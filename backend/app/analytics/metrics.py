"""Analytics computed from real database rows.

Everything here is a SQL aggregation over ``damage_reports`` /
``repair_updates``; there is no hardcoded statistic anywhere. Empty databases
produce empty series and zero KPIs, which the frontend renders as an empty
state.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.entities import DamageReport, ReportStatus, Severity

UNRESOLVED = (
    ReportStatus.submitted.value,
    ReportStatus.under_review.value,
    ReportStatus.verified.value,
    ReportStatus.assigned_for_repair.value,
    ReportStatus.in_progress.value,
)
UNDER_REPAIR = (ReportStatus.assigned_for_repair.value, ReportStatus.in_progress.value)

STATUS_ORDER = [
    ReportStatus.submitted.value,
    ReportStatus.under_review.value,
    ReportStatus.verified.value,
    ReportStatus.assigned_for_repair.value,
    ReportStatus.in_progress.value,
    ReportStatus.resolved.value,
    ReportStatus.rejected.value,
]

SEVERITY_ORDER = [Severity.low.value, Severity.medium.value, Severity.high.value, Severity.critical.value]


def _rows(db: Session, clauses: list) -> list[DamageReport]:
    stmt = select(DamageReport)
    if clauses:
        stmt = stmt.where(and_(*clauses))
    return list(db.execute(stmt).scalars().all())


def kpis(db: Session, clauses: list, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    rows = _rows(db, clauses)

    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = len(rows)
    this_month = sum(1 for r in rows if r.reported_at and r.reported_at >= month_start)
    verified = sum(1 for r in rows if r.is_verified)
    unresolved = sum(1 for r in rows if r.status in UNRESOLVED)
    under_repair = sum(1 for r in rows if r.status in UNDER_REPAIR)
    resolved = sum(1 for r in rows if r.status == ReportStatus.resolved.value)
    high_priority = sum(
        1 for r in rows if r.is_verified and r.status in UNRESOLVED and (r.priority_score or 0) >= 55
    )

    durations = [
        (r.resolved_at - r.reported_at).total_seconds() / 86400
        for r in rows
        if r.resolved_at and r.reported_at and r.resolved_at >= r.reported_at
    ]
    avg_resolution = round(sum(durations) / len(durations), 2) if durations else None

    return {
        "total_reports": total,
        "reports_this_month": this_month,
        "verified_reports": verified,
        "unresolved_reports": unresolved,
        "under_repair": under_repair,
        "resolved_reports": resolved,
        "avg_resolution_days": avg_resolution,
        "high_priority_verified": high_priority,
        "resolved_samples": len(durations),
    }


def kpi_cards(db: Session, clauses: list) -> list[dict[str, Any]]:
    data = kpis(db, clauses)
    cards = [
        {
            "key": "total_reports",
            "label": "Total Reports",
            "value": data["total_reports"],
            "hint": "All records matching the active filters",
        },
        {
            "key": "reports_this_month",
            "label": "Submitted This Month",
            "value": data["reports_this_month"],
            "hint": "Reported since the 1st of the current month",
        },
        {
            "key": "verified_reports",
            "label": "Verified Damage",
            "value": data["verified_reports"],
            "hint": "Confirmed by a reviewer",
        },
        {
            "key": "unresolved_reports",
            "label": "Unresolved",
            "value": data["unresolved_reports"],
            "hint": "Submitted → In Progress, not yet resolved or rejected",
        },
        {
            "key": "under_repair",
            "label": "Under Repair",
            "value": data["under_repair"],
            "hint": "Assigned for repair or in progress",
        },
        {
            "key": "resolved_reports",
            "label": "Resolved",
            "value": data["resolved_reports"],
            "hint": "Repairs confirmed complete",
        },
        {
            "key": "avg_resolution_days",
            "label": "Avg Resolution Time",
            "value": data["avg_resolution_days"] if data["avg_resolution_days"] is not None else 0,
            "unit": "days",
            "hint": f"Mean of {data['resolved_samples']} resolved report(s)"
            if data["resolved_samples"]
            else "No resolved reports yet",
        },
        {
            "key": "high_priority_verified",
            "label": "High-Priority Verified",
            "value": data["high_priority_verified"],
            "hint": "Verified, unresolved, priority score ≥ 55",
        },
    ]
    return cards


def reports_by_date(rows: Iterable[DamageReport], days: int = 30) -> list[dict[str, Any]]:
    rows = list(rows)
    if not rows:
        return []
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    buckets: dict[str, dict[str, int]] = {
        (start + timedelta(days=i)).isoformat(): {"reported": 0, "resolved": 0} for i in range(days)
    }
    for r in rows:
        key = r.reported_at.date().isoformat() if r.reported_at else None
        if key in buckets:
            buckets[key]["reported"] += 1
        if r.resolved_at:
            rkey = r.resolved_at.date().isoformat()
            if rkey in buckets:
                buckets[rkey]["resolved"] += 1
    return [
        {"label": key, "value": value["reported"], "secondary": value["resolved"]}
        for key, value in sorted(buckets.items())
    ]


def count_by(rows: Iterable[DamageReport], attribute: str, order: list[str] | None = None) -> list[dict]:
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        key = getattr(r, attribute) or "unknown"
        counts[key] += 1
    keys = order or sorted(counts, key=lambda k: counts[k], reverse=True)
    out = [{"label": k.replace("_", " ").title(), "value": counts.get(k, 0)} for k in keys]
    return out


def resolution_trend(db: Session, rows: list[DamageReport], months: int = 6) -> list[dict]:
    """Monthly reported vs resolved counts plus mean resolution days."""
    now = datetime.now(timezone.utc)
    buckets: dict[str, dict[str, Any]] = {}
    for i in range(months - 1, -1, -1):
        month = (now.replace(day=1) - timedelta(days=30 * i)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        buckets[month.strftime("%Y-%m")] = {"reported": 0, "resolved": 0, "durations": []}
    for r in rows:
        if r.reported_at:
            key = r.reported_at.strftime("%Y-%m")
            if key in buckets:
                buckets[key]["reported"] += 1
        if r.resolved_at:
            key = r.resolved_at.strftime("%Y-%m")
            if key in buckets:
                buckets[key]["resolved"] += 1
                if r.reported_at and r.resolved_at >= r.reported_at:
                    buckets[key]["durations"].append((r.resolved_at - r.reported_at).total_seconds() / 86400)
    out = []
    for key, value in sorted(buckets.items()):
        durations = value["durations"]
        out.append(
            {
                "label": key,
                "value": value["reported"],
                "secondary": value["resolved"],
                "avg_days": round(sum(durations) / len(durations), 2) if durations else 0,
            }
        )
    return out


def outstanding_by_age(rows: list[DamageReport]) -> list[dict]:
    buckets = [
        ("0-7 days", 0, 7),
        ("8-14 days", 8, 14),
        ("15-30 days", 15, 30),
        ("31-60 days", 31, 60),
        ("60+ days", 61, 100_000),
    ]
    now = datetime.now(timezone.utc)
    out = [{"label": label, "value": 0} for label, _, _ in buckets]
    for r in rows:
        if r.status not in UNRESOLVED or not r.reported_at:
            continue
        age = (now - r.reported_at).total_seconds() / 86400
        for idx, (_, low, high) in enumerate(buckets):
            if low <= age <= high:
                out[idx]["value"] += 1
                break
    return out


def region_stats(rows: list[DamageReport]) -> list[dict]:
    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {"reports": 0, "unresolved": 0, "priority": []})
    for r in rows:
        ward = r.ward or "Unassigned"
        grouped[ward]["reports"] += 1
        if r.status in UNRESOLVED:
            grouped[ward]["unresolved"] += 1
        grouped[ward]["priority"].append(r.priority_score or 0)
    out = []
    for ward, value in grouped.items():
        priorities = value["priority"]
        out.append(
            {
                "ward": ward,
                "reports": value["reports"],
                "unresolved": value["unresolved"],
                "avg_priority": round(sum(priorities) / len(priorities), 1) if priorities else 0.0,
            }
        )
    out.sort(key=lambda item: item["reports"], reverse=True)
    return out


def detection_confidence_distribution(rows: list[DamageReport]) -> list[dict]:
    buckets = [("0-20%", 0, 0.2), ("20-40%", 0.2, 0.4), ("40-60%", 0.4, 0.6), ("60-80%", 0.6, 0.8), ("80-100%", 0.8, 1.01)]
    out = [{"label": label, "value": 0} for label, _, _ in buckets]
    for r in rows:
        if r.detection_confidence is None:
            continue
        for idx, (_, low, high) in enumerate(buckets):
            if low <= r.detection_confidence < high:
                out[idx]["value"] += 1
                break
    return out


def repair_funnel(rows: list[DamageReport]) -> list[dict]:
    return count_by(rows, "status", order=STATUS_ORDER)
