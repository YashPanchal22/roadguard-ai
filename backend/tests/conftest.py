"""Test harness: isolated database, isolated storage, real model weights.

Environment variables are set *before* the app package is imported so the
settings singleton picks up the temporary paths.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="roadguard-tests-"))
os.environ["ROADGUARD_ENVIRONMENT"] = "test"
os.environ["ROADGUARD_DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["ROADGUARD_STORAGE_DIR"] = str(_TMP / "uploads")
os.environ["ROADGUARD_SEED_DEMO_ON_STARTUP"] = "false"
os.environ["ROADGUARD_DEMO_REPORT_COUNT"] = "0"
os.environ["ROADGUARD_JWT_SECRET"] = "test-secret-not-for-production"
os.environ["ROADGUARD_RATE_LIMIT_DETECTION_PER_WINDOW"] = "1000"
os.environ["ROADGUARD_RATE_LIMIT_AUTH_PER_WINDOW"] = "1000"

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = REPO_ROOT / "data" / "models" / "pothole_yolov8.pt"
SAMPLES = REPO_ROOT / "data" / "samples"


@pytest.fixture(scope="session", autouse=True)
def _cleanup_tmp():
    yield
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture(scope="session")
def client():
    from app.main import app
    from fastapi.testclient import TestClient

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def db_session():
    from app.database.session import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="session")
def users(client):
    """Create one account per role directly in the database."""
    from app.core.security import hash_password
    from app.database.session import SessionLocal
    from app.models.entities import Role, User
    from sqlalchemy import select

    created = {}
    with SessionLocal() as db:
        for name, email, role in [
            ("Citizen Tester", "citizen@roadguard-example.com", Role.citizen.value),
            ("Reviewer Tester", "reviewer@roadguard-example.com", Role.reviewer.value),
            ("Admin Tester", "admin@roadguard-example.com", Role.admin.value),
        ]:
            user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
            if user is None:
                user = User(name=name, email=email, role=role, password_hash=hash_password("TestPass123"))
                db.add(user)
            created[role] = {"email": email, "password": "TestPass123"}
        db.commit()

    tokens = {}
    for role, creds in created.items():
        response = client.post(
            "/api/v1/auth/login",
            json={"email": creds["email"], "password": creds["password"]},
        )
        assert response.status_code == 200, response.text
        tokens[role] = {"Authorization": f"Bearer {response.json()['access_token']}", **creds}
    return tokens


@pytest.fixture(scope="session", autouse=True)
def baseline_reports(users):
    """A controlled, known dataset so analytics/export tests are deterministic.

    Written straight to the database (no inference) so the numbers are exact and
    independent of the model.
    """
    from datetime import datetime, timedelta, timezone

    from app.database.session import SessionLocal
    from app.models.entities import DamageReport, RepairUpdate, ReportStatus
    from app.services.priority import recompute_all
    from sqlalchemy import func, select

    with SessionLocal() as db:
        existing = db.execute(select(func.count(DamageReport.id))).scalar_one()
        if existing:
            return existing

        now = datetime.now(timezone.utc)
        plan = [
            (ReportStatus.submitted.value, "pothole", "high", 1, 0.42),
            (ReportStatus.submitted.value, "transverse_crack", None, 3, 0.31),
            (ReportStatus.under_review.value, "pothole", "medium", 5, 0.55),
            (ReportStatus.verified.value, "alligator_crack", "high", 9, 0.62),
            (ReportStatus.verified.value, "pothole", "critical", 14, 0.71),
            (ReportStatus.assigned_for_repair.value, "longitudinal_crack", "low", 21, 0.48),
            (ReportStatus.in_progress.value, "broken_surface", "high", 30, 0.66),
            (ReportStatus.resolved.value, "pothole", "medium", 40, 0.58),
            (ReportStatus.resolved.value, "transverse_crack", "high", 55, 0.44),
            (ReportStatus.rejected.value, "other", None, 8, 0.29),
        ]
        for index, (status, category, severity, days_ago, confidence) in enumerate(plan):
            reported_at = now - timedelta(days=days_ago)
            report = DamageReport(
                reference=f"RG-TEST-{index + 1:04d}",
                description=f"baseline fixture {index + 1}",
                damage_category=category,
                detection_confidence=confidence,
                reviewed_severity=severity,
                latitude=23.02 + index * 0.004,
                longitude=72.55 + index * 0.004,
                location_source="manual",
                road_name="Fixture Road",
                ward="Navrangpura" if index % 2 == 0 else "Satellite",
                status=status,
                is_verified=status
                in {
                    ReportStatus.verified.value,
                    ReportStatus.assigned_for_repair.value,
                    ReportStatus.in_progress.value,
                    ReportStatus.resolved.value,
                },
                reporter_label="Fixture",
                reported_at=reported_at,
            )
            if status == ReportStatus.resolved.value:
                report.resolved_at = reported_at + timedelta(days=6)
                db.add(report)
                db.flush()
                db.add(
                    RepairUpdate(
                        report_id=report.id,
                        previous_status=ReportStatus.in_progress.value,
                        new_status=ReportStatus.resolved.value,
                        notes="fixture resolution",
                        actor_label="Fixture Reviewer",
                        created_at=report.resolved_at,
                    )
                )
            else:
                db.add(report)
        db.commit()
        recompute_all(db)
        return len(plan)


@pytest.fixture(scope="session")
def sample_image():
    images = sorted(SAMPLES.glob("*.jpg"))
    if not images:
        pytest.skip("no sample images available in data/samples")
    return images[0]


@pytest.fixture(scope="session")
def model_ready() -> bool:
    if not MODEL_PATH.exists():
        pytest.skip("model weights not installed (data/models/pothole_yolov8.pt)")
    # Trigger the lazy load once for the whole session.
    from app.detection.detector import get_detector

    detector = get_detector()
    if not detector.available:
        pytest.skip(f"detector unavailable: {detector.info().get('error')}")
    return True


def make_image_bytes(width: int = 640, height: int = 480, fmt: str = "PNG") -> bytes:
    from io import BytesIO

    from PIL import Image

    image = Image.new("RGB", (width, height), (110, 110, 115))
    buffer = BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


@pytest.fixture(scope="session")
def created_report(client, users, model_ready, sample_image):
    """A real report created from a real detection run (used by several tests)."""
    with open(sample_image, "rb") as handle:
        response = client.post(
            "/api/v1/detection/analyze",
            files={"file": (sample_image.name, handle, "image/jpeg")},
        )
    assert response.status_code == 200, response.text
    analysis = response.json()

    created = client.post(
        "/api/v1/reports",
        json={
            "analysis_id": analysis["analysis_id"],
            "description": "Fixture report",
            "latitude": 23.0225,
            "longitude": 72.5714,
            "location_source": "manual",
            "road_name": "Ashram Road",
            "ward": "Navrangpura",
            "reviewed_severity": "high",
            "road_importance": "arterial",
        },
    )
    assert created.status_code == 201, created.text
    return created.json()
