# API reference

Base URL: `/api/v1` · Interactive docs: `/api/docs` · OpenAPI: `/api/openapi.json`

Authentication: `Authorization: Bearer <token>` from `POST /auth/login`.
Errors always use one envelope:

```json
{ "error": { "code": "...", "message": "...", "details": { }, "hints": ["..."] } }
```

| Status | Typical codes |
|---|---|
| 400 | `NO_FILE`, `EMPTY_FILE`, `INVALID_PATH` |
| 401 | `AUTH_REQUIRED`, `INVALID_TOKEN`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `ACCOUNT_DISABLED`, `ROLE_NOT_ALLOWED` |
| 404 | `REPORT_NOT_FOUND`, `NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `NO_STATUS_CHANGE` |
| 410 | `ANALYSIS_EXPIRED` |
| 413 | `FILE_TOO_LARGE` |
| 415 | `UNSUPPORTED_EXTENSION`, `UNSUPPORTED_MIME` |
| 422 | `VALIDATION_ERROR`, `CORRUPT_IMAGE`, `EXTENSION_MISMATCH`, `IMAGE_TOO_SMALL`, `INVALID_TRANSITION`, `INVALID_COORDINATES` |
| 429 | `RATE_LIMITED` |
| 503 | `MODEL_UNAVAILABLE` |

---

## Detection

### `POST /detection/analyze`
`multipart/form-data`: `file` (required), `conf` (0.05–0.99), `iou` (0.1–0.95), `annotate` (bool).

```bash
curl -X POST http://localhost:8000/api/v1/detection/analyze \
  -F "file=@data/samples/sample_cracked_road_02.jpg"
```

```json
{
  "analysis_id": "b1d2…",
  "status": "ok",
  "detections": [
    { "class_id": 2, "class_label": "Alligator Crack", "category": "alligator_crack",
      "confidence": 0.5559, "bbox": { "x1": 744.1, "y1": 379.4, "x2": 1181.0, "y2": 765.2 },
      "area_ratio": 0.19697 }
  ],
  "detections_count": 1,
  "top_confidence": 0.5559,
  "suggested_category": "alligator_crack",
  "image": { "width": 1536, "height": 1024, "mime_type": "image/jpeg", "size_bytes": 134681,
             "file_hash": "…", "exif_gps_present": false },
  "annotated_url": "/api/v1/detection/analysis/b1d2…/annotated",
  "original_url": "/api/v1/detection/analysis/b1d2…/original",
  "model_version": "pothole-yolov8s-community-v1",
  "conf_threshold": 0.35, "iou_threshold": 0.45,
  "latency_ms": 247.04,
  "class_labels": { "0": "Longitudinal Crack", "…": "…" },
  "notice": "Real inference output…",
  "warnings": []
}
```

`analysis_id` is valid for 4 hours and is consumed when a report is created from it.
When the model is unavailable the endpoint returns `503` and **no** detections.

---

## Reports

### `POST /reports`
```json
{
  "analysis_id": "b1d2…",          // optional: attach real detections + images
  "description": "Deep pothole in the middle lane",
  "damage_category": "pothole",     // optional, editable by reviewer later
  "reviewed_severity": "high",
  "road_importance": "arterial",
  "latitude": 23.0225, "longitude": 72.5714,
  "location_source": "manual",      // gps | manual | exif | demo | none
  "road_name": "Ashram Road", "ward": "Navrangpura",
  "reported_at": "2026-10-25T09:00:00Z"
}
```
→ `201` with the full report (reference `RG-YYMMDD-XXXX`, status `submitted`,
`priority_breakdown[]`, images, detections, audit trail). `(0,0)` and out-of-range
coordinates are rejected with `422`.

### `GET /reports`
Query: `q`, `status` (repeatable), `category`, `severity`, `date_from`, `date_to`,
`bbox=south,west,north,east`, `min_priority`, `is_verified`, `geo_only`,
`exclude_duplicates`, `include_synthetic`, `only_synthetic`, `sort`
(`reported_at|created_at|priority_score|status|reference|detection_confidence`),
`order`, `page`, `page_size` (≤200).

### `POST /reports/{id}/status`
```json
{ "new_status": "verified", "notes": "Verified on site by ward inspector" }
```
Allowed chain: `submitted → under_review → verified → assigned_for_repair → in_progress → resolved`,
plus `→ rejected` from the first three stages and `rejected → under_review`.
Skipping a step returns `422 INVALID_TRANSITION`; rejecting without notes returns
`422 NOTES_REQUIRED`. Each accepted transition writes a `RepairUpdate` and an audit entry.

### `GET /reports/{id}/duplicates`
Returns advisory candidates with `distance_m`, `hours_apart`, `same_category`,
`image_similarity`, `score`, `reasons[]` and the existing `linked[]` list.

### `POST /reports/{id}/duplicates/link`
```json
{ "duplicate_report_id": "…", "reason": "Same pothole reported twice" }
```
Reviewer/admin only. Both reports are preserved; the link is audited and reversible.

### `GET /reports/{id}/priority`
```json
{
  "score": 61.72, "band": "high",
  "factors": [ { "key": "severity", "label": "Reviewed severity", "available": true,
                 "normalised": 0.78, "weight": 0.34, "contribution": 26.5,
                 "detail": "Reviewer severity is 'high'." }, "…" ],
  "note": "Priority orders verified repair work…"
}
```

---

## Map

`GET /map/reports?south=22.9&west=72.4&north=23.2&east=72.8` — only records with valid
coordinates; supports `status`, `category`, `severity`, `include_synthetic`,
`exclude_duplicates`, `limit` (≤2000). Inverted bounds → `422`.

`GET /map/config` — centre, zoom, tile URL, attribution, usage-policy note, external link
template.

`GET /media/reports/{image_id}/{original|annotated|thumb}` — traversal-safe file serving.

---

## Analytics

| Endpoint | Returns |
|---|---|
| `GET /analytics/overview` | KPI cards (total, this month, verified, unresolved, under repair, resolved, avg resolution days, high-priority verified) |
| `GET /analytics/charts` | 8 chart bundles: by date, categories, status, severity, outstanding by age, resolution trend, AI-confidence distribution, by region |
| `GET /analytics/regions` | per-ward `{reports, unresolved, avg_priority}` |
| `GET /analytics/priority-queue?limit=` | ranked verified/in-repair cases with full factor lists |
| `GET /analytics/recompute` | reviewer/admin: recompute every priority score |

All accept the same filter set as `/reports` where meaningful, with the same
`include_synthetic` / `only_synthetic` switches.

---

## Model

`GET /model/info` → availability, class labels, thresholds, device, load time, `error`,
`class_match_warning`, `hints`, training config and dataset provenance note.

`GET /model/evaluation` → `{available:false, message:"Evaluation not yet available",
instructions:[…], restrictions:[…]}` until a real evaluation is imported, otherwise the
stored metrics including per-class values and confusion matrix.

`POST /model/reload` (admin) → reload weights from disk.

---

## Exports

| Endpoint | Content |
|---|---|
| `GET /exports/reports.csv` | header line with `generated_at` + row count, then one row per report |
| `GET /exports/reports.json` | `{generated_at, record_count, filters, notice, reports:[…detections, history]}` |
| `GET /exports/summary.pdf` | KPI table, four distribution charts, report register (≤120 rows) |

All accept `q`, `status`, `category`, `severity`, `date_from`, `date_to`, `bbox`,
`include_synthetic`, `only_synthetic`. Reporter labels are included only for admins.

---

## Auth, settings, metadata

| Endpoint | Notes |
|---|---|
| `POST /auth/register` | citizen role only; elevated roles cannot be self-assigned |
| `POST /auth/login` | PBKDF2 verification + JWT |
| `GET /auth/me` | current user |
| `GET /settings/priority` | current weights/thresholds |
| `PUT /settings/priority` | admin; validates weights 0–1, recomputes all scores |
| `GET /meta/options` | statuses, categories, severities, road importance, allowed transitions, map defaults, weights, demo label, detection availability |
| `GET /health` | DB, detector, report counts (real vs synthetic), environment |
