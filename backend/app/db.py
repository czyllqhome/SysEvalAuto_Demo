"""Persistence stays independent of the parent assistant's runtime data."""

from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def uid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class MlpsEvidence(Base):
    __tablename__ = 'mlps_intake_evidence'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey('systems.id'), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    question: Mapped[str] = mapped_column(String(80))
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    sha256: Mapped[str] = mapped_column(String(64))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="customer")


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20), default="owner")


class ManagedSupplier(Base):
    """Customer administration of an independently isolated supplier identity."""
    __tablename__ = "managed_suppliers"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    customer_org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)


class OrganizationRole(Base):
    __tablename__ = 'organization_roles'
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), default='viewer')


class AssessmentMember(Base):
    __tablename__ = 'assessment_members'
    system_id: Mapped[str] = mapped_column(ForeignKey('systems.id'), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), primary_key=True)
    role: Mapped[str] = mapped_column(String(20))


class LoginSession(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    csrf: Mapped[str] = mapped_column(String(100))
    expires_at: Mapped[float] = mapped_column(Float)


class System(Base):
    __tablename__ = "systems"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(40), default="DRAFT")
    version: Mapped[int] = mapped_column(Integer, default=1)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    draft: Mapped[dict] = mapped_column(JSON, default=dict)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    classification: Mapped[dict] = mapped_column(JSON, default=dict)
    context_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    prd_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    round_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    report_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    baseline_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    updated_at: Mapped[float] = mapped_column(Float, default=time.time)
    __mapper_args__ = {"version_id_col": version}


class PrdImport(Base):
    __tablename__ = 'prd_imports'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey('systems.id'), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    filename: Mapped[str] = mapped_column(String(200))
    markdown: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    previous_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class PrdImportApplication(Base):
    __tablename__ = 'prd_import_applications'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    import_id: Mapped[str] = mapped_column(ForeignKey('prd_imports.id'), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey('ai_jobs.id'))
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    changes: Mapped[dict] = mapped_column(JSON)
    undone: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class ContextRevision(Base):
    __tablename__ = "context_revisions"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), index=True)
    source: Mapped[dict] = mapped_column(JSON)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Catalog(Base):
    __tablename__ = "catalogs"
    __table_args__ = (UniqueConstraint("org_id", "code", "version"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    code: Mapped[str] = mapped_column(String(80))
    version: Mapped[str] = mapped_column(String(80))
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Control(Base):
    __tablename__ = "controls"
    __table_args__ = (UniqueConstraint("catalog_id", "code"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    catalog_id: Mapped[str] = mapped_column(ForeignKey("catalogs.id"))
    project_id: Mapped[str | None] = mapped_column(ForeignKey("systems.id"), nullable=True)
    code: Mapped[str] = mapped_column(String(80))
    domain: Mapped[str] = mapped_column(String(40))
    levels: Mapped[list] = mapped_column(JSON)
    required: Mapped[bool] = mapped_column(Boolean)
    translations: Mapped[dict] = mapped_column(JSON)
    tags: Mapped[list] = mapped_column(JSON, default=list)


class Selection(Base):
    __tablename__ = "selected_controls"
    __table_args__ = (UniqueConstraint("system_id", "revision", "control_id"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    control_id: Mapped[str] = mapped_column(ForeignKey("controls.id"))
    included: Mapped[bool] = mapped_column(Boolean, default=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    origin: Mapped[str] = mapped_column(String(20), default="matched")
    snapshot: Mapped[dict] = mapped_column(JSON)


class CatalogImport(Base):
    __tablename__ = "catalog_imports"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    rows: Mapped[list] = mapped_column(JSON)
    errors: Mapped[list] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    published_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Prd(Base):
    __tablename__ = "prd_versions"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"))
    revision: Mapped[int] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(10))
    mode: Mapped[str] = mapped_column(String(20))
    data: Mapped[dict] = mapped_column(JSON)
    markdown: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    approved: Mapped[bool] = mapped_column(Boolean, default=False)


class SupplierRound(Base):
    __tablename__ = "supplier_rounds"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), index=True)
    supplier_org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    prd_id: Mapped[str] = mapped_column(ForeignKey("prd_versions.id"))
    snapshot: Mapped[dict] = mapped_column(JSON)
    draft: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="open")
    submitted_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"))
    supplier_org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    email: Mapped[str] = mapped_column(String(254))
    expires_at: Mapped[float] = mapped_column(Float)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class Submission(Base):
    __tablename__ = "supplier_submissions"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    round_id: Mapped[str] = mapped_column(ForeignKey("supplier_rounds.id"), unique=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Report(Base):
    __tablename__ = "impact_reports"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"))
    submission_id: Mapped[str] = mapped_column(ForeignKey("supplier_submissions.id"))
    data: Mapped[dict] = mapped_column(JSON)
    mode: Mapped[str] = mapped_column(String(20))
    decisions: Mapped[dict] = mapped_column(JSON, default=dict)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)


class Job(Base):
    __tablename__ = "ai_jobs"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    mode: Mapped[str] = mapped_column(String(20))
    language: Mapped[str] = mapped_column(String(10))
    state: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    source_hash: Mapped[str] = mapped_column(String(64))
    input: Mapped[dict] = mapped_column(JSON)
    output: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(String(80), default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_until: Mapped[float] = mapped_column(Float, default=0)
    next_run: Mapped[float] = mapped_column(Float, default=0)
    fence: Mapped[str] = mapped_column(String(36), default="")
    usage: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Baseline(Base):
    __tablename__ = "baselines"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"))
    content_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    finalized: Mapped[bool] = mapped_column(Boolean, default=False)


class Confirmation(Base):
    __tablename__ = "confirmations"
    __table_args__ = (UniqueConstraint("baseline_id", "party"),)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    baseline_id: Mapped[str] = mapped_column(ForeignKey("baselines.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    party: Mapped[str] = mapped_column(String(20))
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Audit(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), index=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(80))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Receipt(Base):
    __tablename__ = "idempotency_receipts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)


class AccountPolicy(Base):
    __tablename__ = "account_policies"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    username: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    admin: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)


class Project(Base):
    __tablename__ = "assessment_projects"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Membership(Base):
    __tablename__ = "project_memberships"
    project_id: Mapped[str] = mapped_column(ForeignKey("assessment_projects.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), primary_key=True)


class Assignment(Base):
    __tablename__ = "system_assignments"
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("assessment_projects.id"), index=True)
    operator_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    reviewer_ids: Mapped[list] = mapped_column(JSON, default=list)
    contributors: Mapped[list] = mapped_column(JSON, default=list)


class Questionnaire(Base):
    __tablename__ = "system_questionnaires"
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), primary_key=True)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    workflow_status: Mapped[str] = mapped_column(String(24), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)
    __mapper_args__ = {"version_id_col": version}


class SupplierForm(Base):
    __tablename__ = "supplier_csv_forms"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    supplier_id: Mapped[str] = mapped_column(String(200))
    revision: Mapped[int] = mapped_column(Integer)
    round_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    definition: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class CsvBatch(Base):
    __tablename__ = "supplier_csv_batches"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    form_id: Mapped[str] = mapped_column(ForeignKey("supplier_csv_forms.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer)
    answers: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    preview: Mapped[dict] = mapped_column(JSON)
    expires_at: Mapped[float] = mapped_column(Float)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)


class AdminAudit(Base):
    __tablename__ = "administration_audits"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class ImportedRecord(Base):
    __tablename__ = "imported_records"
    id: Mapped[str] = mapped_column(String(200), primary_key=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    source_table: Mapped[str] = mapped_column(String(100))
    data: Mapped[dict] = mapped_column(JSON)


class LibraryWorkspace(Base):
    __tablename__ = "control_library_workspaces"
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON)
    published_id: Mapped[str | None] = mapped_column(ForeignKey("catalogs.id"), nullable=True)
    __mapper_args__ = {"version_id_col": version}


class LibraryRelease(Base):
    __tablename__ = "control_library_releases"
    catalog_id: Mapped[str] = mapped_column(ForeignKey("catalogs.id"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class ControlMetadata(Base):
    __tablename__ = "control_metadata"
    control_id: Mapped[str] = mapped_column(ForeignKey("controls.id"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class LibraryBatch(Base):
    __tablename__ = "control_library_batches"
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    version: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)


def make_engine(url: str):
    sqlite = str(url).startswith("sqlite")
    options = {"connect_args": {"check_same_thread": False, "timeout": 30}} if sqlite else {}
    engine = create_engine(url, pool_pre_ping=True, **options)
    if sqlite:
        @event.listens_for(engine, "connect")
        def configure_sqlite(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")
    return engine


def database_url() -> str:
    if os.getenv("SYSEVAL_DATABASE_URL"):
        return os.environ["SYSEVAL_DATABASE_URL"]
    directory = Path(__file__).resolve().parents[2] / ".syseval"
    directory.mkdir(exist_ok=True)
    return f"sqlite:///{directory / 'assessment.db'}"


def make_sessions(engine):
    return sessionmaker(engine, expire_on_commit=False)


class ProjectPurpose(Base):
    __tablename__ = 'project_purposes'
    project_id: Mapped[str] = mapped_column(ForeignKey('assessment_projects.id'), primary_key=True)
    purpose: Mapped[str] = mapped_column(String(20), default='new')


class SystemAsset(Base):
    __tablename__ = 'system_assets'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey('assessment_projects.id'), index=True)
    name: Mapped[str] = mapped_column(String(200))


class AssessmentProfile(Base):
    __tablename__ = 'assessment_profiles'
    system_id: Mapped[str] = mapped_column(ForeignKey('systems.id'), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), default='new')
    asset_id: Mapped[str | None] = mapped_column(ForeignKey('system_assets.id'), nullable=True)
    predecessor_id: Mapped[str | None] = mapped_column(ForeignKey('systems.id'), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class CurrentAssessment(Base):
    __tablename__ = 'current_assessments'
    system_id: Mapped[str] = mapped_column(ForeignKey('systems.id'), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class AssessmentEvidence(Base):
    __tablename__ = 'assessment_evidence'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey('systems.id'), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    data: Mapped[dict] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class AISettings(Base):
    __tablename__ = "ai_settings"
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    __mapper_args__ = {"version_id_col": version}
