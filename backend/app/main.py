"""RoadGuard AI FastAPI application factory."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import analytics, auth, detection, exports, map_routes, meta, model_routes, reports
from app.core.config import settings
from app.core.errors import AppError
from app.database.init_db import init_db
from app.detection.detector import get_detector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("roadguard")

API_DESCRIPTION = """
RoadGuard AI — road damage detection and monitoring API.

* **Detection** — `/detection/analyze` validates the upload then runs the configured YOLO model.
  Missing weights return `503 MODEL_UNAVAILABLE` with setup instructions; predictions are never faked.
* **Reports** — persistent lifecycle from `submitted` to `resolved`, with repair updates and audit logs.
* **Map** — bounds-based retrieval for the Leaflet front end; only records with valid coordinates.
* **Analytics** — KPIs computed from stored records, honest empty states.
* **Exports** — CSV, JSON and PDF built from the same filtered query.

Demo records created by the seed generator are flagged `is_synthetic=true`.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("database ready: %s", settings.database_url)

    if settings.seed_demo_on_startup:
        from sqlalchemy import func, select

        from app.database.session import SessionLocal
        from app.models.entities import DamageReport

        with SessionLocal() as db:
            count = db.execute(
                select(func.count(DamageReport.id)).where(DamageReport.is_synthetic.is_(True))
            ).scalar_one()
            if count == 0 and settings.demo_report_count > 0:
                from app.services.demo_data import generate_demo_data

                logger.info("seeding %s synthetic demo reports", settings.demo_report_count)
                result = generate_demo_data(db, count=settings.demo_report_count)
                logger.info("demo seed complete: %s", result)

    detector = get_detector()
    info = detector.info()
    if info["available"]:
        logger.info("detector ready: %s (%s classes)", info["model_version"], info["class_count"])
    else:
        logger.warning("DETECTOR UNAVAILABLE: %s", info.get("error"))

    yield
    logger.info("shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="RoadGuard AI API",
        description=API_DESCRIPTION,
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_allow_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.payload())

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        details = []
        for error in exc.errors():
            details.append(
                {
                    "field": ".".join(str(part) for part in error.get("loc", []) if part not in ("body", "query")),
                    "message": error.get("msg", "Invalid value"),
                    "type": error.get("type"),
                }
            )
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "One or more fields are invalid.",
                    "details": {"fields": details},
                }
            },
        )

    prefix = settings.api_v1_prefix
    for module in (auth, detection, reports, map_routes, analytics, model_routes, exports):
        app.include_router(module.router, prefix=prefix)
    app.include_router(model_routes.settings_router, prefix=prefix)
    app.include_router(meta.router, prefix=prefix)

    @app.get("/api/health", tags=["Metadata"], summary="Health check (unversioned alias)")
    def health_alias() -> dict:
        return {"status": "ok", "version": app.version}

    # Serve the built frontend if it exists (single-container deployment).
    dist = settings.frontend_dist
    if dist.is_dir() and (dist / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        def index() -> FileResponse:
            return FileResponse(dist / "index.html")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str):
            # Never let the SPA shell swallow API traffic: unknown /api paths must
            # stay JSON 404s (and must not mask path-traversal attempts).
            if full_path.startswith(("api/", "api")) and full_path != "api":
                raise AppError("NOT_FOUND", "No API route matches this path.", status_code=404)
            candidate = (dist / full_path).resolve()
            if str(candidate).startswith(str(dist.resolve())) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
