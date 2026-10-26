"""Dashboard KPI and chart endpoints - all computed from stored records."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import and_, select

from app.analytics import metrics
from app.api.deps import DbSession, ReviewerUser
from app.core.config import settings
from app.models.entities import DamageReport
from app.schemas.schemas import (
    AnalyticsResponse,
    ChartBundle,
    KpiCard,
    NamedSeries,
    OverviewResponse,
    PriorityQueueResponse,
    RegionStat,
    SeriesPoint,
)
from app.services import reports as report_service
from app.services.priority import WEIGHT_LABELS

router = APIRouter(prefix="/analytics", tags=["Analytics"])


def _shared_filters(
    q: str | None,
    status: list[str] | None,
    category: list[str] | None,
    severity: list[str] | None,
    date_from: datetime | None,
    date_to: datetime | None,
    include_synthetic: bool,
    only_synthetic: bool,
) -> list:
    return report_service.build_filters(
        q=q,
        status=status,
        category=category,
        severity=severity,
        date_from=date_from,
        date_to=date_to,
        include_synthetic=include_synthetic,
        only_synthetic=only_synthetic,
    )


def _load_rows(db, clauses: list) -> list[DamageReport]:
    stmt = select(DamageReport)
    if clauses:
        stmt = stmt.where(and_(*clauses))
    return list(db.execute(stmt).scalars().all())


@router.get("/overview", response_model=OverviewResponse, summary="KPI cards for the overview dashboard")
def overview(
    db: DbSession,
    q: str | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    category: Annotated[list[str] | None, Query()] = None,
    severity: Annotated[list[str] | None, Query()] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    include_synthetic: bool = True,
    only_synthetic: bool = False,
) -> OverviewResponse:
    clauses = _shared_filters(q, status, category, severity, date_from, date_to, include_synthetic, only_synthetic)
    cards = metrics.kpi_cards(db, clauses)
    rows = _load_rows(db, clauses)
    return OverviewResponse(
        kpis=[KpiCard(**card) for card in cards],
        generated_at=datetime.now(timezone.utc),
        filters_applied={
            "q": q,
            "status": status,
            "category": category,
            "severity": severity,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
            "include_synthetic": include_synthetic,
            "only_synthetic": only_synthetic,
        },
        record_count=len(rows),
        synthetic_included=include_synthetic or only_synthetic,
    )


@router.get("/charts", response_model=AnalyticsResponse, summary="All dashboard charts from live data")
def charts(
    db: DbSession,
    q: str | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    category: Annotated[list[str] | None, Query()] = None,
    severity: Annotated[list[str] | None, Query()] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    include_synthetic: bool = True,
    only_synthetic: bool = False,
    days: int = Query(default=30, ge=7, le=180),
) -> AnalyticsResponse:
    clauses = _shared_filters(q, status, category, severity, date_from, date_to, include_synthetic, only_synthetic)
    rows = _load_rows(db, clauses)

    by_date = metrics.reports_by_date(rows, days=days)
    categories = metrics.count_by(rows, "damage_category")
    statuses = metrics.count_by(rows, "status", order=metrics.STATUS_ORDER)
    severities = metrics.count_by(rows, "reviewed_severity", order=metrics.SEVERITY_ORDER)
    wards = metrics.region_stats(rows)
    outstanding = metrics.outstanding_by_age(rows)
    resolution = metrics.resolution_trend(db, rows, months=6)
    confidence = metrics.detection_confidence_distribution(rows)

    bundles = [
        ChartBundle(
            name="Reports by date",
            description=f"Daily submitted vs resolved counts over the last {days} days",
            unit="reports",
            series=[
                NamedSeries(
                    name="Submitted",
                    data=[SeriesPoint(label=p["label"], value=p["value"]) for p in by_date],
                ),
                NamedSeries(
                    name="Resolved",
                    data=[SeriesPoint(label=p["label"], value=p["secondary"] or 0) for p in by_date],
                ),
            ],
        ),
        ChartBundle(
            name="Damage categories",
            description="Distribution of reviewed damage categories",
            unit="reports",
            series=[NamedSeries(name="Reports", data=[SeriesPoint(**p) for p in categories])],
        ),
        ChartBundle(
            name="Reports by status",
            description="Current lifecycle stage of every record in scope",
            unit="reports",
            series=[NamedSeries(name="Reports", data=[SeriesPoint(**p) for p in statuses])],
        ),
        ChartBundle(
            name="Severity distribution",
            description="Reviewer-confirmed severity; unreviewed reports are excluded from this chart",
            unit="reports",
            series=[NamedSeries(name="Reports", data=[SeriesPoint(**p) for p in severities])],
        ),
        ChartBundle(
            name="Outstanding repairs by age",
            description="Unresolved reports grouped by days since they were reported",
            unit="reports",
            series=[NamedSeries(name="Open reports", data=[SeriesPoint(**p) for p in outstanding])],
        ),
        ChartBundle(
            name="Resolution trend",
            description="Monthly submitted vs resolved counts",
            unit="reports",
            series=[
                NamedSeries(name="Submitted", data=[SeriesPoint(label=p["label"], value=p["value"]) for p in resolution]),
                NamedSeries(
                    name="Resolved", data=[SeriesPoint(label=p["label"], value=p["secondary"] or 0) for p in resolution]
                ),
            ],
        ),
        ChartBundle(
            name="AI confidence distribution",
            description="Model confidence of the top detection per report (not a severity measure)",
            unit="reports",
            series=[NamedSeries(name="Reports", data=[SeriesPoint(**p) for p in confidence])],
        ),
        ChartBundle(
            name="Damage by region",
            description="Reports per ward/region where location data exists",
            unit="reports",
            series=[
                NamedSeries(
                    name="Reports",
                    data=[SeriesPoint(label=w["ward"], value=w["reports"], secondary=w["unresolved"]) for w in wards],
                )
            ],
        ),
    ]

    return AnalyticsResponse(charts=bundles, generated_at=datetime.now(timezone.utc), record_count=len(rows))


@router.get("/regions", response_model=list[RegionStat], summary="Per-region aggregates")
def regions(db: DbSession, include_synthetic: bool = True) -> list[RegionStat]:
    clauses = _shared_filters(None, None, None, None, None, None, include_synthetic, False)
    rows = _load_rows(db, clauses)
    return [RegionStat(**row) for row in metrics.region_stats(rows)]


@router.get("/priority-queue", response_model=PriorityQueueResponse, summary="Explainable repair priority queue")
def priority_queue(
    db: DbSession,
    limit: int = Query(default=10, ge=1, le=50),
    include_synthetic: bool = True,
) -> PriorityQueueResponse:
    items = report_service.get_priority_queue(db, limit=limit, include_synthetic=include_synthetic)
    from app.schemas.schemas import PriorityFactor, PriorityQueueItem

    return PriorityQueueResponse(
        items=[
            PriorityQueueItem(
                reference=item["reference"],
                id=item["id"],
                priority_score=item["priority_score"],
                reviewed_severity=item["reviewed_severity"],
                damage_category=item["damage_category"],
                status=item["status"],
                road_name=item["road_name"],
                age_days=item["age_days"],
                factors=[PriorityFactor(**f) for f in item["factors"]],
            )
            for item in items
        ],
        weights=dict(settings.priority_weights),
        explanation=(
            "Priority = weighted sum of available factors, renormalised to 0-100. "
            f"Weights: {', '.join(f'{WEIGHT_LABELS.get(k, k)} {v:.2f}' for k, v in settings.priority_weights.items())}. "
            "Missing factors are excluded rather than assumed low. Human verification is required before "
            "any official maintenance decision."
        ),
    )


@router.get("/recompute", summary="Recompute priority scores (reviewer/admin)")
def recompute(db: DbSession, user: ReviewerUser) -> dict:
    from app.services.priority import recompute_all

    count = recompute_all(db)
    return {"message": "Priority scores recomputed", "reports": count}
