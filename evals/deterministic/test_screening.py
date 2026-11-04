
import pytest

from app import screening
from app.domain import DomainError


def low():
    return {'screen.personal_count': 'none', 'screen.sensitive_count': 'none', 'screen.confidential': 'no',
            'screen.data_object': 'rights', 'screen.data_harm': 'minor',
            'screen.service_object': 'rights', 'screen.service_harm': 'minor',
            'screen.interaction': 'none', 'net.public_ingress': 'no', 'risk.business_impact': 'limited',
            'risk.outage_minutes': 1440, 'biz.manual_fallback': 'yes'}


@pytest.mark.parametrize('changes,level', [({}, 'L1'), ({'hosting.models': ['cloud', 'vendor_dc'], 'screen.public_cloud': 'yes'}, 'L1'),
    ({'screen.personal_count': 'under_10k'}, 'L2'), ({'screen.personal_count': '10k_100k'}, 'L2'),
    ({'screen.personal_count': '100k_1m'}, 'L3'), ({'screen.personal_count': 'under_10k', 'screen.sensitive_count': 'under_1k'}, 'L2'),
    ({'screen.personal_count': 'under_10k', 'screen.sensitive_count': '1k_10k'}, 'L3'),
    ({'net.public_ingress': 'yes'}, 'L2'), ({'screen.interaction': 'critical'}, 'L3'),
    ({'risk.outage_minutes': 239, 'biz.manual_fallback': 'no'}, 'L3'),
    ({'risk.outage_minutes': 240, 'biz.manual_fallback': 'no'}, 'L2'),
    ({'screen.service_object': 'public', 'screen.service_harm': 'serious'}, 'L3'),
    ({'screen.personal_count': 'unknown'}, 'L2')])
def test_screening_boundaries(changes, level):
    assert screening.classify({**low(), **changes}, screening.config())['recommended_level'] == level


def test_screening_expert_review_conflicts_and_manual_reason():
    result = screening.classify({**low(), 'screen.service_object': 'national'}, screening.config())
    assert result['expert_review']
    with pytest.raises(DomainError):
        screening.classify({**low(), 'screen.sensitive_count': '1k_10k'}, screening.config())
    with pytest.raises(DomainError):
        screening.classify(low(), screening.config(), 'manual', 'L1', '')
    result = screening.classify({**low(), 'net.public_ingress': 'yes'}, screening.config(), 'manual', 'L1', 'Documented review')
    assert result['exceptions'][0]['code'] == 'MANUAL_DOWNGRADE'






def test_rename_is_versioned_and_preserves_notes(owner):
    _, client = owner
    detail = client.post('/api/v1/systems', json={'name': 'Wrong name'}).json()
    path = '/api/v1/systems/' + detail['system']['id']
    response = client.put(path + '/name', json={'version': detail['system']['version'], 'name': '户外运动 AI 助手'})
    assert response.status_code == 200, response.text
    assert response.json()['system']['name'] == '户外运动 AI 助手'
    assert response.json()['system']['draft'] == detail['system']['draft']
    assert client.put(path + '/name', json={'version': detail['system']['version'], 'name': 'stale'}).status_code == 409


