# Acceptance criteria — status and evidence

Maps the 20 final acceptance criteria from the brief to what was actually verified in this
workspace on 2026-10-25. **Status values:** ✅ verified here · ⚠️ implemented but only
partially verifiable here · ❌ not measured / not possible here.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Frontend and backend start with documented commands | ✅ | `uvicorn app.main:app` → "Application startup complete"; `npm run dev` → Vite ready on :5173; `/api/v1/health` = `{"status":"ok"}` |
| 2 | User can upload a valid road photograph | ✅ | `POST /detection/analyze` with `data/samples/sample_cracked_road_02.jpg` → 200; validation tests for extension/MIME/magic bytes/integrity/size all pass |
| 3 | Detection runs when valid weights are installed | ✅ | Startup log: `detector loaded pothole_yolov8.pt … classes=[Longitudinal Crack, Transverse Crack, Alligator Crack, Pothole, Other] in 1925.5 ms` |
| 4 | Result includes real detections, confidence, boxes, annotated image | ✅ | Response: `1` detection `Alligator Crack` `0.5559`, bbox `{x1,y1,x2,y2}`, `annotated_url` served 662 kB JPEG |
| 5 | User can submit a report with GPS or manually selected coordinates | ✅ | `POST /reports` 201 `RG-261025-B899` with `location_source: manual`; UI flow tested in `report-form.test.tsx`; GPS path uses `useGeolocation` with explicit permission handling |
| 6 | Report persists in the database | ✅ | Retrieved by id and by reference after creation (tests), and after a **process restart** |
| 7 | Report appears at the correct position on the map | ⚠️ | `GET /map/reports` bounds query returns the report exactly inside its bounds and excludes it outside (tested). Leaflet rendering itself was not visually verified (no browser in sandbox) |
| 8 | Dashboard statistics computed from stored records | ✅ | KPI test compares `/analytics/overview` against `COUNT(*)` and raw row maths; empty-filter test proves zeroes instead of placeholders |
| 9 | Authorised reviewer can update status and record repair progress | ✅ | 5-step lifecycle via API (200 each), history 5 updates + 6 audit entries; role tests: 401 anonymous, 403 citizen, 200 reviewer |
| 10 | Reports and analytics can be exported | ✅ | CSV (27 kB, header carries `generated_at`), JSON (169 kB, includes detections + history), PDF (15 kB, valid `%PDF`) |
| 11 | Missing weights / failed inference handled honestly | ✅ | 503 `MODEL_UNAVAILABLE` + hints test; detector raises instead of returning boxes; UI shows the same instructions |
| 12 | App works after restart without losing stored reports | ✅ | Created `RG-261025-5DFC`, stopped the API, restarted, re-fetched: status `under_review`, 1 image, 1 detection, 1 repair update, 2 audit entries, priority 61.72 unchanged |
| 13 | Tests and production builds executed, results documented | ✅ | backend 54 passed · frontend 25 passed (+5 live) · `tsc -b` clean · vite build 954 kB (271 kB gzip) · ruff clean — see `docs/TESTING.md` |
| 14 | Real (not fabricated) AI output | ✅ | Flat 320×320 canvas → 0 detections; real photo → real class + confidence; no fallback heuristic exists in the detector |
| 15 | Honest model evaluation state | ✅ | `/model/evaluation` → `available:false`, "Evaluation not yet available", plus instructions and restrictions; no numbers fabricated |
| 16 | Explainable priority with separated concepts | ✅ | `/reports/{id}/priority` returns 6 factors with weights, normalised values, contributions summing to the score; confidence explicitly excluded from severity |
| 17 | Duplicate assistance without automatic merging | ✅ | Candidates with distance/time/category/phash reasons; reviewer link is audited; both records remain retrievable after linking |
| 18 | Demo data clearly labelled and separable | ✅ | 120 synthetic reports, all `is_synthetic=true`, `DEMO` badges, `--purge` removes only synthetic rows; health reports real vs synthetic counts |
| 19 | Security & privacy controls | ✅ | Upload guards, traversal-safe media test, PBKDF2+JWT, server-side role checks, CORS config, env secrets, EXIF stripped on save, rate limiting (unit level) |
| 20 | Production-oriented UI/UX | ⚠️ | Implemented (dark/light, collapsible sidebar, responsive breakpoints, loading/empty/error states, keyboard-focusable controls, ARIA labels); visual verification limited to DOM assertions + production build |

## Explicitly not done / not verifiable here

* **Local model accuracy metrics** — requires an annotated test split; scripts provided.
* **Browser screenshots / visual regression** — Chromium cannot launch in this sandbox
  (missing `libnss3`, no root). The dev server and built SPA were smoke-tested over HTTP.
* **CUDA inference**, **PostgreSQL**, **multi-worker scaling**, **load/rate-limit 429 paths**,
  **email/password reset** — documented as out of scope or untested.
