"""Upload validation and detection endpoint behaviour."""
from __future__ import annotations

from pathlib import Path

import pytest

from tests.conftest import make_image_bytes


def _upload(client, name: str, content: bytes, mime: str = "image/jpeg"):
    return client.post("/api/v1/detection/analyze", files={"file": (name, content, mime)})


def test_valid_png_upload_runs_real_inference(client, model_ready):
    payload = make_image_bytes(640, 480, "PNG")
    response = _upload(client, "road.png", payload, "image/png")
    assert response.status_code == 200, response.text
    body = response.json()

    # Schema contract
    for key in (
        "analysis_id",
        "status",
        "detections",
        "detections_count",
        "image",
        "annotated_url",
        "model_version",
        "conf_threshold",
        "iou_threshold",
        "latency_ms",
        "class_labels",
    ):
        assert key in body
    assert body["status"] in {"ok", "no_detections"}
    assert body["detections_count"] == len(body["detections"])
    assert body["latency_ms"] > 0
    assert body["model_version"]
    assert isinstance(body["class_labels"], dict) and body["class_labels"]
    assert body["image"]["width"] == 640 and body["image"]["height"] == 480
    for det in body["detections"]:
        assert 0.0 <= det["confidence"] <= 1.0
        bbox = det["bbox"]
        assert bbox["x1"] < bbox["x2"] and bbox["y1"] < bbox["y2"]
        assert det["class_label"] in body["class_labels"].values()
    # Never fabricated: a blank grey canvas has no road damage.
    assert body["detections_count"] == 0


def test_detections_are_not_fabricated_for_flat_image(client, model_ready):
    response = _upload(client, "flat.jpg", make_image_bytes(320, 320, "JPEG"))
    assert response.status_code == 200
    assert response.json()["detections"] == []
    assert response.json()["status"] == "no_detections"


def test_real_road_sample_produces_annotated_image_when_detected(client, model_ready, sample_image):
    with open(sample_image, "rb") as handle:
        data = handle.read()
    response = _upload(client, sample_image.name, data)
    assert response.status_code == 200
    body = response.json()
    if body["detections_count"]:
        assert body["annotated_url"]
        annotated = client.get(body["annotated_url"])
        assert annotated.status_code == 200
        assert annotated.headers["content-type"] == "image/jpeg"
        assert len(annotated.content) > 1000
    original = client.get(body["original_url"])
    assert original.status_code == 200


def test_rejects_unsupported_extension(client):
    response = _upload(client, "notes.txt", b"hello world")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_EXTENSION"


def test_rejects_binary_garbage_with_image_extension(client):
    response = _upload(client, "broken.jpg", b"\x00\x01\x02 not an image")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "CORRUPT_IMAGE"


def test_rejects_extension_content_mismatch(client):
    png_bytes = make_image_bytes(128, 128, "PNG")
    response = _upload(client, "actually_png.jpg", png_bytes)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "EXTENSION_MISMATCH"


def test_rejects_truncated_jpeg(client):
    jpeg = make_image_bytes(400, 400, "JPEG")
    response = _upload(client, "truncated.jpg", jpeg[: len(jpeg) // 3])
    assert response.status_code == 422
    assert response.json()["error"]["code"] in {"CORRUPT_IMAGE"}


def test_rejects_tiny_image(client):
    response = _upload(client, "tiny.png", make_image_bytes(16, 16, "PNG"), "image/png")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "IMAGE_TOO_SMALL"


def test_rejects_oversized_upload(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "max_upload_mb", 0.001)
    response = _upload(client, "big.png", make_image_bytes(500, 500, "PNG"), "image/png")
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_rejects_wrong_declared_mime(client):
    response = _upload(client, "road.jpg", make_image_bytes(128, 128, "JPEG"), "application/pdf")
    assert response.status_code == 415


def test_missing_model_weights_return_actionable_503(client, monkeypatch):
    """A missing weight file must not silently degrade into fake predictions."""
    from app.detection import detector as detector_module

    broken = detector_module.Detector(model_path=Path("/nonexistent/weights.pt"))
    broken.load()
    assert broken.available is False
    assert "not found" in (broken.info()["error"] or "").lower()

    monkeypatch.setattr(detector_module, "_detector", broken)
    response = _upload(client, "road.png", make_image_bytes(320, 240, "PNG"), "image/png")
    assert response.status_code == 503
    body = response.json()["error"]
    assert body["code"] == "MODEL_UNAVAILABLE"
    assert body["hints"], "503 must include setup instructions"


def test_detector_predict_raises_when_unavailable():
    import numpy as np
    from app.core.errors import ModelUnavailableError
    from app.detection.detector import Detector

    detector = Detector(model_path=Path("/nonexistent/weights.pt"))
    with pytest.raises(ModelUnavailableError):
        detector.predict(np.zeros((32, 32, 3), dtype=np.uint8))


def test_analysis_endpoints_expire_gracefully(client):
    response = client.get("/api/v1/detection/analysis/doesnotexist/original")
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "ANALYSIS_EXPIRED"


def test_report_creation_with_expired_analysis_rejected(client):
    response = client.post(
        "/api/v1/reports",
        json={
            "analysis_id": "deadbeef" * 4,
            "latitude": 23.0,
            "longitude": 72.5,
        },
    )
    assert response.status_code == 410


def test_exif_metadata_is_reported_honestly(client):
    """A plain image without EXIF GPS must report exif_gps_present=False."""
    payload = make_image_bytes(200, 200, "JPEG")
    response = _upload(client, "plain.jpg", payload)
    assert response.status_code == 200
    assert response.json()["image"]["exif_gps_present"] is False
