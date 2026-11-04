"""Add assessment metadata and immutable evidence without rewriting old baselines."""
from alembic import op
from app.db import AssessmentEvidence, AssessmentProfile, CurrentAssessment, ProjectPurpose, SystemAsset

revision = 'existing_assessments'
down_revision = 'managed_suppliers'
branch_labels = None
depends_on = None


def upgrade():
    for model in (ProjectPurpose, SystemAsset, AssessmentProfile, CurrentAssessment, AssessmentEvidence):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Restore an approved backup instead of deleting assessment history.')
