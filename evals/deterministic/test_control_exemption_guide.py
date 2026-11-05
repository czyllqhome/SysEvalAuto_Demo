"""The user-facing guide stays aligned with questionnaire labels and published rules."""
import csv
import io
import json
from pathlib import Path

from app.control_rules import evaluate_rule
from app.db import LibraryRelease, User
from app.mlps_applicability import facts
from app.mlps_intake import GRADING_FIELDS, QUESTIONS, deployment_facts
from app.six_field_controls import FIELDS, import_file


GUIDE = json.loads((Path(__file__).resolve().parents[2] / 'frontend/src/control-exemption-guide.json').read_text(encoding='utf-8'))


def clause_examples(row, level):
    reference = row['references'][str(level)]
    if row['domain']:
        return [row['id']]
    if '～' in reference:
        prefix = reference.split('-')[0]
        return [f'{prefix}-{letter})' for letter in 'abcdefg']
    if '*' in reference:
        return [reference.replace('*', letter + ')') for letter in 'ab']
    return reference.split('、')


def test_guide_question_ids_and_labels_match_information_stage():
    by_key = {q['key']: q for q in QUESTIONS}
    information = [q for q in QUESTIONS if not q.get('retired') and not q.get('parent_key') and q['key'] not in GRADING_FIELDS]
    for row in GUIDE:
        question = by_key[row['question_key']]
        assert row['question'] == {lang: question[lang] for lang in ('zh', 'en')}
        assert row['source_id'] == question['id']
        section = [q for q in information if q['id'][0] == question['id'][0]]
        assert row['question_id'] == f"{question['id'][0]}{section.index(question) + 1:02}"
        for example in row['examples']:
            assert all(value in question['options'] for value in (example if isinstance(example, list) else [example]))


def test_guide_examples_exclude_only_the_documented_published_rules(owner):
    app, client = owner
    uid = client.get('/api/v1/auth/session').json()['user']['id']
    with app.state.sessions.begin() as db:
        user = db.get(User, uid)
        for level in (1, 2, 3):
            rows = [row for row in GUIDE if str(level) in row['references']]
            stream = io.StringIO()
            writer = csv.writer(stream)
            writer.writerow(FIELDS)
            for row in rows:
                for clause in clause_examples(row, level):
                    writer.writerow([f"{level}:{row['id']}", clause, row['domain'] or '安全运维管理', '控制点', '原始要求', 'Medium'])
            import_file(db, user, f'MLPS_level_{level}_CN.csv', stream.getvalue().encode('utf-8'))
        from app.service import current_catalog
        release = db.get(LibraryRelease, current_catalog(db, user.org_id).id)
        for control in release.data['controls']:
            identifier = control['source']['languages']['zh']['fields']['source'].split(':', 1)[1]
            row = next(row for row in GUIDE if row['id'] == identifier)
            for example in row['examples']:
                answers = {row['question_key']: example}
                values = {**facts(answers), 'hosting.models': deployment_facts(answers.get('deployment_model'))}
                assert evaluate_rule(control['rule'], values) is False, (identifier, example, control['source_ref'])
            assert evaluate_rule(control['rule'], {**facts({}), 'hosting.models': ['unknown']}) is None
            retained = {**facts({'development_models': ['自行开发', '外包开发'], row['question_key']: '是'}),
                        'hosting.models': ['own_dc'] if row['domain'] == '安全物理环境' else ['cloud']}
            if row['question_key'] == 'development_models':
                retained = facts({'development_models': ['自行开发', '外包开发']})
            assert evaluate_rule(control['rule'], retained) is True
            assert row['outcome'] == ('inapplicable' if row['domain'] == '云计算安全扩展要求' else 'exempted')
