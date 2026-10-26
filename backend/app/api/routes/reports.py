"""Report CRUD, lifecycle, history and duplicate assistance."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import and_, select

from app.api.deps import AdminUser, DbSession, OptionalUser, ReviewerUser
from app.core.errors import AppError
from app.core.rate_limit import check_rate_limit
from app.models.entities import DamageReport
from app.schemas.schemas import (
    DuplicateCandidate,
    DuplicateResponse,
    LinkDuplicateRequest,
    MessageResponse,
    Order,
    PaginatedMeta,
    ReportCreate,
    ReportDetail,
    ReportListResponse,
    ReportUpdate,
    StatusUpdateRequest,
)
from app.services import duplicates as duplicate_service
from app.services import reports as report_service
from app.services.serializers import report_detail, report_summary

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.post(
    "",
    response_model=ReportDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a road damage report",
    responses={410: {"description": "Detection analysis expired"}},
)
def create_report(
    payload: ReportCreate,
    db: DbSession,
    user: OptionalUser,
    request: Request,
) -> ReportDetail:
    check_rate_limit(request, scope="report_create", limit=30, window_seconds=300)
    report = report_service.create_report(db, payload, actor=user)
    history = report_service.history(db, report)
    return report_detail(report, history["audit_trail"])


@router.get("", response_model=ReportListResponse, summary="List / search / filter reports")
def list_reports(
    db: DbSession,
    q: str | None = Query(default=None, description="Reference, road name, ward, description or category"),
    status_filter: Annotated[list[str] | None, Query(alias="status")] = None,
    category: Annotated[list[str] | None, Query()] = None,
    severity: Annotated[list[str] | None, Query()] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    bbox: str | None = Query(default=None, description="south,west,north,east"),
    min_priority: float | None = Query(default=None, ge=0, le=100),
    include_synthetic: bool = Query(default=True),
    only_synthetic: bool = Query(default=False),
    is_verified: bool | None = None,
    geo_only: bool = False,
    exclude_duplicates: bool = False,
    sort: Literal[
        "reported_at", "created_at", "priority_score", "status", "reference", "detection_confidence"
    ] = "reported_at",
    order: Order = "desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
) -> ReportListResponse:
    parsed_bbox = None
    if bbox:
        try:
            parts = [float(part) for part in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError
            south, west, north, east = parts
            if not (-90 <= south <= north <= 90 and -180 <= west <= east <= 180):
                raise ValueError
            parsed_bbox = (south, west, north, east)
        except ValueError as exc:
            raise AppError(
                "INVALID_BBOX",
                "bbox must be 'south,west,north,east' with south<=north and west<=east.",
                status_code=422,
            ) from exc

    filters = report_service.build_filters(
        q=q,
        status=status_filter,
        category=category,
        severity=severity,
        date_from=date_from,
        date_to=date_to,
        bbox=parsed_bbox,
        min_priority=min_priority,
        include_synthetic=include_synthetic,
        only_synthetic=only_synthetic,
        is_verified=is_verified,
    )
    items, total = report_service.query_reports(
        db,
        filters=filters,
        sort=sort,
        order=order,
        page=page,
        page_size=page_size,
        geo_only=geo_only,
        exclude_duplicates=exclude_duplicates,
    )
    return ReportListResponse(
        items=[report_summary(item) for item in items],
        meta=PaginatedMeta(
            page=page,
            page_size=page_size,
            total=total,
            total_pages=max(1, (total + page_size - 1) // page_size),
            sort=sort,
            order=order,
        ),
    )


@router.get("/{report_id}", response_model=ReportDetail, summary="Report detail with detections and history")
def get_report(report_id: str, db: DbSession) -> ReportDetail:
    report = report_service.get_report(db, report_id)
    history = report_service.history(db, report)
    return report_detail(report, history["audit_trail"])


@router.patch("/{report_id}", response_model=ReportDetail, summary="Edit review fields (reviewer/admin)")
def update_report(
    report_id: str,
    payload: ReportUpdate,
    db: DbSession,
    user: ReviewerUser,
) -> ReportDetail:
    report = report_service.get_report(db, report_id)
    updated = report_service.update_report(db, report, payload, actor=user)
    history = report_service.history(db, updated)
    return report_detail(updated, history["audit_trail"])


@router.post(
    "/{report_id}/status",
    response_model=ReportDetail,
    summary="Transition report status and record a repair update",
)
def change_status(
    report_id: str,
    payload: StatusUpdateRequest,
    db: DbSession,
    user: ReviewerUser,
) -> ReportDetail:
    report = report_service.get_report(db, report_id)
    updated = report_service.transition_status(db, report, payload, actor=user)
    history = report_service.history(db, updated)
    return report_detail(updated, history["audit_trail"])


@router.get("/{report_id}/history", summary="Repair updates and audit trail")
def get_history(report_id: str, db: DbSession) -> dict:
    report = report_service.get_report(db, report_id)
    data = report_service.history(db, report)
    return {
        "report_id": report.id,
        "reference": report.reference,
        "status": report.status,
        "resolved_at": report.resolved_at,
        "repair_updates": [
            {
                "id": update.id,
                "previous_status": update.previous_status,
                "new_status": update.new_status,
                "notes": update.notes,
                "actor_label": update.actor_label,
                "created_at": update.created_at,
            }
            for update in data["repair_updates"]
        ],
        "audit_trail": data["audit_trail"],
        "allowed_next": list(report_service.ALLOWED_TRANSITIONS.get(report.status, ())),
    }


@router.delete(
    "/{report_id}",
    response_model=MessageResponse,
    summary="Delete a report (admin only)",
)
def delete_report(report_id: str, db: DbSession, user: AdminUser) -> MessageResponse:
    report = report_service.get_report(db, report_id)
    reference = report.reference
    report_service.delete_report(db, report, actor=user)
    return MessageResponse(message="Report deleted", detail=f"Reference {reference} and its images were removed.")


@router.get(
    "/{report_id}/duplicates",
    response_model=DuplicateResponse,
    summary="Possible duplicate reports (advisory only)",
)
def duplicates(report_id: str, db: DbSession, include_linked: bool = True) -> DuplicateResponse:
    report = report_service.get_report(db, report_id)
    candidates = duplicate_service.find_duplicate_candidates(db, report)
    linked_rows = []
    if include_linked:
        links = db.execute(
            select(duplicate_service.DuplicateLink).where(
                and_(
                    duplicate_service.DuplicateLink.canonical_report_id == report.id,
                )
            )
        ).scalars().all()
        for link in links:
            linked_report = db.execute(
                select(DamageReport).where(DamageReport.id == link.duplicate_report_id)
            ).scalar_one_or_none()
            if linked_report:
                linked_rows.append(
                    {
                        "id": link.id,
                        "duplicate_reference": linked_report.reference,
                        "duplicate_report_id": linked_report.id,
                        "similarity": link.similarity,
                        "reason": link.reason,
                        "linked_by": link.linked_by_label,
                        "created_at": link.created_at.isoformat(),
                    }
                )
    return DuplicateResponse(
        report_id=report.id,
        candidates=[
            DuplicateCandidate(
                report=report_summary(candidate["report"]),
                distance_m=candidate["distance_m"],
                hours_apart=candidate["hours_apart"],
                same_category=candidate["same_category"],
                image_similarity=candidate["image_similarity"],
                score=candidate["score"],
                reasons=candidate["reasons"],
            )
            for candidate in candidates
        ],
        linked=linked_rows,
    )


@router.post(
    "/{report_id}/duplicates/link",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Link a duplicate to its canonical report (reviewer/admin, audited)",
)
def link_duplicate(
    report_id: str,
    payload: LinkDuplicateRequest,
    db: DbSession,
    user: ReviewerUser,
) -> MessageResponse:
    canonical = report_service.get_report(db, report_id)
    duplicate = report_service.get_report(db, payload.duplicate_report_id)
    if canonical.id == duplicate.id:
        raise AppError("INVALID_DUPLICATE", "A report cannot be a duplicate of itself.", status_code=422)

    similarity = 0.0
    candidate = duplicate_service.find_duplicate_candidates(db, canonical, radius_m=5000, window_days=365)
    for item in candidate:
        if item["report"].id == duplicate.id:
            similarity = item["score"]
            break

    link = duplicate_service.link_duplicate(
        db,
        canonical=canonical,
        duplicate=duplicate,
        similarity=similarity,
        reason=payload.reason,
        actor_id=user.id,
        actor_label=user.name,
    )
    report_service.audit(
        db,
        entity_type="report",
        entity_id=duplicate.id,
        action="report.duplicate_linked",
        changes={"canonical_reference": canonical.reference, "link_id": link.id, "similarity": similarity},
        actor=user,
        is_synthetic=duplicate.is_synthetic,
    )
    db.commit()
    return MessageResponse(
        message="Duplicate linked",
        detail=f"{duplicate.reference} is now linked to {canonical.reference}. Both records are preserved.",
    )


@router.get("/{report_id}/priority", summary="Explainable priority breakdown")
def priority(report_id: str, db: DbSession) -> dict:
    from app.services.priority import compute_priority, priority_band

    report = report_service.get_report(db, report_id)
    score, factors = compute_priority(db, report)
    return {
        "reference": report.reference,
        "score": score,
        "band": priority_band(score),
        "factors": factors,
        "note": (
            "Priority orders verified repair work. AI confidence is displayed separately and is not a "
            "severity or safety measure. Human verification is always required."
        ),
    }
