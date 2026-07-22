# Rebuilt Hallucination-Coefficient Report

**Status:** Preliminary evidence only — not a confirmed scaling law.

## Models

| Model | Full name | Params | λ | n conditions |
|-------|-----------|--------|---|---------------|
| base | base | 74,000,000 | 45.897 | 8 |
| small | small | 244,000,000 | 48.920 | 8 |
| tiny | tiny | 39,000,000 | 44.275 | 8 |

## Per-Model Summary (mean [95% CI])

| Model | Mean HC | Median HC | λ/HC mean | λ/HC median | Mean WER | Total Reps |
|-------|---------|-----------|-----------|-------------|----------|------------|
| base | 0.274 [0.093, 0.447] | 0.248 | 155.90 [80.92, 286.35] | 96.27 | 0.444 | 0 |
| small | 0.211 [0.063, 0.382] | 0.091 | 146.29 [82.50, 222.42] | 116.79 | 0.389 | 0 |
| tiny | 0.480 [0.143, 0.931] | 0.375 | 82.22 [51.57, 111.87] | 75.83 | 1.986 | 110 |

## Robustness Check: Excluding tir_neg3_rev (tiny 112-token repetition loop)

| Model | Mean HC (excl.) | λ/HC mean (excl.) |
|-------|-----------------|---------------------|
| base | 0.245 | 170.80 |
| small | 0.216 | 105.36 |
| tiny | 0.274 | 97.01 |

## Leave-One-Condition-Out Sensitivity

| Model | Max Δ mean HC | Max Δ mean λ/HC |
|-------|---------------|-----------------|
| base | 0.0514 | 64.30 |
| small | 0.0545 | 40.92 |
| tiny | 0.2057 | 14.79 |

## Hypothesis H6

**Claim:** Within the tested Whisper checkpoint family, larger parameter-count checkpoints are associated with lower unsupported-output, repetition, and speaker-confusion errors under the selected controlled speech-overlap conditions.

**Assessment:** Preliminary evidence consistent with H6; not confirmed.

**Reason:** Only 3 checkpoints were evaluated. Correlation with n=3 is unstable and cannot support a causal claim about pre-training exposure or a general scaling law.

- λ vs mean HC correlation: -0.891 (excl. outlier: -0.985)
- λ vs λ/HC correlation: 0.685 (excl. outlier: -0.069)

## Disclaimers

- This report is descriptive, not causal. It compares three Whisper checkpoints on eight synthetic overlap conditions.
- lambda is log10(params) * log10(680000) and is a unitless capacity proxy, not a direct measure of pre-training exposure to overlapping speech.
- capacity_index (lambda/HC) is an exploratory capacity-normalized inverse-error index, not a measure of awareness.
- Correlation coefficients are computed across n=3 models and are for illustration only; they do not support a scaling law.
- The tir_neg3_rev condition for tiny produced a 112-token 'yeah' repetition loop; statistics excluding this outlier are reported separately.

## Canonical JSON

All displayed values regenerate from `results/hc_experiment/hc_report_rebuilt.json`.

