from datetime import date

import pytest
from pydantic import ValidationError

from app.assessment_rules import (
    ControlVerification, EvidenceReference, RetestResult, RiskAcceptance,
    remediation_after_retest, risk_acceptance_active, validate_evidence_scope,
    validate_report_coverage, verification_summary,
)
from app.domain import DomainError


def evidence(**overrides):
    return EvidenceReference(**dict({
        'source_id': 'e1', 'source_revision': '1', 'environment': 'production',
        'system_version': 'v1', 'collected_on': date(2026, 10, 1), 'description': 'Verified configuration',
    }, **overrides))


def verification(**overrides):
    return ControlVerification(**dict({
        'control_id': 'c1', 'control_revision': '1', 'scope_revision': '1',
    }, **overrides))


@pytest.mark.parametrize('conclusion', ['satisfied', 'partial', 'unsatisfied'])
def test_assertions_need_evidence(conclusion):
    with pytest.raises(ValidationError):
        verification(conclusion=conclusion, reason='Supplier says so', method='Interview')


def test_unknown_and_excluded_are_not_passes():
    rows = [verification(), verification(control_id='c2', applicability='not_applicable', reason='Outside scope')]
    summary = verification_summary(rows)
    assert summary['applicable'] == 1
    assert summary['satisfied'] == 0
    assert summary['coverage'] == 0
    assert verification_summary([])['coverage'] is None


@pytest.mark.parametrize('overrides', [
    {'environment': 'test'}, {'system_version': 'v0'}, {'collected_on': date(2027, 1, 1)},
])
def test_wrong_evidence_scope_rejected(overrides):
    row = verification(evidence=[evidence(**overrides)])
    with pytest.raises(DomainError, match='EVIDENCE_SCOPE_MISMATCH'):
        validate_evidence_scope(row, 'production', 'v1', date(2026, 11, 1))


def test_report_requires_reviewed_limitations():
    row = verification(conclusion='insufficient_evidence', reason='Logs unavailable')
    with pytest.raises(DomainError, match='LIMITATION_REVIEW_REQUIRED'):
        validate_report_coverage(['c1'], [row], set())
    validate_report_coverage(['c1'], [row], {'c1'})
    with pytest.raises(DomainError, match='CONTROL_COVERAGE_INCOMPLETE'):
        validate_report_coverage(['c1', 'c2'], [row], {'c1'})
    with pytest.raises(DomainError, match='VERIFICATION_INCOMPLETE'):
        validate_report_coverage(['c1'], [verification()], set())


@pytest.mark.parametrize('passed,expected', [(True, 'verified'), (False, 'in_progress')])
def test_retest_keeps_plan_identity(passed, expected):
    result = RetestResult(plan_hash='h', passed=passed, reason='Observed result', evidence=[evidence()])
    assert remediation_after_retest('awaiting_retest', 'h', result) == expected
    with pytest.raises(DomainError, match='BASELINE_CHANGED'):
        remediation_after_retest('awaiting_retest', 'new', result)
    with pytest.raises(DomainError, match='INVALID_STATE'):
        remediation_after_retest('in_progress', 'h', result)


def test_risk_acceptance_expires_on_review_date():
    record = RiskAcceptance(owner_id='owner', reason='Temporary acceptance',
                            compensating_measures='Manual checks', review_on=date(2026, 11, 1))
    assert risk_acceptance_active(record, True, date(2026, 10, 31))
    assert not risk_acceptance_active(record, False, date(2026, 10, 31))
    assert not risk_acceptance_active(record, True, date(2026, 11, 1))
