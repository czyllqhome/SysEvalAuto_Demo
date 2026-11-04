"""Create the initial independent assessment schema."""

from alembic import op
from app.db import Base

revision = "initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(op.get_bind())


def downgrade():
    raise RuntimeError("Automatic schema destruction is disabled. Restore an approved backup instead.")
