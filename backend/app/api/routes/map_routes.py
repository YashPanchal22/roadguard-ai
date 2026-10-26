"""Map-oriented report retrieval (bounds based) + media file serving."""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import DbSession
from app.core.config import settings
from app.core.errors import AppError
from app.models.entities import ReportImage
from app.schemas.schemas import ReportSummary
from app.services import reports as report_service
from app.services import storage
from app.services.serializers import report_summary

router = APIRouter(tags=["Map & Media"])


@router.get("/map/reports", response_model=list[ReportSummary], summary="Reports inside map bounds")
def map_reports(
    db: DbSession,
    south: float = Query(ge=-90, le=90),
    west: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=180),
    status: Annotated[list[str] | None, Query()] = None,
    category: Annotated[list[str] | None, Query()] = None,
    severity: Annotated[list[str] | None, Query()] = None,
    include_synthetic: bool = True,
    only_synthetic: bool = False,
    exclude_duplicates: bool = False,
    limit: int = Query(default=500, ge=1, le=2000),
) -> list[ReportSummary]:
    if south > north or west > east:
        raise AppError(
            "INVALID_BBOX",
            "Bounds must satisfy south <= north and west <= east.",
            status_code=422,
        )
    filters = report_service.build_filters(
        status=status,
        category=category,
        severity=severity,
        bbox=(south, west, north, east),
        include_synthetic=include_synthetic,
        only_synthetic=only_synthetic,
    )
    items, _ = report_service.query_reports(
        db,
        filters=filters,
        sort="reported_at",
        order="desc",
        page=1,
        page_size=limit,
        geo_only=True,
        exclude_duplicates=exclude_duplicates,
    )
    return [report_summary(item) for item in items]


@router.get("/map/config", summary="Default map centre and tile configuration")
def map_config() -> dict:
    return {
        "center": {"lat": settings.default_map_lat, "lng": settings.default_map_lng},
        "zoom": settings.default_map_zoom,
        "region_label": settings.demo_region_label,
        "tile_url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "attribution": "© OpenStreetMap contributors",
        "tile_policy_note": (
            "OpenStreetMap tiles are used under the OSM Foundation tile usage policy: light, "
            "cached, non-bulk browsing only. Configure a dedicated provider for production "
            "traffic (see docs/DEPLOYMENT.md)."
        ),
        "external_link_template": "https://www.openstreetmap.org/?mlat={lat}&mlon={lng}#map=18/{lat}/{lng}",
    }


@router.get("/media/reports/{image_id}/{variant}", summary="Serve original or annotated report image")
def serve_image(
    image_id: str,
    variant: Literal["original", "annotated", "thumb"],
    db: DbSession,
) -> FileResponse:
    image = db.execute(select(ReportImage).where(ReportImage.id == image_id)).scalar_one_or_none()
    if image is None:
        raise AppError("NOT_FOUND", "Image not found.", status_code=404)

    if variant == "original":
        relative = image.original_path
        media_type = image.mime_type
    else:
        relative = image.annotated_path or image.original_path
        media_type = "image/jpeg"

    path = storage.resolve_media(relative)  # traversal-safe
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )
