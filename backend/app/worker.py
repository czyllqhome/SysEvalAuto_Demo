"""Durable job worker. Run as a separate process outside local development."""

from __future__ import annotations

import asyncio
import os
import random
import time

import httpx
from pydantic import ValidationError
from sqlalchemy import or_, select, update

from .ai_settings import active_config
from .ai import MODEL_RESPONSE_TIMEOUT, generate, redact_source
from .db import Audit, Base, Job, System, database_url, make_engine, make_sessions, uid
from .domain import DomainError, digest
from .service import job_input, publish_job


def claim_job(sessions):
    now = time.time()
    with sessions.begin() as db:
        job = db.scalar(select(Job).where(
            or_(Job.state == "queued", (Job.state == "running") & (Job.lease_until < now)),
            Job.next_run <= now
        ).order_by(Job.created_at).with_for_update(skip_locked=True))
        if not job:
            return None
        if job.attempts >= 3:
            job.state, job.error, job.lease_until = "failed", "JOB_FAILED", 0
            return None
        previous_fence, fence = job.fence, uid()
        changed = db.execute(update(Job).where(Job.id == job.id, Job.fence == previous_fence).values(
            state="running", fence=fence, lease_until=now + MODEL_RESPONSE_TIMEOUT + 60, attempts=Job.attempts + 1))
        if changed.rowcount != 1:
            return None
        return job.id, fence


async def run_once(sessions):
    claimed = claim_job(sessions)
    if not claimed:
        return False
    job_id, fence = claimed
    with sessions() as db:
        job = db.get(Job, job_id)
        kind, source, language, mode = job.kind, job.input, job.language, job.mode
        config = job.usage.get("ai_config")
        if kind == 'prd_generation' and job.usage.get('prd_template'):
            config = {**(config or {}), 'prd_document_template': job.usage['prd_template']}
    config_token = active_config.set(config)
    error = None
    observed_usage = None
    try:
        # Offline drafts preserve authored text. Only external payloads are redacted.
        output, usage = await generate(kind, redact_source(source) if mode == "openrouter" else source,
                                       language, mode)
        observed_usage = usage
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
            if job.fence != fence or job.state != "running":
                return True
            system = db.scalar(select(System).where(System.id == job.system_id).with_for_update())
            job.usage = {**job.usage, **usage, "tokens": job.usage.get("tokens", 0) + usage.get("tokens", 0)}
            try:
                current_hash = digest(job_input(db, system, kind))
            except DomainError:
                current_hash = "stale"
            if current_hash != job.source_hash:
                job.state = "stale"
            else:
                publish_job(db, system, job, output)
                job.state = "succeeded"
                job.error = ""
            job.lease_until = 0
    except DomainError as exc:
        error = exc.code
        observed_usage = getattr(exc, "usage", observed_usage)
    except ValidationError:
        error = "MODEL_SCHEMA_INVALID"
    except (httpx.HTTPError, TimeoutError):
        error = "MODEL_RETRYABLE"
    except Exception:
        # Never include model payloads or credentials in an operational error.
        error = "JOB_FAILED"
    finally:
        active_config.reset(config_token)
    if error:
        with sessions.begin() as db:
            job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
            if job.fence == fence and job.state == "running":
                if observed_usage:
                    job.usage = {**job.usage, **observed_usage, "tokens": job.usage.get("tokens", 0) + observed_usage.get("tokens", 0)}
                repairable = error in {"INVALID_MODEL_OUTPUT", "MODEL_JSON_INVALID", "MODEL_SCHEMA_INVALID",
                                       "INVALID_SOURCE_REFERENCE", "INCOMPLETE_COVERAGE"}
                retry = (error == "MODEL_RETRYABLE" and job.attempts < 3) or (repairable and job.attempts < 2)
                job.state = "queued" if retry else "failed"
                job.next_run = time.time() + 2 ** job.attempts + random.random()
                job.error, job.lease_until = error, 0
                db.add(Audit(system_id=job.system_id, action="job.retry" if retry else "job.failed",
                             detail={"job_id": job_id, "code": error}))
    return True


async def loop(sessions, stop: asyncio.Event):
    while not stop.is_set():
        try:
            worked = await run_once(sessions)
        except Exception:
            worked = False
        try:
            await asyncio.wait_for(stop.wait(), timeout=0.1 if worked else 0.75)
        except TimeoutError:
            pass


async def main():
    engine = make_engine(database_url())
    if os.getenv("SYSEVAL_AUTO_CREATE", "true") == "true":
        Base.metadata.create_all(engine)
    await loop(make_sessions(engine), asyncio.Event())


if __name__ == "__main__":
    asyncio.run(main())
