# Project instructions

This is a standalone system-assessment and supplier-collaboration application.
This independent Demo checkout is `A:\SysEvalAuto_Demo_v0.1`, copied with user authorization from `A:\SysEvalAuto-v0.0.1`.
Use this Demo directory for all commands and edits. Do not redirect edits to the original checkout.
See `DEMO.md` for local startup and isolation details.
Runtime data is exclusively `.syseval/assessment.db` unless explicitly overridden.
Read `README.md`, `docs/implementation.md`, and `development-specification.md`
before making substantial changes.

- Keep application dependencies in `backend/pyproject.toml` and `frontend/package.json`.
- Preserve `.syseval/` records and backups. Never reset runtime data without explicit approval.
- Keep credentials in server configuration; never commit `.env`, runtime data, or keys.
- Maintain Chinese and English interface copy. Language changes must preserve authored text.
- Keep rule-based drafts visibly distinct from model-generated results.
- Add offline deterministic regression coverage for business behavior changes.
- Preserve source references, revision checks, organization boundaries, and independent
  customer/supplier confirmation of the same baseline hash.
- Update affected documentation with code changes.

Checks from the project root:

```powershell
uv run --project backend --extra dev python -m pytest evals/deterministic -q
uv run --project backend --extra dev ruff check backend/app backend/migrations evals run.py
npm --prefix frontend test
npm --prefix frontend run build
```
