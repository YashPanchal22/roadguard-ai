"""Report lifecycle: creation, edits, status transitions, history and queries."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.models.entities import (
    AuditLog,
    DamageReport,
    Detection,
    RepairUpdate,
    ReportImage,
    ReportStatus,
    Role,
    User,
)
from app.schemas.schemas import ReportCreate, ReportUpdate, StatusUpdateRequest
from app.services import storage
from app.services.priority import compute_priority, recompute_report_priority

# Allowed lifecycle transitions. Terminal states keep their history.
ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    ReportStatus.submitted.value: (
        ReportStatus.under_review.value,
        ReportStatus.rejected.value,
    ),
    ReportStatus.under_review.value: (
        ReportStatus.verified.value,
        ReportStatus.rejected.value,
    ),
    ReportStatus.verified.value: (
        ReportStatus.assigned_for_repair.value,
        ReportStatus.rejected.value,
    ),
    ReportStatus.assigned_for_repair.value: (ReportStatus.in_progress.value,),
    ReportStatus.in_progress.value: (ReportStatus.resolved.value,),
    ReportStatus.resolved.value: (),
    ReportStatus.rejected.value: (ReportStatus.under_review.value,),
}

STATUS_ACTIONS = {
    ReportStatus.under_review.value: "report.under_review",
    ReportStatus.verified.value: "report.verified",
    ReportStatus.assigned_for_repair.value: "report.assigned",
    ReportStatus.in_progress.value: "report.in_progress",
    ReportStatus.resolved.value: "report.resolved",
    ReportStatus.rejected.value: "report.rejected",
}

REVIEWER_ROLES = {Role.reviewer.value, Role.admin.value}


def new_reference(db: Session) -> str:
    """Human-friendly reference: RG-YYMMDD-XXXX (uniqueness enforced in DB)."""
    for _ in range(20):
        token = secrets.token_hex(2).upper()
        reference = f"RG-{datetime.now(timezone.utc):%y%m%d}-{token}"
        exists = db.execute(select(DamageReport.id).where(DamageReport.reference == reference)).first()
        if not exists:
            return reference
    raise AppError("REFERENCE_CONFLICT", "Could not allocate a report reference, please retry.", status_code=500)


def audit(
    db: Session,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    changes: dict[str, Any] | None = None,
    actor: User | None = None,
    actor_label: str | None = None,
    is_synthetic: bool = False,
) -> AuditLog:
    entry = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        changes=changes,
        actor_id=actor.id if actor else None,
        actor_label=(actor.name if actor else actor_label),
        is_synthetic=is_synthetic,
    )
    db.add(entry)
    return entry


def create_report(
    db: Session,
    payload: ReportCreate,
    *,
    actor: User | None,
    is_synthetic: bool = False,
) -> DamageReport:
    """Create a report, optionally attaching a real detection analysis."""
    analysis_meta: dict[str, Any] | None = None
    if payload.analysis_id:
        analysis_meta = storage.load_analysis(payload.analysis_id)  # raises 410 when expired

    report = DamageReport(
        reference=new_reference(db),
        description=payload.description,
        damage_category=(payload.damage_category.value if payload.damage_category else "unknown"),
        ai_suggested_category=None,
        reviewed_severity=payload.reviewed_severity.value if payload.reviewed_severity else None,
        road_importance=payload.road_importance.value,
        latitude=payload.latitude,
        longitude=payload.longitude,
        location_source=payload.location_source,
        road_name=payload.road_name,
        ward=payload.ward,
        status=ReportStatus.submitted.value,
        reporter_id=actor.id if actor else None,
        reporter_label=payload.reporter_label or (actor.name if actor else None),
        is_synthetic=is_synthetic,
        reported_at=payload.reported_at or datetime.now(timezone.utc),
    )
    db.add(report)
    db.flush()  # assign report.id

    if analysis_meta is not None:
        final = storage.finalize_analysis(payload.analysis_id, report.id)
        image = ReportImage(
            id=final["image_id"],
            report_id=report.id,
            original_path=final["original_rel"],
            annotated_path=final.get("annotated_rel"),
            original_filename=final.get("original_filename"),
            width=final["width"],
            height=final["height"],
            file_hash=final["file_hash"],
            perceptual_hash=final.get("perceptual_hash"),
            mime_type=final.get("mime_type", "image/jpeg"),
            size_bytes=final.get("size_bytes", 0),
            exif_gps_present=bool(final.get("exif_gps_present")),
            exif_stripped=True,
            is_synthetic=is_synthetic,
        )
        db.add(image)
        db.flush()

        for det in final.get("detections", []):
            db.add(
                Detection(
                    image_id=image.id,
                    report_id=report.id,
                    class_label=det["class_label"],
                    class_id=det["class_id"],
                    confidence=det["confidence"],
                    bbox_x1=det["bbox"]["x1"],
                    bbox_y1=det["bbox"]["y1"],
                    bbox_x2=det["bbox"]["x2"],
                    bbox_y2=det["bbox"]["y2"],
                    area_ratio=det.get("area_ratio", 0.0),
                    model_version=final.get("model_version", "unknown"),
                    is_synthetic=is_synthetic,
                )
            )
        report.detection_confidence = final.get("top_confidence")
        report.ai_suggested_category = final.get("suggested_category")
        if not payload.damage_category and final.get("suggested_category"):
            report.damage_category = final["suggested_category"]

    audit(
        db,
        entity_type="report",
        entity_id=report.id,
        action="report.created",
        changes={"reference": report.reference, "status": report.status, "synthetic": is_synthetic},
        actor=actor,
        actor_label=payload.reporter_label,
        is_synthetic=is_synthetic,
    )
    db.flush()
    recompute_report_priority(db, report, commit=False)
    db.commit()
    db.refresh(report)
    return report


def get_report(db: Session, report_id: str) -> DamageReport:
    stmt = (
        select(DamageReport)
        .options(
            selectinload(DamageReport.images),
            selectinload(DamageReport.detections),
            selectinload(DamageReport.repair_updates),
        )
        .where(or_(DamageReport.id == report_id, DamageReport.reference == report_id))
    )
    report = db.execute(stmt).scalar_one_or_none()
    if report is None:
        raise AppError("REPORT_NOT_FOUND", "No report matches that ID or reference.", status_code=404)
    return report


def require_role(actor: User | None, *, roles: set[str], action: str) -> None:
    if actor is None or actor.role not in roles:
        raise AppError(
            "FORBIDDEN",
            f"Your role does not permit this action ({action}).",
            status_code=403,
            details={"required_roles": sorted(roles)},
        )


def update_report(
    db: Session,
    report: DamageReport,
    payload: ReportUpdate,
    *,
    actor: User,
) -> DamageReport:
    require_role(actor, roles=REVIEWER_ROLES, action="edit report review fields")

    changes: dict[str, Any] = {}
    data = payload.model_dump(exclude_unset=True)

    if "latitude" in data or "longitude" in data:
        new_lat = data.get("latitude", report.latitude)
        new_lng = data.get("longitude", report.longitude)
        if new_lat is None or new_lng is None:
            raise AppError(
                "INVALID_COORDINATES",
                "Both latitude and longitude are required when correcting a location.",
                status_code=422,
            )
        if abs(new_lat) < 1e-6 and abs(new_lng) < 1e-6:
            raise AppError("INVALID_COORDINATES", "(0, 0) is not an acceptable location.", status_code=422)
        changes["location"] = {"from": [report.latitude, report.longitude], "to": [new_lat, new_lng]}
        report.latitude, report.longitude = new_lat, new_lng
        report.location_source = "manual"

    for field in ("description", "road_name", "ward"):
        if field in data and data[field] != getattr(report, field):
            changes[field] = {"from": getattr(report, field), "to": data[field]}
            setattr(report, field, data[field])

    if "damage_category" in data and payload.damage_category:
        new_value = payload.damage_category.value
        if new_value != report.damage_category:
            changes["damage_category"] = {"from": report.damage_category, "to": new_value}
            report.damage_category = new_value

    if "reviewed_severity" in data and payload.reviewed_severity:
        new_value = payload.reviewed_severity.value
        if new_value != report.reviewed_severity:
            changes["reviewed_severity"] = {"from": report.reviewed_severity, "to": new_value}
            report.reviewed_severity = new_value

    if "road_importance" in data and payload.road_importance:
        new_value = payload.road_importance.value
        if new_value != report.road_importance:
            changes["road_importance"] = {"from": report.road_importance, "to": new_value}
            report.road_importance = new_value

    if "is_verified" in data and payload.is_verified is not None:
        if payload.is_verified and report.status in {
            ReportStatus.submitted.value,
        }:
            # Verification implies review; keep the lifecycle consistent.
            report.status = ReportStatus.under_review.value
        changes["is_verified"] = {"from": report.is_verified, "to": payload.is_verified}
        report.is_verified = payload.is_verified

    if not changes:
        return report

    audit(
        db,
        entity_type="report",
        entity_id=report.id,
        action="report.updated",
        changes=changes,
        actor=actor,
        is_synthetic=report.is_synthetic,
    )
    recompute_report_priority(db, report, commit=False)
    db.commit()
    db.refresh(report)
    return report


def transition_status(
    db: Session,
    report: DamageReport,
    payload: StatusUpdateRequest,
    *,
    actor: User,
) -> DamageReport:
    require_role(actor, roles=REVIEWER_ROLES, action="change report status")
    target = payload.new_status.value
    current = report.status

    if target == current:
        raise AppError("NO_STATUS_CHANGE", f"Report is already '{current}'.", status_code=409)

    allowed = ALLOWED_TRANSITIONS.get(current, ())
    if target not in allowed:
        raise AppError(
            "INVALID_TRANSITION",
            f"Cannot move a report from '{current}' to '{target}'.",
            status_code=422,
            details={"current": current, "allowed": list(allowed)},
            hints=["Follow the lifecycle: submitted -> under_review -> verified -> assigned_for_repair -> in_progress -> resolved."],
        )

    if target == ReportStatus.rejected.value and not (payload.notes or "").strip():
        raise AppError(
            "NOTES_REQUIRED",
            "A rejection must include a reason in notes.",
            status_code=422,
        )

    previous = current
    report.status = target
    if target == ReportStatus.verified.value:
        report.is_verified = True
    if target == ReportStatus.resolved.value:
        report.resolved_at = datetime.now(timezone.utc)
    if target == ReportStatus.rejected.value:
        report.is_verified = False

    db.add(
        RepairUpdate(
            report_id=report.id,
            previous_status=previous,
            new_status=target,
            notes=payload.notes or payload.resolution_notes,
            actor_id=actor.id,
            actor_label=actor.name,
        )
    )
    audit(
        db,
        entity_type="report",
        entity_id=report.id,
        action=STATUS_ACTIONS.get(target, "report.status_changed"),
        changes={"from": previous, "to": target, "notes": payload.notes},
        actor=actor,
        is_synthetic=report.is_synthetic,
    )
    recompute_report_priority(db, report, commit=False)
    db.commit()
    db.refresh(report)
    return report


def delete_report(db: Session, report: DamageReport, *, actor: User) -> None:
    require_role(actor, roles={Role.admin.value}, action="delete a report")
    reference = report.reference
    files_id = report.id
    db.delete(report)
    audit(
        db,
        entity_type="report",
        entity_id=files_id,
        action="report.deleted",
        changes={"reference": reference},
        actor=actor,
    )
    db.commit()
    storage.delete_report_files(files_id)


def history(db: Session, report: DamageReport) -> dict[str, Any]:
    logs = (
        db.execute(
            select(AuditLog)
            .where(AuditLog.entity_type == "report", AuditLog.entity_id == report.id)
            .order_by(AuditLog.created_at.asc())
        )
        .scalars()
        .all()
    )
    return {
        "repair_updates": report.repair_updates,
        "audit_trail": [
            {
                "id": log.id,
                "action": log.action,
                "changes": log.changes,
                "actor_label": log.actor_label,
                "created_at": log.created_at,
                "is_synthetic": log.is_synthetic,
            }
            for log in logs
        ],
    }


# --------------------------------------------------------------------------
# Querying
# --------------------------------------------------------------------------

SORT_FIELDS = {
    "reported_at": DamageReport.reported_at,
    "created_at": DamageReport.created_at,
    "priority_score": DamageReport.priority_score,
    "status": DamageReport.status,
    "reference": DamageReport.reference,
    "detection_confidence": DamageReport.detection_confidence,
}


def build_filters(
    *,
    q: str | None = None,
    status: list[str] | None = None,
    category: list[str] | None = None,
    severity: list[str] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    bbox: tuple[float, float, float, float] | None = None,
    min_priority: float | None = None,
    include_synthetic: bool = True,
    only_synthetic: bool = False,
    is_verified: bool | None = None,
    duplicate_of: str | None = None,
) -> list:
    clauses: list = []
    if q:
        like = f"%{q.strip()}%"
        clauses.append(
            or_(
                DamageReport.reference.ilike(like),
                DamageReport.road_name.ilike(like),
                DamageReport.ward.ilike(like),
                DamageReport.description.ilike(like),
                DamageReport.damage_category.ilike(like),
            )
        )
    if status:
        clauses.append(DamageReport.status.in_(status))
    if category:
        clauses.append(DamageReport.damage_category.in_(category))
    if severity:
        clauses.append(DamageReport.reviewed_severity.in_(severity))
    if date_from:
        clauses.append(DamageReport.reported_at >= date_from)
    if date_to:
        clauses.append(DamageReport.reported_at <= date_to)
    if bbox:
        south, west, north, east = bbox
        clauses.append(
            and_(
                DamageReport.latitude.between(south, north),
                DamageReport.longitude.between(west, east),
            )
        )
    if min_priority is not None:
        clauses.append(DamageReport.priority_score >= min_priority)
    if only_synthetic:
        clauses.append(DamageReport.is_synthetic.is_(True))
    elif not include_synthetic:
        clauses.append(DamageReport.is_synthetic.is_(False))
    if is_verified is not None:
        clauses.append(DamageReport.is_verified.is_(is_verified))
    if duplicate_of:
        clauses.append(DamageReport.duplicate_of_id == duplicate_of)
    return clauses


def query_reports(
    db: Session,
    *,
    filters: list,
    sort: str = "reported_at",
    order: str = "desc",
    page: int = 1,
    page_size: int = 25,
    geo_only: bool = False,
    exclude_duplicates: bool = False,
) -> tuple[list[DamageReport], int]:
    clauses = list(filters)
    if geo_only:
        clauses.append(DamageReport.latitude.is_not(None))
        clauses.append(DamageReport.longitude.is_not(None))
    if exclude_duplicates:
        clauses.append(DamageReport.duplicate_of_id.is_(None))

    count_stmt = select(func.count(DamageReport.id))
    if clauses:
        count_stmt = count_stmt.where(and_(*clauses))
    total = int(db.execute(count_stmt).scalar_one())

    sort_column = SORT_FIELDS.get(sort, DamageReport.reported_at)
    sort_expr = sort_column.desc() if order.lower() != "asc" else sort_column.asc()

    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    stmt = (
        select(DamageReport)
        .options(selectinload(DamageReport.images), selectinload(DamageReport.detections))
        .order_by(sort_expr, DamageReport.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if clauses:
        stmt = stmt.where(and_(*clauses))
    items = db.execute(stmt).scalars().all()
    return list(items), total


def get_priority_queue(db: Session, *, limit: int = 10, include_synthetic: bool = True) -> list[dict]:
    clause = [
        DamageReport.status.in_(
            [
                ReportStatus.verified.value,
                ReportStatus.assigned_for_repair.value,
                ReportStatus.in_progress.value,
            ]
        )
    ]
    if not include_synthetic:
        clause.append(DamageReport.is_synthetic.is_(False))
    stmt = (
        select(DamageReport)
        .options(selectinload(DamageReport.detections))
        .where(and_(*clause))
        .order_by(DamageReport.priority_score.desc())
        .limit(limit)
    )
    rows = db.execute(stmt).scalars().all()
    now = datetime.now(timezone.utc)
    out = []
    for report in rows:
        score, factors = compute_priority(db, report, now=now)
        out.append(
            {
                "reference": report.reference,
                "id": report.id,
                "priority_score": round(score, 2),
                "reviewed_severity": report.reviewed_severity,
                "damage_category": report.damage_category,
                "status": report.status,
                "road_name": report.road_name,
                "age_days": round((now - report.reported_at).total_seconds() / 86400, 1),
                "factors": factors,
            }
        )
    return out
