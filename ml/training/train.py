#!/usr/bin/env python3
"""Fine-tune a YOLOv8 detector on an annotated road-damage dataset.

Usage
-----
    python ml/training/train.py --config ml/training/config.yaml
    python ml/training/train.py --config ml/training/config.yaml --device 0 --epochs 150

The resulting weights land in ``runs/train/roadguard-yolov8s/weights/best.pt``.
Copy them to ``data/models/pothole_yolov8.pt`` (or point ROADGUARD_MODEL_PATH at
them) and restart the API.

Why this script exists
----------------------
The bundled weights are community weights. To make claims about *your* road
network you must train or fine-tune on your own annotated imagery and evaluate
on a held-out split (see ml/evaluation/evaluate.py).
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=str(REPO / "ml" / "training" / "config.yaml"))
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--imgsz", type=int, default=None)
    parser.add_argument("--device", default=None)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    config = yaml.safe_load(Path(args.config).read_text())
    config_path = Path(args.config)
    if args.epochs:
        config["epochs"] = args.epochs
    if args.imgsz:
        config["imgsz"] = args.imgsz
    if args.device:
        config["device"] = args.device

    data_yaml = Path(config["data"])
    if not data_yaml.is_absolute():
        data_yaml = (config_path.parent / data_yaml).resolve()
    if not data_yaml.is_file():
        raise SystemExit(
            f"Dataset config not found: {data_yaml}\n"
            "Prepare a YOLO-format dataset first (see docs/MODEL_GUIDE.md) with:\n"
            "  data/dataset/data.yaml\n"
            "  data/dataset/images/{train,val,test}/\n"
            "  data/dataset/labels/{train,val,test}/\n"
        )

    from ultralytics import YOLO  # imported lazily

    model = YOLO(config["model"] if Path(config["model"]).suffix == ".pt" and not Path(config["model"]).exists() else config["model"])
    train_kwargs = {
        key: value
        for key, value in config.items()
        if key not in {"model", "data", "project", "name"}
    }
    started = datetime.now(timezone.utc)
    results = model.train(data=str(data_yaml), project=str(REPO / config["project"]), name=config["name"], **train_kwargs)

    save_dir = Path(getattr(results, "save_dir", REPO / config["project"] / config["name"]))
    best = save_dir / "weights" / "best.pt"
    manifest = {
        "trained_at": started.isoformat(),
        "config": config,
        "data_yaml": str(data_yaml),
        "save_dir": str(save_dir),
        "best_weights": str(best) if best.exists() else None,
        "class_names": getattr(model, "names", {}),
        "note": "Always evaluate on the held-out test split; training metrics are not generalisation evidence.",
    }
    (save_dir / "training_manifest.json").write_text(json.dumps(manifest, indent=2, default=str))
    if best.exists():
        target = REPO / "data" / "models" / "pothole_yolov8.pt"
        shutil.copy2(best, target)
        print(f"copied best weights -> {target}")
    print(json.dumps(manifest, indent=2, default=str))


if __name__ == "__main__":
    main()
