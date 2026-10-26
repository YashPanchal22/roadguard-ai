"""KPI maths, empty states, exports, persistence and settings endpoints."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import pytest


def test_kpis_reflect_database_rows(client, db_session):
    from app.models.entities import DamageReport
    from sqlalchemy import func, select

    overview = client.get("/api/v1/analytics/overview")
    assert overview.status_code == 200
    body = overview.json()
    cards = {card["key"]: card["value"] for card in body["kpis"]}

    db_total = db_session.execute(select(func.count(DamageReport.id))).scalar_one()
    assert cards["total_reports"] == db_total
    assert body["record_count"] == db_total
    assert cards["verified_reports"] <= db_total
    assert cards["resolved_reports"] <= db_total
    assert cards["unresolved_reports"] <= db_total


def test_kpi_values_are_mathematically_consistent(client, db_session):
    from app.models.entities import DamageReport, ReportStatus
    from sqlalchemy import select

    rows = db_session.execute(select(DamageReport)).scalars().all()
    cards = {c["key"]: c["value"] for c in client.get("/api/v1/analytics/overview").json()["kpis"]}

    assert cards["verified_reports"] == sum(1 for r in rows if r.is_verified)
    assert cards["resolved_reports"] == sum(1 for r in rows if r.status == ReportStatus.resolved.value)
    assert cards["under_repair"] == sum(
        1
        for r in rows
        if r.status in {ReportStatus.assigned_for_repair.value, ReportStatus.in_progress.value}
    )

    resolved = [r for r in rows if r.resolved_at and r.reported_at]
    if resolved:
        expected = round(
            sum((r.resolved_at - r.reported_at).total_seconds() / 86400 for r in resolved) / len(resolved), 2
        )
        assert cards["avg_resolution_days"] == pytest.approx(expected, abs=0.05)


def test_empty_dataset_returns_zeroes_not_fake_statistics(client):
    """Filter to an impossible window: KPIs must be zero, charts must be empty."""
    future = quote((datetime.now(timezone.utc) + timedelta(days=3650)).isoformat(), safe="")
    overview = client.get(f"/api/v1/analytics/overview?date_from={future}").json()
    assert all(card["value"] == 0 for card in overview["kpis"]), overview["kpis"]
    assert overview["record_count"] == 0

    charts = client.get(f"/api/v1/analytics/charts?date_from={future}").json()
    assert charts["record_count"] == 0
    for bundle in charts["charts"]:
        assert all(point["value"] == 0 for point in bundle["series"][0]["data"])


def test_charts_have_expected_shapes(client):
    body = client.get("/api/v1/analytics/charts").json()
    names = {bundle["name"] for bundle in body["charts"]}
    assert {
        "Reports by date",
        "Damage categories",
        "Reports by status",
        "Severity distribution",
        "Outstanding repairs by age",
        "Resolution trend",
        "Damage by region",
    }.issubset(names)
    for bundle in body["charts"]:
        assert bundle["series"] and bundle["series"][0]["data"]


def test_priority_queue_is_sorted_and_explained(client):
    body = client.get("/api/v1/analytics/priority-queue?limit=5").json()
    scores = [item["priority_score"] for item in body["items"]]
    assert scores == sorted(scores, reverse=True)
    for item in body["items"]:
        assert sum(f["contribution"] for f in item["factors"]) == pytest.approx(item["priority_score"], abs=0.3)
    assert body["weights"]


def test_priority_settings_require_admin_and_take_effect(client, users):
    forbidden = client.put("/api/v1/settings/priority", json={"age_full_days": 45}, headers=users["reviewer"])
    assert forbidden.status_code == 403

    current = client.get("/api/v1/settings/priority").json()
    original = current["age_full_days"]
    updated = client.put(
        "/api/v1/settings/priority",
        json={"age_full_days": original + 5},
        headers=users["admin"],
    )
    assert updated.status_code == 200
    assert updated.json()["age_full_days"] == original + 5
    # restore
    client.put("/api/v1/settings/priority", json={"age_full_days": original}, headers=users["admin"])


def test_priority_weights_validation(client, users):
    response = client.put(
        "/api/v1/settings/priority",
        json={"weights": {"severity": 1.5}},
        headers=users["admin"],
    )
    assert response.status_code == 422


def test_csv_export_matches_database(client):
    response = client.get("/api/v1/exports/reports.csv")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    text = response.content.decode()
    assert "generated_at=" in text.splitlines()[0]
    reader = csv.DictReader(io.StringIO("\n".join(text.splitlines()[1:])))
    rows = list(reader)
    total = client.get("/api/v1/reports?page_size=1").json()["meta"]["total"]
    assert len(rows) == total
    for row in rows[:5]:
        assert row["reference"].startswith("RG-")
        assert row["status"]


def test_json_export_is_valid_and_integration_ready(client):
    response = client.get("/api/v1/exports/reports.json")
    assert response.status_code == 200
    payload = json.loads(response.content)
    assert payload["record_count"] == len(payload["reports"])
    assert payload["generated_at"]
    assert "is_synthetic" in payload["reports"][0]


def test_pdf_export_is_a_real_pdf(client):
    response = client.get("/api/v1/exports/summary.pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert len(response.content) > 3000


def test_filters_carry_into_exports(client):
    filtered = client.get("/api/v1/reports?status=resolved&page_size=1").json()["meta"]["total"]
    exported = client.get("/api/v1/exports/reports.json?status=resolved").json()
    assert exported["record_count"] == filtered


def test_persistence_across_new_session(client, db_session):
    """Re-open a fresh session + engine against the same file: data must survive."""
    from app.core.config import settings
    from app.models.entities import DamageReport
    from sqlalchemy import create_engine, func, select
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    with Session() as fresh:
        total = fresh.execute(select(func.count(DamageReport.id))).scalar_one()
    engine.dispose()
    assert total == db_session.execute(select(func.count(DamageReport.id))).scalar_one()
    assert total > 0


def test_health_reports_detector_state(client):
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok"
    assert body["database"]["ok"] is True
    assert "detector" in body and "reports" in body


def test_model_info_and_evaluation_empty_state(client):
    info = client.get("/api/v1/model/info").json()
    assert info["class_count"] >= 1
    assert "pothole" in " ".join(info["class_labels"].values()).lower()
    assert info["conf_threshold"] > 0

    evaluation = client.get("/api/v1/model/evaluation")
    assert evaluation.status_code == 200
    body = evaluation.json()
    if not body["available"]:
        assert body["message"] == "Evaluation not yet available"
        assert body["instructions"], "must tell the user how to produce metrics"
        assert body["evaluation"] is None


def test_meta_options_expose_lifecycle(client):
    body = client.get("/api/v1/meta/options").json()
    assert len(body["statuses"]) == 7
    assert body["allowed_transitions"]["submitted"] == ["under_review", "rejected"]
    assert body["map_defaults"]["lat"] == pytest.approx(23.0225)
    assert body["demo_region_label"]
