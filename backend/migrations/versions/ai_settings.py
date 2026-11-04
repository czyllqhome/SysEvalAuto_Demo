"""Add organization AI settings without touching assessment records."""
from alembic import op
from app.db import AISettings
revision = 'ai_settings'
down_revision = 'control_library'
branch_labels = None
depends_on = None


def upgrade():
    AISettings.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Restore an approved backup instead of dropping settings.')
