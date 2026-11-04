import copy

import pytest

from app.ai import model_input_limit, prd_transport_source
from app.domain import DomainError


def test_prd_transport_keeps_reviewed_requirements_and_source_identity():
    source = {'context': {'functions': [{'id': 'F-1'}]}, 'controls': [
        {'id': 'C-1', 'domain': 'IAM', 'translations': {'zh': {'description': 'Reviewed requirement', 'verification': 'PRIVATE PROCEDURE'}},
         'metadata': {'source': {'fields': {'security_domain': 'Access security', 'control_requirement': 'Old requirement', 'assessment_procedure': 'PRIVATE PROCEDURE'}, 'cells': {'A1': 'RAW'}}}},
        {'id': 'C-2', 'domain': 'CUSTOM', 'translations': {'en': {'description': 'Custom requirement'}}},
    ]}
    before = copy.deepcopy(source)
    result = prd_transport_source(source, 'zh')
    assert result['controls'] == [
        {'id': 'C-1', 'security_domain': 'Access security', 'control_requirement': 'Reviewed requirement'},
        {'id': 'C-2', 'security_domain': 'CUSTOM', 'control_requirement': 'Custom requirement'},
    ]
    assert result['requirement_slots'][-1]['source_control_ids'] == ['C-2']
    assert source == before


def test_model_input_limit_is_larger_and_configurable(monkeypatch):
    monkeypatch.delenv('SYSEVAL_MAX_MODEL_INPUT_BYTES', raising=False)
    assert model_input_limit() == 1000000
    monkeypatch.setenv('SYSEVAL_MAX_MODEL_INPUT_BYTES', '2000000')
    assert model_input_limit() == 2000000
    for value in ('0', '-1', 'invalid'):
        monkeypatch.setenv('SYSEVAL_MAX_MODEL_INPUT_BYTES', value)
        with pytest.raises(DomainError) as error:
            model_input_limit()
        assert error.value.code == 'MODEL_CONFIG_INVALID'
