"""Add six-field source controls without deleting historical releases."""
from alembic import op
from app.db import SixFieldLibrary, SixFieldUpload, SixFieldControl
revision = 'six_field_controls'
down_revision = 'mlps_intake'
branch_labels = None
depends_on = None


def upgrade():
    for model in (SixFieldLibrary, SixFieldUpload, SixFieldControl):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Preserve uploaded source records; restore an approved backup instead.')
