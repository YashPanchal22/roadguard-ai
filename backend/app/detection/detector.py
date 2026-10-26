"""YOLO detector: loaded once per process, honest about failure modes.

Rules enforced here
-------------------
* The model is loaded lazily on first use and cached for the process lifetime
  (``get_detector``), never re-loaded per request.
* If the weight file is missing or the runtime cannot load it, the detector
  reports ``available=False`` with actionable instructions. ``predict`` raises
  ``ModelUnavailableError`` (HTTP 503) instead of returning fake boxes.
* No random, hard-coded or heuristic "predictions" are ever produced.
* A configured checkpoint whose class names are not road-damage related is
  flagged (``class_match_warning``) so a generic COCO model can never be
  presented as a validated pothole detector.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np

from app.core.config import settings
from app.core.errors import ModelUnavailableError

logger = logging.getLogger(__name__)

_SETUP_HINTS = [
    "Download or train a YOLO weight file and place it at data/models/pothole_yolov8.pt.",
    "Or point ROADGUARD_MODEL_PATH at an existing .pt file (absolute path allowed).",
    "See docs/MODEL_GUIDE.md for how to obtain a licensed road-damage dataset, train, and evaluate a model.",
    "Expected class labels for the bundled config: Longitudinal Crack, Transverse Crack, Alligator Crack, Pothole, Other.",
]

# Maps the model's trained labels to the application's canonical categories.
# Anything not listed stays 'other' - we never claim an untrained class.
LABEL_TO_CATEGORY: dict[str, str] = {
    "pothole": "pothole",
    "longitudinal crack": "longitudinal_crack",
    "transverse crack": "transverse_crack",
    "alligator crack": "alligator_crack",
    "broken road surface": "broken_surface",
    "broken surface": "broken_surface",
    "other": "other",
}


def label_to_category(label: str) -> str:
    return LABEL_TO_CATEGORY.get(label.strip().lower(), "other")


@dataclass
class DetectionOut:
    class_id: int
    class_label: str
    confidence: float
    bbox: tuple[float, float, float, float]
    category: str
    area_ratio: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "class_id": self.class_id,
            "class_label": self.class_label,
            "confidence": round(self.confidence, 4),
            "bbox": {
                "x1": round(self.bbox[0], 2),
                "y1": round(self.bbox[1], 2),
                "x2": round(self.bbox[2], 2),
                "y2": round(self.bbox[3], 2),
            },
            "category": self.category,
            "area_ratio": round(self.area_ratio, 5),
        }


@dataclass
class InferenceResult:
    detections: list[DetectionOut]
    annotated_bgr: np.ndarray | None
    latency_ms: float
    model_version: str
    model_name: str
    image_width: int
    image_height: int
    class_labels: dict[int, str] = field(default_factory=dict)

    @property
    def top_confidence(self) -> float | None:
        return max((d.confidence for d in self.detections), default=None)

    def dominant_category(self) -> str:
        if not self.detections:
            return "unknown"
        return max(self.detections, key=lambda d: d.confidence).category


PALETTE = {
    "pothole": (38, 76, 240),
    "longitudinal_crack": (241, 132, 15),
    "transverse_crack": (60, 200, 245),
    "alligator_crack": (170, 60, 240),
    "broken_surface": (70, 70, 220),
    "other": (180, 180, 180),
}


class Detector:
    """Wraps an Ultralytics YOLO model."""

    def __init__(self, model_path: Path | None = None) -> None:
        self.model_path = Path(model_path or settings.model_path)
        self._model = None
        self._load_error: str | None = None
        self._load_attempted = False
        self._lock = Lock()
        self.load_time_ms: float | None = None
        self.class_labels: dict[int, str] = {}

    # -- lifecycle ----------------------------------------------------------
    def load(self) -> None:
        """Load the model exactly once. Safe to call repeatedly."""
        with self._lock:
            if self._load_attempted:
                return
            self._load_attempted = True
            started = time.perf_counter()
            if not self.model_path.exists():
                self._load_error = f"Model weights not found at {self.model_path}"
                logger.warning("detector unavailable: %s", self._load_error)
                return
            try:
                from ultralytics import YOLO  # imported lazily: heavy dependency

                model = YOLO(str(self.model_path))
                names = model.names
                if isinstance(names, dict):
                    self.class_labels = {int(k): str(v) for k, v in names.items()}
                else:  # pragma: no cover - list form
                    self.class_labels = {i: str(v) for i, v in enumerate(names)}
                self._model = model
                self.load_time_ms = round((time.perf_counter() - started) * 1000, 1)
                logger.info(
                    "detector loaded %s (%s) classes=%s in %.1f ms",
                    self.model_path.name,
                    settings.model_version,
                    list(self.class_labels.values()),
                    self.load_time_ms,
                )
            except Exception as exc:  # pragma: no cover - depends on environment
                self._model = None
                self._load_error = f"Failed to load YOLO weights: {type(exc).__name__}: {exc}"
                logger.exception("detector load failure")

    @property
    def available(self) -> bool:
        self.load()
        return self._model is not None

    @property
    def class_match_warning(self) -> str | None:
        if not self.class_labels:
            return "Model class labels could not be read."
        keywords = [k.lower() for k in settings.road_damage_class_keywords]
        labels = [v.lower() for v in self.class_labels.values()]
        if not any(k in label for label in labels for k in keywords):
            return (
                "Configured weights do not expose road-damage class names "
                f"({', '.join(sorted(set(self.class_labels.values())))}). "
                "Predictions must not be presented as pothole detection until validated."
            )
        return None

    def info(self) -> dict[str, Any]:
        self.load()
        return {
            "available": self._model is not None,
            "model_name": settings.model_name,
            "model_version": settings.model_version,
            "model_path": str(self.model_path.name),  # never expose the filesystem path
            "weights_present": self.model_path.exists(),
            "weights_size_mb": round(self.model_path.stat().st_size / 1024 / 1024, 1)
            if self.model_path.exists()
            else None,
            "class_labels": self.class_labels,
            "class_count": len(self.class_labels),
            "conf_threshold": settings.conf_threshold,
            "iou_threshold": settings.iou_threshold,
            "max_detections": settings.max_detections,
            "device": settings.device,
            "load_time_ms": self.load_time_ms,
            "error": self._load_error,
            "class_match_warning": self.class_match_warning if self._model else None,
            "hints": _SETUP_HINTS if self._model is None else [],
        }

    def reload(self, model_path: Path | None = None) -> dict[str, Any]:
        with self._lock:
            self._load_attempted = False
            self._model = None
            self._load_error = None
            if model_path:
                self.model_path = Path(model_path)
        self.load()
        return self.info()

    # -- inference ----------------------------------------------------------
    def predict(
        self,
        image_bgr: np.ndarray,
        *,
        conf: float | None = None,
        iou: float | None = None,
        annotate: bool = True,
    ) -> InferenceResult:
        if not self.available:
            raise ModelUnavailableError(
                self._load_error or "Detection model is not available.",
                hints=_SETUP_HINTS,
                details={"model_path_hint": "data/models/pothole_yolov8.pt"},
            )

        conf = settings.conf_threshold if conf is None else float(conf)
        iou = settings.iou_threshold if iou is None else float(iou)
        height, width = image_bgr.shape[:2]

        started = time.perf_counter()
        try:
            results = self._model.predict(  # type: ignore[union-attr]
                source=image_bgr,
                conf=conf,
                iou=iou,
                max_det=settings.max_detections,
                device=settings.device,
                verbose=False,
            )
        except Exception as exc:
            raise ModelUnavailableError(
                f"Inference failed: {type(exc).__name__}: {exc}",
                hints=["Check that the weight file matches the installed ultralytics version."],
            ) from exc
        latency_ms = round((time.perf_counter() - started) * 1000, 2)

        detections: list[DetectionOut] = []
        result = results[0] if results else None
        if result is not None and result.boxes is not None and len(result.boxes) > 0:
            boxes = result.boxes
            xyxy = boxes.xyxy.cpu().numpy()
            confs = boxes.conf.cpu().numpy()
            classes = boxes.cls.cpu().numpy().astype(int)
            for (x1, y1, x2, y2), c, cls_id in zip(xyxy, confs, classes, strict=False):
                label = self.class_labels.get(int(cls_id), f"class_{cls_id}")
                area = max(0.0, (x2 - x1)) * max(0.0, (y2 - y1))
                detections.append(
                    DetectionOut(
                        class_id=int(cls_id),
                        class_label=label,
                        confidence=float(c),
                        bbox=(float(x1), float(y1), float(x2), float(y2)),
                        category=label_to_category(label),
                        area_ratio=float(area) / float(width * height) if width and height else 0.0,
                    )
                )
        detections.sort(key=lambda d: d.confidence, reverse=True)

        annotated = None
        if annotate:
            annotated = _draw_annotations(image_bgr, detections)

        return InferenceResult(
            detections=detections,
            annotated_bgr=annotated,
            latency_ms=latency_ms,
            model_version=settings.model_version,
            model_name=settings.model_name,
            image_width=width,
            image_height=height,
            class_labels=self.class_labels,
        )


def _draw_annotations(image_bgr: np.ndarray, detections: list[DetectionOut]) -> np.ndarray:
    import cv2

    canvas = image_bgr.copy()
    thickness = max(2, round(min(canvas.shape[:2]) / 320))
    font_scale = max(0.45, min(canvas.shape[:2]) / 1100)
    for det in detections:
        x1, y1, x2, y2 = (int(v) for v in det.bbox)
        colour = PALETTE.get(det.category, PALETTE["other"])
        cv2.rectangle(canvas, (x1, y1), (x2, y2), colour, thickness)
        text = f"{det.class_label} {det.confidence * 100:.0f}%"
        (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        label_top = max(0, y1 - th - baseline - 6)
        cv2.rectangle(canvas, (x1, label_top), (x1 + tw + 10, label_top + th + baseline + 6), colour, -1)
        cv2.putText(
            canvas,
            text,
            (x1 + 5, label_top + th + 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (255, 255, 255),
            max(1, thickness - 1),
            cv2.LINE_AA,
        )
    return canvas


_detector: Detector | None = None
_detector_lock = Lock()


def get_detector() -> Detector:
    """Process-wide singleton (loaded once at startup, reused per request)."""
    global _detector
    if _detector is None:
        with _detector_lock:
            if _detector is None:
                _detector = Detector()
                _detector.load()
    return _detector
