"""Add versioned control library tables without modifying assessment records."""
from alembic import op
from app.db import LibraryWorkspace, LibraryRelease, ControlMetadata, LibraryBatch

revision = 'control_library'
down_revision = 'integrated_intake'
branch_labels = None
depends_on = None


def upgrade():
    for model in (LibraryWorkspace, LibraryRelease, ControlMetadata, LibraryBatch):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Preserve control revisions; restore an approved backup instead.')
