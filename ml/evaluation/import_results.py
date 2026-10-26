#!/usr/bin/env python3
"""Import an evaluation artefact into the RoadGuard database.

The Model performance page reads from ``model_evaluations``; it shows
"Evaluation not yet available" until a real evaluation is imported.

    python ml/evaluation/import_results.py --file ml/evaluation/results/eval.json
    python ml/evaluation/import_results.py --file ml/evaluation/results/eval.json --replace
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.database.init_db import init_db  # noqa: E402
from app.database.session import SessionLocal  # noqa: E402
from app.models.entities import ModelEvaluation  # noqa: E402
from sqlalchemy import delete  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True)
    parser.add_argument("--replace", action="store_true", help="delete existing evaluation rows first")
    args = parser.parse_args()

    payload = json.loads(Path(args.file).read_text())
    for required in ("model_name", "dataset_name", "precision", "recall", "map50", "map50_95"):
        if required not in payload:
            raise SystemExit(f"artefact missing required key: {required}")

    init_db()
    with SessionLocal() as db:
        if args.replace:
            db.execute(delete(ModelEvaluation))
        row = ModelEvaluation(
            model_name=str(payload["model_name"]),
            model_version=str(payload.get("model_version", "unknown")),
            dataset_name=str(payload["dataset_name"]),
            dataset_split=str(payload.get("dataset_split", "test")),
            image_count=int(payload.get("image_count", 0)),
            instance_count=int(payload.get("instance_count", 0)),
            precision=float(payload["precision"]),
            recall=float(payload["recall"]),
            map50=float(payload["map50"]),
            map50_95=float(payload["map50_95"]),
            iou_threshold=float(payload.get("iou_threshold", 0.5)),
            per_class=payload.get("per_class"),
            confusion_matrix=payload.get("confusion_matrix"),
            latency_ms_mean=payload.get("latency_ms_mean"),
            latency_ms_p95=payload.get("latency_ms_p95"),
            class_labels=payload.get("class_labels"),
            notes=payload.get("notes"),
            source_file=payload.get("source_file"),
            evaluated_at=datetime.fromisoformat(payload["evaluated_at"])
            if payload.get("evaluated_at")
            else datetime.now(timezone.utc),
        )
        db.add(row)
        db.commit()
        print(f"imported evaluation {row.id} ({row.model_name} · mAP50 {row.map50:.3f})")


if __name__ == "__main__":
    main()
