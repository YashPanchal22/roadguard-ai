"""CSV / JSON / PDF exports of filtered report data."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import and_, select

from app.analytics import metrics
from app.api.deps import DbSession, OptionalUser
from app.models.entities import DamageReport, Role
from app.services import exports as export_service
from app.services import reports as report_service

router = APIRouter(prefix="/exports", tags=["Exports"])

EXPORT_ROW_LIMIT = 5000


def _collect(
    db,
    *,
    q: str | None,
    status: list[str] | None,
    category: list[str] | None,
    severity: list[str] | None,
    date_from: datetime | None,
    date_to: datetime | None,
    include_synthetic: bool,
    only_synthetic: bool,
    bbox: str | None,
) -> tuple[list[DamageReport], list, dict]:
    parsed_bbox = None
    if bbox:
        parts = [float(part) for part in bbox.split(",")]
        if len(parts) == 4:
            parsed_bbox = (parts[0], parts[1], parts[2], parts[3])
    clauses = report_service.build_filters(
        q=q,
        status=status,
        category=category,
        severity=severity,
        date_from=date_from,
        date_to=date_to,
        bbox=parsed_bbox,
        include_synthetic=include_synthetic,
        only_synthetic=only_synthetic,
    )
    stmt = select(DamageReport).order_by(DamageReport.reported_at.desc()).limit(EXPORT_ROW_LIMIT)
    if clauses:
        stmt = stmt.where(and_(*clauses))
    rows = list(db.execute(stmt).scalars().all())
    filters = {
        "q": q,
        "status": status,
        "category": category,
        "severity": severity,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "include_synthetic": include_synthetic,
        "only_synthetic": only_synthetic,
        "bbox": bbox,
    }
    return rows, clauses, filters


@router.get("/reports.csv", summary="Filtered report export as CSV")
def export_csv(
    db: DbSession,
    user: OptionalUser,
    q: str | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    category: Annotated[list[str] | None, Query()] = None,
    severity: Annotated[list[str] | None, Query()] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    include_synthetic: bool = True,
    only_synthetic: bool = False,
    bbox: str | None = None,
) -> Response:
    rows, _, filters = _collect(
        db,
        q=q,
        status=status,
        category=category,
        severity=severity,
        date_from=date_from,
        date_to=date_to,
        include_synthetic=include_synthetic,
        only_synthetic=only_synthetic,
        bbox=bbox,
    )
    include_reporter = bool(user and user.role == Role.admin.value)
    content = export_service.to_csv(rows, include_reporter=include_reporter)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    # Lead with the generation time so downstream users always know the vintage.
    content = f"# RoadGuard AI export generated_at={datetime.now().isoformat()} rows={len(rows)}\n" + content
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="roadguard-reports-{stamp}.csv"'},
    )


@router.get("/reports.json", summary="Filtered report export as JSON")
def export_json(
    db: DbSession,
    user: OptionalUser,
    q: str | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    category: Annotated[list[str] | None, Query()] = None,
    severity: Annotated[list[str] | None, Query()] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    include_synthetic: bool = True,
    only_synthetic: bool = False,
    bbox: str | None = None,
) -> Response:
    rows, _, filters = _collect(
        db,
        q=q,
        status=status,
        category=category,
        severity=severity,
        date_from=date_from,
        date_to=date_to,
        include_synthetic=include_synthetic,
        only_synthetic=only_synthetic,
        bbox=bbox,
    )
    include_reporter = bool(user and user.role == Role.admin.value)
    content = export_service.to_json(rows, include_reporter=include_reporter, filters=filters)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="roadguard-reports-{stamp}.json"'},
    )


@router.get("/summary.pdf", summary="PDF summary with KPIs and charts")
def export_pdf(
    db: DbSession,
    q: str | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    category: Annotated[list[str] | None, Query()] = None,
    severity: Annotated[list[str] | None, Query()] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    include_synthetic: bool = True,
    only_synthetic: bool = False,
    bbox: str | None = None,
) -> Response:
    rows, clauses, filters = _collect(
        db,
        q=q,
        status=status,
        category=category,
        severity=severity,
        date_from=date_from,
        date_to=date_to,
        include_synthetic=include_synthetic,
        only_synthetic=only_synthetic,
        bbox=bbox,
    )
    kpis = metrics.kpi_cards(db, clauses)
    pdf = export_service.to_pdf(
        reports=rows,
        kpis=kpis,
        category_counts=metrics.count_by(rows, "damage_category"),
        status_counts=metrics.count_by(rows, "status", order=metrics.STATUS_ORDER),
        severity_counts=metrics.count_by(rows, "reviewed_severity", order=metrics.SEVERITY_ORDER),
        by_date=metrics.reports_by_date(rows, days=30),
        filters=filters,
    )
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="roadguard-summary-{stamp}.pdf"'},
    )
