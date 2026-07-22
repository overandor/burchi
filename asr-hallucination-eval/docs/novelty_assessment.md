# Novelty Assessment and Literature Ancestry

## Ancestry Tree

```
ASR Hallucination Research
│
├─ POST-DETECTION (oldest, crowded)
│  ├─ Frieski & Shi 2024 — perturbation metrics (arXiv:2401.01572)
│  ├─ Koenecke 2024 — harm catalog
│  ├─ Barański 2025 — non-speech phrase catalogs
│  ├─ Glazer 2025 — decoder-embedding classifier
│  └─ HALAS 2026 — human-annotated dataset
│
├─ INFERENCE STEERING (no training)
│  ├─ SAE Steering 2026 — encoder activations linearly separable, steer at inference (arXiv:2606.07473)
│  └─ Whisper-CD 2026 — contrastive decoding (clean vs noise logits)
│
├─ FINE-TUNING (weight modification)
│  ├─ Calm-Whisper 2025 — fine-tune 3 "crazy" decoder heads, blank labels on noise
│  ├─ ALA+KD 2025 — encoder layer fusion + distillation (arXiv:2511.14219)
│  └─ Serai 2021 — augment with hallucinated transcripts
│
├─ ABSTENTION
│  └─ RAS 2026 — PH placeholder token, RL training, reliability metric
│
├─ CONTRASTIVE TRAINING
│  ├─ Whisper-CD 2026 — inference-time, not training
│  └─ POI Contrastive 2026 — code-switching, phonetic near-misses
│
└─ CALIBRATION
   ├─ Post-hoc temperature scaling 2025 (arXiv:2509.07195)
   └─ SR-CEM 2024 — beam-search confidence estimation
```

## Component-Level Prior Art

| Component | Prior art? | Who | Key difference from our work |
|---|---|---|---|
| Hallucination signal in encoder | **Yes** | SAE Steering (arXiv:2606.07473) | They steer at inference; we train the encoder to produce and use the signal |
| Fine-tuning to reduce hallucination | **Yes** | Calm-Whisper (Interspeech 2025) | They fine-tune decoder heads only; we co-optimize encoder + risk head + decoder |
| Abstention / empty output on noise | **Yes** | RAS 2026, Calm-Whisper 2025 | They use RL or blank labels; we use adaptive loss penalty |
| Contrastive decoding | **Yes** | Whisper-CD 2026 | Inference-time; ours is training-time |
| Contrastive training with plausible negatives | **Partial** | POI 2026 (code-switching) | Different domain; our negatives are plausible language-prior continuations |
| Adaptive loss weighting | **Partial** | AdaKD 2024 (distillation difficulty) | Adjusts output sharpness over time; ours is per-sample hallucination risk |
| Calibration loss on risk head | **No** | — | Novel |
| Pre-decoding risk head + adaptive penalty λ_eff = λ₀/(1−ĥ+ε) | **No** | — | Novel |
| Joint training: risk head gradients flow back to encoder | **No** | — | Novel |
| Critical detached vs. joint comparison | **No** | — | Novel |

## Detailed Prior Art Analysis

### Encoder representations contain hallucination signal (proven, not our contribution)

- **Aparin et al. (arXiv:2606.07473)** — Showed hallucination info is linearly separable in Whisper encoder activations. Used SAE-based steering at inference time to reduce hallucination rate from 72.6% → 14.1% on non-speech. No training change, no risk head, no adaptive loss. This is the strongest prior evidence that our approach is feasible.
- **Beyond Transcription (arXiv:2508.15882)** — Linear probing of decoder residual stream achieves 93.4% hallucination detection accuracy. Analysis only, no training intervention.

### Fine-tuning Whisper to reduce hallucinations (training changes, but different mechanism)

- **Calm-Whisper (Interspeech 2025)** — Identified 3 "crazy heads" in decoder responsible for 75% of hallucinations, fine-tuned only those heads on non-speech with blank labels. 80% hallucination reduction, <0.1% WER degradation. No risk estimation, no adaptive loss, no encoder-side intervention.
- **Listen Like a Teacher (AAAI 2026, arXiv:2511.14219)** — Adaptive Layer Attention on encoder + knowledge distillation from clean teacher. Addresses hallucination via representation alignment. No explicit risk head, no adaptive penalty, no detached-vs-joint comparison.
- **Rethinking Entropy Allocation (arXiv:2604.08003)** — Multi-stage training to prevent encoder representation drift in LLM-based ASR. Monitors drift via CKA. Closest in spirit (encoder-level training intervention) but uses training paradigm redesign, not an explicit risk head with adaptive loss weighting.

### Confidence estimation (post-hoc, not pre-decoding)

- **C-Whisper (arXiv:2502.13446)** — Fine-tuned Whisper decoder to output word-level confidence scores. Post-decoding, not encoder-side, doesn't feed back into training loss.
- **Multi-Task Confidence (arXiv:2104.12870)** — Joint word/utterance confidence + deletion prediction. Confidence as output, not as adaptive training signal.
- **Post-hoc temperature scaling (arXiv:2509.07195)** — Calibration for overconfident Whisper predictions in noise. No training change.

### Pre-generation hallucination detection in LLMs (analogous concept, different domain)

- **Pre-Generation Hallucination Detection (arXiv:2606.21917)** — Attention probing to estimate hallucination risk before generation in LLMs. Closest conceptual analog, but for text LLMs, not ASR, and doesn't use the risk to modulate training loss.

### Acoustic grounding

- **LOOKAHEAD (2023)** — Made text representations more acoustically grounded by extracting lookahead tokens from the audio encoder. Different architecture, different mechanism, no risk head.

## What Is Novel in This Work

Three components not found in the literature:

1. **Encoder-side risk head trained to estimate hallucination probability before decoding, with that estimate feeding back into the training loss.** Existing work either probes/steers at inference (Aparin) or fine-tunes decoder heads (Calm-Whisper). Nobody trains an encoder-representation risk head that modulates the optimization objective.

2. **The adaptive penalty formulation `λ_eff = λ₀ / (1 − ĥ + ε)`.** The closest is AdaMER-CTC's adaptive entropy regularization, but that adjusts output distribution sharpness over training time, not per-sample hallucination risk. The inverse-support formulation — where low acoustic support produces a large penalty against confident textual continuation — is specific to this work.

3. **The 5-arm causal experimental design isolating internalization from detection** (joint vs. detached gradient). This specific experimental protocol — training the same risk head with and without gradient flow to the encoder, then comparing unsupported output reduction — has not been proposed or run in the ASR hallucination literature.

## What Is NOT Novel

- Encoder representations encoding hallucination information (proven by arXiv:2606.07473)
- Fine-tuning Whisper to reduce hallucinations (Calm-Whisper, Listen Like a Teacher)
- The concept that acoustic underdetermination causes hallucination (established across multiple papers)
- Calibration losses for ASR (existing but applied differently)
- Abstention mechanisms for ASR (RAS, Calm-Whisper)

## Honest Assessment

The **premise** (encoder representations contain hallucination signals) is established by Aparin et al. (2025). The **intuition** (use that signal to improve the model) is shared in spirit by Calm-Whisper and Listen Like a Teacher. But the **specific mechanism** — a learned risk head on encoder states that adaptively modulates a composite training loss with contrastive, abstention, calibration, and consistency terms, tested via a joint-vs-detached causal design — is not in the literature.

The gap between "the signal exists in encoder representations" (Aparin, 2025) and "train the encoder to produce that signal and use it to alter generation policy" (this work) is exactly the gap this framework addresses.

## First-Mover Risk

The field is moving fast. SAE Steering, Whisper-CD, and RAS all appeared in 2026. The SAE Steering paper already showed encoder representations carry hallucination signals. Someone could combine that finding with Calm-Whisper's fine-tuning approach and arrive at a similar joint training scheme. The differentiator is the **adaptive penalty formulation** and the **detached-vs-joint experimental design** that isolates causal internalization from mere detection.

## Decisive Evidence Required

The novelty claim is supported by literature search but not yet by experimental evidence. The decisive artifact is:

1. **Two real Whisper checkpoints** — detached-head and jointly optimized — trained on the same corpus
2. **Evaluated on the same untouched test mixtures**
3. **Showing that joint training reduces unsupported output below what detection alone achieves** (HSR_joint < HSR_detached)
4. **While preserving clean WER and coverage** (ΔWER ≤ δ, unnecessary abstention ≤ τ)

Until those checkpoints exist, this is a preregistered protocol with a novel formulation, not a confirmed result.

## References

1. arXiv:2401.01572 — Frieski & Shi, "Hallucinations in Neural ASR: Identifying Errors and Hallucinatory Models", 2024
2. arXiv:2606.07473 — Aparin et al., "Whisper Hallucination Detection and Mitigation via Hidden Representation Steering and Sparse AutoEncoders", 2026
3. arXiv:2511.14219 — "Listen Like a Teacher: Mitigating Whisper Hallucinations using Adaptive Layer Attention and Knowledge Distillation", 2025
4. arXiv:2502.13446 — "Adopting Whisper for Confidence Estimation" (C-Whisper), 2025
5. arXiv:2212.04356 — Radford et al., "Robust Speech Recognition via Large-Scale Weak Supervision" (Whisper), 2022
6. arXiv:2508.15882 — "Beyond Transcription: Probing Decoder Representations for Hallucination Detection", 2025
7. arXiv:2604.08003 — "Rethinking Entropy Allocation: Preventing Encoder Representation Drift", 2026
8. arXiv:2606.21917 — "Pre-Generation Hallucination Detection in LLMs", 2026
9. arXiv:2509.07195 — "Post-hoc Temperature Scaling for Whisper Confidence Calibration", 2025
10. arXiv:2104.12870 — "Multi-Task Confidence Estimation for ASR", 2021
11. Calm-Whisper — Interspeech 2025
12. RAS (Reliability-Aware Abstention) — 2026
13. Whisper-CD (Contrastive Decoding) — 2026
14. POI Contrastive — 2026 (code-switching)
15. LOOKAHEAD — 2023 (acoustic grounding for RNN-T)
