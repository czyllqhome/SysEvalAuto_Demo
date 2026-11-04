"""Add immutable questionnaire evidence without changing historical records."""
from alembic import op
from app.db import MlpsEvidence

revision = 'mlps_intake'
down_revision = 'direct_assessments'
branch_labels = None
depends_on = None


def upgrade():
    MlpsEvidence.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Evidence must be preserved; destructive downgrade is not supported.')
