export type ReportStatus =
  | 'submitted'
  | 'under_review'
  | 'verified'
  | 'assigned_for_repair'
  | 'in_progress'
  | 'resolved'
  | 'rejected';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type DamageCategory =
  | 'pothole'
  | 'longitudinal_crack'
  | 'transverse_crack'
  | 'alligator_crack'
  | 'broken_surface'
  | 'other'
  | 'unknown';

export type RoadImportance = 'local' | 'collector' | 'arterial' | 'highway';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'citizen' | 'reviewer' | 'admin';
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in_minutes: number;
  user: User;
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectionResult {
  class_id: number;
  class_label: string;
  category: DamageCategory;
  confidence: number;
  bbox: BBox;
  area_ratio: number;
}

export interface AnalyzeResponse {
  analysis_id: string;
  status: 'ok' | 'no_detections';
  detections: DetectionResult[];
  detections_count: number;
  top_confidence: number | null;
  suggested_category: DamageCategory;
  image: {
    width: number;
    height: number;
    mime_type: string;
    size_bytes: number;
    file_hash: string;
    exif_gps_present: boolean;
  };
  annotated_url: string;
  original_url: string;
  model_version: string;
  model_name: string;
  conf_threshold: number;
  iou_threshold: number;
  latency_ms: number;
  class_labels: Record<string, string>;
  notice: string;
  warnings: string[];
}

export interface DetectionRecord {
  id: string;
  class_label: string;
  class_id: number;
  confidence: number;
  bbox_x1: number;
  bbox_y1: number;
  bbox_x2: number;
  bbox_y2: number;
  area_ratio: number;
  model_version: string;
  is_synthetic: boolean;
}

export interface ReportImage {
  id: string;
  width: number;
  height: number;
  mime_type: string;
  size_bytes: number;
  file_hash: string;
  exif_gps_present: boolean;
  is_synthetic: boolean;
  created_at: string;
  original_url: string;
  annotated_url: string | null;
}

export interface PriorityFactor {
  key: string;
  label: string;
  available: boolean;
  normalised: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface RepairUpdate {
  id: string;
  previous_status: ReportStatus;
  new_status: ReportStatus;
  notes: string | null;
  actor_label: string | null;
  created_at: string;
}

export interface ReportSummary {
  id: string;
  reference: string;
  description: string | null;
  damage_category: DamageCategory;
  ai_suggested_category: DamageCategory | null;
  detection_confidence: number | null;
  reviewed_severity: Severity | null;
  road_importance: RoadImportance;
  priority_score: number;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  road_name: string | null;
  ward: string | null;
  status: ReportStatus;
  is_verified: boolean;
  is_synthetic: boolean;
  duplicate_of_id: string | null;
  reporter_label: string | null;
  reported_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  detection_count: number;
  thumbnail_url: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  changes: Record<string, unknown> | null;
  actor_label: string | null;
  created_at: string;
  is_synthetic: boolean;
}

export interface ReportDetail extends ReportSummary {
  priority_breakdown: PriorityFactor[];
  images: ReportImage[];
  detections: DetectionRecord[];
  repair_updates: RepairUpdate[];
  audit_trail: AuditEntry[];
  resolution_age_days: number | null;
}

export interface Paginated<T> {
  items: T[];
  meta: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    sort: string;
    order: 'asc' | 'desc';
  };
}

export interface KpiCard {
  key: string;
  label: string;
  value: number;
  unit?: string | null;
  hint?: string | null;
}

export interface OverviewResponse {
  kpis: KpiCard[];
  generated_at: string;
  filters_applied: Record<string, unknown>;
  record_count: number;
  synthetic_included: boolean;
}

export interface SeriesPoint {
  label: string;
  value: number;
  secondary?: number | null;
}

export interface ChartBundle {
  name: string;
  description: string;
  series: { name: string; data: SeriesPoint[] }[];
  unit?: string | null;
}

export interface AnalyticsResponse {
  charts: ChartBundle[];
  generated_at: string;
  record_count: number;
}

export interface PriorityQueueItem {
  reference: string;
  id: string;
  priority_score: number;
  reviewed_severity: Severity | null;
  damage_category: DamageCategory;
  status: ReportStatus;
  road_name: string | null;
  age_days: number;
  factors: PriorityFactor[];
}

export interface ModelInfo {
  available: boolean;
  model_name: string;
  model_version: string;
  model_path: string;
  weights_present: boolean;
  weights_size_mb: number | null;
  class_labels: Record<string, string>;
  class_count: number;
  conf_threshold: number;
  iou_threshold: number;
  max_detections: number;
  device: string;
  load_time_ms: number | null;
  error: string | null;
  class_match_warning: string | null;
  hints: string[];
  training_config: Record<string, unknown> | null;
  dataset_note: string | null;
}

export interface Evaluation {
  id: string;
  model_name: string;
  model_version: string;
  dataset_name: string;
  dataset_split: string;
  image_count: number;
  instance_count: number;
  precision: number;
  recall: number;
  map50: number;
  map50_95: number;
  iou_threshold: number;
  per_class: Record<string, Record<string, number>> | null;
  confusion_matrix: { labels?: string[]; matrix?: number[][] } | null;
  latency_ms_mean: number | null;
  latency_ms_p95: number | null;
  class_labels: Record<string, string> | null;
  notes: string | null;
  evaluated_at: string;
}

export interface EvaluationResponse {
  available: boolean;
  evaluation: Evaluation | null;
  message: string;
  instructions: string[];
  restrictions: string[];
}

export interface DuplicateCandidate {
  report: ReportSummary;
  distance_m: number | null;
  hours_apart: number;
  same_category: boolean;
  image_similarity: number | null;
  score: number;
  reasons: string[];
}

export interface DuplicateResponse {
  report_id: string;
  candidates: DuplicateCandidate[];
  linked: {
    id: string;
    duplicate_reference: string;
    duplicate_report_id: string;
    similarity: number;
    reason: string | null;
    linked_by: string | null;
    created_at: string;
  }[];
  method: string;
}

export interface MetaOptions {
  statuses: { value: ReportStatus; label: string; description: string }[];
  categories: { value: DamageCategory; label: string }[];
  severities: { value: Severity; label: string }[];
  road_importance: { value: RoadImportance; label: string }[];
  allowed_transitions: Record<ReportStatus, ReportStatus[]>;
  map_defaults: { lat: number; lng: number; zoom: number };
  priority_weights: Record<string, number>;
  demo_region_label: string;
  detection_available: boolean;
}

export interface MapConfig {
  center: { lat: number; lng: number };
  zoom: number;
  region_label: string;
  tile_url: string;
  attribution: string;
  tile_policy_note: string;
  external_link_template: string;
}

export interface HealthResponse {
  status: string;
  database: { ok: boolean; error: string | null };
  detector: { available: boolean; model_version: string; weights_present: boolean };
  reports: { total: number; synthetic: number; real: number };
  environment: string;
}

export interface PrioritySettings {
  weights: Record<string, number>;
  age_full_days: number;
  repeat_radius_m: number;
  repeat_window_days: number;
  duplicate_radius_m: number;
  duplicate_window_days: number;
}

export interface ReportFilters {
  q?: string;
  status?: ReportStatus[];
  category?: DamageCategory[];
  severity?: Severity[];
  date_from?: string;
  date_to?: string;
  include_synthetic?: boolean;
  only_synthetic?: boolean;
  min_priority?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}
