# Model Guide — datasets, training, evaluation, deployment

This guide explains how the detector in RoadGuard AI is produced, how to replace it with a
model trained on your own road network, and what you may honestly claim about it.

---

## 1. What ships in this repository

| Item | Value |
|---|---|
| Architecture | YOLOv8s (Ultralytics) |
| Weight file | `data/models/pothole_yolov8.pt` (~64 MB) |
| Source | `vinothvikas1987/pothole-detection-yolov8` (Hugging Face, Apache-2.0) |
| Classes | `Longitudinal Crack`, `Transverse Crack`, `Alligator Crack`, `Pothole`, `Other` |
| Publisher metrics | mAP50 0.629 · mAP50-95 0.345 · precision 0.662 · recall 0.583 (their split, **not measured here**) |
| Inference | CPU, ≈210–250 ms per 1024×1536 photo on the development machine |
| Version label | `ROADGUARD_MODEL_VERSION=pothole-yolov8s-community-v1` |

The application reads the class list **from the weight file at load time**. If you swap in a
model with different labels, the UI, database records and exports follow automatically.
If the labels do not look like road damage (no `pothole`, `crack`, `damage`, `distress`…),
`/model/info` returns a `class_match_warning` and the detection view displays it — a generic
COCO model is never presented as a validated pothole detector.

### Downloading the bundled weights

```bash
curl -L -o data/models/pothole_yolov8.pt \
  https://huggingface.co/vinothvikas1987/pothole-detection-yolov8/resolve/main/best.pt
```

### Missing weights behaviour

* `/detection/analyze` → `503 MODEL_UNAVAILABLE` with `hints[]` (never fake boxes).
* `/model/info` → `available: false`, `error`, `weights_present: false`, `hints[]`.
* UI: detection page and sidebar show the same instructions.

---

## 2. Datasets (licensed, road-damage specific)

Pick one and **record its licence** in your project report.

| Dataset | Content | Licence | Notes |
|---|---|---|---|
| RDD2022 (Road Damage Dataset) | 47k+ images, 6 countries, 4 distress types | CC BY-NC-SA 4.0 (research) | Japan/India/Czech/Norway/US/China; the standard academic benchmark |
| Road Damage Dataset (Maeda et al.) | 9k Japan dashcam images | CC BY 4.0 (check current terms) | Classic 8-class taxonomy |
| Pothole-600 (Kaggle) | 600 pothole images, pixel masks | varies by mirror | Small; good for quick fine-tunes |
| Pothole Detection Dataset (Roboflow Universe) | community uploads | varies per project | Verify licence per project |
| Your own survey | your roads | yours | Most defensible for a pilot |

Reference: Arya et al., *RDD2022: A multi-national image dataset for automatic road damage
detection* (2022); Maeda et al., *Road Damage Detection and Classification Using Deep Neural
Networks with Smartphone Images* (2018).

**Do not** mix licences you cannot honour. **Do not** train on data you scraped from a map
provider's street-level imagery without permission.

### Recommended split

Split **by route / capture session**, not by frame: consecutive dashcam frames are nearly
duplicates and leak between splits.

```
train 70 %   val 20 %   test 10 %
```

Keep a written record: capture dates, roads, device, weather, annotators.

---

## 3. Annotation

* YOLO format: `class_id cx cy w h` normalised to 0–1, one `.txt` per image.
* One tight box per visible defect instance; do not merge multiple potholes.
* Ambiguous/partially visible defects: skip rather than guess.
* Double-annotate 10 % of the set and report inter-annotator agreement (IoU > 0.5 as a match).
* Keep a `classes.txt` and an annotation guidelines document in your repo.

Directory layout expected by `ml/training/train.py` and `ml/evaluation/evaluate.py`:

```
data/dataset/
├── data.yaml
├── images/{train,val,test}/*.jpg
└── labels/{train,val,test}/*.txt
```

```yaml
# data/dataset/data.yaml
name: roadguard-local
path: .            # relative to this file
train: images/train
val: images/val
test: images/test
nc: 5
names:
  0: Longitudinal Crack
  1: Transverse Crack
  2: Alligator Crack
  3: Pothole
  4: Other
```

---

## 4. Training

```bash
pip install -r backend/requirements.txt          # provides ultralytics==8.3.58
python ml/training/train.py --config ml/training/config.yaml
```

`ml/training/config.yaml` pins epochs, image size, batch size, optimizer, augmentation and
seeds so the run is reproducible; `training_manifest.json` is written next to the weights
with the exact configuration, class names and timestamp.

The script copies `best.pt` to `data/models/pothole_yolov8.pt` (or point
`ROADGUARD_MODEL_PATH` elsewhere) and reminds you that **training metrics are not
generalisation evidence**.

---

## 5. Evaluation (this is what the Model performance page shows)

```bash
python ml/evaluation/evaluate.py \
  --weights data/models/pothole_yolov8.pt \
  --data data/dataset/data.yaml \
  --split test

python ml/evaluation/import_results.py --file ml/evaluation/results/eval.json --replace
```

The evaluator:

* refuses to run on an empty split (no fabricated artefacts);
* reports precision, recall, mAP@0.5, mAP@0.5:0.95, per-class metrics, confusion matrix,
  dataset sizes and measured latency;
* writes `ml/evaluation/results/eval.json`, which `import_results.py` stores in the
  `model_evaluations` table;
* the Model performance page then shows real numbers and stops saying
  *"Evaluation not yet available"*.

**Baseline comparison.** Always report a baseline alongside your model, e.g.:

1. A pretrained COCO YOLOv8s without fine-tuning (shows the value of domain training).
2. The previous release of your own model (shows regression/improvement).
3. Optionally a classical CV baseline (thresholding + contours) to demonstrate the
   advantage of learned detectors.

Record all three on the *same* test split with the same thresholds.

---

## 6. Deployment of new weights

1. Copy weights to `data/models/` (or set `ROADGUARD_MODEL_PATH` to an absolute path).
2. Update `ROADGUARD_MODEL_NAME` / `ROADGUARD_MODEL_VERSION` so stored detections remain
   attributable to the model that produced them.
3. Restart the API, or call `POST /api/v1/model/reload` as an admin.
4. Re-check `/api/v1/model/info` (classes, thresholds, load time) and run a smoke detection.

Every stored `Detection` row keeps the `model_version` string, so historical reports always
state which model produced their boxes.

---

## 7. GPU / performance notes

* `ROADGUARD_DEVICE=cpu` by default. `cuda` works when a CUDA build of PyTorch and a
  compatible GPU are present.
* The model is loaded once per process (`get_detector()` singleton); avoid `--reload`
  in production, it doubles memory.
* Measure latency honestly: `python ml/scripts/benchmark_latency.py --runs 5`.

---

## 8. What you may claim

| Claim | Allowed? |
|---|---|
| "We detect five road-distress classes with a fine-tuned YOLOv8s" | ✅ |
| "Local mAP@0.5 is X" (only after importing your own evaluation) | ✅ |
| "The detector finds potholes with 98 % accuracy" (no local evaluation) | ❌ |
| "High confidence means the pothole is dangerous" | ❌ |
| "Validated for all Indian roads" (your test set is Ahmedabad only) | ❌ |
