# Running Scope

The default command serves the built frontend and API at loopback port 8000 and
runs one embedded worker. Compose separates API, worker, migration, and PostgreSQL.

## PostgreSQL deployment

Create this application's `.env` from `.env.example`. Replace the development
password in both `POSTGRES_PASSWORD` and `SYSEVAL_DATABASE_URL`. Empty model settings
leave only the explicitly selected local draft mode available.

```powershell
Copy-Item .env.example .env
# Edit the application settings before starting the deployment.
docker compose --env-file .env -f deploy/compose.yaml up --build -d
```

Open [the Compose workspace](http://127.0.0.1:8080). Its host port binds only to
loopback. PostgreSQL uses a named volume and has no exposed host port. Migrations
finish before API/worker startup. Images use pinned base digests and hash-locked
Python runtime dependencies; application processes run as a non-root user.

Stop without removing stored data:

```powershell
docker compose --env-file .env -f deploy/compose.yaml stop
```

Do not use volume-removal flags against a database containing needed records. The
application contains no command that clears runtime data. A new customer receives
an internal starter catalog without replacing another organization's records.

## Configuration

| Setting | Meaning |
|---|---|
| `SYSEVAL_DATABASE_URL` | SQLAlchemy URL; default is a local SQLite file. |
| `SYSEVAL_PORT` | `run.py` port; default 8000. |
| `SYSEVAL_EMBEDDED_WORKER` | `true` locally; `false` with a separate worker. |
| `SYSEVAL_AUTO_CREATE` | `true` bootstraps local tables; deployed systems use `false` and Alembic. |
| `SYSEVAL_PUBLIC_ORIGIN` | Exact allowed mutation origin; use the deployed HTTPS origin. |
| `SYSEVAL_COOKIE_SECURE` | `true` with HTTPS so session cookies require TLS. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Required together to enable the model option. |
| `OPENROUTER_PROVIDERS` | Optional provider allowlist; failures never relax it. |
| `OPENROUTER_ZDR` | Restrict to compatible zero-retention endpoints. |
| `OPENROUTER_REASONING_TOKENS` | Optional reasoning token budget; positive integer below the total output cap. Requires model/provider support. |
| `SYSEVAL_MAX_OUTPUT_TOKENS` | Requested output cap per call; default 12000. |
| `SYSEVAL_SYSTEM_TOKEN_BUDGET` | Recorded-usage threshold blocking new jobs; default 500000. |
| `SYSEVAL_ENV_FILE` | Alternate service env file for Compose. |
| `SYSEVAL_TEST_DATABASE_URL` | Dedicated test database; tests create/remove their own random schemas. |

`python run.py` loads only `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
`OPENROUTER_PROVIDERS`, `OPENROUTER_ZDR`, and optional `OPENROUTER_REASONING_TOKENS`
from the project-root `.env` file.
Explicit process environment values take precedence, including empty values.
Other local settings must be process variables; this avoids importing Compose-only
database hosts or disabling the local worker. Restart and refresh after changes.
Direct Uvicorn/worker commands read process environment; Compose explicitly
loads its selected file. Never commit runtime secrets. The upstream model URL is
fixed; the application does not accept an arbitrary user-supplied endpoint.

Use the full model ID from the OpenRouter model catalog. The model author and the
inference provider are different identifiers: `qwen/qwen3.8-flash` is a model ID;
its provider slug is `alibaba`, not `qwen`. Check the model's endpoint directory
before restricting `OPENROUTER_PROVIDERS`. An incompatible allowlist, privacy
policy, or parameter requirement can produce HTTP 404 without a model refusal.
Routing, authentication, credits, invalid parameters, and explicit refusals have
separate UI errors. Upstream error bodies are not persisted or shown to users.

## Migrations and backup

```powershell
uv run --project backend alembic -c backend/alembic.ini upgrade head
```

Back up before structural upgrades. For SQLite, stop the server and use SQLite's
backup API or a consistent copy; copying a live database must account for its WAL
state. PostgreSQL operators should use `pg_dump` or managed backups and verify
restoration in an isolated environment. Destructive downgrades are disabled.
`create_all` bootstraps a local installation; it does not replace future migrations.

Jobs survive restart. Workers publish only while the lease/fencing token and source
hash remain current. Leases expire after 300 seconds and permit recovery within
three attempts. Invalid structured output has at most one additional attempt.
External requests have a 240-second total deadline, in addition to connection/read
timeouts. Deadline failures stop the task without an automatic duplicate request;
usage remains explicitly unknown when the provider did not return it.
An output-limit response is not automatically repeated with identical parameters.
Reported tokens are retained even when a response is truncated, invalid JSON, or
fails document validation. No unfinished content is published. Only safe finish
and usage metadata is retained for transport-level failures; model content and
reasoning text are not copied into error logs.
Failed/stale results do not advance business state.

## Authentication and deployment boundaries

Local accounts use salted scrypt hashes, opaque hashed session tokens, HttpOnly/
SameSite cookies, CSRF checks, object authorization, and bounded per-process login
attempts. Sessions expire after 12 hours and invitations after seven days. Local
accounts do not provide email verification, recovery, SSO, or verified legal
identity. Integrate organizational identity before treating confirmations as
externally verified organizational approvals.

React renders authored/model text without executing raw HTML. Markdown files are
downloaded as attachments. Contact redaction reduces unnecessary external input;
operators still decide which business information may be sent to approved providers.

The application supports customer-organization and supplier-assignment boundaries;
it is not a measured high-availability service. Configure HTTPS, network controls,
monitored backups, retention, centralized throttling, and worker alerts before a
wider deployment. No cloud service or external messaging was activated by local setup.

## Delivery evidence operations (2026-11-02)

Apply `delivery_evidence` after `existing_assessments` using the existing Alembic deployment
procedure. Back up the configured database before migration; the migration adds tables and
does not rewrite existing baselines. Local auto-create creates missing tables on restart.
Do not reset `.syseval/assessment.db`. Evidence bytes are stored in that same configured
database, not an uploads directory. Backups and restore verification must include attachment
bytes, SHA-256 hashes, submission manifests and review references. Use a consistent SQLite
backup (including committed WAL content), not a live copy of only the main database file.

Uploads are bounded to 20 MiB each, 100 MiB/10 files per submission and 1 GiB per assessment.
Four in-memory upload readers per API process and a 120-second timeout bound ingestion;
configure global rate limits at the deployment proxy for multiple workers. PDF/Office files
download as attachments; only safely re-encoded screenshots preview inline. Format validation
is not malware scanning. No physical evidence cleanup or external model transmission occurs.
