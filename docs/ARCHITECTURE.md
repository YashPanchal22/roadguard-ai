# Architecture

## Layering

```
React SPA  ──HTTP/JSON──▶  FastAPI routers  ──▶  services (domain)  ──▶  SQLAlchemy models
                                   │                     │                      │
                                   │                     ├── priority / duplicates / exports
                                   │                     └── storage (files on disk)
                                   └── detection (validation → YOLO singleton → annotation)
```

* **Routers** (`app/api/routes/`) only parse/validate requests, call services and shape
  responses. No business logic and no direct model calls except in `detection.py`.
* **Services** (`app/services/`) hold the domain rules: lifecycle transitions, audit writing,
  priority maths, duplicate search, exports, demo seeding.
* **Analytics** (`app/analytics/metrics.py`) is pure aggregation over ORM rows — easy to test
  and to reuse in exports.
* **Detection** (`app/detection/`) is isolated: `validation.py` guards every upload before the
  detector is touched; `detector.py` owns the YOLO singleton and all failure modes.
* **Database** (`app/database/`) provides the session/engine and an additive migration helper.

## Data model

```
users ─┬─< damage_reports >─┬─< report_images >─< detections
       │                    ├─< repair_updates
       │                    └─< duplicate_links (canonical → duplicate)
       └─< audit_logs
model_evaluations  (one row per imported evaluation run)
```

Key decisions:

| Decision | Rationale |
|---|---|
| Images stored on disk, referenced by relative path + SHA-256 | keeps the DB small and backups simple; no blobs |
| `is_synthetic` on reports, images, detections, audits | demo data is separable and cannot silently pollute real analytics or exports |
| `RepairUpdate` rows + `AuditLog` rows for every mutation | a resolved report keeps its full status history |
| `priority_breakdown` JSON snapshot per report | the explanation stored with the score matches the score at the time |
| `model_version` on each detection | provenance: which model produced these boxes |
| UTC-aware `UTCDateTime` type | correct behaviour on SQLite, drop-in compatible with PostgreSQL `timestamptz` |
| No soft-delete of resolved reports | terminal states stay in the register; new damage gets a new report |

## Request flow — report submission

1. `POST /detection/analyze` → validate upload (extension, MIME, magic bytes, Pillow verify,
   dimension/size limits) → run YOLO → encode annotated JPEG → write to
   `data/uploads/_tmp/<analysis_id>/` + `meta.json`.
2. Front end shows boxes/confidence and asks for a location (GPS or map click).
3. `POST /reports` with `analysis_id` → service moves the temp folder into
   `data/uploads/reports/<report_id>/`, writes `ReportImage` + `Detection` rows, computes
   priority, writes the audit entry, returns the reference.
4. Unclaimed analyses expire (4 h TTL) and are cleaned up.

## Frontend structure

* `context/AppProviders` — theme, auth (JWT in `localStorage`), toasts, and a cached
  `/meta/options` fetch shared by every screen.
* `hooks/useAsync` — one uniform loader with `loading / error / hints / reload` so every page
  renders consistent skeletons, error states with retry and empty states.
* `services/api.ts` — axios instance, bearer token injection, error-envelope → `ApiError`
  mapping, `describeError()` for UI messages.
* `components/ui.tsx` — accessible primitives (buttons with loading state, fields with
  errors/hints, modal with `role="dialog"`, pagination, notices).
* `components/charts.tsx` — Recharts wrappers that render explicit empty states instead of
  empty axes.
* `components/MapView.tsx` — React-Leaflet with `CircleMarker` (no missing-icon problems),
  bounds watcher, click-to-pick, popup actions, dark-mode tile filter.

## Layout deviations from the requested tree

| Requested | Implemented | Why |
|---|---|---|
| `app/api/` | `app/api/routes/*` + `app/api/deps.py` | one module per resource keeps files readable |
| `app/analytics/` | pure metrics module | reusable by both API and PDF export |
| `ml/training`+`ml/evaluation` | plus `ml/scripts` | ad-hoc prediction and latency benchmarking |
| `data/samples` | 3 generated placeholder photos | needed so demo reports can carry real images |
| `backend/tests` | conftest with isolated DB/storage | tests never touch the developer database |

## Scaling notes

* Model loading is per process; use 1 worker or a shared inference service.
* In-process rate limiting → move to Redis/NGINX for multi-worker deployments.
* SQLite → PostgreSQL via `ROADGUARD_DATABASE_URL`, then adopt Alembic.
* Image storage → S3-compatible object store behind the same `storage` service API.
