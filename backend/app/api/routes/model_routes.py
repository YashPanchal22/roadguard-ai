"""Model metadata, live evaluation and runtime configuration endpoints."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import AdminUser, DbSession
from app.core.config import settings
from app.detection.detector import get_detector
from app.models.entities import ModelEvaluation
from app.schemas.schemas import (
    EvaluationOut,
    EvaluationResponse,
    ModelInfoResponse,
    PrioritySettingsOut,
    PrioritySettingsUpdate,
)

router = APIRouter(prefix="/model", tags=["Model"])

TRAINING_CONFIG = {
    "architecture": "YOLOv8s (Ultralytics)",
    "weights": settings.model_path.name,
    "input_size": 640,
    "epochs": "see ml/training/train.py (default 100)",
    "batch": 16,
    "optimizer": "auto (SGD/AdamW)",
    "augmentation": ["mosaic", "random hsv", "horizontal flip", "random scale/translate"],
    "split": "70/20/10 train/val/test by captured route (no frame leakage)",
    "reproducibility": "data/augmentation seeds fixed in ml/training/config.yaml; Ultralytics seed=0",
}

DATASET_NOTE = (
    "The bundled weights are community-trained on road-distress imagery (Apache-2.0) with the classes "
    "Longitudinal Crack, Transverse Crack, Alligator Crack, Pothole, Other. Reported figures on the model "
    "card (mAP50 0.629 / mAP50-95 0.345) come from the publisher's own validation split and are NOT "
    "measured on this installation. Run ml/evaluation/evaluate.py on your own annotated test split to "
    "produce numbers for this deployment."
)


def _labels(info: dict) -> dict[str, str]:
    return {str(k): v for k, v in (info.get("class_labels") or {}).items()}


@router.get("/info", response_model=ModelInfoResponse, summary="Loaded model metadata")
def model_info() -> ModelInfoResponse:
    detector = get_detector()
    info = detector.info()
    return ModelInfoResponse(
        available=info["available"],
        model_name=info["model_name"],
        model_version=info["model_version"],
        model_path=info["model_path"],
        weights_present=info["weights_present"],
        weights_size_mb=info["weights_size_mb"],
        class_labels=_labels(info),
        class_count=info["class_count"],
        conf_threshold=info["conf_threshold"],
        iou_threshold=info["iou_threshold"],
        max_detections=info["max_detections"],
        device=info["device"],
        load_time_ms=info["load_time_ms"],
        error=info.get("error"),
        class_match_warning=info.get("class_match_warning"),
        hints=info.get("hints", []),
        training_config=TRAINING_CONFIG,
        dataset_note=DATASET_NOTE,
    )


@router.get(
    "/evaluation",
    response_model=EvaluationResponse,
    summary="Evaluation metrics (honest empty state when absent)",
)
def evaluation(db: DbSession) -> EvaluationResponse:
    row = db.execute(
        select(ModelEvaluation).order_by(ModelEvaluation.evaluated_at.desc()).limit(1)
    ).scalar_one_or_none()
    if row is None:
        return EvaluationResponse(
            available=False,
            evaluation=None,
            message="Evaluation not yet available",
            instructions=[
                "Annotate a held-out test split in YOLO format (data/dataset/test/images + labels).",
                "Run: python ml/evaluation/evaluate.py --weights data/models/pothole_yolov8.pt --data data/dataset/data.yaml --split test",
                "Import the produced artefact: python ml/evaluation/import_results.py --file ml/evaluation/results/eval.json",
                "Reload this page - metrics will be read from the model_evaluations table.",
            ],
            restrictions=[
                "Metrics are never estimated, extrapolated or fabricated.",
                "Training-set scores are not evidence of generalisation; only a held-out test split counts.",
                "Publisher metrics on the public model card are not reproduced here as if locally measured.",
            ],
        )
    return EvaluationResponse(
        available=True,
        evaluation=EvaluationOut.model_validate(row),
        message="Metrics imported from a real evaluation run stored in the database.",
        restrictions=[
            "Evaluate on the held-out test split only; never tune on test data.",
            "Small test sets yield wide confidence intervals - report the sample size.",
        ],
    )


@router.post("/reload", response_model=ModelInfoResponse, summary="Reload weights from disk (admin)")
def reload_model(user: AdminUser) -> ModelInfoResponse:
    detector = get_detector()
    info = detector.reload()
    return ModelInfoResponse(
        available=info["available"],
        model_name=info["model_name"],
        model_version=info["model_version"],
        model_path=info["model_path"],
        weights_present=info["weights_present"],
        weights_size_mb=info["weights_size_mb"],
        class_labels=_labels(info),
        class_count=info["class_count"],
        conf_threshold=info["conf_threshold"],
        iou_threshold=info["iou_threshold"],
        max_detections=info["max_detections"],
        device=info["device"],
        load_time_ms=info["load_time_ms"],
        error=info.get("error"),
        class_match_warning=info.get("class_match_warning"),
        hints=info.get("hints", []),
        training_config=TRAINING_CONFIG,
        dataset_note=DATASET_NOTE,
    )


settings_router = APIRouter(prefix="/settings", tags=["Settings"])

_RUNTIME_OVERRIDES: dict[str, float | int | dict[str, float]] = {
    "age_full_days": settings.priority_age_full_days,
    "repeat_radius_m": settings.priority_repeat_radius_m,
    "repeat_window_days": settings.priority_repeat_window_days,
    "weights": dict(settings.priority_weights),
}


def runtime_priority_settings() -> PrioritySettingsOut:
    weights = _RUNTIME_OVERRIDES["weights"]
    return PrioritySettingsOut(
        weights=dict(weights) if isinstance(weights, dict) else dict(settings.priority_weights),
        age_full_days=int(_RUNTIME_OVERRIDES["age_full_days"]),
        repeat_radius_m=float(_RUNTIME_OVERRIDES["repeat_radius_m"]),
        repeat_window_days=int(_RUNTIME_OVERRIDES["repeat_window_days"]),
        duplicate_radius_m=settings.duplicate_radius_m,
        duplicate_window_days=settings.duplicate_window_days,
    )


@settings_router.get("/priority", response_model=PrioritySettingsOut, summary="Current priority configuration")
def get_priority_settings() -> PrioritySettingsOut:
    return runtime_priority_settings()


@settings_router.put(
    "/priority",
    response_model=PrioritySettingsOut,
    summary="Update priority weights and thresholds (admin, runtime only)",
)
def update_priority_settings(payload: PrioritySettingsUpdate, db: DbSession, user: AdminUser) -> PrioritySettingsOut:
    from app.services.priority import recompute_all

    if payload.weights is not None:
        settings.priority_weights = dict(payload.weights)
        _RUNTIME_OVERRIDES["weights"] = dict(payload.weights)
    if payload.age_full_days is not None:
        settings.priority_age_full_days = payload.age_full_days
        _RUNTIME_OVERRIDES["age_full_days"] = payload.age_full_days
    if payload.repeat_radius_m is not None:
        settings.priority_repeat_radius_m = payload.repeat_radius_m
        _RUNTIME_OVERRIDES["repeat_radius_m"] = payload.repeat_radius_m
    if payload.repeat_window_days is not None:
        settings.priority_repeat_window_days = payload.repeat_window_days
        _RUNTIME_OVERRIDES["repeat_window_days"] = payload.repeat_window_days

    recompute_all(db)
    return runtime_priority_settings()
