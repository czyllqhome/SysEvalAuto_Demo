"""Routing and API failures must never be misreported as a model refusal."""

import asyncio

import httpx
import pytest
from app import ai
from app.domain import DomainError


@pytest.mark.parametrize("http_status,body,expected", [
    (404, {"error": {"code": 404, "message": "No allowed providers; provider.only permits an author name"}}, "MODEL_PROVIDER_UNAVAILABLE"),
    (400, {"error": {"message": "Unsupported schema"}}, "MODEL_INVALID_REQUEST"),
    (401, {}, "MODEL_AUTH_FAILED"), (402, {}, "MODEL_BALANCE_EXCEEDED"),
    (403, {}, "MODEL_ACCESS_DENIED"), (422, {}, "MODEL_INVALID_REQUEST"),
    (408, {}, "MODEL_RETRYABLE"), (429, {}, "MODEL_RETRYABLE"),
    (503, {}, "MODEL_RETRYABLE"),
    (200, {"error": {"code": 404, "message": "No endpoint"}}, "MODEL_PROVIDER_UNAVAILABLE"),
    (200, {"error": "Provider rejected parameters"}, "MODEL_INVALID_REQUEST"),
    (200, {"choices": [{"finish_reason": "stop", "message": {"refusal": "Policy refusal"}}]}, "MODEL_REFUSED"),
    (200, {"choices": [{"finish_reason": "content_filter", "message": {"content": ""}}]}, "MODEL_REFUSED"),
])
def test_model_errors_are_classified_without_exposing_upstream_text(monkeypatch, http_status, body, expected):
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-private-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "test/model")
    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(http_status, json=body))
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kwargs: original_client(transport=transport, **kwargs))
    with pytest.raises(DomainError) as exc:
        asyncio.run(ai.generate("context_organization", {}, "en", "openrouter"))
    assert exc.value.code == expected
    assert exc.value.detail is None
    assert "synthetic-private-key" not in str(exc.value)
