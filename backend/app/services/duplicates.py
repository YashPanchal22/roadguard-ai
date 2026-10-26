"""Duplicate-report assistance.

Suggestions only. Nothing is merged or deleted automatically: an authorised
reviewer links a duplicate, which records a ``DuplicateLink`` row plus an
audit-log entry so the relationship is reversible and traceable.
"""
from __future__ import annotations

import math
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.detection.validation import phash_distance
from app.models.entities import DamageReport, DuplicateLink, ReportStatus


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def find_duplicate_candidates(
    db: Session,
    report: DamageReport,
    *,
    radius_m: float | None = None,
    window_days: int | None = None,
    limit: int = 8,
) -> list[dict]:
    if report.latitude is None or report.longitude is None:
        return []

    radius = radius_m or settings.duplicate_radius_m
    window = window_days or settings.duplicate_window_days
    lat_delta = radius / 111_320.0
    lng_delta = radius / (111_320.0 * max(math.cos(math.radians(report.latitude)), 1e-6))

    stmt = select(DamageReport).where(
        DamageReport.id != report.id,
        DamageReport.latitude.is_not(None),
        DamageReport.longitude.is_not(None),
        DamageReport.latitude.between(report.latitude - lat_delta, report.latitude + lat_delta),
        DamageReport.longitude.between(report.longitude - lng_delta, report.longitude + lng_delta),
        DamageReport.status != ReportStatus.rejected.value,
    )
    if report.reported_at:
        stmt = stmt.where(
            DamageReport.reported_at.between(
                report.reported_at - timedelta(days=window),
                report.reported_at + timedelta(days=window),
            )
        )
    rows = db.execute(stmt.limit(200)).scalars().all()

    my_hash = report.images[0].perceptual_hash if report.images else None
    candidates: list[dict] = []
    for other in rows:
        if other.duplicate_of_id == report.id:
            continue
        distance = haversine_m(report.latitude, report.longitude, other.latitude, other.longitude)
        if distance > radius:
            continue
        hours_apart = (
            abs((other.reported_at - report.reported_at).total_seconds()) / 3600
            if report.reported_at and other.reported_at
            else 0.0
        )
        same_category = bool(
            report.damage_category
            and other.damage_category
            and report.damage_category == other.damage_category
        )

        other_hash = other.images[0].perceptual_hash if other.images else None
        distance_bits = phash_distance(my_hash or "", other_hash or "")
        similarity = None if distance_bits is None else round(max(0.0, 1 - distance_bits / 64), 3)

        proximity_score = max(0.0, 1 - distance / radius)
        time_score = max(0.0, 1 - hours_apart / (window * 24))
        score = 0.5 * proximity_score + 0.25 * time_score + (0.25 if same_category else 0.0)
        if similarity is not None:
            score = 0.45 * proximity_score + 0.2 * time_score + 0.175 * (1 if same_category else 0) + 0.175 * similarity

        reasons = []
        if distance <= radius / 2:
            reasons.append(f"Within {distance:.0f} m")
        else:
            reasons.append(f"{distance:.0f} m apart")
        reasons.append(f"{hours_apart:.1f} h apart" if hours_apart < 48 else f"{hours_apart / 24:.1f} days apart")
        if same_category:
            reasons.append(f"Same category ({report.damage_category})")
        if similarity is not None and similarity >= 0.75:
            reasons.append(f"Similar image (perceptual similarity {similarity:.2f})")

        candidates.append(
            {
                "report": other,
                "distance_m": round(distance, 1),
                "hours_apart": round(hours_apart, 2),
                "same_category": same_category,
                "image_similarity": similarity,
                "score": round(min(score, 1.0), 3),
                "reasons": reasons,
            }
        )

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[:limit]


def link_duplicate(
    db: Session,
    *,
    canonical: DamageReport,
    duplicate: DamageReport,
    similarity: float = 0.0,
    reason: str | None = None,
    actor_id: str | None = None,
    actor_label: str | None = None,
) -> DuplicateLink:
    existing = db.execute(
        select(DuplicateLink).where(
            DuplicateLink.canonical_report_id == canonical.id,
            DuplicateLink.duplicate_report_id == duplicate.id,
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    link = DuplicateLink(
        canonical_report_id=canonical.id,
        duplicate_report_id=duplicate.id,
        similarity=similarity,
        reason=reason,
        linked_by_id=actor_id,
        linked_by_label=actor_label,
    )
    duplicate.duplicate_of_id = canonical.id
    db.add(link)
    db.commit()
    db.refresh(link)
    return link
