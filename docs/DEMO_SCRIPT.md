# 12-minute demonstration script (viva / review)

Start both servers first:

```bash
# terminal 1
cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# terminal 2
cd frontend && npm run dev
```

Open <http://localhost:5173>. The 120 seeded reports are all badged **DEMO** — say this out
loud, then show that real submissions appear without the badge.

---

### 0:00 — Frame the honesty rules (30 s)

> "Every number on this dashboard is computed from stored rows. Every box comes from a real
> YOLO run. If the model is missing or fails, the API returns an error instead of inventing
> predictions — I'll prove that in a minute."

### 0:30 — Overview dashboard (1 min)

Point at the 8 KPI cards, the reports-by-date area chart, the status donut and the priority
queue. Change a filter (e.g. status = Verified) → KPIs and charts recompute. Set an
impossible date range → everything reads zero with an empty state (no fake statistics).

### 1:30 — AI detection (2 min)

1. Open **AI detection**, upload `data/samples/sample_cracked_road_02.jpg`.
2. Show the annotated image, class label, confidence, box coordinates and latency.
3. Upload a flat/greyscale image → **0 detections**. "No invented boxes."
4. Optional: stop the API, rename the weights file, restart → upload returns an honest 503
   with setup instructions. Rename back.

### 3:30 — Full report flow (2 min)

1. Press **Turn into a report**.
2. Click **Use my GPS location** — explain the permission prompt; deny it to show that manual
   pin placement still works.
3. Click the map to drop the pin, add a road name and description, submit.
4. Show the generated reference (`RG-YYMMDD-XXXX`) and the success panel.

### 5:30 — Map (1 min)

Open **Damage map**: markers coloured by severity, popups with reference, category, date,
confidence, severity, status; the synchronised list; pan/zoom reloads by bounds; "Open in OSM".

### 6:30 — Reviewer workflow (2 min)

1. Sign in as `reviewer@roadguard.demo` / `Reviewer@123`.
2. Open the new report → **Lifecycle action**: under review → verified (with notes).
3. Show the **repair history** timeline and the **audit trail**.
4. Show an invalid jump (submitted → resolved) being rejected by the server.
5. Open **Duplicate assistance** on a demo pair and link one — both records survive.
6. Show the **priority breakdown**: six factors, weights, points; explain that confidence is
   not severity.

### 8:30 — Repair management (1 min)

Board of under review / verified / assigned / in progress / resolved with the verification
queue sorted by priority score.

### 9:30 — Analytics + model performance (1.5 min)

Analytics: distributions, outstanding-by-age, resolution trend, regional table.
Model page: model version, class labels, thresholds, latency, **"Evaluation not yet
available"** — explain that metrics require a real held-out test split and point to
`ml/evaluation/evaluate.py`; mention the publisher's mAP is not reproduced as ours.

### 11:00 — Exports (30 s)

Export CSV/JSON/PDF from the current filter; open the CSV to show the `is_synthetic` column
and the `generated_at` header; open the PDF summary.

### 11:30 — Close with evidence (30 s)

> "54 backend tests, 25 frontend tests, 5 live-API integration tests, a clean production
> build and a restart-persistence proof are all recorded in `docs/TESTING.md`. Known
> limitations are in `README.md` §10."

---

## Likely examiner questions

| Question | Answer |
|---|---|
| How accurate is your model? | "Not measured on this deployment. The bundled weights are community weights; I wrote the evaluation pipeline and the app refuses to display metrics until a real test-split run is imported." |
| What if two people report the same pothole? | "Distance + time + category + perceptual-hash similarity produce suggestions; a reviewer links them, both records and the link are audited. Nothing is auto-merged." |
| Why is confidence not used for severity? | "Confidence measures the model, not the road. Severity is a human judgement; priority is a weighted operational score with the factors shown per report." |
| How do you stop someone marking their own report resolved? | "Role-gated server-side: citizen → 403; only reviewer/admin can transition; every change is stamped with the actor and appears in the audit log." |
| Where is the location coming from? | "GPS with explicit permission, or a manual map pin. A photo only provides coordinates if the camera wrote EXIF GPS; we detect that, tell the user, and strip it on save." |
| Does it scale? | "Not yet: SQLite + in-process rate limiting + a per-process model. The docs describe the PostgreSQL, object-storage and shared-rate-limit path." |
