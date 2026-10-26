# Testing — inventory, commands and recorded evidence

All commands below were executed in this workspace on **2026-10-25** (Python 3.13.16,
Node 20.20.2, CPU-only). Outputs are pasted verbatim.

---

## 1. Commands

```bash
cd backend && python -m pytest                                       # backend suite
cd frontend && npm run test                                          # component/unit suite
cd frontend && RUN_LIVE_TESTS=1 npx vitest run src/test/live-api.test.tsx   # against live API
cd frontend && npm run build                                         # tsc -b && vite build
ruff check backend/app backend/tests ml                              # static analysis
```

## 2. Recorded results

```
=== BACKEND (pytest) ===
......................................................                   [100%]
54 passed in 6.73s

=== FRONTEND (vitest, component + unit) ===
Test Files  5 passed | 1 skipped (6)
     Tests  25 passed | 5 skipped (30)

=== FRONTEND ↔ LIVE API (vitest, RUN_LIVE_TESTS=1) ===
Test Files  1 passed (1)
     Tests  5 passed (5)

=== PRODUCTION BUILD ===
vite v5.4.11 building for production...
✓ 2500 modules transformed.
dist/index.html                   0.92 kB │ gzip:   0.56 kB
dist/assets/index-BtWX34Sx.css   54.76 kB │ gzip:  13.47 kB
dist/assets/index-BBbcIfiF.js   954.46 kB │ gzip: 271.34 kB
✓ built in 6.83s
(tsc -b: clean, no errors)

=== STATIC ANALYSIS (ruff 0.8.4, E/F/W/I/B/UP) ===
All checks passed!
```

The 5 skipped tests in the frontend run are the live-API suite (`live-api.test.tsx`),
which skips itself unless `RUN_LIVE_TESTS=1` so that `npm test` works without a server.
They pass when the API is running (row above).

---

## 3. Backend test inventory (54 tests)

### `tests/test_uploads_and_detection.py` (12)
| Test | Verifies |
|---|---|
| `test_valid_png_upload_runs_real_inference` | 200, full response schema, bbox validity, class labels from the model, blank image yields **0** detections |
| `test_detections_are_not_fabricated_for_flat_image` | no invented boxes for a flat canvas |
| `test_real_road_sample_produces_annotated_image_when_detected` | annotated JPEG served when a real detection exists |
| `test_rejects_unsupported_extension` | 415 `UNSUPPORTED_EXTENSION` |
| `test_rejects_binary_garbage_with_image_extension` | 422 `CORRUPT_IMAGE` (magic bytes) |
| `test_rejects_extension_content_mismatch` | 422 `EXTENSION_MISMATCH` (PNG named .jpg) |
| `test_rejects_truncated_jpeg` | 422 on truncated file |
| `test_rejects_tiny_image` | 422 `IMAGE_TOO_SMALL` |
| `test_rejects_oversized_upload` | 413 `FILE_TOO_LARGE` |
| `test_rejects_wrong_declared_mime` | 415 on `application/pdf` |
| `test_missing_model_weights_return_actionable_503` | 503 `MODEL_UNAVAILABLE` **with hints**, no predictions |
| `test_detector_predict_raises_when_unavailable` | detector raises instead of returning boxes |
| `test_analysis_endpoints_expire_gracefully` | 410 `ANALYSIS_EXPIRED` |
| `test_report_creation_with_expired_analysis_rejected` | 410 when attaching a dead analysis |
| `test_exif_metadata_is_reported_honestly` | `exif_gps_present=false` for a metadata-free image |

### `tests/test_reports_lifecycle.py` (24)
Persistence & references; retrieval by UUID *and* by reference; 404 shape; coordinate
validation (`(0,0)`, ±91 lat, ±181 lng, missing longitude); 401 without token; 403 for
citizen status changes and review-field edits; full 5-step lifecycle with ordered history,
`resolved_at`, audit entries; invalid/skipped transition → 422; same-status → 409; rejection
requires notes; reviewer edit + audit trail; location correction; admin-only delete;
explainable priority (6 factors, contributions sum to score); filtering/sorting/pagination
+ invalid sort → 422; map bounds retrieval (inside/outside/inverted); duplicate suggestions
+ audited link + both records preserved; duplicate link requires auth; path-traversal-safe
media serving; unknown `/api/*` path returns JSON 404 (SPA fallback regression).

### `tests/test_analytics_exports.py` (18)
KPIs match `COUNT(*)`; KPI maths vs raw rows (verified/resolved/under-repair/avg resolution);
empty dataset → all-zero KPIs and empty chart series (no placeholder numbers); chart bundle
names/shapes; priority queue sorted with contributions summing to score; priority settings
admin-only + validation; CSV export row count equals filtered DB count; JSON export valid and
integration-ready; PDF is a real PDF (`%PDF` magic, >3 kB); filters carry into exports;
**persistence across a fresh engine/session**; health endpoint; model info/evaluation empty
state; meta options + allowed transitions.

### Test isolation
`tests/conftest.py` sets `ROADGUARD_DATABASE_URL` / `ROADGUARD_STORAGE_DIR` to a temp
directory *before* the app is imported, disables demo seeding, seeds a deterministic
10-report fixture set directly in the DB, and creates one account per role. Tests never
touch the developer database or `data/uploads`.

---

## 4. Frontend test inventory (25 tests + 5 live)

| File | Tests | Focus |
|---|---|---|
| `api-client.test.ts` | 4 | error-envelope → `ApiError`, network fallback messaging, bearer-token injection, `describeError` |
| `filters.test.tsx` | 3 | status toggles emit correct patches, `aria-pressed` state, search input, demo-data toggle, clear action |
| `report-form.test.tsx` | 4 | submission blocked without coordinates, successful submit with map-picked location → reference shown, detection error surfaced while staying submittable, unsupported MIME rejected client-side |
| `report-detail.test.tsx` | 3 | priority factor explanations + detection table, anonymous users see "Reviewer access required", reviewer transition calls the API and toasts |
| `pages-smoke.test.tsx` | 11 | every screen (overview, detection, map, reports, repairs, analytics, model, exports, settings, login) renders with mocked payloads and produces **zero console errors** |
| `live-api.test.tsx` (opt-in) | 5 | real KPIs from the DB, persisted report rows, analytics aggregates, model metadata + honest evaluation state, **end-to-end submit → `RG-YYMMDD-XXXX`** |

---

## 5. Manual / runtime verification performed

| Check | Command / action | Result |
|---|---|---|
| API boots, DB created, model loaded once | `uvicorn app.main:app` | `detector loaded … in 1925.5 ms`, 5 classes |
| Demo seed | first startup | `created: 120, images_attached: 6, duplicates_linked: 3` |
| Real inference on a sample photo | `POST /detection/analyze` | `1` detection `Alligator Crack` 0.5559, 247 ms |
| Annotated image retrieval | `GET /detection/analysis/{id}/annotated` | 200, `image/jpeg`, 662 kB |
| Report creation from analysis | `POST /reports` | 201, `RG-261025-B899`, priority 61.72, 1 detection |
| Full lifecycle | 5 × `POST /reports/{id}/status` | all 200, 5 repair updates, 6 audit entries |
| Auth | login/me/bad-token/no-token | 200 / 200 / 401 / 401 |
| Invalid uploads | bad ext / corrupt / tiny / mismatch | 415 / 422 / 422 / 422 |
| Exports | CSV / JSON / PDF | 200 / 200 / 200 (27 kB / 169 kB / 15 kB) |
| **Persistence across restart** | create report → stop API → start API → `GET /reports/{id}` | `RG-261025-5DFC`, status `under_review`, 1 image, 1 detection, 1 repair update, 2 audit entries, priority 61.72 |
| Health after restart | `GET /health` | `{total: 127, synthetic: 120, real: 7}`, detector available |
| SPA served by FastAPI | `GET /` on :8000 | 200 (built `index.html`) |
| Dev server proxy | `GET /api/v1/health` on :5173 | 200 |

---

## 6. Known verification gaps (honest list)

1. **No browser screenshot/E2E automation.** This sandbox runs as a non-root user and the
   Chromium build lacks system libraries (`libnss3`), so Playwright could not launch
   (`error while loading shared libraries: libnss3.so`). Automated UI verification was done
   with jsdom component tests plus the live-API suite instead. Layout, colour and map-tile
   rendering were **not** visually verified here; run `npm run dev` and inspect the pages.
2. **Recharts and Leaflet do not render pixels in jsdom** (no layout engine), so chart and
   map *geometry* are untested; their data plumbing and empty states are tested.
3. **GPU path untested** — `ROADGUARD_DEVICE=cuda` was never executed (CPU-only machine).
4. **PostgreSQL path untested** — only SQLite was exercised.
5. **Model quality not measured here.** No annotated test split is present, so no local
   precision/recall/mAP exists; `ml/evaluation/evaluate.py` was written but not run.
6. **Concurrency/load untested** — no load testing, no multi-worker behaviour.
7. **Rate limiting** is verified only by unit-level behaviour (in-process counters); 429 paths
   were not exercised end-to-end.
8. **Email delivery, password reset, account lockout** are out of scope and unimplemented.
