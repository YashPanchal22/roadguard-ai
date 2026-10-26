"""Synthetic demonstration dataset generator.

Everything created here is flagged ``is_synthetic = True`` so the UI can badge
it as DEMO and so it can be purged independently of real citizen submissions.

* Coordinates are plausible jittered positions around the configured demo
  region (default Ahmedabad, Gujarat) - they are labels on a map, not claims
  about real damage.
* Lifecycle histories are realistic status chains with timestamps.
* Sample images are attached only when real files exist in ``data/samples``.
  Any detections stored for those images come from an actual model run on that
  file (never invented numbers), and are still flagged synthetic because the
  parent report is synthetic.
"""
from __future__ import annotations

import argparse
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import REPO_ROOT, settings
from app.database.init_db import init_db
from app.database.session import SessionLocal
from app.models.entities import (
    AuditLog,
    DamageReport,
    Detection,
    DuplicateLink,
    RepairUpdate,
    ReportImage,
    ReportStatus,
    RoadImportance,
    Role,
    Severity,
    User,
)
from app.services import storage
from app.services.priority import recompute_all

SAMPLES_DIR = REPO_ROOT / "data" / "samples"

# Approximate Ahmedabad ward centroids (demo positioning only).
WARD_CENTROIDS: list[tuple[str, float, float]] = [
    ("Navrangpura", 23.0365, 72.5610),
    ("Satellite", 23.0300, 72.5180),
    ("Bopal", 23.0355, 72.4720),
    ("Maninagar", 22.9960, 72.6020),
    ("Vastrapur", 23.0350, 72.5290),
    ("Chandkheda", 23.1120, 72.5820),
    ("Gota", 23.1000, 72.5450),
    ("Naranpura", 23.0530, 72.5560),
    ("Paldi", 23.0110, 72.5700),
    ("Vejalpur", 23.0250, 72.5030),
    ("Nikol", 23.0300, 72.6600),
    ("Sarkhej", 22.9830, 72.5000),
]

ROAD_NAMES = [
    "Ashram Road",
    "C.G. Road",
    "SG Highway Service Road",
    "Ring Road",
    "Sarkhej-Gandhinagar Highway",
    "Lal Darwaja Road",
    "Relief Road",
    "Vijay Cross Road",
    "Prahlad Nagar Main Road",
    "Science City Road",
    "Naroda Road",
    "Nehru Park Road",
]

CATEGORIES = [
    ("pothole", 0.42),
    ("longitudinal_crack", 0.16),
    ("transverse_crack", 0.14),
    ("alligator_crack", 0.12),
    ("broken_surface", 0.11),
    ("other", 0.05),
]

SEVERITIES = [(Severity.low.value, 0.22), (Severity.medium.value, 0.38), (Severity.high.value, 0.28), (Severity.critical.value, 0.12)]

IMPORTANCES = [
    (RoadImportance.local.value, 0.32),
    (RoadImportance.collector.value, 0.38),
    (RoadImportance.arterial.value, 0.22),
    (RoadImportance.highway.value, 0.08),
]

DESCRIPTIONS = {
    "pothole": [
        "Deep pothole in the middle lane, around 40 cm wide. Cars swerve around it.",
        "Pothole refilled last monsoon has reopened and is deeper now.",
        "Large pothole just after the junction, hard to see at night.",
        "Water-filled pothole near the bus stop, splashes pedestrians.",
    ],
    "longitudinal_crack": [
        "Long crack running along the lane joint for several metres.",
        "Joint cracking widening along the road edge.",
    ],
    "transverse_crack": [
        "Crack across the full width of the lane near the speed breaker.",
        "Transverse crack opening up after heavy rain.",
    ],
    "alligator_crack": [
        "Alligator cracking patch spreading across the turning area.",
        "Web of cracks near the signal; surface is breaking into pieces.",
    ],
    "broken_surface": [
        "Top layer of asphalt has sheared off, loose gravel on the road.",
        "Broken surface patch after utility digging was filled poorly.",
    ],
    "other": [
        "Road surface damage near the drain cover.",
        "Suspected damage, needs a physical inspection.",
    ],
}

# status chain weights: how far along the lifecycle a demo report is
CHAIN_OPTIONS: list[tuple[list[str], float]] = [
    ([ReportStatus.submitted.value], 0.18),
    ([ReportStatus.submitted.value, ReportStatus.under_review.value], 0.18),
    ([ReportStatus.submitted.value, ReportStatus.under_review.value, ReportStatus.verified.value], 0.16),
    (
        [
            ReportStatus.submitted.value,
            ReportStatus.under_review.value,
            ReportStatus.verified.value,
            ReportStatus.assigned_for_repair.value,
        ],
        0.13,
    ),
    (
        [
            ReportStatus.submitted.value,
            ReportStatus.under_review.value,
            ReportStatus.verified.value,
            ReportStatus.assigned_for_repair.value,
            ReportStatus.in_progress.value,
        ],
        0.13,
    ),
    (
        [
            ReportStatus.submitted.value,
            ReportStatus.under_review.value,
            ReportStatus.verified.value,
            ReportStatus.assigned_for_repair.value,
            ReportStatus.in_progress.value,
            ReportStatus.resolved.value,
        ],
        0.17,
    ),
    ([ReportStatus.submitted.value, ReportStatus.under_review.value, ReportStatus.rejected.value], 0.05),
]

TRANSITION_NOTES = {
    ReportStatus.under_review.value: [
        "Photo reviewed against survey records.",
        "Duplicate check completed; damage looks genuine.",
        "Field team asked to confirm location.",
    ],
    ReportStatus.verified.value: [
        "Verified on site by ward inspector.",
        "Damage confirmed; severity set from inspection.",
        "Confirmed as structural damage, not a surface stain.",
    ],
    ReportStatus.assigned_for_repair.value: [
        "Assigned to contractor batch for this ward.",
        "Scheduled in the next patching cycle.",
        "Work order raised with the maintenance crew.",
    ],
    ReportStatus.in_progress.value: [
        "Crew on site, cutting the damaged area.",
        "Cold mix patching underway.",
        "Surface preparation in progress.",
    ],
    ReportStatus.resolved.value: [
        "Repair completed and compacted; surface level checked.",
        "Patched and sealed. Photo evidence attached by the crew.",
        "Work completed; road reopened.",
    ],
    ReportStatus.rejected.value: [
        "Duplicate of an existing verified report.",
        "Location could not be confirmed.",
        "Not a road defect (utility cover).",
    ],
}


def _weighted(rng: random.Random, pairs: list[tuple[str, float]]) -> str:
    labels = [p[0] for p in pairs]
    weights = [p[1] for p in pairs]
    return rng.choices(labels, weights=weights, k=1)[0]


def _ensure_users(db: Session) -> dict[str, User]:
    """Demo reviewer/admin accounts (development only, documented in README)."""
    from app.core.security import hash_password

    users: dict[str, User] = {}
    presets = [
        ("Priya Shah", "reviewer@roadguard.demo", Role.reviewer.value, "Reviewer@123"),
        ("Arjun Mehta", "admin@roadguard.demo", Role.admin.value, "Admin@123"),
    ]
    for name, email, role, password in presets:
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            user = User(name=name, email=email, role=role, password_hash=hash_password(password))
            db.add(user)
        users[role] = user
    db.commit()
    return users


def _attach_sample_images(db: Session, report: DamageReport, sample_path: Path, *, run_inference: bool) -> None:
    data = sample_path.read_bytes()
    from PIL import Image

    with Image.open(sample_path) as img:
        width, height = img.size
    annotated_bytes = None
    detections: list[dict] = []
    top_conf = None
    suggested = None
    model_version = settings.model_version

    if run_inference:
        try:
            import cv2

            from app.detection.detector import get_detector
            from app.detection.validation import to_bgr_array

            detector = get_detector()
            if detector.available:
                result = detector.predict(to_bgr_array(data))
                detections = [d.as_dict() for d in result.detections]
                top_conf = result.top_confidence
                suggested = result.dominant_category() if result.detections else None
                if result.annotated_bgr is not None:
                    ok, buffer = cv2.imencode(".jpg", result.annotated_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
                    if ok:
                        annotated_bytes = buffer.tobytes()
        except Exception:  # pragma: no cover - demo seeding must never fail hard
            detections = []

    import hashlib
    import uuid

    image_id = uuid.uuid4().hex
    target_dir = storage.reports_root() / report.id
    target_dir.mkdir(parents=True, exist_ok=True)
    original_name = f"{image_id}_original.jpg"
    (target_dir / original_name).write_bytes(data)
    annotated_rel = None
    if annotated_bytes:
        annotated_name = f"{image_id}_annotated.jpg"
        (target_dir / annotated_name).write_bytes(annotated_bytes)
        annotated_rel = f"reports/{report.id}/{annotated_name}"

    db.add(
        ReportImage(
            id=image_id,
            report_id=report.id,
            original_path=f"reports/{report.id}/{original_name}",
            annotated_path=annotated_rel,
            original_filename=sample_path.name,
            width=width,
            height=height,
            file_hash=hashlib.sha256(data).hexdigest(),
            perceptual_hash=None,
            mime_type="image/jpeg",
            size_bytes=len(data),
            exif_gps_present=False,
            exif_stripped=True,
            is_synthetic=True,
        )
    )
    for det in detections:
        db.add(
            Detection(
                image_id=image_id,
                report_id=report.id,
                class_label=det["class_label"],
                class_id=det["class_id"],
                confidence=det["confidence"],
                bbox_x1=det["bbox"]["x1"],
                bbox_y1=det["bbox"]["y1"],
                bbox_x2=det["bbox"]["x2"],
                bbox_y2=det["bbox"]["y2"],
                area_ratio=det.get("area_ratio", 0.0),
                model_version=model_version,
                is_synthetic=True,
            )
        )
    if detections:
        report.detection_confidence = top_conf
        report.ai_suggested_category = suggested


def generate_demo_data(
    db: Session,
    *,
    count: int = 120,
    seed: int = 20261025,
    reset: bool = True,
    run_inference: bool = True,
) -> dict:
    rng = random.Random(seed)
    users = _ensure_users(db)

    if reset:
        # Only demo (synthetic) rows are deleted - real reports are untouched.
        demo_ids = [
            row[0]
            for row in db.execute(select(DamageReport.id).where(DamageReport.is_synthetic.is_(True))).all()
        ]
        if demo_ids:
            db.execute(delete(Detection).where(Detection.report_id.in_(demo_ids)))
            db.execute(delete(ReportImage).where(ReportImage.report_id.in_(demo_ids)))
            db.execute(delete(RepairUpdate).where(RepairUpdate.report_id.in_(demo_ids)))
            db.execute(delete(DuplicateLink).where(DuplicateLink.canonical_report_id.in_(demo_ids)))
            db.execute(delete(AuditLog).where(AuditLog.entity_type == "report", AuditLog.entity_id.in_(demo_ids)))
            db.execute(delete(DamageReport).where(DamageReport.id.in_(demo_ids)))
            db.commit()
        for demo_id in demo_ids:
            storage.delete_report_files(demo_id)

    now = datetime.now(timezone.utc)
    reviewers = [users[Role.reviewer.value], users[Role.admin.value]]
    samples = sorted(SAMPLES_DIR.glob("*.jpg")) + sorted(SAMPLES_DIR.glob("*.jpeg")) + sorted(SAMPLES_DIR.glob("*.png"))

    created: list[DamageReport] = []
    for index in range(count):
        ward, base_lat, base_lng = rng.choice(WARD_CENTROIDS)
        category = _weighted(rng, CATEGORIES)
        # Bias toward the recent past with a long tail.
        days_ago = int(abs(rng.gauss(0, 1)) * 45)
        days_ago = min(days_ago, 210)
        reported_at = now - timedelta(days=days_ago, hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
        chain = rng.choices([c[0] for c in CHAIN_OPTIONS], weights=[c[1] for c in CHAIN_OPTIONS], k=1)[0]
        final_status = chain[-1]
        severity = _weighted(rng, SEVERITIES) if final_status not in {ReportStatus.submitted.value, ReportStatus.rejected.value} else None
        importance = _weighted(rng, IMPORTANCES)

        report = DamageReport(
            reference=f"RG-DEMO-{index + 1:04d}",
            description=rng.choice(DESCRIPTIONS.get(category, DESCRIPTIONS["other"])),
            damage_category=category,
            ai_suggested_category=None,
            detection_confidence=None,
            reviewed_severity=severity,
            road_importance=importance,
            latitude=round(base_lat + rng.uniform(-0.012, 0.012), 6),
            longitude=round(base_lng + rng.uniform(-0.012, 0.012), 6),
            location_source="demo",
            road_name=rng.choice(ROAD_NAMES),
            ward=ward,
            status=final_status,
            is_verified=final_status not in {
                ReportStatus.submitted.value,
                ReportStatus.under_review.value,
                ReportStatus.rejected.value,
            },
            reporter_label=rng.choice(["Citizen app", "Ward inspector", "Helpline import", "Field survey"]),
            is_synthetic=True,
            reported_at=reported_at,
            created_at=reported_at,
            updated_at=reported_at,
        )

        # Lifecycle history with monotonically increasing timestamps.
        cursor = reported_at
        db.add(report)
        db.flush()
        for step in chain[1:]:
            gap_hours = rng.randint(6, 96)
            cursor = cursor + timedelta(hours=gap_hours)
            if cursor > now:
                cursor = now - timedelta(minutes=rng.randint(5, 120))
            actor = rng.choice(reviewers)
            db.add(
                RepairUpdate(
                    report_id=report.id,
                    previous_status=chain[chain.index(step) - 1],
                    new_status=step,
                    notes=rng.choice(TRANSITION_NOTES.get(step, ["Status updated."])),
                    actor_id=actor.id,
                    actor_label=actor.name,
                    created_at=cursor,
                )
            )
            db.add(
                AuditLog(
                    entity_type="report",
                    entity_id=report.id,
                    action=f"report.{step}",
                    changes={"from": chain[chain.index(step) - 1], "to": step},
                    actor_id=actor.id,
                    actor_label=actor.name,
                    is_synthetic=True,
                    created_at=cursor,
                )
            )
        if final_status == ReportStatus.resolved.value:
            report.resolved_at = cursor
        db.add(
            AuditLog(
                entity_type="report",
                entity_id=report.id,
                action="report.created",
                changes={"reference": report.reference, "synthetic": True},
                actor_label=report.reporter_label,
                is_synthetic=True,
                created_at=reported_at,
            )
        )
        created.append(report)

    db.commit()

    # Attach real sample photos to a handful of demo reports (real inference
    # output when the model is available, otherwise image only).
    attached = 0
    if samples:
        for offset, report in enumerate(created[: min(len(created), 6)]):
            sample = samples[offset % len(samples)]
            _attach_sample_images(db, report, sample, run_inference=run_inference)
            attached += 1
        db.commit()

    # A few explicit duplicate pairs so the review workflow is demonstrable.
    duplicates_linked = 0
    for offset in range(0, min(40, len(created) - 1), 8):
        canonical = created[offset]
        candidate = created[offset + 1]
        if canonical.status in {ReportStatus.verified.value, ReportStatus.resolved.value}:
            candidate.latitude = round((canonical.latitude or 0) + 0.0004, 6)
            candidate.longitude = round((canonical.longitude or 0) + 0.0004, 6)
            candidate.damage_category = canonical.damage_category
            candidate.reported_at = canonical.reported_at + timedelta(hours=6)
            db.add(
                DuplicateLink(
                    canonical_report_id=canonical.id,
                    duplicate_report_id=candidate.id,
                    similarity=0.82,
                    reason="Demo pair: same pothole reported by two citizens.",
                    linked_by_label="Demo seed",
                )
            )
            candidate.duplicate_of_id = canonical.id
            duplicates_linked += 1
    db.commit()

    recompute_all(db)

    total = int(db.execute(select(func.count(DamageReport.id)).where(DamageReport.is_synthetic.is_(True))).scalar_one())
    return {
        "created": len(created),
        "demo_reports_total": total,
        "images_attached": attached,
        "duplicates_linked": duplicates_linked,
        "sample_files_found": len(samples),
        "region": settings.demo_region_label,
    }


def purge_demo_data(db: Session) -> int:
    demo_ids = [row[0] for row in db.execute(select(DamageReport.id).where(DamageReport.is_synthetic.is_(True))).all()]
    if not demo_ids:
        return 0
    db.execute(delete(Detection).where(Detection.report_id.in_(demo_ids)))
    db.execute(delete(ReportImage).where(ReportImage.report_id.in_(demo_ids)))
    db.execute(delete(RepairUpdate).where(RepairUpdate.report_id.in_(demo_ids)))
    db.execute(delete(DuplicateLink).where(DuplicateLink.canonical_report_id.in_(demo_ids)))
    db.execute(delete(AuditLog).where(AuditLog.entity_type == "report", AuditLog.entity_id.in_(demo_ids)))
    db.execute(delete(DamageReport).where(DamageReport.id.in_(demo_ids)))
    db.commit()
    for demo_id in demo_ids:
        storage.delete_report_files(demo_id)
    return len(demo_ids)


def main() -> None:  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Generate the RoadGuard AI synthetic demo dataset.")
    parser.add_argument("--count", type=int, default=settings.demo_report_count)
    parser.add_argument("--seed", type=int, default=20261025)
    parser.add_argument("--no-reset", action="store_true", help="append instead of replacing demo rows")
    parser.add_argument("--no-inference", action="store_true", help="skip model runs on sample images")
    parser.add_argument("--purge", action="store_true", help="delete all synthetic demo reports only")
    args = parser.parse_args()

    init_db()
    with SessionLocal() as db:
        if args.purge:
            removed = purge_demo_data(db)
            print(f"removed {removed} synthetic demo report(s); real reports untouched")
            return
        result = generate_demo_data(
            db,
            count=args.count,
            seed=args.seed,
            reset=not args.no_reset,
            run_inference=not args.no_inference,
        )
    print("demo data ready:", result)


if __name__ == "__main__":  # pragma: no cover
    main()
