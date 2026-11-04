"""Add project scope without dropping existing control data."""

import sqlalchemy as sa
from alembic import op

revision = "custom_control_scope"
down_revision = "initial"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if "project_id" not in {column["name"] for column in sa.inspect(connection).get_columns("controls")}:
        op.add_column("controls", sa.Column("project_id", sa.String(), nullable=True))


def downgrade():
    raise RuntimeError("Automatic data-destructive downgrades are disabled.")
