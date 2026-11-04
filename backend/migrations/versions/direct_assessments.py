"""Add direct organization and assessment roles; preserve historical project records."""
from alembic import op
from app.db import OrganizationRole, AssessmentMember

revision = 'direct_assessments'
down_revision = 'delivery_evidence'
branch_labels = None
depends_on = None


def upgrade():
    for model in (OrganizationRole, AssessmentMember):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Preserve roles and history; restore an approved backup instead.')
