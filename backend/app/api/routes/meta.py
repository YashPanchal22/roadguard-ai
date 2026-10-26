"""Static option lists, health check and system status."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import func, select, text

from app.api.deps import DbSession
from app.core.config import settings
from app.detection.detector import get_detector
from app.models.entities import DamageCategory, DamageReport, ReportStatus, RoadImportance, Severity
from app.schemas.schemas import MetaOptions
from app.services.reports import ALLOWED_TRANSITIONS

router = APIRouter(tags=["Metadata"])

STATUS_DESCRIPTIONS = {
    ReportStatus.submitted.value: "Citizen submission awaiting triage",
    ReportStatus.under_review.value: "Reviewer is validating the report",
    ReportStatus.verified.value: "Damage confirmed; eligible for prioritisation",
    ReportStatus.assigned_for_repair.value: "Work order raised with a crew",
    ReportStatus.in_progress.value: "Repair work underway",
    ReportStatus.resolved.value: "Repair completed and confirmed",
    ReportStatus.rejected.value: "Not valid damage or a duplicate",
}

CATEGORYLABELS = {
    DamageCategory.pothole.value: "Pothole",
    DamageCategory.longitudinal_crack.value: "Longitudinal crack",
    DamageCategory.transverse_crack.value: "Transverse crack",
    DamageCategory.alligator_crack.value: "Alligator crack",
    DamageCategory.broken_surface.value: "Broken road surface",
    DamageCategory.other.value: "Other road damage",
    DamageCategory.unknown.value: "Unclassified",
}


@router.get("/meta/options", response_model=MetaOptions, summary="Enumerations used by the UI")
def options() -> MetaOptions:
    detector = get_detector()
    return MetaOptions(
        statuses=[{"value": s.value, "label": s.value.replace("_", " ").title(), "description": STATUS_DESCRIPTIONS[s.value]} for s in ReportStatus],
        categories=[{"value": value, "label": label} for value, label in CATEGORYLABELS.items()],
        severities=[
            {"value": Severity.low.value, "label": "Low"},
            {"value": Severity.medium.value, "label": "Medium"},
            {"value": Severity.high.value, "label": "High"},
            {"value": Severity.critical.value, "label": "Critical"},
        ],
        road_importance=[{"value": r.value, "label": r.value.title()} for r in RoadImportance],
        allowed_transitions={key: list(value) for key, value in ALLOWED_TRANSITIONS.items()},
        map_defaults={
            "lat": settings.default_map_lat,
            "lng": settings.default_map_lng,
            "zoom": settings.default_map_zoom,
        },
        priority_weights=dict(settings.priority_weights),
        demo_region_label=settings.demo_region_label,
        detection_available=detector.available,
    )


@router.get("/health", summary="Service and database health")
def health(db: DbSession) -> dict:
    db_ok = True
    error = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover
        db_ok = False
        error = str(exc)
    detector = get_detector()
    total = db.execute(select(func.count(DamageReport.id))).scalar_one()
    synthetic = db.execute(
        select(func.count(DamageReport.id)).where(DamageReport.is_synthetic.is_(True))
    ).scalar_one()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": {"ok": db_ok, "error": error},
        "detector": {
            "available": detector.available,
            "model_version": settings.model_version,
            "weights_present": settings.model_path.exists(),
        },
        "reports": {"total": int(total), "synthetic": int(synthetic), "real": int(total) - int(synthetic)},
        "environment": settings.environment,
    }
