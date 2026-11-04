"""Deterministic current-state verification and remediation contracts.

Authorization, persistence and transaction ownership belong to command services.
"""

from datetime import date
from typing import Literal

from pydantic import ConfigDict, Field, StrictBool, model_validator

from .domain import DomainError, StrictModel


class AssessmentModel(StrictModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class EvidenceReference(AssessmentModel):
    source_id: str = Field(min_length=1, max_length=200)
    source_revision: str = Field(min_length=1, max_length=200)
    environment: str = Field(min_length=1, max_length=200)
    system_version: str = Field(min_length=1, max_length=200)
    collected_on: date
    description: str = Field(min_length=1, max_length=8000)


class ControlVerification(AssessmentModel):
    control_id: str = Field(min_length=1)
    control_revision: str = Field(min_length=1)
    scope_revision: str = Field(min_length=1)
    applicability: Literal['applicable', 'not_applicable', 'pending'] = 'applicable'
    conclusion: Literal['not_assessed', 'insufficient_evidence', 'satisfied', 'partial', 'unsatisfied'] = 'not_assessed'
    reason: str = Field(default='', max_length=8000)
    method: str = Field(default='', max_length=8000)
    evidence: list[EvidenceReference] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def supported_conclusion(self):
        if self.applicability != 'applicable' and self.conclusion != 'not_assessed':
            raise ValueError('Applicability is not an implementation conclusion')
        if self.applicability == 'not_applicable' and not self.reason.strip():
            raise ValueError('Non-applicability needs a reason')
        if self.conclusion != 'not_assessed' and not self.reason.strip():
            raise ValueError('A conclusion needs a reason')
        if self.conclusion in {'satisfied', 'partial', 'unsatisfied'} and (
                not self.evidence or not self.method.strip()):
            raise ValueError('A verified conclusion needs evidence and a method')
        return self


def validate_evidence_scope(verification, environment, system_version, as_of):
    for evidence in verification.evidence:
        if (evidence.environment != environment or evidence.system_version != system_version
                or evidence.collected_on > as_of):
            raise DomainError('EVIDENCE_SCOPE_MISMATCH')


def verification_summary(verifications):
    """Unknowns stay in the denominator; exclusions never become passes."""
    applicable = [v for v in verifications if v.applicability == 'applicable']
    verified = [v for v in applicable if v.conclusion in {'satisfied', 'partial', 'unsatisfied'}]
    return {
        'applicable': len(applicable),
        'pending_applicability': sum(v.applicability == 'pending' for v in verifications),
        'not_applicable': sum(v.applicability == 'not_applicable' for v in verifications),
        'verified': len(verified),
        'satisfied': sum(v.conclusion == 'satisfied' for v in applicable),
        'insufficient_evidence': sum(v.conclusion == 'insufficient_evidence' for v in applicable),
        'coverage': len(verified) / len(applicable) if applicable else None,
    }


def validate_report_coverage(expected_control_ids, verifications, reviewed_limitations):
    ids = [v.control_id for v in verifications]
    if len(ids) != len(set(ids)) or set(ids) != set(expected_control_ids):
        raise DomainError('CONTROL_COVERAGE_INCOMPLETE')
    for item in verifications:
        if item.applicability == 'pending' or (
            item.applicability == 'applicable' and item.conclusion == 'not_assessed'
        ):
            raise DomainError('VERIFICATION_INCOMPLETE')
        if item.conclusion == 'insufficient_evidence' and item.control_id not in reviewed_limitations:
            raise DomainError('LIMITATION_REVIEW_REQUIRED')


class RemediationPlan(AssessmentModel):
    gap_ids: list[str] = Field(min_length=1)
    owner_id: str = Field(min_length=1)
    due_on: date
    kind: Literal['development', 'configuration', 'process', 'verification']
    scope: str = Field(min_length=1, max_length=8000)
    acceptance_criteria: list[str] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def nonempty_entries(self):
        if any(not value.strip() for value in [*self.gap_ids, *self.acceptance_criteria, self.owner_id, self.scope]):
            raise ValueError('Plan entries cannot be blank')
        if len(set(self.gap_ids)) != len(self.gap_ids):
            raise ValueError('Duplicate gaps')
        return self


class RetestResult(AssessmentModel):
    plan_hash: str = Field(min_length=1)
    passed: StrictBool
    reason: str = Field(min_length=1, max_length=8000)
    evidence: list[EvidenceReference] = Field(min_length=1, max_length=100)


def remediation_after_retest(current_status, current_plan_hash, result):
    if current_status != 'awaiting_retest':
        raise DomainError('INVALID_STATE', 409)
    if result.plan_hash != current_plan_hash:
        raise DomainError('BASELINE_CHANGED', 409)
    return 'verified' if result.passed else 'in_progress'


class RiskAcceptance(AssessmentModel):
    owner_id: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=8000)
    compensating_measures: str = Field(min_length=1, max_length=8000)
    review_on: date


def risk_acceptance_active(acceptance, approved, as_of):
    return approved and acceptance.review_on > as_of
