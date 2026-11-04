"""Local server entry point; only model settings are read from the project env file."""

from __future__ import annotations

import os
from pathlib import Path

import uvicorn
from dotenv import dotenv_values

MODEL_SETTINGS = (
    "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_PROVIDERS", "OPENROUTER_ZDR",
    "OPENROUTER_REASONING_TOKENS",
)
ROOT = Path(__file__).resolve().parents[2]


def load_model_settings(path: Path, environ=None):
    """Preserve explicit process settings and ignore Compose-only configuration."""
    target = os.environ if environ is None else environ
    if not path.is_file():
        return
    values = dotenv_values(path, encoding="utf-8-sig", interpolate=False)
    for name in MODEL_SETTINGS:
        value = values.get(name)
        if value is not None:
            target.setdefault(name, value)


def main():
    load_model_settings(ROOT / ".env")
    missing = [name for name in MODEL_SETTINGS[:2] if not os.getenv(name, "").strip()]
    print("OpenRouter: " + ("missing " + ", ".join(missing) if missing else "configured"), flush=True)
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.getenv("SYSEVAL_PORT", "8000")))


if __name__ == "__main__":
    main()
