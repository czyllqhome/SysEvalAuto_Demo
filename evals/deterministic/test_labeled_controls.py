"""Offline synthetic fixtures for the seven-column multi-framework importer."""
import copy
import io

import pytest
from openpyxl import Workbook

from app.control_rules import default_config
from app.control_workbooks import preview
from app.labeled_controls import HEADERS
from app import screening


def workbook(sheets, headers=HEADERS):
    book = Workbook()
    book.remove(book.active)
    for name, rows in sheets.items():
        sheet = book.create_sheet(name)
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def initial():
    return {'version': 0, 'config': default_config(), 'controls': []}


def sample():
    return workbook({
        'ITGC': [('ITGC', 'ITGC-APD-01', 'APD', 'N/A', '  原始要求\n原文保留  ', '核查授权', 'IAM')],
        'PIPL': [('PIPL', '第一条', 'Privacy', '', '个人信息保护原文', 'N/A', 'PRIVACY')],
        'MLPS Level 2': [('MLPS Level 2', '7.1.4.1-c)', '安全计算环境', '身份鉴别', '远程管理', '核查', 'IAM')],
        'MLPS Level 3': [('MLPS Level 3', '8.1.4.11-a)', '安全计算环境', '个人信息保护', '个人信息', '核查', 'PRIVACY')],
        'NIST-SP800-53r5': [('NIST-SP800-53r6', 'AC-2(1)', 'Account Management', None, 'Authored requirement', None, 'IAM')],
    })


def test_all_sheets_labels_provenance_profiles_and_rules():
    current = initial()
    before = copy.deepcopy(current)
    result = preview(sample(), current)
    assert current == before  # Preview must not change live config.
    assert result['errors'] == []
    assert result['source_format'] == 'labeled'
    controls = result['data']['controls']
    assert len(controls) == 5
    assert {c['domain_code'] for c in controls} == {'IAM', 'PRIVACY'}
    assert all(c['review_status'] == 'draft' for c in controls)
    itgc, pipl, level2, level3, nist = controls
    assert itgc['translations']['zh']['description'] == '  原始要求\n原文保留  '
    assert pipl['source']['fields']['control_identifier'] == '第一条'
    assert pipl['translations']['zh']['verification'] == 'N/A'
    assert nist['source_framework'] == 'NIST-SP800-53r5'
    assert nist['source']['fields']['source'] == 'NIST-SP800-53r6'
    assert nist['source']['cells']['A2'] == 'NIST-SP800-53r6'
    assert nist['source_version'] == 'r5'
    assert nist['translations']['en']['verification'].startswith('Assessment procedure not supplied')
    assert len(result['warnings']) == 2
    assert level2['assessment_profiles'] == ['MLPS2_REFERENCE']
    assert level3['assessment_profiles'] == ['MLPS3_REFERENCE']
    assert level2['rule']['any'][0]['all'][0]['tag'] == 'ops.remote_admin'
    assert level3['rule']['any'][0]['all'][0]['tag'] == 'data.personal'
    assert screening.match(level2, {}, ['MLPS2_REFERENCE'], ['MLPS'])['status'] == 'unknown'
    assert screening.match(nist, {}, nist['assessment_profiles'], ['ITGC'])['status'] == 'inapplicable'
    assert preview(sample(), result['data'])['data'] is None  # No silent overwrite.


@pytest.mark.parametrize('field,value', [('label', 'TYPO'), ('source', ''), ('control_requirement', ''), ('control_identifier', '')])
def test_invalid_rows_are_atomic_and_located(field, value):
    row = dict(zip(HEADERS, ['ITGC', 'A-1', 'APD', '', 'Requirement', '', 'IAM']))
    row[field] = value
    raw = workbook({'ITGC': [list(row.values())], 'Other': [['OTHER', 'X-1', 'Domain', '', 'Requirement', 'Check', 'DATA']]})
    result = preview(raw, initial())
    assert result['data'] is None and result['changes'] == []
    assert result['errors'][0]['sheet'] == 'ITGC'
    assert result['errors'][0]['row'] == 2
    assert result['errors'][0]['column'] == field


def test_reordered_headers_blank_rows_and_stable_identity():
    row = ['CUSTOM', '编号一', 'domain', None, 'text', None, 'IAM']
    first = preview(workbook({'One': [row, [None] * 7]}), initial())
    second = preview(workbook({'Renamed': [list(reversed(row))]}, tuple(reversed(HEADERS))), initial())
    assert len(first['changes']) == 1
    assert first['changes'][0]['code'] == second['changes'][0]['code']
    bad = preview(workbook({'One': [row]}, (*HEADERS[:-1], 'control_identifier')), initial())
    assert bad['data'] is None and bad['errors'][0]['row'] == 1
    duplicate = preview(workbook({'One': [row], 'Two': [row]}), initial())
    assert duplicate['data'] is None


def test_mlps_full_width_parenthesis_keeps_original_source():
    row = ['MLPS Level 3', '8.1.10.6-i）', '安全运维管理', '远程管理', '原文', '核查', 'OPERATIONS']
    result = preview(workbook({'MLPS Level 3': [row]}), initial())
    assert result['errors'] == []
    item = result['data']['controls'][0]
    assert item['control_code'] == 'MLPS3-8.1.10.6-i'
    assert item['source']['fields']['control_identifier'] == row[1]
    assert item['rule']['any'][0]['all'][0]['tag'] == 'ops.remote_admin'




