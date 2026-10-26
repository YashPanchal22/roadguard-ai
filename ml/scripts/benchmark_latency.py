#!/usr/bin/env python3
"""Measure inference latency for the configured model on sample images."""
from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.detection.detector import get_detector  # noqa: E402
from app.detection.validation import to_bgr_array  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", nargs="*", default=None)
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()

    images = args.images or [str(p) for p in sorted((REPO / "data" / "samples").glob("*.jpg"))]
    if not images:
        raise SystemExit("No images supplied and data/samples is empty.")

    detector = get_detector()
    if not detector.available:
        raise SystemExit("Detector unavailable: " + str(detector.info().get("error")))

    latencies: list[float] = []
    for image in images:
        data = Path(image).read_bytes()
        frame = to_bgr_array(data)
        for _ in range(args.runs):
            start = time.perf_counter()
            detector.predict(frame)
            latencies.append((time.perf_counter() - start) * 1000)

    print(f"runs: {len(latencies)}")
    print(f"mean: {statistics.mean(latencies):.1f} ms")
    print(f"median: {statistics.median(latencies):.1f} ms")
    print(f"p95: {sorted(latencies)[max(int(len(latencies) * 0.95) - 1, 0)]:.1f} ms")
    print(f"max: {max(latencies):.1f} ms")


if __name__ == "__main__":
    main()
