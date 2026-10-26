"""SQLAlchemy ORM models.

Design notes
------------
* Images are stored on disk under ``settings.storage_dir``; the database only
  keeps relative references plus a SHA-256 file hash. No blobs in the DB.
* Every harmful state change writes an ``AuditLog`` and every status change
  writes a ``RepairUpdate`` row, so a resolved report keeps its full history.
* ``is_synthetic`` marks demo generator records so they can never be confused
  with real citizen submissions (visible in the UI as a "DEMO" badge).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, UTCDateTime, utcnow


def _uuid() -> str:
    return uuid.uuid4().hex


class Role(str, enum.Enum):
    citizen = "citizen"
    reviewer = "reviewer"
    admin = "admin"


class ReportStatus(str, enum.Enum):
    submitted = "submitted"
    under_review = "under_review"
    verified = "verified"
    assigned_for_repair = "assigned_for_repair"
    in_progress = "in_progress"
    resolved = "resolved"
    rejected = "rejected"


class Severity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class DamageCategory(str, enum.Enum):
    pothole = "pothole"
    longitudinal_crack = "longitudinal_crack"
    transverse_crack = "transverse_crack"
    alligator_crack = "alligator_crack"
    broken_surface = "broken_surface"
    other = "other"
    unknown = "unknown"


class RoadImportance(str, enum.Enum):
    local = "local"
    collector = "collector"
    arterial = "arterial"
    highway = "highway"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default=Role.citizen.value, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    reports: Mapped[list[DamageReport]] = relationship(back_populates="reporter")

    @property
    def permissions(self) -> list[str]:
        if self.role == Role.admin.value:
            return ["report:create", "report:review", "report:assign", "report:resolve", "report:delete", "model:read", "admin"]
        if self.role == Role.reviewer.value:
            return ["report:create", "report:review", "report:assign", "report:resolve"]
        return ["report:create"]


class DamageReport(Base):
    __tablename__ = "damage_reports"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    reference: Mapped[str] = mapped_column(String(24), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    damage_category: Mapped[str] = mapped_column(String(32), default=DamageCategory.unknown.value, nullable=False)
    ai_suggested_category: Mapped[str | None] = mapped_column(String(32))
    detection_confidence: Mapped[float | None] = mapped_column(Float)
    reviewed_severity: Mapped[str | None] = mapped_column(String(16))
    road_importance: Mapped[str] = mapped_column(String(16), default=RoadImportance.collector.value)
    priority_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    priority_breakdown: Mapped[dict | None] = mapped_column(JSON)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    location_source: Mapped[str | None] = mapped_column(String(24))
    road_name: Mapped[str | None] = mapped_column(String(200))
    ward: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(24), default=ReportStatus.submitted.value, nullable=False, index=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reporter_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reporter_label: Mapped[str | None] = mapped_column(String(120))
    duplicate_of_id: Mapped[str | None] = mapped_column(ForeignKey("damage_reports.id", ondelete="SET NULL"))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    reported_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    reporter: Mapped[User | None] = relationship(back_populates="reports")
    images: Mapped[list[ReportImage]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="ReportImage.created_at"
    )
    detections: Mapped[list[Detection]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="Detection.confidence.desc()"
    )
    repair_updates: Mapped[list[RepairUpdate]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="RepairUpdate.created_at"
    )
    duplicates: Mapped[list[DuplicateLink]] = relationship(
        back_populates="canonical_report",
        foreign_keys="DuplicateLink.canonical_report_id",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_reports_geo", "latitude", "longitude"),
        Index("ix_reports_status_severity", "status", "reviewed_severity"),
    )


class ReportImage(Base):
    __tablename__ = "report_images"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    report_id: Mapped[str] = mapped_column(ForeignKey("damage_reports.id", ondelete="CASCADE"), index=True)
    original_path: Mapped[str] = mapped_column(String(255), nullable=False)
    annotated_path: Mapped[str | None] = mapped_column(String(255))
    original_filename: Mapped[str | None] = mapped_column(String(255))
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    perceptual_hash: Mapped[str | None] = mapped_column(String(32), index=True)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    exif_gps_present: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    exif_stripped: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    report: Mapped[DamageReport] = relationship(back_populates="images")
    detections: Mapped[list[Detection]] = relationship(back_populates="image", cascade="all, delete-orphan")


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    image_id: Mapped[str] = mapped_column(ForeignKey("report_images.id", ondelete="CASCADE"), index=True)
    report_id: Mapped[str] = mapped_column(ForeignKey("damage_reports.id", ondelete="CASCADE"), index=True)
    class_label: Mapped[str] = mapped_column(String(64), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_x1: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y1: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_x2: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y2: Mapped[float] = mapped_column(Float, nullable=False)
    area_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    model_version: Mapped[str] = mapped_column(String(80), nullable=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    image: Mapped[ReportImage] = relationship(back_populates="detections")
    report: Mapped[DamageReport] = relationship(back_populates="detections")


class RepairUpdate(Base):
    __tablename__ = "repair_updates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    report_id: Mapped[str] = mapped_column(ForeignKey("damage_reports.id", ondelete="CASCADE"), index=True)
    previous_status: Mapped[str] = mapped_column(String(24), nullable=False)
    new_status: Mapped[str] = mapped_column(String(24), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    report: Mapped[DamageReport] = relationship(back_populates="repair_updates")


class DuplicateLink(Base):
    __tablename__ = "duplicate_links"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    canonical_report_id: Mapped[str] = mapped_column(ForeignKey("damage_reports.id", ondelete="CASCADE"), index=True)
    duplicate_report_id: Mapped[str] = mapped_column(
        ForeignKey("damage_reports.id", ondelete="CASCADE"), index=True
    )
    similarity: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str | None] = mapped_column(Text)
    linked_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    linked_by_label: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    canonical_report: Mapped[DamageReport] = relationship(
        back_populates="duplicates", foreign_keys=[canonical_report_id]
    )

    __table_args__ = (UniqueConstraint("canonical_report_id", "duplicate_report_id", name="uq_duplicate_pair"),)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    changes: Mapped[dict | None] = mapped_column(JSON)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str | None] = mapped_column(String(120))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False, index=True)


class ModelEvaluation(Base):
    """Stored evaluation run produced by ``ml/evaluation/evaluate.py``.

    Nothing is inserted unless a real evaluation artefact is imported, so the UI
    can honestly show "Evaluation not yet available".
    """

    __tablename__ = "model_evaluations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    model_name: Mapped[str] = mapped_column(String(120), nullable=False)
    model_version: Mapped[str] = mapped_column(String(80), nullable=False)
    dataset_name: Mapped[str] = mapped_column(String(160), nullable=False)
    dataset_split: Mapped[str] = mapped_column(String(120), default="test")
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    instance_count: Mapped[int] = mapped_column(Integer, default=0)
    precision: Mapped[float] = mapped_column(Float, default=0.0)
    recall: Mapped[float] = mapped_column(Float, default=0.0)
    map50: Mapped[float] = mapped_column(Float, default=0.0)
    map50_95: Mapped[float] = mapped_column(Float, default=0.0)
    iou_threshold: Mapped[float] = mapped_column(Float, default=0.5)
    per_class: Mapped[dict | None] = mapped_column(JSON)
    confusion_matrix: Mapped[dict | None] = mapped_column(JSON)
    latency_ms_mean: Mapped[float | None] = mapped_column(Float)
    latency_ms_p95: Mapped[float | None] = mapped_column(Float)
    class_labels: Mapped[dict | None] = mapped_column(JSON)
    notes: Mapped[str | None] = mapped_column(Text)
    evaluated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    source_file: Mapped[str | None] = mapped_column(String(255))
