# Sample photographs

`sample_pothole_urban_01.jpg`, `sample_cracked_road_02.jpg` and
`sample_pothole_monsoon_03.jpg` are **AI-generated placeholder photographs** created for
this project. They are not survey imagery and must not be presented as real road evidence.

They exist so that:

* the detector can be demonstrated without exposing anyone's photographs;
* the demo dataset can attach images (a handful of demo reports use them);
* `ml/scripts/predict.py` and `ml/scripts/benchmark_latency.py` have an input by default.

Detection results shown for these files come from a real model run on the file; the parent
demo report is still flagged `is_synthetic = true`.
