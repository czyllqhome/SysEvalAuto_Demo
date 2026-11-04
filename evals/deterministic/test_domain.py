import copy
import csv
import io

import pytest
from app.ai import generate, local_prd, output_schema, redact_source
from app.catalog import parse_import
from app.domain import DomainError, SupplierAnswer, classify, context_grade_facts, validate_prd
from pydantic import ValidationError


@pytest.mark.parametrize("answers,expected", [
    ({f"Q{i}": "L1" for i in range(1, 6)}, "L1"),
    ({"Q1": "L1", "Q2": "L2", "Q3": "L1", "Q4": "L1", "Q5": "L1"}, "L2"),
    ({"Q1": "L1", "Q2": "L1", "Q3": "L3", "Q4": "L1", "Q5": "L1"}, "L3"),
    ({}, "L2"), ({"Q1": "L3"}, "L3"),
])
def test_classification_uses_highest_risk_and_preserves_unknowns(answers, expected):
    assert classify(answers, "questionnaire", None)["effective_level"] == expected


def test_manual_skip_does_not_fabricate_a_recommendation():
    result = classify({}, "manual", "L1", "Bounded pilot; owner accepts unknowns")
    assert result["recommended_level"] is None
    assert result["effective_level"] == "L1"
    assert result["exceptions"][0]["code"] == "UNRESOLVED_CLASSIFICATION"


def test_manual_downgrade_preserves_the_rule_outcome():
    result = classify({"Q1": "L3"}, "manual", "L1", "A documented exception")
    assert result["recommended_level"] == "L3"
    assert any(e["code"] == "MANUAL_DOWNGRADE" for e in result["exceptions"])


def test_accepted_context_tags_raise_proposed_facts_without_lowering_prior_risk():
    previous = {"Q1": "L3", "Q3": "L1", "Q4": "unknown"}
    context = {"applicability_tags": {"personal_data": "yes", "production_admin": "yes", "external_access": "yes"}}
    assert context_grade_facts(context, previous) == {"Q3": "L3", "Q4": "L2"}
    assert previous == {"Q1": "L3", "Q3": "L1", "Q4": "unknown"}


@pytest.mark.parametrize("answers,reason", [(None, ""), ([], ""), ({}, None), ({}, "x" * 8001)])
def test_malformed_classification_is_a_domain_error(answers, reason):
    with pytest.raises(DomainError, match="INVALID_CLASSIFICATION"):
        classify(answers, "questionnaire", None, reason)


@pytest.mark.parametrize("mode,answers,level,reason", [
    ("manual", {}, "L1", ""), ("manual", {}, "L4", "reason"),
    ("questionnaire", {"Q4": "L3"}, None, ""),
    ("questionnaire", {"Q6": "L1"}, None, ""),
])
def test_classification_rejects_unsupported_inputs(mode, answers, level, reason):
    with pytest.raises(DomainError):
        classify(answers, mode, level, reason)


@pytest.mark.parametrize("data", [
    {"implementation_status": "yes", "duration_workdays": -1},
    {"implementation_status": "yes", "duration_workdays": 5, "owner_name": "Owner"},
    {"implementation_status": "partial", "duration_workdays": 5, "owner_name": "Owner", "implementation_plan": "Implement"},
    {"implementation_status": "no"},
    {"implementation_status": "needs_clarification"},
    {"implementation_status": "no", "limitations": "Not available", "estimated_start_date": "2026-10-10", "estimated_finish_date": "2026-10-01"},
])
def test_submission_conditionals_and_dates_are_validated(data):
    with pytest.raises(ValidationError):
        SupplierAnswer.model_validate(data)


def test_no_implementation_does_not_require_a_fictional_schedule():
    answer = SupplierAnswer.model_validate({"implementation_status": "no", "limitations": "Outside supported platform"})
    assert answer.duration_workdays is None


def test_business_requirements_do_not_need_artificial_control_sources():
    source = {"name": "Portal", "context": {"summary": "Improve service", "functions": [
        {"id": "F-1", "title": "Create tickets", "description": "Create a customer ticket"}]}, "controls": []}
    generated = local_prd(source, "en")
    assert validate_prd(generated, source["context"], [])["requirements"][0]["source_control_ids"] == []
    modified = copy.deepcopy(generated)
    modified["requirements"][0]["source_context_item_ids"] = ["invented"]
    with pytest.raises(DomainError, match="INVALID_SOURCE_REFERENCE"):
        validate_prd(modified, source["context"], [])
    modified = copy.deepcopy(generated)
    context = {**source["context"], "functions": source["context"]["functions"] + [{"id": "F-2"}]}
    with pytest.raises(DomainError, match="INCOMPLETE_COVERAGE"):
        validate_prd(modified, context, [])


def test_csv_quoted_content_bom_and_duplicate_validation():
    columns = ["catalog_code", "catalog_version", "scheme_code", "scheme_revision", "control_code", "domain_code", "title", "description", "applicable_levels", "required", "verification_guidance"]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(columns)
    row = ["CUSTOM", "R1", "SYS-RISK", "R1", "C-1", "IAM", "A quoted, title", "Two\nlines", "L1|L2|L3", "true", "Verify access"]
    writer.writerow(row)
    rows, errors, _ = parse_import(("\ufeff" + output.getvalue()).encode())
    assert not errors
    assert rows[0]["description"] == "Two\nlines"
    writer.writerow(row)
    _, errors, _ = parse_import(output.getvalue().encode())
    assert any(e["row"] == 3 and e["column"] == "control_code" for e in errors)


def test_model_contact_redaction_preserves_non_contact_business_numbers():
    cleaned = redact_source({"text": "Contact owner@example.test or +86 138 1234 5678. Accept 8 hours; REQ-001."})
    assert "owner@example.test" not in cleaned["text"]
    assert "138 1234 5678" not in cleaned["text"]
    assert "8 hours" in cleaned["text"] and "REQ-001" in cleaned["text"]
    assert redact_source({"deadline": "2026-10-19"})["deadline"] == "2026-10-19"


def test_strict_model_schema_closes_objects_and_types_unknown_facts():
    schema = output_schema("context_organization")
    assert set(schema["required"]) == set(schema["properties"])
    assert schema["additionalProperties"] is False
    assert schema["properties"]["grading_facts"]["properties"]["Q1"]["anyOf"][1]["type"] == "null"


def test_openrouter_transport_uses_structured_output_without_a_live_call(monkeypatch):
    import asyncio
    import json

    import httpx
    from app import ai

    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-test-token")
    monkeypatch.setenv("OPENROUTER_MODEL", "test/structured-model")
    seen = []
    source = {"name": "Portal", "context": {"summary": "Improve service", "functions": [
        {"id": "F-1", "title": "Create tickets", "description": "Create a ticket"}]}, "controls": []}
    generated = local_prd(source, "en")
    wire_document = {**generated, "requirements": {"REQ-001": {
        key: value for key, value in generated["requirements"][0].items()
        if key in {"title", "description", "priority", "acceptance_criteria", "dependencies"}}}}
    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "test/structured-model", "usage": {"total_tokens": 42},
                                        "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(wire_document)}}]})
    original_client = httpx.AsyncClient
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    output, usage = asyncio.run(generate("prd_generation", source, "en", "openrouter"))
    assert output["requirements"][0]["title"] == "Create tickets"
    assert usage["tokens"] == 42
    assert seen[0]["provider"]["require_parameters"] is True
    assert seen[0]["provider"]["data_collection"] == "deny"
    assert seen[0]["response_format"]["json_schema"]["strict"] is True
