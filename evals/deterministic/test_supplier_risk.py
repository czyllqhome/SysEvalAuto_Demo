import pytest
from app.ai import local_impact
from app.domain import validate_report


@pytest.mark.parametrize('status,severity', [('partial', 'medium'), ('no', 'high')])
def test_supplier_commitment_determines_risk_even_when_model_disagrees(status, severity):
    requirements = [{'id': 'R-1', 'title': 'Access protection'}]
    answers = {'R-1': {'implementation_status': status, 'limitations': 'Unavailable protection'}}
    output = local_impact({'prd': {'requirements': requirements}, 'answers': answers}, 'en')
    output['findings'][0]['severity'] = 'low'
    result = validate_report(output, requirements, answers)
    assert result['findings'][0]['severity'] == severity
    assert result['findings'][0]['evidence'] == 'Unavailable protection'

@pytest.mark.parametrize('status', ['no', 'needs_clarification'])
def test_unavailable_zero_duration_is_absent(status):
    from app.domain import SupplierAnswer
    answer = SupplierAnswer.model_validate({'implementation_status': status, 'duration_workdays': 0, 'limitations': 'Cannot deliver'})
    assert answer.duration_workdays is None


@pytest.mark.parametrize('status', ['yes', 'partial'])
def test_deliverable_zero_duration_remains_invalid(status):
    from app.domain import SupplierAnswer
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        SupplierAnswer.model_validate({'implementation_status': status, 'duration_workdays': 0, 'owner_name': 'Owner', 'implementation_plan': 'Plan', 'limitations': 'Gap'})
