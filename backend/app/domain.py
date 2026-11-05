"""Pure business rules and validated, language-neutral data contracts."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

TOPICS = ("goal", "functions", "people", "responsibility", "workflow", "data", "constraints", "acceptance")
DOMAINS = ("IAM", "DATA", "AUDIT", "RESILIENCE", "DELIVERY")
APPLICABILITY_TAGS = ("external_access", "personal_data", "production_admin", "payments")
LEVELS = ("L1", "L2", "L3")


class DomainError(Exception):
    def __init__(self, code: str, status: int = 422, detail=None):
        self.code, self.status, self.detail = code, status, detail
        super().__init__(code)


def digest(value) -> str:
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def classify(answers: dict, mode: str, chosen: str | None, reason: str = "") -> dict:
    if not isinstance(answers, dict) or not isinstance(reason, str) or len(reason) > 8000:
        raise DomainError("INVALID_CLASSIFICATION")
    if mode not in ("questionnaire", "manual") or any(
        key not in {f"Q{i}" for i in range(1, 6)} or value not in (*LEVELS, "unknown")
        for key, value in answers.items()
    ):
        raise DomainError("INVALID_CLASSIFICATION")
    if any(answers.get(q) == "L3" for q in ("Q4", "Q5")):
        raise DomainError("INVALID_CLASSIFICATION")
    unknown = [f"Q{i}" for i in range(1, 6) if answers.get(f"Q{i}", "unknown") == "unknown"]
    recommended = None
    if mode == "questionnaire" or answers:
        rank = max([LEVELS.index(v) for v in answers.values() if v in LEVELS] or [0])
        if unknown:
            rank = max(rank, 1)
        recommended = LEVELS[rank]
    if mode == "manual" and (chosen not in LEVELS or not reason.strip()):
        raise DomainError("MANUAL_REASON_REQUIRED")
    effective = chosen if mode == "manual" else recommended
    exceptions = []
    if unknown:
        exceptions.append({"code": "UNRESOLVED_CLASSIFICATION", "questions": unknown})
    if recommended and LEVELS.index(effective) < LEVELS.index(recommended):
        exceptions.append({"code": "MANUAL_DOWNGRADE", "recommended": recommended, "chosen": effective})
    return {"mode": mode, "effective_level": effective, "recommended_level": recommended,
            "answers": answers, "reason": reason, "exceptions": exceptions,
            "scheme": "SYS-RISK/R1", "input_hash": digest(answers)}


def context_grade_facts(context: dict, previous: dict) -> dict:
    facts = dict(context.get("grading_facts", {}))
    for tag, question, minimum in (
        ("external_access", "Q4", "L2"), ("personal_data", "Q1", "L2"),
        ("production_admin", "Q3", "L3"),
    ):
        current = facts.get(question, previous.get(question, "unknown"))
        if context.get("applicability_tags", {}).get(tag) == "yes":
            if current == "unknown" or LEVELS.index(current) < LEVELS.index(minimum):
                facts[question] = minimum
    return facts


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ContextItem(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=4000)
    source_blocks: list[str] = Field(default_factory=list)


class Context(StrictModel):
    summary: str = Field(default="", max_length=10000)
    functions: list[ContextItem] = Field(default_factory=list, max_length=100)
    departments: list[str] = Field(default_factory=list, max_length=40)
    roles: list[str] = Field(default_factory=list, max_length=80)
    owner_role: str = Field(default="", max_length=200)
    workflow: str = Field(default="", max_length=10000)
    data_notes: str = Field(default="", max_length=5000)
    integrations: str = Field(default="", max_length=5000)
    constraints: str = Field(default="", max_length=5000)
    scope: str = Field(default="", max_length=5000)
    questions: list[str] = Field(default_factory=list, max_length=30)
    grading_facts: dict[str, Literal["L1", "L2", "L3", "unknown"]] = Field(default_factory=dict)
    applicability_tags: dict[str, Literal["yes", "no", "unknown"]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({f.id for f in self.functions}) != len(self.functions):
            raise ValueError("Duplicate function identifiers")
        if any(key not in {f"Q{i}" for i in range(1, 6)} for key in self.grading_facts):
            raise ValueError("Unknown classification fact")
        if any(self.grading_facts.get(key) == "L3" for key in ("Q4", "Q5")):
            raise ValueError("Exposure and reach do not independently trigger L3")
        if not set(self.applicability_tags) <= set(APPLICABILITY_TAGS):
            raise ValueError("Unknown applicability tag")
        return self


def validate_context(data: dict) -> dict:
    context = Context.model_validate(data).model_dump()
    if not context["functions"]:
        raise DomainError("CONTEXT_INCOMPLETE")
    if any(not name.strip() for name in context["departments"] + context["roles"]):
        raise DomainError("CONTEXT_INCOMPLETE")
    return context


class Requirement(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1, max_length=8000)
    priority: Literal["must", "should", "could"] = "must"
    origin: Literal["business", "control", "both"]
    source_context_item_ids: list[str] = Field(default_factory=list)
    source_control_ids: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(min_length=1, max_length=20)
    dependencies: list[str] = Field(default_factory=list)


class PrdDocument(StrictModel):
    title: str = Field(min_length=1, max_length=500)
    summary: str = Field(min_length=1, max_length=10000)
    requirements: list[Requirement] = Field(min_length=1, max_length=1000)
    assumptions: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


def validate_prd(data: dict, context: dict, controls: list[dict]) -> dict:
    result = PrdDocument.model_validate(data).model_dump()
    functions = {item["id"] for item in context["functions"]}
    control_ids = {item["id"] for item in controls}
    covered_functions, covered_controls = set(), set()
    requirements = {item["id"] for item in result["requirements"]}
    if len(requirements) != len(result["requirements"]):
        raise DomainError("INVALID_MODEL_OUTPUT")
    for requirement in result["requirements"]:
        if any(not criterion.strip() for criterion in requirement["acceptance_criteria"]):
            raise DomainError("INVALID_MODEL_OUTPUT")
        fs, cs = set(requirement["source_context_item_ids"]), set(requirement["source_control_ids"])
        if not fs <= functions or not cs <= control_ids or not (fs or cs):
            raise DomainError("INVALID_SOURCE_REFERENCE")
        if requirement["origin"] in ("business", "both") and not fs:
            raise DomainError("INVALID_SOURCE_REFERENCE")
        if requirement["origin"] in ("control", "both") and not cs:
            raise DomainError("INVALID_SOURCE_REFERENCE")
        if not set(requirement["dependencies"]) <= requirements:
            raise DomainError("INVALID_SOURCE_REFERENCE")
        covered_functions |= fs
        covered_controls |= cs
    if functions != covered_functions or control_ids != covered_controls:
        raise DomainError("INCOMPLETE_COVERAGE")
    return result


class SupplierAnswer(StrictModel):
    implementation_status: Literal["yes", "partial", "no", "needs_clarification"]
    duration_workdays: int | None = Field(default=None, gt=0, le=10000)
    estimated_start_date: date | None = None
    estimated_finish_date: date | None = None
    owner_name: str = Field(default="", max_length=200)
    implementation_plan: str = Field(default="", max_length=10000)
    limitations: str = Field(default="", max_length=10000)
    alternative: str = Field(default="", max_length=10000)

    @model_validator(mode="before")
    @classmethod
    def normalize_unavailable_duration(cls, value):
        if (isinstance(value, dict) and value.get("implementation_status") in ("no", "needs_clarification")
                and type(value.get("duration_workdays")) is int and value["duration_workdays"] == 0):
            return {**value, "duration_workdays": None}
        return value

    @model_validator(mode="after")
    def conditional_fields(self):
        if self.implementation_status in ("partial", "no", "needs_clarification") and not self.limitations.strip():
            raise ValueError("Explain the gap or clarification question")
        if self.estimated_start_date and self.estimated_finish_date:
            if self.estimated_finish_date < self.estimated_start_date:
                raise ValueError("Finish date precedes start date")
        return self


class RiskEvidence(StrictModel):
    path: str
    quote: str


class ContextualRisk(StrictModel):
    exposure: str
    exploitation_conditions: str
    mitigations: str
    uncertainties: list[str]
    facts: list[RiskEvidence]


class Finding(StrictModel):
    id: str
    requirement_id: str
    severity: Literal["low", "medium", "high", "critical", "unknown"]
    title: str
    evidence_field: Literal["implementation_status", "implementation_plan", "limitations", "alternative"]
    evidence: str
    impact: str
    recommendation: str
    contextual_assessment: ContextualRisk | None = None


class ImpactDocument(StrictModel):
    summary: str
    findings: list[Finding]


def validate_report(data: dict, requirements: list[dict], answers: dict, *, contextual_source=None) -> dict:
    report = ImpactDocument.model_validate(data).model_dump()
    ids = {item["id"] for item in requirements}
    seen = set()
    for finding in report["findings"]:
        rid = finding["requirement_id"]
        if rid not in ids or rid not in answers or finding["id"] in seen:
            raise DomainError("INVALID_SOURCE_REFERENCE")
        seen.add(finding["id"])
        status = answers[rid].get("implementation_status")
        context = finding.get('contextual_assessment')
        if context and contextual_source is not None:
            from .risk_context import validate_contextual_risk
            validate_contextual_risk(context, contextual_source)
            if context['uncertainties'] and finding['severity'] in ('low', 'medium'):
                finding['severity'] = 'unknown'
        if status in ("partial", "no") and not (context and contextual_source is not None):
            finding["severity"] = "medium" if status == "partial" else "high"
        source = str(answers[rid].get(finding["evidence_field"], ""))
        if not finding["evidence"] or finding["evidence"] not in source:
            raise DomainError("INVALID_SOURCE_REFERENCE")
    if {f["requirement_id"] for f in report["findings"]} != ids:
        raise DomainError("INCOMPLETE_COVERAGE")
    return report
