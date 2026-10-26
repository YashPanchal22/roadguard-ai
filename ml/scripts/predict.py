#!/usr/bin/env python3
"""Run the configured detector on local images and save annotated copies.

    python ml/scripts/predict.py --images data/samples/*.jpg --out /tmp/predictions
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.detection.detector import get_detector  # noqa: E402
from app.detection.validation import to_bgr_array, validate_upload  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--images", nargs="+", required=True)
    parser.add_argument("--out", default="/tmp/roadguard-predictions")
    parser.add_argument("--conf", type=float, default=None)
    args = parser.parse_args()

    import cv2

    detector = get_detector()
    if not detector.available:
        raise SystemExit(
            "Detector unavailable: " + str(detector.info().get("error")) + "\n" + "\n".join(detector.info()["hints"])
        )

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = []
    for image_path in args.images:
        path = Path(image_path)
        validated = validate_upload(filename=path.name, content_type=None, data=path.read_bytes())
        result = detector.predict(to_bgr_array(validated.data), conf=args.conf)
        target = out_dir / f"{path.stem}_annotated.jpg"
        cv2.imwrite(str(target), result.annotated_bgr)
        entry = {
            "image": path.name,
            "detections": [d.as_dict() for d in result.detections],
            "latency_ms": result.latency_ms,
            "annotated": str(target),
        }
        summary.append(entry)
        print(json.dumps(entry, indent=2))
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
