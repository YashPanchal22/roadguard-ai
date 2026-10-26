---
license: apache-2.0
library_name: ultralytics
tags:
- yolov8
- pothole-detection
- road-distress
- road-damage
- computer-vision
- object-detection
datasets: []
pipeline_tag: object-detection
metrics:
- mAP50: 0.629
- mAP50-95: 0.345
- precision: 0.662
- recall: 0.583
---

# Pothole & Road Distress Detection (YOLOv8s)

Fine-tuned [YOLOv8s](https://github.com/ultralytics/ultralytics) model for detecting 5 types of road surface distress from drone and dashcam imagery.

## Training Data Labels

![Label Distribution](./assets/labels.jpg)
*Distribution of bounding boxes across classes, positions, and sizes in the training set*

![Training Batch Samples](./assets/train_batch0.jpg)
*Example training images with augmented bounding boxes during training*

## Realistic Capabilities

### Where This Model Works Best

| Scenario | Performance | Notes |
|----------|-------------|-------|
| Drone/ aerial road survey | ✅ Good | Model trained on Japan/India drone datasets |
| Dashcam footage | ✅ Good | Standard road-facing camera angles |
| Well-lit conditions | ✅ Good | Training data is mostly daylight |
| **Pothole detection** | **mAP50=0.782** | Best-performing class — distinct visual features |
| Alligator crack detection | mAP50=0.671 | Moderate — interconnected cracks are distinctive |
| Longitudinal/ Transverse cracks | mAP50~0.57 | Harder — thin features, requires good resolution |
| "Other" class (manholes, patches) | mAP50=0.494 | Weakest — too diverse, consider ignoring |

### Limitations

| Limitation | Why |
|------------|-----|
| Poor in heavy rain/ fog | Training data lacks adverse weather |
| Night detection degraded | No night-time training images |
| Thin hairline cracks | May miss cracks thinner than ~5px at 640px input |
| Class imbalance | "Other" class has few examples (965 instances vs 3890 for Longitudinal) |
| Overlapping cracks | Struggles when multiple crack types intersect |
| Very wide potholes (>5m) | Rare in training data |

### Recommended Use

- **Automated road inspection** from drones for municipal maintenance
- **Pre-screening** dashcam footage for pothole alerts
- **Asset management** — quantifying crack density per road segment
- **NOT recommended** for safety-critical real-time braking systems (use as advisory only)

## Model Performance

| Metric | Value |
|--------|-------|
| mAP@0.5 | **0.629** |
| mAP@0.5:0.95 | **0.345** |
| Precision | **0.662** |
| Recall | **0.583** |

### Per-Class Performance

| Class | mAP50 | Precision | Recall |
|-------|-------|-----------|--------|
| Longitudinal Crack | 0.571 | 0.618 | 0.537 |
| Transverse Crack | 0.562 | 0.631 | 0.521 |
| Alligator Crack | 0.671 | 0.663 | 0.639 |
| Pothole | **0.782** | **0.706** | **0.740** |
| Other | 0.494 | 0.628 | 0.451 |

## Classes

```
0: Longitudinal Crack — cracks parallel to road direction (thin, linear)
1: Transverse Crack   — cracks across the road (thin, linear)
2: Alligator Crack    — interconnected web of cracks (fatigue cracking)
3: Pothole            — bowl-shaped depressions (most detectable)
4: Other              — manholes, patches, oil spills, road markings
```

## Quick Usage

```python
from ultralytics import YOLO

model = YOLO("best.pt")
results = model.predict("road_image.jpg", conf=0.25, save=True)
# Results saved to runs/detect/predict/
```

```bash
# CLI
yolo predict model=best.pt source=video.mp4 conf=0.25
yolo predict model=best.onnx source=image.jpg conf=0.25
```

### Adjusting Confidence Threshold

```python
# For pothole detection (high precision) — use conf=0.4
results = model.predict("image.jpg", conf=0.4)

# For crack screening (high recall, more false positives) — use conf=0.15
results = model.predict("image.jpg", conf=0.15)
```

## Model Files

| File | Size | Format |
|------|------|--------|
| `best.pt` | 67 MB | PyTorch (Ultralytics YOLO) |
| `best.onnx` | 45 MB | ONNX (cross-platform) |
| `best.torchscript` | 45 MB | TorchScript (C++ inference) |

## Training Details

- **Base model**: YOLOv8s (COCO pretrained, 11.1M params)
- **Dataset**: RDD (Road Damage Dataset) — 26,869 training images from Japan, India, Czech Republic
- **Epochs**: 76 (stopped by Kaggle 9h time limit, still improving)
- **Input size**: 640×640
- **Hardware**: NVIDIA Tesla T4 (16GB) × 2
- **Batch**: 64
- **Training time**: ~9 hours

Training script: [`training/train_improved.py`](./training/train_improved.py)

## Citation

```bibtex
@misc{pothole-detection-yolov8-2026,
  author = {vinothvikas1987},
  title = {Pothole and Road Distress Detection with YOLOv8s},
  year = {2026},
  publisher = {Hugging Face},
  howpublished = {https://huggingface.co/vinothvikas1987/pothole-detection-yolov8}
}
```

## License

Apache 2.0
