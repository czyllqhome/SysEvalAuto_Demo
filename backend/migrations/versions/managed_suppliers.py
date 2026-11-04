"""Add project-managed supplier identities without changing existing organizations."""
from alembic import op
from app.db import ManagedSupplier

revision = 'managed_suppliers'
down_revision = 'prd_imports'
branch_labels = None
depends_on = None


def upgrade():
    ManagedSupplier.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Restore an approved backup instead of dropping supplier administration records.')
