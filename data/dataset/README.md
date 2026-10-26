# Dataset directory

This folder is a **skeleton**. No licensed road-damage imagery is distributed with the
repository — download or collect it yourself and record the licence.

```
data/dataset/
├── data.yaml
├── images/{train,val,test}/*.jpg
└── labels/{train,val,test}/*.txt      # YOLO format: class cx cy w h (normalised)
```

Steps:

1. Choose a licensed dataset (see `docs/MODEL_GUIDE.md` §2).
2. Split **by capture route/session**, not by frame: 70 / 20 / 10.
3. Annotate or convert annotations to YOLO format; review 10 % twice for agreement.
4. Update `data.yaml` (`nc` and `names` must match your classes exactly).
5. Train: `python ml/training/train.py --config ml/training/config.yaml`
6. Evaluate: `python ml/evaluation/evaluate.py --split test`
7. Import metrics: `python ml/evaluation/import_results.py --file ml/evaluation/results/eval.json`
8. Point the API at the new weights and restart (or `POST /api/v1/model/reload`).

The evaluator refuses to run on an empty split — there are no placeholder metrics anywhere
in this project.
