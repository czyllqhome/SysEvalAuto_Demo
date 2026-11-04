"""Exercise the deployed API and separate worker using an isolated synthetic organization.

This script creates records and never clears a database or calls an external model.
"""

import argparse
import secrets
import time

import httpx


def run(url):
    password = secrets.token_urlsafe(24)
    suffix = secrets.token_hex(5)
    owner = httpx.Client(base_url=f"{url.rstrip('/')}/api/v1", timeout=15)
    vendor = httpx.Client(base_url=f"{url.rstrip('/')}/api/v1", timeout=15)

    def request(client, method, path, body=None):
        response = client.request(method, path, json=body)
        if response.status_code != 200:
            raise RuntimeError(f"{method} {path}: {response.status_code} {response.text[:300]}")
        return response.json()

    def register(client, email, **extra):
        data = request(client, "POST", "/auth/register", {"name": "Deployment verification", "organization": "Synthetic QA",
                       "email": email, "password": password, **extra})
        client.headers["X-CSRF-Token"] = data["csrf"]

    try:
        register(owner, f"smoke-owner-{suffix}@example.test")
        system = request(owner, "POST", "/systems", {"name": f"Deployment smoke {suffix}"})
        system_id = system["system"]["id"]
        def command(client, path, body=None):
            latest = request(client, "GET", f"/systems/{system_id}")
            return request(client, "POST", path, {"version": latest["system"]["version"], **(body or {})})
        def wait(job_id):
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                job = request(owner, "GET", f"/jobs/{job_id}")
                if job["state"] == "succeeded":
                    return
                if job["state"] in {"failed", "stale"}:
                    raise RuntimeError(f"Worker did not publish: {job['error']}")
                time.sleep(.25)
            raise RuntimeError("The deployed worker did not finish within 30 seconds")
        prefix = f"/systems/{system_id}"
        command(owner, prefix + "/classification-confirmations", {"mode": "manual", "level": "L2", "reason": "Synthetic local deployment verification"})
        brief = {"summary": "Verify the deployed workflow", "functions": [{"id": "F-1", "title": "Create a ticket", "description": "Create a service ticket", "source_blocks": []}],
                 "departments": ["Service"], "roles": ["Agent"], "owner_role": "Service lead", "scope": "Tickets only; billing excluded"}
        command(owner, prefix + "/context-confirmations", {"context": brief})
        job = command(owner, prefix + "/jobs", {"kind": "prd_generation", "mode": "local", "language": "en"})
        wait(job["job_id"])
        command(owner, prefix + "/prd-approval")
        email = f"smoke-supplier-{suffix}@example.test"
        assignment = command(owner, prefix + "/supplier-rounds", {"supplier_name": "Synthetic supplier", "email": email})
        register(vendor, email, invite_token=assignment["invite_token"])
        state = request(vendor, "GET", prefix)
        answers = {r["id"]: {"implementation_status": "yes", "duration_workdays": 5,
                             "owner_name": "Synthetic delivery owner", "implementation_plan": "Implement and retain reproducible acceptance evidence"}
                   for r in state["prd"]["data"]["requirements"]}
        submitted = command(vendor, prefix + "/supplier-submit", {"answers": answers,
                            "round_version": state["round"]["version"], "mode": "local", "language": "en"})
        wait(submitted["job_id"])
        state = request(owner, "GET", prefix)
        decisions = {f["id"]: {"decision": "accept", "reason": "Synthetic owner will verify acceptance evidence"}
                     for f in state["report"]["data"]["findings"]}
        command(owner, prefix + "/review-decisions", {"decisions": decisions,
                "exception_reason": "Customer accepts the documented classification unknowns for this synthetic verification"})
        baseline = command(owner, prefix + "/baselines")["baseline"]
        for client in (owner, vendor):
            command(client, f"/baselines/{baseline['id']}/confirmations", {"content_hash": baseline["content_hash"]})
        finished = command(owner, f"/baselines/{baseline['id']}/finalize")
        assert finished["system"]["status"] == "PENDING_DEVELOPMENT"
        print(f"Deployment smoke passed: separate worker, immutable submission, joint confirmation, ready baseline. System {system_id}")
    finally:
        owner.close()
        vendor.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    run(parser.parse_args().url)
