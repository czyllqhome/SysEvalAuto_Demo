"""Preserve uploaded PRDs and field applications without modifying runtime records."""
from alembic import op
from app.db import PrdImport, PrdImportApplication

revision = 'prd_imports'
down_revision = 'ai_settings'
branch_labels = None
depends_on = None


def upgrade():
    PrdImport.__table__.create(op.get_bind(), checkfirst=True)
    PrdImportApplication.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Restore an approved backup instead of dropping imported documents.')
