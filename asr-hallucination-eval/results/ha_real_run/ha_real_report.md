# Real End-to-End Hallucination-Aware Pretraining Report

**Model:** whisper-tiny | **Device:** cpu | **Epochs:** 50
**Generated:** 2026-07-22T23:11:26Z

## Gradient Routing Receipts

| Arm | Risk head grad norm | Encoder grad norm |
|-----|---------------------|-------------------|
| Detached | 0.826513 | 0.000000 |
| Joint | 0.906100 | 184.709110 |

## Risk Head Calibration on Real Encoder States

| Condition | Label | Detached h_hat | Joint h_hat |
|-----------|-------|----------------|-------------|
| clean | 0 | 0.1599 | 0.1684 |
| overlap_0db | 0 | 0.4329 | 0.5698 |
| reversed | 1 | 0.9595 | 0.9726 |
| noise | 1 | 0.9985 | 0.9973 |
| silence | 1 | 0.9987 | 0.9983 |
| underdetermined | 1 | 0.3870 | 0.5098 |

## Per-Arm Results

| Arm | Mean HSR | Mean WER | Mean HC | Coverage | Abstentions |
|-----|----------|----------|---------|----------|-------------|
| baseline | 0.1667 | 0.7778 | 0.5279 | 1.00 | 0 |
| post_tokenization_detector | 0.0000 | 0.7778 | 0.6946 | 0.50 | 3 |
| risk_head_only | 0.1667 | 0.7778 | 0.5279 | 1.00 | 0 |
| hallucination_aware_pretrained | 0.0000 | 0.7778 | 0.6946 | 0.50 | 3 |
| combined | 0.0000 | 0.7778 | 0.6946 | 0.50 | 3 |

## Hypothesis Assessment

**HSR pretrained < HSR posthoc:** False (0.0000 vs 0.0000)
**ΔWER ≤ δ:** True (0.0000 vs 0.05)
**Unnecessary abstention ≤ τ:** False (0.5000 vs 0.15)
**Supported:** False

**Critical comparison (joint vs detached):** True
  - Joint HSR: 0.0000
  - Detached HSR: 0.1667

## Limitations

- Only the risk head is trained; Whisper encoder/decoder weights are frozen.
- The 'joint' arm trains the risk head with gradients flowing through the encoder, but with frozen Whisper weights this is a proxy for full joint fine-tuning.
- The corpus is small (6 conditions from 2 TTS sentences). This is a proof-of-pipeline, not a statistically powered experiment.
- The post-decoding filter uses a threshold of 0.5 on the risk head output.
- Full joint fine-tuning of Whisper requires GPU and is out of scope for this run.

## Canonical JSON

All values regenerate from `results/ha_real_run/ha_real_report.json`.

