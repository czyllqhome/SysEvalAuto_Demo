"""Model output budgets, identifiers, and unusable-response accounting."""

import asyncio
import json

import httpx
import pytest
from app import ai
from app.domain import DomainError


def test_prd_schema_requires_one_slot_per_source_and_server_binds_database_ids():
    source = {"context": {"functions": [{"id": "F-001"}]},
              "controls": [{"id": "control-uuid", "code": "IAM-001"}]}
    schema = ai.output_schema("prd_generation", source)
    assert schema["properties"]["requirements"]["required"] == ["REQ-001", "REQ-002"]
    assert schema["properties"]["requirements"]["additionalProperties"] is False
    assert "source_control_ids" not in schema["$defs"]["RequirementContent"]["properties"]
    assert ai.prd_slots(source)[1]["source_control_ids"] == ["control-uuid"]


def test_empty_source_list_requires_empty_references():
    source = {"context": {"functions": []}, "controls": []}
    slots = ai.output_schema("prd_generation", source)["properties"]["requirements"]
    assert slots["properties"] == {} and slots["required"] == []


def test_model_cannot_omit_a_control_or_inject_a_source_mapping():
    source = {"context": {"functions": [{"id": "F-001"}]}, "controls": [{"id": "control-uuid"}]}
    content = {"title": "Requirement", "description": "Verify intended behavior", "priority": "must",
               "acceptance_criteria": ["Retain successful and denied-access evidence"], "dependencies": []}
    def response(requirements):
        return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({
            "title": "PRD", "summary": "Confirmed scope", "requirements": requirements,
            "assumptions": [], "open_questions": []})}}]}
    with pytest.raises(ai.ModelResponseError, match="INCOMPLETE_COVERAGE"):
        ai.parse_model_response(response({"REQ-001": content}), "prd_generation", "test/model", source)
    output, _ = ai.parse_model_response(response({"REQ-001": content, "REQ-002": content}), "prd_generation", "test/model", source)
    from app.domain import validate_prd
    validated = validate_prd(output, source["context"], source["controls"])
    assert validated["requirements"][0]["source_context_item_ids"] == ["F-001"]
    assert validated["requirements"][1]["source_control_ids"] == ["control-uuid"]
    with pytest.raises(ai.ModelResponseError, match="MODEL_SCHEMA_INVALID"):
        ai.parse_model_response(response({"REQ-001": content, "REQ-002": {**content, "source_control_ids": ["invented"]}}),
                                "prd_generation", "test/model", source)


@pytest.mark.parametrize("finish,content,expected", [
    ("length", '{"requirements":[', "MODEL_OUTPUT_TRUNCATED"),
    ("stop", '{"requirements":[', "MODEL_JSON_INVALID"),
    ("stop", '[]', "MODEL_SCHEMA_INVALID"),
])
def test_unusable_outputs_preserve_usage_without_storing_content(finish, content, expected):
    body = {"choices": [{"finish_reason": finish, "message": {"content": content}}],
            "usage": {"total_tokens": 1234, "completion_tokens": 1000,
                      "completion_tokens_details": {"reasoning_tokens": 900}, "cost": 0.001}}
    with pytest.raises(ai.ModelResponseError) as exc:
        ai.parse_model_response(body, "prd_generation", "test/model")
    assert exc.value.code == expected
    assert exc.value.usage["tokens"] == 1234
    assert exc.value.usage["reasoning_tokens"] == 900
    assert exc.value.usage["finish_reason"] == finish
    assert content not in json.dumps(exc.value.usage)


def test_reasoning_budget_is_sent_separately_from_total_output_limit(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "test/model")
    monkeypatch.setenv("OPENROUTER_REASONING_TOKENS", "2048")
    monkeypatch.setenv("SYSEVAL_MAX_OUTPUT_TOKENS", "12000")
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": "{}"}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    asyncio.run(ai.generate("context_organization", {}, "en", "openrouter"))
    assert seen[0]["reasoning"] == {"max_tokens": 2048, "exclude": True}
    assert seen[0]["max_tokens"] == 12000
    assert seen[0]["provider"]["require_parameters"] is True


@pytest.mark.parametrize("budget", ["12000", "-1", "0", "not-a-number"])
def test_invalid_budget_cannot_call_a_provider(monkeypatch, budget):
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "test/model")
    monkeypatch.setenv("OPENROUTER_REASONING_TOKENS", budget)
    monkeypatch.setenv("SYSEVAL_MAX_OUTPUT_TOKENS", "12000")
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kwargs: pytest.fail("Invalid config must not call a provider"))
    with pytest.raises(DomainError, match="MODEL_CONFIG_INVALID"):
        asyncio.run(ai.generate("context_organization", {}, "en", "openrouter"))


def test_total_deadline_stops_a_keepalive_response_without_claiming_zero_cost(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "test/model")
    monkeypatch.delenv("OPENROUTER_REASONING_TOKENS", raising=False)
    class Deadline:
        async def __aenter__(self):
            raise TimeoutError()
        async def __aexit__(self, *args):
            return False
    monkeypatch.setattr(ai.asyncio, "timeout", lambda seconds: Deadline())
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kwargs: pytest.fail("Deadline already expired"))
    with pytest.raises(ai.ModelResponseError, match="MODEL_RESPONSE_TIMEOUT") as exc:
        asyncio.run(ai.generate("context_organization", {}, "en", "openrouter"))
    assert exc.value.usage["usage_unknown"] is True
    assert "cost" not in exc.value.usage
