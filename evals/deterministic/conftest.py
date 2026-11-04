"""Isolated application fixtures. The real workspace database is never cleared."""

import os
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.main import create_app  # noqa: E402


@pytest.fixture(autouse=True)
def legacy_workflow_fixtures(monkeypatch):
    # Existing workflow tests explicitly provision retired examples in isolated databases.
    from app import methodology
    monkeypatch.setattr(methodology, 'LEGACY_FIXTURES_ENABLED', True)


@pytest.fixture
def application(tmp_path):
    base_url = os.getenv("SYSEVAL_TEST_DATABASE_URL")
    schema = "syseval_test_" + uuid.uuid4().hex
    admin_engine = create_engine(base_url) if base_url else None
    if admin_engine:
        with admin_engine.begin() as db:
            db.execute(text(f'CREATE SCHEMA "{schema}"'))
        url = make_url(base_url).update_query_dict({"options": f"-csearch_path={schema}"})
        app = create_app(url, embedded_worker=False)
    else:
        app = create_app(f"sqlite:///{tmp_path / 'test.db'}", embedded_worker=False)
    with TestClient(app) as client:
        yield app, client
    if admin_engine:
        # Only a fresh, randomly named schema created by this fixture is removed.
        assert schema.startswith("syseval_test_") and len(schema) == 45
        with admin_engine.begin() as db:
            db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()


def register(client, email="owner@example.test", **extra):
    response = client.post("/api/v1/auth/register", json={"email": email, "password": "TestOnly-Passphrase",
                           "name": "Test owner", "organization": "Test organization", **extra})
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf"]
    return response.json()


@pytest.fixture
def owner(application):
    app, client = application
    register(client)
    return app, client
