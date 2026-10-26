"""Application configuration.

All runtime knobs are read from environment variables (prefix ``ROADGUARD_``)
or from a local ``.env`` file. See ``.env.example`` at the repository root for
the full documented list.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = REPO_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ROADGUARD_",
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- application -------------------------------------------------------
    app_name: str = "RoadGuard AI"
    environment: str = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"

    # --- persistence -------------------------------------------------------
    database_url: str = f"sqlite:///{REPO_ROOT / 'data' / 'roadguard.db'}"
    storage_dir: Path = REPO_ROOT / "data" / "uploads"
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"

    # --- security ----------------------------------------------------------
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        ]
    )
    cors_allow_origin_regex: str = r"https://.*\.e2b\.app"
    max_upload_mb: float = 10.0
    rate_limit_window_seconds: int = 60
    rate_limit_detection_per_window: int = 30
    rate_limit_auth_per_window: int = 20

    # --- detection ---------------------------------------------------------
    model_path: Path = REPO_ROOT / "data" / "models" / "pothole_yolov8.pt"
    model_name: str = "RoadGuard road-distress YOLOv8s (community weights)"
    model_version: str = "pothole-yolov8s-community-v1"
    conf_threshold: float = 0.35
    iou_threshold: float = 0.45
    max_detections: int = 100
    device: str = "cpu"
    # Model classes that are considered road damage. Used to warn when a
    # generic (e.g. COCO) checkpoint is configured by mistake.
    road_damage_class_keywords: list[str] = Field(
        default_factory=lambda: [
            "pothole",
            "crack",
            "damage",
            "distress",
            "road",
            "rutting",
            "patch",
        ]
    )

    # --- mapping / demo data ----------------------------------------------
    default_map_lat: float = 23.0225
    default_map_lng: float = 72.5714
    default_map_zoom: int = 12
    demo_region_label: str = "Ahmedabad, Gujarat (demo region)"
    seed_demo_on_startup: bool = True
    demo_report_count: int = 120

    # --- prioritisation (weights are editable at runtime by an admin) ------
    priority_weights: dict = Field(
        default_factory=lambda: {
            "severity": 0.34,
            "category": 0.16,
            "road_importance": 0.14,
            "damage_size": 0.12,
            "report_age": 0.12,
            "repeat_reports": 0.12,
        }
    )
    priority_age_full_days: int = 30
    priority_repeat_radius_m: float = 250.0
    priority_repeat_window_days: int = 60

    # --- duplicate assistance ---------------------------------------------
    duplicate_radius_m: float = 120.0
    duplicate_window_days: int = 14
    duplicate_phash_max_distance: int = 12

    @field_validator("storage_dir", "model_path", "frontend_dist", mode="before")
    @classmethod
    def _resolve_path(cls, value):
        if value in (None, ""):
            return value
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = (REPO_ROOT / path).resolve()
        return path

    @field_validator("cors_origins", "road_damage_class_keywords", mode="before")
    @classmethod
    def _split_csv(cls, value):
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def media_root(self) -> Path:
        return self.storage_dir

    def ensure_dirs(self) -> None:
        for path in (self.storage_dir, self.storage_dir / "reports", self.model_path.parent):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings


settings = get_settings()
