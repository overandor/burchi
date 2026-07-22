# Hallucination-Aware Pretraining Experiment Protocol

## Preregistered Hypothesis

> A model jointly pretrained to estimate acoustic-support deficiency and adapt its generation loss before textual decoding will produce fewer fluent unsupported spans than an equivalent model protected only by post-decoding detection.

## Decision Criterion

The result counts only when:

- **HSR_pretrained < HSR_posthoc** (fewer hallucinated spans than post-hoc detection)
- **ΔWER_clean ≤ δ** (clean-speech WER degradation within tolerance, δ = 0.05)
- **UnnecessaryAbstentionRate ≤ τ** (not refusing to transcribe recoverable speech, τ = 0.10)

The headline outcome is plotted as a frontier: unsupported-output reduction vs. clean accuracy and retained coverage.

## Formulation

### Pre-decoding risk head

Given encoder output `z = E_θ(x)` (before textual decoding), a risk head predicts:

```
ĥ = H_φ(z) ≈ P(fluent output unsupported | x)
```

### Adaptive loss weighting

Define the acoustic-support coefficient:

```
c = 1 - ĥ + ε
```

Then the effective loss weight is:

```
λ_eff = λ / (c + ε) = λ / (1 - ĥ + ε)
```

As ĥ → 1 (low acoustic support), λ_eff → λ/ε (strong penalty against confident generation).
As ĥ → 0 (high acoustic support), λ_eff → λ (ordinary transcription loss dominates).

### Joint objective

```
L = L_ASR + λ_eff · L_unsupported + λ_a · L_abstain + λ_c · L_clean/noisy_consistency + λ_h · L_risk_calibration
```

| Term | Job |
|------|-----|
| L_ASR | Preserve transcription accuracy when speech is recoverable |
| L_unsupported | Penalize probability assigned to fluent sequences unsupported by any source transcript |
| L_abstain | Teach explicit no-speech/uncertain/cannot-transcribe action under underdetermined input |
| L_clean/noisy_consistency | Make corrupted-input student preserve evidence-supported behavior of clean-input teacher |
| L_risk_calibration | Train pre-decoding head so ĥ corresponds to observed unsupported-output risk |

## Five Arms

| Arm | Description | Risk head | Detached | Joint training | Post-hoc filter |
|-----|-------------|-----------|----------|----------------|-----------------|
| 1. Baseline | Ordinary ASR training and decoding | No | — | No | No |
| 2. Post-tokenization detector | Baseline + detector blocks suspicious output | No | — | No | Yes |
| 3. Risk-head-only | Encoder predicts ĥ, gradient detached from encoder/decoder | Yes | Yes | No | No |
| 4. Hallucination-aware pretrained | Risk head, encoder, decoder optimized jointly | Yes | No | Yes | No |
| 5. Combined | Joint training + post-release HDAR CommitGate | Yes | No | Yes | Yes |

### Critical comparison

**Arm 4 (jointly trained) vs. Arm 3 (detached risk detection)**

If the jointly trained model reduces unsupported output while the detached-head model merely predicts it, that is evidence that awareness was **internalized into the representation and generation policy**, rather than attached as a classifier after the fact.

## Training Corpus

Each clean speech sample generates paired conditions:

| Condition | Audio | Target | Support label |
|-----------|-------|--------|---------------|
| clean | x_clean | y | 0 (supported) |
| overlap | x_overlap | y + source map | 0 (supported) |
| noise | x_noise | y | 0 (supported) |
| reversed | x_reversed | ∅ (ABSTAIN) | 1 (unsupported) |
| silence | x_silence | ∅ (ABSTAIN) | 1 (unsupported) |
| underdetermined | x_underdetermined | ABSTAIN | 1 (unsupported) |

Negative examples are **plausible language-prior continuations** that sound linguistically convincing but are unsupported by the source audio. These teach the distinction between probable language and acoustically licensed language.

Whisper was trained on 680,000 hours of weakly supervised data. The practical experiment uses **hallucination-aware continued pretraining** of the encoder and decoder, not from-scratch retraining.

## Literature Support

1. **Hallucinations in ASR are not adequately characterized by WER** — perturbation reveals models with different hallucination susceptibility despite similar recognition error. [arXiv:2401.01572](https://arxiv.org/abs/2401.01572)
2. **Hallucination-related information exists in Whisper encoder representations** — suggesting a pre-decoding risk signal may be learnable. [arXiv:2606.07473](https://arxiv.org/abs/2606.07473)
3. **Noisy-audio student / clean-audio teacher knowledge distillation reduces hallucination** — direct preliminary support for modifying the trained model. [arXiv:2511.14219](https://arxiv.org/abs/2511.14219)
4. **Whisper can be fine-tuned for confidence estimation** — confidence-related behavior can be learned, not just read from token probabilities. [arXiv:2502.13446](https://arxiv.org/abs/2502.13446)
5. **Whisper original paper** — large-scale weak supervision training. [arXiv:2212.04356](https://arxiv.org/abs/2212.04356)

These results support the experiment's plausibility; they do not substitute for running it.

## Implementation

The experiment scaffold is in `experiments/hallucination_aware_pretraining.py`.

### Running

```bash
python3 experiments/hallucination_aware_pretraining.py \
  --model tiny \
  --device cpu \
  --epochs 3 \
  --out-dir results/hallucination_aware_experiment
```

### Output

- `results/hallucination_aware_experiment/{arm_name}.json` — per-arm results
- `results/hallucination_aware_experiment/experiment_report.json` — combined report with hypothesis assessment

## Status

**Protocol preregistered. Experiment scaffold implemented. Not yet run with full Whisper fine-tuning.**

The training loop is structurally complete but the inner batch loop (mel spectrogram → encoder → decoder → loss → backward) requires full Whisper model integration. The risk head, joint loss, corpus generation, and 5-arm evaluation protocol are all functional.
