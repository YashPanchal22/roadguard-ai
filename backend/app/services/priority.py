"""Explainable repair-priority scoring.

The score is a transparent weighted sum of *available* factors, rescaled to
0-100. Every factor is reported with its normalised value, weight, weight
contribution and a human-readable explanation so a reviewer can see exactly why
a report ranks where it does.

Deliberate separation of concerns
---------------------------------
* ``detection_confidence`` = the model's confidence. It is **not** used as a
  severity signal and carries at most a small 0-1 tie-break nudge towards
  "a detection exists"; it never dominates the score.
* ``reviewed_severity`` = human/estimated seriousness (used with weight).
* ``priority_score`` = operational ordering for repair.

Known limitations (documented in docs/PRIORITY.md):
* Severity is only as good as the reviewer, and an unreviewed report has no
  severity factor at all (it is treated as missing, not as "low").
* Repeated-report density is a proxy for impact, not proven traffic volume.
* Road importance must come from an authoritative source; the UI labels it as
  user-provided and unverified.
* Weights are configuration, not ground truth.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import DamageReport, ReportStatus, RoadImportance, Severity

WEIGHT_LABELS = {
    "severity": "Reviewed severity",
    "category": "Damage category",
    "road_importance": "Road importance",
    "damage_size": "Detected damage size",
    "report_age": "Age of unresolved report",
    "repeat_reports": "Nearby verified reports",
}

CATEGORY_RISK = {
    # Structural categories that typically worsen fastest rank higher.
    "pothole": 0.85,
    "alligator_crack": 0.75,
    "broken_surface": 0.7,
    "transverse_crack": 0.5,
    "longitudinal_crack": 0.4,
    "other": 0.3,
    "unknown": 0.2,
}

SEVERITY_SCORE = {
    Severity.low.value: 0.25,
    Severity.medium.value: 0.5,
    Severity.high.value: 0.78,
    Severity.critical.value: 1.0,
}

ROAD_IMPORTANCE_SCORE = {
    RoadImportance.local.value: 0.3,
    RoadImportance.collector.value: 0.5,
    RoadImportance.arterial.value: 0.8,
    RoadImportance.highway.value: 1.0,
}

UNRESOLVED_STATUSES = (
    ReportStatus.submitted.value,
    ReportStatus.under_review.value,
    ReportStatus.verified.value,
    ReportStatus.assigned_for_repair.value,
    ReportStatus.in_progress.value,
)


@dataclass
class Factor:
    key: str
    label: str
    available: bool
    normalised: float
    weight: float
    contribution: float
    detail: str

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "available": self.available,
            "normalised": round(self.normalised, 4),
            "weight": round(self.weight, 4),
            "contribution": round(self.contribution, 2),
            "detail": self.detail,
        }


def _weights(db: Session) -> dict[str, float]:
    """Weights come from settings; admins can override at runtime (in-memory)."""
    override = getattr(db, "info", {}).get("priority_weights") if db is not None else None
    return dict(override or settings.priority_weights)


def nearby_verified_count(
    db: Session,
    *,
    report: DamageReport,
    radius_m: float | None = None,
    window_days: int | None = None,
) -> int:
    radius = radius_m or settings.priority_repeat_radius_m
    window = window_days or settings.priority_repeat_window_days
    if report.latitude is None or report.longitude is None:
        return 0
    lat_delta = radius / 111_320.0
    lng_delta = radius / (111_320.0 * max(math.cos(math.radians(report.latitude)), 1e-6))
    stmt = select(func.count(DamageReport.id)).where(
        DamageReport.id != report.id,
        DamageReport.is_verified.is_(True),
        DamageReport.latitude.is_not(None),
        DamageReport.longitude.is_not(None),
        DamageReport.latitude.between(report.latitude - lat_delta, report.latitude + lat_delta),
        DamageReport.longitude.between(report.longitude - lng_delta, report.longitude + lng_delta),
        DamageReport.status != ReportStatus.rejected.value,
    )
    if window:
        cutoff = report.reported_at.timestamp() - window * 86400
        stmt = stmt.where(
            (
                DamageReport.reported_at
                >= datetime.fromtimestamp(max(cutoff, 0), tz=timezone.utc)
            )
            | (DamageReport.reported_at.is_(None))
        )
    return int(db.execute(stmt).scalar_one())


def compute_priority(
    db: Session,
    report: DamageReport,
    *,
    now: datetime | None = None,
    weights: dict[str, float] | None = None,
    include_context: bool = True,
) -> tuple[float, list[dict]]:
    """Return ``(priority_score, factors)`` where score is 0-100."""
    now = now or datetime.now(timezone.utc)
    weights = weights or _weights(db)
    factors: list[Factor] = []

    # 1. Reviewed severity (missing when nobody reviewed it yet).
    if report.reviewed_severity and report.reviewed_severity in SEVERITY_SCORE:
        value = SEVERITY_SCORE[report.reviewed_severity]
        factors.append(
            Factor(
                "severity",
                WEIGHT_LABELS["severity"],
                True,
                value,
                weights.get("severity", 0),
                0.0,
                f"Reviewer severity is '{report.reviewed_severity}'.",
            )
        )
    else:
        factors.append(
            Factor(
                "severity",
                WEIGHT_LABELS["severity"],
                False,
                0.0,
                weights.get("severity", 0),
                0.0,
                "No severity review recorded - factor excluded rather than assumed low.",
            )
        )

    # 2. Damage category risk.
    cat_value = CATEGORY_RISK.get(report.damage_category, 0.25)
    cat_available = report.damage_category not in {"unknown", None}
    factors.append(
        Factor(
            "category",
            WEIGHT_LABELS["category"],
            cat_available,
            cat_value if cat_available else 0.0,
            weights.get("category", 0),
            0.0,
            f"Category '{report.damage_category}' has risk weight {cat_value:.2f}.",
        )
    )

    # 3. Road importance (user/authority-provided, flagged as unverified).
    ri_value = ROAD_IMPORTANCE_SCORE.get(report.road_importance, 0.5)
    factors.append(
        Factor(
            "road_importance",
            WEIGHT_LABELS["road_importance"],
            True,
            ri_value,
            weights.get("road_importance", 0),
            0.0,
            f"Road classified as '{report.road_importance}' (user/source-provided, unverified).",
        )
    )

    # 4. Damage size from the largest real detection area ratio.
    areas = [d.area_ratio for d in report.detections if d.area_ratio]
    if areas:
        biggest = max(areas)
        # 0-15 % of frame maps to 0-1; larger saturates.
        size_value = min(1.0, biggest / 0.15)
        factors.append(
            Factor(
                "damage_size",
                WEIGHT_LABELS["damage_size"],
                True,
                size_value,
                weights.get("damage_size", 0),
                0.0,
                f"Largest detection covers {biggest * 100:.1f}% of the photo.",
            )
        )
    else:
        factors.append(
            Factor(
                "damage_size",
                WEIGHT_LABELS["damage_size"],
                False,
                0.0,
                weights.get("damage_size", 0),
                0.0,
                "No detection geometry available.",
            )
        )

    # 5. Age of an unresolved report.
    reference = report.reported_at or report.created_at
    age_days = max((now - reference).total_seconds() / 86400, 0.0) if reference else 0.0
    if report.status in UNRESOLVED_STATUSES:
        age_value = min(1.0, age_days / max(settings.priority_age_full_days, 1))
        factors.append(
            Factor(
                "report_age",
                WEIGHT_LABELS["report_age"],
                True,
                age_value,
                weights.get("report_age", 0),
                0.0,
                f"Unresolved for {age_days:.1f} days (saturates at {settings.priority_age_full_days}).",
            )
        )
    else:
        factors.append(
            Factor(
                "report_age",
                WEIGHT_LABELS["report_age"],
                False,
                0.0,
                weights.get("report_age", 0),
                0.0,
                f"Report is '{report.status}', so age pressure does not apply.",
            )
        )

    # 6. Nearby verified reports (repeat damage in the same area).
    if report.latitude is not None and report.longitude is not None:
        count = nearby_verified_count(db, report=report) if include_context else 0
        repeat_value = min(1.0, count / 4.0)
        factors.append(
            Factor(
                "repeat_reports",
                WEIGHT_LABELS["repeat_reports"],
                True,
                repeat_value,
                weights.get("repeat_reports", 0),
                0.0,
                f"{count} verified report(s) within {settings.priority_repeat_radius_m:.0f} m "
                f"in the last {settings.priority_repeat_window_days} days.",
            )
        )
    else:
        factors.append(
            Factor(
                "repeat_reports",
                WEIGHT_LABELS["repeat_reports"],
                False,
                0.0,
                weights.get("repeat_reports", 0),
                0.0,
                "Location missing, so proximity analysis is unavailable.",
            )
        )

    # Weighted sum over available factors only, renormalised so a report is not
    # penalised for missing data it cannot provide.
    available_weight = sum(f.weight for f in factors if f.available) or 1.0
    raw = sum(f.normalised * f.weight for f in factors if f.available)
    score = round(100.0 * raw / available_weight, 2)

    # Renormalised contributions (points of the final 0-100 score).
    for f in factors:
        f.contribution = round(100.0 * (f.normalised * f.weight) / available_weight, 2) if f.available else 0.0

    # AI confidence is displayed separately and only used for ordering ties.
    return score, [f.as_dict() for f in factors]


def priority_band(score: float) -> str:
    if score >= 75:
        return "critical"
    if score >= 55:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def recompute_report_priority(db: Session, report: DamageReport, *, commit: bool = True) -> float:
    score, breakdown = compute_priority(db, report)
    report.priority_score = score
    report.priority_breakdown = {"score": score, "band": priority_band(score), "factors": breakdown}
    if commit:
        db.commit()
        db.refresh(report)
    return score


def recompute_all(db: Session) -> int:
    reports = db.execute(select(DamageReport)).scalars().all()
    for report in reports:
        score, breakdown = compute_priority(db, report)
        report.priority_score = score
        report.priority_breakdown = {"score": score, "band": priority_band(score), "factors": breakdown}
    db.commit()
    return len(reports)
