#!/usr/bin/env python3
"""Evaluate a YOLO checkpoint on a held-out test split and export metrics.

Usage
-----
    python ml/evaluation/evaluate.py \
        --weights data/models/pothole_yolov8.pt \
        --data data/dataset/data.yaml \
        --split test

Outputs ``ml/evaluation/results/eval.json`` containing precision, recall,
mAP@0.5, mAP@0.5:0.95, per-class metrics, the confusion matrix, per-image
latency and dataset sizes. Import it with ml/evaluation/import_results.py so the
API can display it.

Rules
-----
* Evaluate only on data the model never saw during training.
* Never report training-set metrics as evidence of generalisation.
* The script refuses to write an artefact if the split is empty.
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO / "ml" / "evaluation" / "results"


def count_images(split_dir: Path) -> int:
    if not split_dir.is_dir():
        return 0
    return len([p for p in split_dir.rglob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weights", default=str(REPO / "data" / "models" / "pothole_yolov8.pt"))
    parser.add_argument("--data", default=str(REPO / "data" / "dataset" / "data.yaml"))
    parser.add_argument("--split", default="test")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--conf", type=float, default=0.001, help="Low threshold for mAP computation (standard practice)")
    parser.add_argument("--iou", type=float, default=0.6, help="NMS IoU used during evaluation")
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    weights = Path(args.weights)
    data_yaml = Path(args.data)
    if not weights.is_file():
        raise SystemExit(f"Weights not found: {weights}")
    if not data_yaml.is_file():
        raise SystemExit(f"data.yaml not found: {data_yaml}\nSee docs/MODEL_GUIDE.md to build the dataset.")

    data = yaml.safe_load(data_yaml.read_text())
    split_path = Path(data.get(args.split, ""))
    if not split_path.is_absolute():
        split_path = (data_yaml.parent / data.get(args.split, "")).resolve()
    image_count = count_images(split_path)
    if image_count == 0:
        raise SystemExit(
            f"The '{args.split}' split at {split_path} contains no images. "
            "Refusing to fabricate metrics for an empty evaluation set."
        )

    from ultralytics import YOLO

    model = YOLO(str(weights))
    started = datetime.now(timezone.utc)
    metrics = model.val(data=str(data_yaml), split=args.split, imgsz=args.imgsz, conf=args.conf, iou=args.iou, device=args.device, plots=True)

    class_names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))
    per_class: dict[str, dict[str, float]] = {}
    try:
        p, r, ap50, ap = metrics.box.mp, metrics.box.mr, metrics.box.ap50, metrics.box.ap
        for index, class_id in enumerate(metrics.box.ap_class_index):
            label = class_names.get(int(class_id), str(class_id))
            per_class[label] = {
                "precision": float(p) if not hasattr(p, "__len__") else float(p[index]),
                "recall": float(r) if not hasattr(r, "__len__") else float(r[index]),
                "map50": float(ap50[index]),
                "map50_95": float(ap[index].mean()) if hasattr(ap[index], "mean") else float(ap[index]),
            }
    except Exception as exc:  # pragma: no cover - depends on ultralytics internals
        print(f"per-class extraction skipped: {exc}")

    confusion = None
    if getattr(metrics, "confusion_matrix", None) is not None and getattr(metrics.confusion_matrix, "matrix", None) is not None:
        confusion = {
            "labels": [class_names.get(i, str(i)) for i in range(len(class_names))],
            "matrix": metrics.confusion_matrix.matrix.astype(int).tolist(),
        }

    # Latency: time individual predictions on the first N test images.
    latencies: list[float] = []
    sample_images = sorted([p for p in split_path.rglob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"}])[:20]
    for image in sample_images:
        t0 = time.perf_counter()
        model.predict(source=str(image), imgsz=args.imgsz, device=args.device, verbose=False)
        latencies.append((time.perf_counter() - t0) * 1000)

    instance_count = 0
    label_dir = Path(str(split_path).replace("images", "labels"))
    if label_dir.is_dir():
        for label_file in label_dir.rglob("*.txt"):
            instance_count += len([line for line in label_file.read_text().splitlines() if line.strip()])

    artefact = {
        "model_name": weights.name,
        "model_version": f"{weights.stem}-{started:%Y%m%d}",
        "dataset_name": data.get("name", data_yaml.parent.name),
        "dataset_split": args.split,
        "image_count": image_count,
        "instance_count": instance_count,
        "precision": float(metrics.box.mp),
        "recall": float(metrics.box.mr),
        "map50": float(metrics.box.map50),
        "map50_95": float(metrics.box.map),
        "iou_threshold": 0.5,
        "per_class": per_class or None,
        "confusion_matrix": confusion,
        "latency_ms_mean": round(statistics.mean(latencies), 2) if latencies else None,
        "latency_ms_p95": round(sorted(latencies)[int(len(latencies) * 0.95) - 1], 2) if latencies else None,
        "class_labels": {str(k): v for k, v in class_names.items()},
        "notes": (
            f"Evaluated on the '{args.split}' split ({image_count} images, {instance_count} instances) at "
            f"imgsz={args.imgsz}, conf={args.conf}, iou={args.iou}. Small test sets give wide confidence intervals."
        ),
        "evaluated_at": started.isoformat(),
        "source_file": str(weights),
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / "eval.json"
    output.write_text(json.dumps(artefact, indent=2))
    print(json.dumps({k: v for k, v in artefact.items() if k not in {"per_class", "confusion_matrix"}}, indent=2))
    print(f"\nwritten -> {output}\nnext: python ml/evaluation/import_results.py --file {output}")


if __name__ == "__main__":
    main()
