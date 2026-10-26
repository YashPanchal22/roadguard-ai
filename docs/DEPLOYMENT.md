# Deployment, security and operations

## 1. Environment variables

See `.env.example`. Everything is prefixed `ROADGUARD_`; there are no hardcoded
credentials or endpoints in the codebase.

| Variable | Purpose |
|---|---|
| `ROADGUARD_ENVIRONMENT` | `development` / `production` label |
| `ROADGUARD_DATABASE_URL` | SQLAlchemy URL; SQLite default, PostgreSQL supported |
| `ROADGUARD_STORAGE_DIR` | root for uploaded/annotated images |
| `ROADGUARD_JWT_SECRET` | token signing secret — **replace** (`python -c "import secrets;print(secrets.token_urlsafe(48))"`) |
| `ROADGUARD_ACCESS_TOKEN_EXPIRE_MINUTES` | token lifetime (default 720) |
| `ROADGUARD_CORS_ORIGINS` | comma-separated allowed origins |
| `ROADGUARD_CORS_ALLOW_ORIGIN_REGEX` | regex for preview/hosting domains |
| `ROADGUARD_MAX_UPLOAD_MB` | upload cap (default 10) |
| `ROADGUARD_RATE_LIMIT_*` | detection/auth/report limits per window |
| `ROADGUARD_MODEL_PATH` / `_NAME` / `_VERSION` | weights + provenance labels |
| `ROADGUARD_CONF_THRESHOLD` / `_IOU_THRESHOLD` / `_MAX_DETECTIONS` | inference config |
| `ROADGUARD_DEVICE` | `cpu` or `cuda` |
| `ROADGUARD_DEFAULT_MAP_*` | map centre/zoom |
| `ROADGUARD_SEED_DEMO_ON_STARTUP` / `_DEMO_REPORT_COUNT` | demo dataset |
| `ROADGUARD_PRIORITY_*` | priority weights and thresholds |
| `ROADGUARD_DUPLICATE_*` | duplicate search radius/window |

---

## 2. Local / single-container deployment

```bash
cd frontend && npm run build          # produces frontend/dist
cd ../backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

FastAPI serves the built SPA (with client-side routing fallback) and the API on one port.
Unknown `/api/*` paths return JSON 404 — the SPA shell never masks API errors.

### systemd unit sketch

```ini
[Unit]
Description=RoadGuard AI API
After=network.target

[Service]
User=roadguard
WorkingDirectory=/srv/roadguard-ai/backend
EnvironmentFile=/srv/roadguard-ai/.env
ExecStart=/srv/roadguard-ai/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Use `--workers 1`: the YOLO model is a per-process singleton (memory) and rate-limit
counters are in-process. For multiple workers, add a shared limiter and a task queue.

---

## 3. PostgreSQL

```bash
pip install "psycopg[binary]==3.2.3"
export ROADGUARD_DATABASE_URL="postgresql+psycopg://roadguard:secret@localhost:5432/roadguard"
```

`init_db()` creates the tables. For versioned changes adopt Alembic:

```bash
alembic init migrations
alembic revision --autogenerate -m "baseline"
alembic upgrade head
```

The models use a UTC-aware `UTCDateTime` type that maps cleanly to
`TIMESTAMP WITH TIME ZONE`. JSON columns already map to `JSONB`-compatible types.
The SQLite "additive column" migration helper in `app/database/init_db.py` exists only so a
local `.db` file survives schema additions; it is not a substitute for Alembic in production.

---

## 4. Security checklist for a pilot

- [ ] Replace `ROADGUARD_JWT_SECRET`; keep it out of images and repositories.
- [ ] Set `ROADGUARD_CORS_ORIGINS` to your real domain(s) only.
- [ ] Terminate TLS at a reverse proxy (nginx/Caddy) and forward `X-Forwarded-For`.
- [ ] Add proxy-level rate limiting for `/api/v1/detection/analyze` and `/api/v1/auth/*`.
- [ ] Disable demo seeding (`ROADGUARD_SEED_DEMO_ON_STARTUP=false`) and purge demo rows.
- [ ] Delete/rotate the demo `reviewer@roadguard.demo` / `admin@roadguard.demo` accounts.
- [ ] Restrict `POST /model/reload` and `DELETE /reports/{id}` to trusted admins.
- [ ] Back up both the database **and** `data/uploads/` (images are files, not blobs).
- [ ] Schedule `storage.cleanup_tmp()` (temporary analyses expire after 4 h).
- [ ] Review the Ultralytics AGPL-3.0 licence if you distribute the service.
- [ ] Document retention: how long photographs and reports are kept, and who can export them.

### Privacy handling of photographs

Uploads are re-encoded through Pillow on save (`strip_exif_bytes` / image save path), which
removes EXIF including GPS, camera serial and timestamps. The API still *reports* whether EXIF
GPS was present (so the UI can explain the provenance), but never uses or stores it.
To purge metadata from already-stored files:

```python
from pathlib import Path
from app.detection.validation import strip_exif_bytes
for path in Path("data/uploads/reports").rglob("*_original.jpg"):
    path.write_bytes(strip_exif_bytes(path.read_bytes()))
```

---

## 5. Map tiles

The front end uses OpenStreetMap tiles (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`).
The OSM Foundation tile usage policy permits light, interactive, cached browsing and forbids
bulk downloads, prefetching and heavy automated use. For any real traffic, configure a
dedicated provider and update `MapView.tsx` + `/api/v1/map/config`:

| Provider | Notes |
|---|---|
| MapTiler | API key, vector/raster tiles, generous free tier |
| Stadia Maps | key required, OSM-derived styles |
| Thunderforest | key required |
| Self-hosted tiles | `tile.openstreetmap.org` data via TileServer GL |

Always keep the attribution `© OpenStreetMap contributors`.

---

## 6. Observability

* `GET /api/v1/health` — database reachability, detector availability, report counts.
* `GET /api/v1/model/info` — model version, classes, thresholds, load time, warnings.
* Structured uvicorn access logs; add a JSON log handler for production.
* Store `Detection.latency_ms`-style figures via `ml/scripts/benchmark_latency.py` for
  performance tracking.

---

## 7. Backups and retention

```bash
# SQLite (safe while running thanks to WAL)
sqlite3 data/roadguard.db ".backup 'backup-$(date +%F).db'"
tar czf uploads-$(date +%F).tgz data/uploads/
```

Real reports and demo reports are separable (`is_synthetic`), so a production database can
carry demonstration data without contaminating exports or analytics.
