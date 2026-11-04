"""Add project permissions, questionnaire and CSV persistence without altering existing records."""
from alembic import op
from app.db import Base

revision = 'integrated_intake'
down_revision = 'custom_control_scope'
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(op.get_bind())


def downgrade():
    raise RuntimeError('Restore an approved backup instead of dropping assessment data.')
