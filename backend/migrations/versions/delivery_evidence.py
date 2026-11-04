"""Add delivery evidence without rewriting baseline hashes or historical plans."""
from alembic import op
from app.delivery_models import DeliveryBatch, DeliveryItem, EvidenceAttachment, DeliverySubmission, DeliveryReview

revision = 'delivery_evidence'
down_revision = 'existing_assessments'
branch_labels = None
depends_on = None


def upgrade():
    for model in (DeliveryBatch, DeliveryItem, EvidenceAttachment, DeliverySubmission, DeliveryReview):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('Preserve delivery history; restore an approved backup instead.')
