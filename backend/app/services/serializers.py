"""ORM -> API schema serialisation (kept in one place so URLs stay consistent)."""
from __future__ import annotations

from app.models.entities import DamageReport
from app.schemas.schemas import (
    DetectionRecordOut,
    PriorityFactor,
    RepairUpdateOut,
    ReportDetail,
    ReportImageOut,
    ReportSummary,
)


def media_url(image_id: str, variant: str) -> str:
    return f"/api/v1/media/reports/{image_id}/{variant}"


def thumbnail_url(report: DamageReport) -> str | None:
    if not report.images:
        return None
    image = report.images[0]
    if image.annotated_path:
        return media_url(image.id, "annotated")
    return media_url(image.id, "original")


def image_out(image) -> ReportImageOut:
    return ReportImageOut(
        id=image.id,
        width=image.width,
        height=image.height,
        mime_type=image.mime_type,
        size_bytes=image.size_bytes,
        file_hash=image.file_hash,
        exif_gps_present=image.exif_gps_present,
        is_synthetic=image.is_synthetic,
        created_at=image.created_at,
        original_url=media_url(image.id, "original"),
        annotated_url=media_url(image.id, "annotated") if image.annotated_path else None,
    )


def report_summary(report: DamageReport) -> ReportSummary:
    return ReportSummary(
        id=report.id,
        reference=report.reference,
        description=report.description,
        damage_category=report.damage_category,
        ai_suggested_category=report.ai_suggested_category,
        detection_confidence=report.detection_confidence,
        reviewed_severity=report.reviewed_severity,
        road_importance=report.road_importance,
        priority_score=round(report.priority_score or 0.0, 2),
        latitude=report.latitude,
        longitude=report.longitude,
        location_source=report.location_source,
        road_name=report.road_name,
        ward=report.ward,
        status=report.status,
        is_verified=report.is_verified,
        is_synthetic=report.is_synthetic,
        duplicate_of_id=report.duplicate_of_id,
        reporter_label=report.reporter_label,
        reported_at=report.reported_at,
        resolved_at=report.resolved_at,
        created_at=report.created_at,
        updated_at=report.updated_at,
        detection_count=len(report.detections),
        thumbnail_url=thumbnail_url(report),
    )


def report_detail(report: DamageReport, audit_trail: list[dict] | None = None) -> ReportDetail:
    breakdown = []
    payload = report.priority_breakdown or {}
    for factor in payload.get("factors", []):
        breakdown.append(PriorityFactor(**factor))

    age_days = None
    if report.reported_at:
        from datetime import datetime, timezone

        age_days = round((datetime.now(timezone.utc) - report.reported_at).total_seconds() / 86400, 2)

    base = report_summary(report)
    return ReportDetail(
        **base.model_dump(),
        priority_breakdown=breakdown,
        images=[image_out(image) for image in report.images],
        detections=[DetectionRecordOut.model_validate(det) for det in report.detections],
        repair_updates=[RepairUpdateOut.model_validate(update) for update in report.repair_updates],
        audit_trail=audit_trail or [],
        resolution_age_days=age_days,
    )
