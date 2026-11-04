"""Explicit source-file MLPS level mappings, separate from authored risk levels."""
from alembic import op
from app.db import SixFieldLevelMapping
revision = 'six_field_levels'
down_revision = 'six_field_controls'
branch_labels = None
depends_on = None


def upgrade():
    SixFieldLevelMapping.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Preserve source mappings; restore an approved backup instead.')
