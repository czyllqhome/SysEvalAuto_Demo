"""Run the built local application without changing or clearing runtime data."""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
print(f"Application root: {ROOT}", flush=True)
environment_python = ROOT / "backend" / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
python = str(environment_python) if environment_python.exists() else sys.executable

if not (ROOT / "frontend" / "dist" / "index.html").exists():
    raise SystemExit("Build the frontend first: cd frontend, npm ci, npm run build")
if python == sys.executable and importlib.util.find_spec("uvicorn") is None:
    raise SystemExit("Install backend dependencies first: uv sync --project backend")

try:
    child_environment = os.environ.copy()
    child_environment["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(ROOT / "backend"), os.getenv("PYTHONPATH", "")) if part
    )
    process = subprocess.Popen([python, "-m", "app.local"], cwd=ROOT, env=child_environment)
    process.wait()
except KeyboardInterrupt:
    process.terminate()
    process.wait(timeout=10)
