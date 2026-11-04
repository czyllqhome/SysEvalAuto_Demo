"""Explicit, repeatable import of the displaced local app into the main database.

Live sessions and login throttles are intentionally not imported. Password hashes,
account status, project roles, assessment snapshots and audit evidence are preserved.
"""
import argparse
import json
import sqlite3
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5
from sqlalchemy import select
from .catalog import seed_catalog
from .db import (AccountPolicy, AdminAudit, Assignment, Base, ImportedRecord, Membership,
                 Organization, Project, Questionnaire, System, User, make_engine, make_sessions)


def mapped(kind, value):
    return str(uuid5(NAMESPACE_URL, 'scope/questionnaire-import/' + kind + '/' + str(value)))


def import_database(source, sessions):
    path = Path(source).resolve()
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as source_db:
        source_db.row_factory = sqlite3.Row
        tables = {row[0] for row in source_db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {'users', 'assessments', 'projects', 'project_memberships', 'audit_events'}
        if not required <= tables:
            raise ValueError('Unsupported source schema')
        records = {table: [dict(row) for row in source_db.execute('SELECT * FROM "' + table + '"')]
                   for table in sorted(tables) if table not in {'sessions', 'login_failures', 'sqlite_sequence'}}
    with sessions() as db, db.begin():
        marker = 'questionnaire-app-import-v1'
        if db.get(ImportedRecord, marker):
            return {'already_imported': True}
        org_id = mapped('organization', 'legacy')
        db.add(Organization(id=org_id, name='迁入的问卷工作空间 / Imported questionnaire workspace', kind='customer'))
        db.flush()
        admins = {r['user_id'] for r in records.get('user_global_roles', [])}
        for row in records['users']:
            if db.scalar(select(AccountPolicy).where(AccountPolicy.username == row['username'])):
                raise ValueError('Username conflict: resolve identities before importing')
            uid = mapped('user', row['id'])
            db.add(User(id=uid, org_id=org_id, email=uid + '@imported.local', name=row['display_name'],
                        password_hash=row['password_hash'], role='member'))
            db.flush()
            db.add(AccountPolicy(user_id=uid, username=row['username'], active=bool(row['active']),
                                 admin=row['id'] in admins, must_change_password=bool(row['must_change_password'])))
        for row in records['projects']:
            db.add(Project(id=mapped('project', row['id']), org_id=org_id, name=row['name'], active=bool(row['active'])))
        db.flush()
        for row in records['project_memberships']:
            db.add(Membership(project_id=mapped('project', row['project_id']), user_id=mapped('user', row['user_id']), role=row['role']))
        for row in records['assessments']:
            snapshot = json.loads(row['snapshot'])
            owner = row.get('created_by') or next(iter(admins), None)
            if not owner:
                raise ValueError('An assessment has no recoverable owner')
            sid = mapped('system', row['id'])
            db.add(System(id=sid, org_id=org_id, owner_id=mapped('user', owner), name=snapshot['name'], status='CLASSIFYING', draft={'blocks': {}}))
            db.flush()
            db.add(Questionnaire(system_id=sid, snapshot=snapshot, workflow_status=row['workflow_status']))
            assigned = [a for a in records.get('assessment_assignments', []) if a['assessment_id'] == row['id']]
            operator = next((a['user_id'] for a in assigned if a['role'] == 'operator'), None)
            if row.get('project_id') and operator:
                db.add(Assignment(system_id=sid, project_id=mapped('project', row['project_id']), operator_id=mapped('user', operator),
                                  reviewer_ids=[mapped('user', a['user_id']) for a in assigned if a['role'] == 'reviewer'],
                                  contributors=[mapped('user', a['user_id']) for a in records.get('assessment_contributors', []) if a['assessment_id'] == row['id']]))
        for table, rows in records.items():
            for index, row in enumerate(rows):
                # Authentication hashes exist only in the authentication table, never in visible archives.
                safe = {key: value for key, value in row.items() if key != 'password_hash'}
                db.add(ImportedRecord(id=f'questionnaire/{table}/{index}', org_id=org_id, source_table=table, data=safe))
        counts = {table: len(rows) for table, rows in records.items()}
        db.add(ImportedRecord(id=marker, org_id=org_id, source_table='migration', data=counts))
        db.add(AdminAudit(org_id=org_id, action='legacy.imported', detail=counts))
        seed_catalog(db, org_id)
        return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.apply:
        print('Dry run: pass --apply after backing up both databases.')
        return
    if args.source.resolve() == args.target.resolve():
        raise ValueError('Source and target must be different databases')
    engine = make_engine('sqlite:///' + args.target.resolve().as_posix())
    Base.metadata.create_all(engine)
    print(json.dumps(import_database(args.source, make_sessions(engine))))
    engine.dispose()


if __name__ == '__main__':
    main()
