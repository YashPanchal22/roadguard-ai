"""Image upload + inference endpoints.

Validation (extension/MIME/magic bytes/size/integrity) always runs before the
detector is touched. Missing weights produce HTTP 503 with setup instructions;
no predictions are ever fabricated.
"""
from __future__ import annotations

import logging

import cv2
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, status

from app.api.deps import detection_rate_limit
from app.core.errors import AppError, ModelUnavailableError
from app.detection.detector import get_detector
from app.detection.validation import to_bgr_array, validate_upload
from app.schemas.schemas import AnalyzeResponse, DetectionOutSchema, ImageMeta
from app.services import storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/detection", tags=["Detection"])


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(detection_rate_limit)],
    summary="Run road-damage detection on an uploaded photo",
    responses={
        413: {"description": "File too large"},
        415: {"description": "Unsupported file type"},
        422: {"description": "Corrupt or invalid image"},
        503: {"description": "Detection model unavailable"},
    },
)
async def analyze(
    request: Request,
    file: UploadFile = File(..., description="JPG, JPEG, PNG or WEBP road photo (max size from settings)"),
    conf: float | None = Form(default=None, ge=0.05, le=0.99),
    iou: float | None = Form(default=None, ge=0.1, le=0.95),
    annotate: bool = Form(default=True),
) -> AnalyzeResponse:
    data = await file.read()
    validated = validate_upload(
        filename=file.filename,
        content_type=file.content_type,
        data=data,
    )

    detector = get_detector()
    if not detector.available:
        info = detector.info()
        raise ModelUnavailableError(
            info.get("error") or "The detection model is not loaded.",
            hints=info.get("hints", []),
        )

    image_bgr = to_bgr_array(validated.data)
    result = detector.predict(image_bgr, conf=conf, iou=iou, annotate=annotate)

    annotated_bytes = None
    if annotate and result.annotated_bgr is not None:
        ok, buffer = cv2.imencode(".jpg", result.annotated_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        if not ok:  # pragma: no cover - encoder failure
            raise AppError("ANNOTATION_FAILED", "Could not encode the annotated image.", status_code=500)
        annotated_bytes = buffer.tobytes()

    detection_dicts = [d.as_dict() for d in result.detections]
    warnings: list[str] = []
    if detector.class_match_warning:
        warnings.append(detector.class_match_warning)

    meta = {
        "width": result.image_width,
        "height": result.image_height,
        "file_hash": validated.file_hash,
        "perceptual_hash": validated.perceptual_hash,
        "mime_type": validated.mime_type,
        "size_bytes": len(validated.data),
        "extension": validated.extension,
        "exif_gps_present": validated.exif_gps_present,
        "original_filename": file.filename,
        "detections": detection_dicts,
        "top_confidence": result.top_confidence,
        "suggested_category": result.dominant_category() if result.detections else "unknown",
        "model_version": result.model_version,
        "model_name": result.model_name,
        "conf_threshold": conf if conf is not None else detector.info()["conf_threshold"],
        "iou_threshold": iou if iou is not None else detector.info()["iou_threshold"],
        "latency_ms": result.latency_ms,
        "class_labels": {str(k): v for k, v in result.class_labels.items()},
    }
    # Store the *validated* bytes (metadata already normalised through Pillow).
    analysis_id = storage.save_analysis(
        original_bytes=validated.data,
        annotated_bytes=annotated_bytes,
        meta=meta,
    )

    return AnalyzeResponse(
        analysis_id=analysis_id,
        status="ok" if result.detections else "no_detections",
        detections=[
            DetectionOutSchema(
                class_id=d.class_id,
                class_label=d.class_label,
                category=d.category,
                confidence=round(d.confidence, 4),
                bbox={"x1": d.bbox[0], "y1": d.bbox[1], "x2": d.bbox[2], "y2": d.bbox[3]},
                area_ratio=round(d.area_ratio, 5),
            )
            for d in result.detections
        ],
        detections_count=len(result.detections),
        top_confidence=round(result.top_confidence, 4) if result.top_confidence is not None else None,
        suggested_category=meta["suggested_category"],
        image=ImageMeta(
            width=validated.width,
            height=validated.height,
            mime_type=validated.mime_type,
            size_bytes=len(validated.data),
            file_hash=validated.file_hash,
            exif_gps_present=validated.exif_gps_present,
        ),
        annotated_url=f"/api/v1/detection/analysis/{analysis_id}/annotated" if annotated_bytes else "",
        original_url=f"/api/v1/detection/analysis/{analysis_id}/original",
        model_version=result.model_version,
        model_name=result.model_name,
        conf_threshold=meta["conf_threshold"],
        iou_threshold=meta["iou_threshold"],
        latency_ms=result.latency_ms,
        class_labels={str(k): v for k, v in result.class_labels.items()},
        notice=(
            "Real inference output from the configured model. AI confidence is not a severity or safety "
            "judgement; a reviewer must verify the report."
        ),
        warnings=warnings,
    )


@router.get("/analysis/{analysis_id}/original", summary="Temporary original image for an analysis")
def analysis_original(analysis_id: str):
    from fastapi.responses import FileResponse

    meta = storage.load_analysis(analysis_id)
    return FileResponse(meta["_folder"] / "original.jpg", media_type="image/jpeg")


@router.get("/analysis/{analysis_id}/annotated", summary="Temporary annotated image for an analysis")
def analysis_annotated(analysis_id: str):
    from fastapi.responses import FileResponse

    meta = storage.load_analysis(analysis_id)
    path = meta["_folder"] / "annotated.jpg"
    if not path.is_file():
        raise AppError("NOT_FOUND", "No annotated image exists for this analysis.", status_code=404)
    return FileResponse(path, media_type="image/jpeg")


@router.get("/analysis/{analysis_id}", summary="Structured result of a previous analysis")
def analysis_detail(analysis_id: str) -> dict:
    meta = storage.load_analysis(analysis_id)
    return {k: v for k, v in meta.items() if not k.startswith("_")}
