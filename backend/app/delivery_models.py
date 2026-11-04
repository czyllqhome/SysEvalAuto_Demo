"""Additive delivery aggregates; submitted evidence and decisions are append-only."""
import time

from sqlalchemy import JSON, Float, ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, uid


class DeliveryBatch(Base):
    __tablename__ = 'delivery_batches'
    __table_args__ = (UniqueConstraint('system_id', 'source_id', 'source_hash'),)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    system_id: Mapped[str] = mapped_column(ForeignKey('systems.id'), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey('organizations.id'), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    source_id: Mapped[str] = mapped_column(String(36))
    source_hash: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(30))
    supplier_org_id: Mapped[str] = mapped_column(ForeignKey('organizations.id'))
    supplier_user_id: Mapped[str | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    snapshot: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(30), default='ACTIVE')
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    __mapper_args__ = {'version_id_col': version}


class DeliveryItem(Base):
    __tablename__ = 'delivery_items'
    __table_args__ = (UniqueConstraint('batch_id', 'source_id'),)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    batch_id: Mapped[str] = mapped_column(ForeignKey('delivery_batches.id'), index=True)
    source_id: Mapped[str] = mapped_column(String(200))
    snapshot: Mapped[dict] = mapped_column(JSON)
    criteria: Mapped[list] = mapped_column(JSON)
    draft: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default='OPEN', index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    __mapper_args__ = {'version_id_col': version}


class EvidenceAttachment(Base):
    __tablename__ = 'evidence_attachments'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    item_id: Mapped[str] = mapped_column(ForeignKey('delivery_items.id'), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100))
    sha256: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    meta: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class DeliverySubmission(Base):
    __tablename__ = 'delivery_submissions'
    __table_args__ = (UniqueConstraint('item_id', 'round_no'),)
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    item_id: Mapped[str] = mapped_column(ForeignKey('delivery_items.id'), index=True)
    round_no: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    payload: Mapped[dict] = mapped_column(JSON)
    manifest_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class DeliveryReview(Base):
    __tablename__ = 'delivery_reviews'
    id: Mapped[str] = mapped_column(primary_key=True, default=uid)
    submission_id: Mapped[str] = mapped_column(ForeignKey('delivery_submissions.id'), unique=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
