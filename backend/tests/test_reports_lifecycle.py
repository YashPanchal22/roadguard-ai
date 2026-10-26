"""Report persistence, lifecycle, permissions, filtering and duplicates."""
from __future__ import annotations

import pytest


def test_report_creation_persists_and_returns_reference(created_report):
    assert created_report["reference"].startswith("RG-")
    assert created_report["status"] == "submitted"
    assert created_report["latitude"] == pytest.approx(23.0225)
    assert created_report["is_synthetic"] is False
    assert created_report["images"], "report should carry the analysed image"
    assert created_report["images"][0]["annotated_url"]


def test_report_retrievable_by_id_and_reference(client, created_report):
    by_id = client.get(f"/api/v1/reports/{created_report['id']}")
    by_ref = client.get(f"/api/v1/reports/{created_report['reference']}")
    assert by_id.status_code == 200 and by_ref.status_code == 200
    assert by_id.json()["id"] == by_ref.json()["id"] == created_report["id"]


def test_unknown_report_returns_404(client):
    response = client.get("/api/v1/reports/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "REPORT_NOT_FOUND"


@pytest.mark.parametrize(
    "payload",
    [
        {"latitude": 0, "longitude": 0},
        {"latitude": 91, "longitude": 72},
        {"latitude": 23, "longitude": 181},
        {"latitude": 23},
    ],
)
def test_coordinate_validation(client, payload):
    response = client.post("/api/v1/reports", json=payload)
    assert response.status_code == 422


def test_requires_authentication_for_status_change(client, created_report):
    response = client.post(f"/api/v1/reports/{created_report['id']}/status", json={"new_status": "under_review"})
    assert response.status_code == 401


def test_citizen_cannot_change_status(client, created_report, users):
    response = client.post(
        f"/api/v1/reports/{created_report['id']}/status",
        json={"new_status": "under_review"},
        headers=users["citizen"],
    )
    assert response.status_code == 403


def test_citizen_cannot_edit_review_fields(client, created_report, users):
    response = client.patch(
        f"/api/v1/reports/{created_report['id']}",
        json={"reviewed_severity": "critical"},
        headers=users["citizen"],
    )
    assert response.status_code == 403


def test_full_lifecycle_records_history(client, users, model_ready, sample_image):
    with open(sample_image, "rb") as handle:
        analysis = client.post(
            "/api/v1/detection/analyze", files={"file": (sample_image.name, handle, "image/jpeg")}
        ).json()
    created = client.post(
        "/api/v1/reports",
        json={
            "analysis_id": analysis["analysis_id"],
            "latitude": 22.99,
            "longitude": 72.60,
            "road_name": "Lifecycle Road",
        },
    ).json()
    report_id = created["id"]

    chain = ["under_review", "verified", "assigned_for_repair", "in_progress", "resolved"]
    for index, status in enumerate(chain):
        response = client.post(
            f"/api/v1/reports/{report_id}/status",
            json={"new_status": status, "notes": f"step {index}: {status}"},
            headers=users["reviewer"],
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == status

    final = client.get(f"/api/v1/reports/{report_id}").json()
    assert final["status"] == "resolved"
    assert final["is_verified"] is True
    assert final["resolved_at"] is not None
    assert len(final["repair_updates"]) == len(chain)
    assert [u["new_status"] for u in final["repair_updates"]] == chain
    assert final["repair_updates"][0]["previous_status"] == "submitted"
    assert any(log["action"] == "report.resolved" for log in final["audit_trail"])


def test_invalid_transition_is_rejected(client, users, created_report):
    response = client.post(
        f"/api/v1/reports/{created_report['id']}/status",
        json={"new_status": "resolved"},
        headers=users["reviewer"],
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_TRANSITION"


def test_same_status_is_conflict(client, users, created_report):
    response = client.post(
        f"/api/v1/reports/{created_report['id']}/status",
        json={"new_status": "submitted"},
        headers=users["reviewer"],
    )
    assert response.status_code == 409


def test_rejection_requires_notes(client, users, created_report):
    client.post(
        f"/api/v1/reports/{created_report['id']}/status",
        json={"new_status": "under_review", "notes": "triage"},
        headers=users["reviewer"],
    )
    response = client.post(
        f"/api/v1/reports/{created_report['id']}/status",
        json={"new_status": "rejected"},
        headers=users["reviewer"],
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "NOTES_REQUIRED"


def test_reviewer_can_edit_and_audit_trail_is_written(client, users, created_report):
    response = client.patch(
        f"/api/v1/reports/{created_report['id']}",
        json={"reviewed_severity": "critical", "road_name": "Corrected Road Name"},
        headers=users["reviewer"],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["reviewed_severity"] == "critical"
    assert body["road_name"] == "Corrected Road Name"
    assert any(log["action"] == "report.updated" for log in body["audit_trail"])


def test_reviewer_can_correct_location(client, users, created_report):
    response = client.patch(
        f"/api/v1/reports/{created_report['id']}",
        json={"latitude": 23.05, "longitude": 72.6},
        headers=users["reviewer"],
    )
    assert response.status_code == 200
    assert response.json()["latitude"] == pytest.approx(23.05)
    assert response.json()["location_source"] == "manual"


def test_only_admin_can_delete(client, users, created_report):
    forbidden = client.delete(f"/api/v1/reports/{created_report['id']}", headers=users["reviewer"])
    assert forbidden.status_code == 403


def test_priority_breakdown_is_explainable(client, created_report):
    response = client.get(f"/api/v1/reports/{created_report['id']}/priority")
    assert response.status_code == 200
    body = response.json()
    assert 0 <= body["score"] <= 100
    assert len(body["factors"]) == 6
    assert sum(f["contribution"] for f in body["factors"]) == pytest.approx(body["score"], abs=0.2)
    keys = {f["key"] for f in body["factors"]}
    assert {"severity", "category", "road_importance", "damage_size", "report_age", "repeat_reports"} == keys


def test_filtering_sorting_and_pagination(client, users, created_report):
    page_one = client.get("/api/v1/reports?page=1&page_size=2&sort=reported_at&order=desc")
    assert page_one.status_code == 200
    body = page_one.json()
    assert body["meta"]["page_size"] == 2
    assert len(body["items"]) <= 2
    assert body["meta"]["total"] >= 1

    referenced = client.get(f"/api/v1/reports?q={created_report['reference']}")
    assert referenced.status_code == 200
    assert any(item["reference"] == created_report["reference"] for item in referenced.json()["items"])

    filtered = client.get("/api/v1/reports?status=submitted&category=alligator_crack")
    assert filtered.status_code == 200
    for item in filtered.json()["items"]:
        assert item["status"] == "submitted"
        assert item["damage_category"] == "alligator_crack"

    bad_sort = client.get("/api/v1/reports?sort=drop_table")
    assert bad_sort.status_code == 422


def test_map_bounds_retrieval(client, created_report):
    response = client.get("/api/v1/map/reports?south=22.9&west=72.4&north=23.2&east=72.8")
    assert response.status_code == 200
    assert any(item["id"] == created_report["id"] for item in response.json())
    for item in response.json():
        assert item["latitude"] is not None and item["longitude"] is not None

    outside = client.get("/api/v1/map/reports?south=10&west=10&north=11&east=11")
    assert outside.status_code == 200
    assert all(item["id"] != created_report["id"] for item in outside.json())

    inverted = client.get("/api/v1/map/reports?south=30&west=72&north=20&east=73")
    assert inverted.status_code == 422


def test_duplicate_suggestions_and_link(client, users, model_ready, sample_image):
    geometry = {"latitude": 23.0301, "longitude": 72.5801, "road_name": "Dup Road", "damage_category": "pothole"}
    first = client.post("/api/v1/reports", json=geometry).json()
    second = client.post(
        "/api/v1/reports",
        json={**geometry, "latitude": 23.0303, "longitude": 72.5803, "description": "same pothole again"},
    ).json()

    suggestions = client.get(f"/api/v1/reports/{first['id']}/duplicates")
    assert suggestions.status_code == 200
    candidates = suggestions.json()["candidates"]
    assert any(candidate["report"]["id"] == second["id"] for candidate in candidates)
    assert candidates[0]["distance_m"] is not None

    link = client.post(
        f"/api/v1/reports/{first['id']}/duplicates/link",
        json={"duplicate_report_id": second["id"], "reason": "Same location, same day"},
        headers=users["reviewer"],
    )
    assert link.status_code == 201

    # Nothing was deleted or merged away; both records survive.
    assert client.get(f"/api/v1/reports/{first['id']}").status_code == 200
    dup = client.get(f"/api/v1/reports/{second['id']}").json()
    assert dup["duplicate_of_id"] == first["id"]
    assert any(log["action"] == "report.duplicate_linked" for log in dup["audit_trail"])


def test_duplicate_link_requires_reviewer(client, created_report):
    response = client.post(
        f"/api/v1/reports/{created_report['id']}/duplicates/link",
        json={"duplicate_report_id": created_report["id"]},
    )
    assert response.status_code == 401


def test_media_serving_is_path_traversal_safe(client, created_report):
    image_id = created_report["images"][0]["id"]
    ok = client.get(f"/api/v1/media/reports/{image_id}/original")
    assert ok.status_code == 200
    traversal = client.get("/api/v1/media/reports/..%2f..%2f..%2fetc%2fpasswd/original")
    assert traversal.status_code in {404, 400}


def test_unknown_api_path_returns_json_not_spa_shell(client):
    """Regression: the built SPA fallback must never answer API requests."""
    response = client.get("/api/v1/definitely-not-a-route")
    assert response.status_code == 404
    assert "application/json" in response.headers["content-type"]
    traversal = client.get("/api/v1/media/reports/../../etc/passwd/original")
    assert traversal.status_code in {400, 404}
