# Repair priority — formula, factors and limitations

RoadGuard AI keeps three ideas strictly separate:

| Concept | Meaning | Source |
|---|---|---|
| **AI confidence** | How sure the *model* is that a bounding box contains its class | model output |
| **Reviewed severity** | How serious the damage is judged to be | human reviewer (or citizen estimate, pending review) |
| **Repair priority** | Operational ordering for repair work | weighted score below |

> A 0.97-confidence detection of a shallow crack is not a dangerous road. Confidence is
> never fed into severity, and never dominates priority.

---

## Formula

For each report, every **available** factor is normalised to 0–1 and combined:

```
priority = 100 × Σ (normalised_i × weight_i) / Σ (weight_i for available factors)
```

Renormalising over *available* factors means a report is never penalised for information
nobody could provide (e.g. no reviewer severity yet, or no location for proximity analysis).
The per-factor points contribution is stored with every report and shown in the UI.

### Factors and default weights

| Factor | Weight | Normalisation | Notes |
|---|---|---|---|
| Reviewed severity | 0.34 | low 0.25 / medium 0.50 / high 0.78 / critical 1.00 | excluded entirely when unreviewed — **not** treated as "low" |
| Damage category | 0.16 | pothole 0.85, alligator 0.75, broken surface 0.70, transverse 0.50, longitudinal 0.40, other 0.30 | structural, fast-worsening categories rank higher |
| Road importance | 0.14 | local 0.30 / collector 0.50 / arterial 0.80 / highway 1.00 | flag shown as user/source-provided, **unverified** |
| Detected damage size | 0.12 | largest detection area ÷ 15 % of frame, capped at 1 | from real bounding boxes |
| Age of unresolved report | 0.12 | days open ÷ `ROADGUARD_PRIORITY_AGE_FULL_DAYS` (30) | zero for resolved/rejected |
| Nearby verified reports | 0.12 | count(same area, 250 m, 60 days) ÷ 4, capped | repeat damage = higher real-world impact |

Bands: `≥75 critical`, `≥55 high`, `≥35 medium`, `<35 low`.

Configuration: `ROADGUARD_PRIORITY_*` environment variables, or an administrator can change
weights at runtime in **Settings → Repair priority configuration**
(`PUT /api/v1/settings/priority`, which also recomputes all stored scores).

---

## Worked example

A verified pothole, arterial road, 21 days open, one nearby verified report, no detection
geometry (photo-only report):

| Factor | normalised | weight | points |
|---|---|---|---|
| Severity (high) | 0.78 | 0.34 | 26.5 |
| Category (pothole) | 0.85 | 0.16 | 13.6 |
| Road importance (arterial) | 0.80 | 0.14 | 11.2 |
| Damage size | unavailable | — | 0.0 (excluded) |
| Age (21/30 days) | 0.70 | 0.12 | 9.5 |
| Nearby verified | 0.25 | 0.12 | 3.1 |
| **Total** (renormalised over 0.88 weight) | | | **≈ 61.7** |

The same report appears in the UI with those six rows, their explanations and the total.

---

## Limitations (state these in your report)

1. **Severity is a judgement.** It comes from a reviewer or a citizen estimate, not a
   measurement of depth, geometry or traffic load.
2. **Missing data changes the denominator.** Two reports with the same physical damage can
   score differently if one has a location and the other does not. This is honest
   (unknown ≠ safe) but not directly comparable.
3. **Repeat-density is a proxy.** Nearby verified reports approximate local impact; they are
   not traffic counts or accident data.
4. **Road importance is user-provided.** Only authoritative road-classification data makes it
   trustworthy; the UI labels it as unverified.
5. **Weights are configuration, not ground truth.** They encode a policy choice. Change them
   deliberately and document the change.
6. **No proximity-to-sensitive-locations factor** is implemented (schools, hospitals). It was
   intentionally left out because it requires a reliable POI source; adding it without one
   would mean inventing data.
7. **Priority ≠ safety certification.** Verified human judgement and engineering assessment
   are required before any official maintenance decision.
