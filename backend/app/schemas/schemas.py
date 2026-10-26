"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models.entities import DamageCategory, ReportStatus, RoadImportance, Role, Severity

Order = Literal["asc", "desc"]

# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Role = Role.citizen


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: EmailStr
    role: str
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int
    user: UserOut


# --------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------


class BBoxSchema(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class DetectionOutSchema(BaseModel):
    class_id: int
    class_label: str
    category: str
    confidence: float
    bbox: BBoxSchema
    area_ratio: float


class ImageMeta(BaseModel):
    width: int
    height: int
    mime_type: str
    size_bytes: int
    file_hash: str
    exif_gps_present: bool


class AnalyzeResponse(BaseModel):
    analysis_id: str
    status: Literal["ok", "no_detections"]
    detections: list[DetectionOutSchema]
    detections_count: int
    top_confidence: float | None
    suggested_category: str
    image: ImageMeta
    annotated_url: str
    original_url: str
    model_version: str
    model_name: str
    conf_threshold: float
    iou_threshold: float
    latency_ms: float
    class_labels: dict[str, str]
    notice: str
    warnings: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------


class ReportCreate(BaseModel):
    analysis_id: str | None = Field(default=None, description="Analysis token from /detection/analyze")
    description: str | None = Field(default=None, max_length=2000)
    damage_category: DamageCategory | None = None
    reviewed_severity: Severity | None = None
    road_importance: RoadImportance = RoadImportance.collector
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    location_source: Literal["gps", "manual", "exif", "demo", "none"] = "manual"
    road_name: str | None = Field(default=None, max_length=200)
    ward: str | None = Field(default=None, max_length=120)
    reported_at: datetime | None = None
    reporter_label: str | None = Field(default=None, max_length=120)

    @field_validator("description", "road_name", "ward", "reporter_label")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def _coordinates_not_null_island(self) -> ReportCreate:
        if abs(self.latitude) < 1e-6 and abs(self.longitude) < 1e-6:
            raise ValueError("(0, 0) is not an acceptable report location; pick the damage location on the map.")
        return self


class ReportUpdate(BaseModel):
    """Fields a reviewer may edit. Coordinates set-by-citizen are re-validated."""

    description: str | None = Field(default=None, max_length=2000)
    damage_category: DamageCategory | None = None
    reviewed_severity: Severity | None = None
    road_importance: RoadImportance | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    road_name: str | None = Field(default=None, max_length=200)
    ward: str | None = Field(default=None, max_length=120)
    is_verified: bool | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> ReportUpdate:
        provided = {k: v for k, v in self.model_dump(exclude_unset=True).items()}
        if not provided:
            raise ValueError("Provide at least one field to update.")
        return self


class StatusUpdateRequest(BaseModel):
    new_status: ReportStatus
    notes: str | None = Field(default=None, max_length=2000)
    resolution_notes: str | None = Field(default=None, max_length=2000)


class RepairUpdateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    previous_status: str
    new_status: str
    notes: str | None
    actor_label: str | None
    created_at: datetime


class DetectionRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    class_label: str
    class_id: int
    confidence: float
    bbox_x1: float
    bbox_y1: float
    bbox_x2: float
    bbox_y2: float
    area_ratio: float
    model_version: str
    is_synthetic: bool


class ReportImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    width: int
    height: int
    mime_type: str
    size_bytes: int
    file_hash: str
    exif_gps_present: bool
    is_synthetic: bool
    created_at: datetime
    original_url: str = ""
    annotated_url: str | None = None


class PriorityFactor(BaseModel):
    key: str
    label: str
    available: bool
    normalised: float
    weight: float
    contribution: float
    detail: str


class ReportSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    reference: str
    description: str | None
    damage_category: str
    ai_suggested_category: str | None
    detection_confidence: float | None
    reviewed_severity: str | None
    road_importance: str
    priority_score: float
    latitude: float | None
    longitude: float | None
    location_source: str | None
    road_name: str | None
    ward: str | None
    status: str
    is_verified: bool
    is_synthetic: bool
    duplicate_of_id: str | None
    reporter_label: str | None
    reported_at: datetime
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    detection_count: int = 0
    thumbnail_url: str | None = None


class ReportDetail(ReportSummary):
    priority_breakdown: list[PriorityFactor] = Field(default_factory=list)
    images: list[ReportImageOut] = Field(default_factory=list)
    detections: list[DetectionRecordOut] = Field(default_factory=list)
    repair_updates: list[RepairUpdateOut] = Field(default_factory=list)
    audit_trail: list[dict[str, Any]] = Field(default_factory=list)
    resolution_age_days: float | None = None


class PaginatedMeta(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int
    sort: str
    order: str


class ReportListResponse(BaseModel):
    items: list[ReportSummary]
    meta: PaginatedMeta


# --------------------------------------------------------------------------
# Duplicates
# --------------------------------------------------------------------------


class DuplicateCandidate(BaseModel):
    report: ReportSummary
    distance_m: float | None
    hours_apart: float
    same_category: bool
    image_similarity: float | None
    score: float
    reasons: list[str]


class DuplicateResponse(BaseModel):
    report_id: str
    candidates: list[DuplicateCandidate]
    linked: list[dict[str, Any]] = Field(default_factory=list)
    method: str = (
        "Haversine proximity + time window + category match + optional perceptual-hash image similarity. "
        "Suggestions are advisory only; nothing is merged automatically."
    )


class LinkDuplicateRequest(BaseModel):
    duplicate_report_id: str
    reason: str | None = Field(default=None, max_length=500)


# --------------------------------------------------------------------------
# Analytics
# --------------------------------------------------------------------------


class KpiCard(BaseModel):
    key: str
    label: str
    value: float
    unit: str | None = None
    hint: str | None = None


class SeriesPoint(BaseModel):
    label: str
    value: float
    secondary: float | None = None


class NamedSeries(BaseModel):
    name: str
    data: list[SeriesPoint]


class OverviewResponse(BaseModel):
    kpis: list[KpiCard]
    generated_at: datetime
    filters_applied: dict[str, Any]
    record_count: int
    synthetic_included: bool


class ChartBundle(BaseModel):
    name: str
    description: str
    series: list[NamedSeries]
    unit: str | None = None


class AnalyticsResponse(BaseModel):
    charts: list[ChartBundle]
    generated_at: datetime
    record_count: int


class RegionStat(BaseModel):
    ward: str
    reports: int
    unresolved: int
    avg_priority: float


class PriorityQueueItem(BaseModel):
    reference: str
    id: str
    priority_score: float
    reviewed_severity: str | None
    damage_category: str
    status: str
    road_name: str | None
    age_days: float
    factors: list[PriorityFactor]


class PriorityQueueResponse(BaseModel):
    items: list[PriorityQueueItem]
    weights: dict[str, float]
    explanation: str


# --------------------------------------------------------------------------
# Model / evaluation
# --------------------------------------------------------------------------


class ModelInfoResponse(BaseModel):
    available: bool
    model_name: str
    model_version: str
    model_path: str
    weights_present: bool
    weights_size_mb: float | None
    class_labels: dict[str, str]
    class_count: int
    conf_threshold: float
    iou_threshold: float
    max_detections: int
    device: str
    load_time_ms: float | None
    error: str | None = None
    class_match_warning: str | None = None
    hints: list[str] = Field(default_factory=list)
    training_config: dict[str, Any] | None = None
    dataset_note: str | None = None


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    model_name: str
    model_version: str
    dataset_name: str
    dataset_split: str
    image_count: int
    instance_count: int
    precision: float
    recall: float
    map50: float
    map50_95: float
    iou_threshold: float
    per_class: dict | None
    confusion_matrix: dict | None
    latency_ms_mean: float | None
    latency_ms_p95: float | None
    class_labels: dict | None
    notes: str | None
    evaluated_at: datetime


class EvaluationResponse(BaseModel):
    available: bool
    evaluation: EvaluationOut | None = None
    message: str
    instructions: list[str] = Field(default_factory=list)
    restrictions: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------


class PrioritySettingsOut(BaseModel):
    weights: dict[str, float]
    age_full_days: int
    repeat_radius_m: float
    repeat_window_days: int
    duplicate_radius_m: float
    duplicate_window_days: int


class PrioritySettingsUpdate(BaseModel):
    weights: dict[str, float] | None = None
    age_full_days: int | None = Field(default=None, ge=1, le=365)
    repeat_radius_m: float | None = Field(default=None, ge=10, le=5000)
    repeat_window_days: int | None = Field(default=None, ge=1, le=365)

    @field_validator("weights")
    @classmethod
    def _weights_valid(cls, value: dict[str, float] | None) -> dict[str, float] | None:
        if value is None:
            return None
        allowed = {"severity", "category", "road_importance", "damage_size", "report_age", "repeat_reports"}
        unknown = set(value) - allowed
        if unknown:
            raise ValueError(f"Unknown weight keys: {sorted(unknown)}")
        if any(v < 0 or v > 1 for v in value.values()):
            raise ValueError("Weights must be between 0 and 1.")
        if not value or sum(value.values()) <= 0:
            raise ValueError("At least one weight must be positive.")
        return value


class MetaOptions(BaseModel):
    statuses: list[dict[str, str]]
    categories: list[dict[str, str]]
    severities: list[dict[str, str]]
    road_importance: list[dict[str, str]]
    allowed_transitions: dict[str, list[str]]
    map_defaults: dict[str, Any]
    priority_weights: dict[str, float]
    demo_region_label: str
    detection_available: bool


class MessageResponse(BaseModel):
    message: str
    detail: str | None = None
