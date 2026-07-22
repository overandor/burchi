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
│  └─ HALAS 2026 — human-annotated hallucination benchmark (arXiv:2606.23048)
│
├─ SYNTHETIC ERROR GENERATION (not hallucination mitigation)
│  └─ Serai et al. 2021 — generates plausible ASR error sequences from clean text (arXiv:2103.12258)
│     [Terminology collision: uses "hallucination" to mean synthetic error injection,
│      not semantically unsupported fluent output. Not in the hallucination mitigation lineage.]
│
├─ INFERENCE STEERING (no training)
│  ├─ SAE Steering 2026 — encoder activations linearly separable, steer at inference (arXiv:2606.07473)
│  └─ Whisper-CD 2026 — contrastive decoding, clean vs noise logits at inference (arXiv:2603.06193)
│
├─ FINE-TUNING (weight modification)
│  ├─ Calm-Whisper 2025 — fine-tune 3 "crazy" decoder heads, blank labels on noise (arXiv:2505.12969)
│  ├─ Listen Like a Teacher 2025 — encoder layer fusion + distillation (arXiv:2511.14219)
│  └─ Rethinking Entropy Allocation 2026 — multi-stage training to prevent encoder drift (arXiv:2604.08003)
│
├─ ABSTENTION
│  └─ RAS 2026 — PH placeholder token, RL training, reliability metric (arXiv:2604.24278)
│
├─ CONTRASTIVE TRAINING
│  ├─ Whisper-CD 2026 — inference-time, not training (arXiv:2603.06193)
│  └─ POI Contrastive 2026 — code-switching, phonetic near-misses (arXiv:2606.06985)
│
└─ CALIBRATION / CONFIDENCE
   ├─ Confidence Estimation for Attention-based Seq2Seq 2020 (arXiv:2010.11428)
   ├─ Post-hoc temperature scaling 2025 (arXiv:2509.07195)
   ├─ C-Whisper 2025 — word-level confidence scores from decoder (arXiv:2502.13446)
   ├─ Multi-Task Confidence 2021 — joint word/utterance confidence + deletion prediction (arXiv:2104.12870)
   └─ Adaptive loss weighting — META LEARNING WITH ADAPTIVE LOSS WEIGHT for low-resource ASR (IEEE ICASSP 2023)
      [Uncertainty-weighted training and adaptive loss allocation have long precedents
       in ASR, speech processing, and multitask learning. Not novel in the abstract.]
```

## Component-Level Prior Art (Corrected)

| Component | Prior art? | Who | What remains unoccupied |
|---|---|---|---|
| Hallucination signal in encoder | **Yes** | Aparin et al. (arXiv:2606.07473) | Nothing — signal's existence is established |
| Fine-tuning to reduce hallucination | **Yes** | Calm-Whisper (arXiv:2505.12969) | Nothing — weight modification for hallucination reduction is occupied |
| Encoder-side training intervention | **Yes** | Listen Like a Teacher (arXiv:2511.14219) | Nothing — encoder pathway modification with multi-objective training is occupied |
| Abstention / learned uncertainty behavior | **Yes** | RAS (arXiv:2604.24278), Calm-Whisper | Nothing — abstention and reliability-aware training are occupied |
| Contrastive decoding | **Yes** | Whisper-CD (arXiv:2603.06193) | Nothing — inference-time contrastive logits are occupied |
| Contrastive training with plausible negatives | **Partial** | POI (arXiv:2606.06985) — code-switching, not hallucination | Contrastive training with hallucination-targeted plausible language-prior negatives is unoccupied |
| Adaptive loss weighting | **Yes** | META LEARNING WITH ADAPTIVE LOSS WEIGHT (IEEE ICASSP 2023), uncertainty-weighted multitask literature | Nothing — adaptive/uncertainty-dependent weighting is established in ASR and multitask learning |
| Confidence / calibration heads on ASR | **Yes** | arXiv:2010.11428, C-Whisper (arXiv:2502.13446) | Nothing — confidence heads and calibration objectives predate this work |
| Pre-decoding risk head | **No (in ASR)** | Closest analog: Pre-Generation Hallucination Detection in LLMs (arXiv:2606.21917) | Pre-decoding hallucination-risk estimation in ASR specifically |
| Risk estimate as endogenous optimization variable | **No** | — | The risk estimate modulating the training loss itself, not merely reported or used for inference |
| Risk gradients reshaping encoder | **No** | — | Joint optimization where risk-head gradients propagate back through the acoustic encoder |
| Detached vs. joint causal comparison | **No (as ablation for this question)** | Gradient detachment is standard machinery | Its application to isolate risk internalization from risk detection in ASR hallucination |

## What Is NOT Novel

- **Encoder representations encoding hallucination information.** Proven by Aparin et al. (arXiv:2606.07473). They showed Whisper encoder activations are linearly separable for hallucination and used SAE-based steering at inference time. This eliminates any claim to discovering the encoder hallucination signal.
- **Training Whisper to reduce hallucinations.** Calm-Whisper (arXiv:2505.12969) already modifies model weights by identifying and fine-tuning decoder attention heads. "Training Whisper to reduce hallucination" is occupied territory.
- **Encoder-side training intervention with multi-objective losses.** Listen Like a Teacher (arXiv:2511.14219) already modifies the encoder pathway and jointly trains a noisy student against a clean teacher using adaptive layer aggregation and multi-objective distillation. Encoder-side training intervention and multiple hallucination-mitigation losses are occupied.
- **Learned abstention and reliability-aware training.** RAS (arXiv:2604.24278) already trains an ASR system to abstain through supervised bootstrapping and reinforcement learning, with a reliability-informativeness metric. Abstention, explicit uncertainty behavior, and reliability-aware training cannot be claimed.
- **Contrastive methods.** Whisper-CD (arXiv:2603.06193) contrasts ordinary audio-conditioned logits with logits from degraded negatives at inference. POI-aware work (arXiv:2606.06985) performs contrastive Whisper training with acoustically and phonetically plausible negative hypotheses for code-switching.
- **Confidence estimation and calibration in ASR.** Confidence heads, auxiliary correctness prediction, calibration objectives, and uncertainty-guided training already exist (arXiv:2010.11428, arXiv:2502.13446, arXiv:2104.12870). The ancestry-table row saying "calibration loss on risk head: no prior art" is too broad. Confidence heads and calibration objectives predate this work, even though they are not necessarily trained to predict span-level hallucination before decoding.
- **The adaptive formula alone.** Inverse-confidence and uncertainty-dependent weighting functions are mathematically natural and easy to vary. The formula `lambda_eff = lambda_0/(1-h_hat+epsilon)` is not itself the moat.
- **Gradient detachment as an ablation technique.** Gradient-detachment ablations are standard experimental machinery. The detached-versus-joint comparison is not itself a novel algorithm.

## The Candidate Novelty: Closed Training Loop

The real candidate novelty is not any individual component. It is the **closed training loop**:

    x -> E_theta(x) -> h_hat -> lambda_eff(h_hat) -> L_grounding -> nabla_theta

The model predicts, from pre-decoding acoustic representations, its risk of producing unsupported fluent output. That prediction then changes the sample-specific training pressure, and the resulting risk-dependent loss sends gradients back into the acoustic encoder and generation policy.

That is materially different from:

    encoder signal -> detector
    encoder signal -> inference steering
    decoder output -> confidence score
    decoded text -> post-hoc gate
    noisy encoder -> clean-teacher alignment
    uncertain segment -> abstention token

Our mechanism is:

    encoder signal
        |
        v
    hallucination / grounding-risk estimate
        |
        v
    sample-specific optimization pressure
        |
        v
    encoder and decoder representation update
        |
        v
    changed future generation behavior

The adaptive formula `lambda_eff = lambda_0/(1-h_hat+epsilon)` alone is not a strong novelty boundary. It is a particular monotonic transformation of an uncertainty estimate. A reviewer could regard it as a straightforward application of uncertainty-dependent weighting unless the surrounding mechanism and experimental evidence are distinctive.

### The complete training contract

The stronger contribution is not the adaptive formula but the complete training contract:

> **pre-decoding support-risk estimation -> sample-dependent hallucination penalty -> joint encoder adaptation -> explicit abstention behavior -> detached causal control -> source-supported evaluation**

### The causal thesis: risk prediction vs. risk-conditioned representation learning

The strongest experimental contribution is the **stop-gradient counterfactual**:

    Detached:  h_hat = H_phi(stopgrad(E_theta(x)))
    Joint:     h_hat = H_phi(E_theta(x))

Both systems possess the same risk head. Both may learn to predict risk. Only the joint system allows the risk objective and risk-conditioned penalty to alter the encoder.

That comparison asks a precise causal question:

> Does merely knowing the risk predict hallucination, or does allowing that risk signal to reshape the acoustic representation and generation objective reduce unsupported output?

That is much stronger than "our method beats baseline." It separates **detection capability** from **behavioral internalization**.

- **Arm 3** (risk-head-only, detached) asks whether the existing representation already predicts risk.
- **Arm 4** (jointly optimized) asks whether allowing that risk objective to modify the representation and generation policy produces an additional behavioral effect.

That is the actual research contribution.

## The Novelty Hierarchy

The strongest novelty is not the risk head alone. Aparin substantially narrows that territory by demonstrating that encoder activations contain predictive hallucination structure.

It is not fine-tuning alone. Calm-Whisper and Listen Like a Teacher already modify model weights to suppress hallucination.

It is not abstention alone. RAS trains explicit abstention behavior.

It is not contrastive negatives alone. POI contrastive training already constructs plausible acoustically constrained near-misses.

It is not adaptive loss weighting alone. Uncertainty-weighted training and adaptive loss allocation have long precedents in ASR and multitask learning.

The most defensible novelty stack is:

> **Risk-conditioned optimization**
> An explicit pre-decoding grounding-risk estimate controls the magnitude or form of the training objective.

> **Endogenous intervention**
> The risk signal modifies the representations from which it was estimated instead of acting only as an external classifier.

> **Causal gradient ablation**
> Detached and joint variants separate risk observability from risk internalization.

> **Unsupported-output endpoint**
> Evaluation targets fluent output unsupported by the audio, not merely WER, confidence, or non-speech suppression.

## Defensible Novelty Statement

Based on the targeted literature search, we found no directly matching publication that combines all four elements:

1. A hallucination- or grounding-risk head operating on pre-decoding ASR encoder representations.
2. A per-example risk estimate that dynamically weights an unsupported-output or grounding objective during training.
3. Joint gradient flow from that risk-conditioned objective back into the acoustic encoder and generation model.
4. A matched detached-versus-joint experiment designed to isolate internalization from detection.

That supports:

> **We identify an apparently unoccupied intersection between internal hallucination detection and hallucination-mitigating model training: an encoder-side risk estimator used as an endogenous, sample-dependent optimization controller, evaluated through a stop-gradient causal ablation.**

It does **not** yet support:

> "We are definitively the first."

A publishable paper search is not equivalent to exhaustive patent, dissertation, workshop, corporate research, and unpublished-preprint clearance. The accurate wording is "we found no prior work implementing this complete mechanism" and should be accompanied by a documented search protocol.

## Architecture vs. Experiment

> **The next checkpoints are not what makes the work novel. They are what determines whether the proposed novel composition works.**

The architecture is the candidate invention. The detached and jointly optimized checkpoints are the experiment that either validates or falsifies it.

## Decisive Evidence Required

The novelty claim is supported by literature search but not yet by experimental evidence. The decisive artifact is:

1. **Two real Whisper checkpoints** — detached-head and jointly optimized — trained on the same corpus
2. **Evaluated on the same untouched test mixtures**
3. **Showing that joint training reduces unsupported output below what detection alone achieves** (HSR_joint < HSR_detached)
4. **While preserving clean WER and coverage** (delta_WER <= delta, unnecessary abstention <= tau)

Until those checkpoints exist, this is a preregistered protocol with a novel formulation, not a confirmed result.

## First-Mover Risk

The field is moving fast. SAE Steering, Whisper-CD, and RAS all appeared in 2026. Aparin et al. already showed encoder representations carry hallucination signals. Someone could combine that finding with Calm-Whisper's fine-tuning approach and arrive at a similar joint training scheme. The differentiator is not any single component but the **complete closed-loop training contract** with the **detached-vs-joint causal design** that isolates representational internalization from risk detection.

## References

1. arXiv:2401.01572 — Frieski & Shi, "Hallucinations in Neural ASR: Identifying Errors and Hallucinatory Models", 2024
2. arXiv:2606.07473 — Aparin et al., "Whisper Hallucination Detection and Mitigation via Hidden Representation Steering and Sparse AutoEncoders", 2026
3. arXiv:2505.12969 — "Calm-Whisper: Reduce Whisper Hallucination On Non-Speech By Calming Crazy Heads Down", Interspeech 2025
4. arXiv:2511.14219 — "Listen Like a Teacher: Mitigating Whisper Hallucinations using Adaptive Layer Attention and Knowledge Distillation", AAAI 2025
5. arXiv:2604.24278 — "RAS: a Reliability Oriented Metric for Automatic Speech Recognition", 2026
6. arXiv:2603.06193 — "Whisper-CD: Accurate Long-Form Speech Recognition using Multi-Negative Contrastive Decoding", 2026
7. arXiv:2606.06985 — "Contrastive Training with LLM-generated Near-Misses for Robust Code-Switching Speech Recognition", 2026
8. arXiv:2010.11428 — "Confidence Estimation for Attention-based Sequence-to-sequence Models for Speech Recognition", 2020
9. arXiv:2502.13446 — "Adopting Whisper for Confidence Estimation" (C-Whisper), 2025
10. arXiv:2212.04356 — Radford et al., "Robust Speech Recognition via Large-Scale Weak Supervision" (Whisper), 2022
11. arXiv:2508.15882 — "Beyond Transcription: Probing Decoder Representations for Hallucination Detection", 2025
12. arXiv:2604.08003 — "Rethinking Entropy Allocation: Preventing Encoder Representation Drift", 2026
13. arXiv:2606.21917 — "Pre-Generation Hallucination Detection in LLMs", 2026
14. arXiv:2509.07195 — "Post-hoc Temperature Scaling for Whisper Confidence Calibration", 2025
15. arXiv:2104.12870 — "Multi-Task Confidence Estimation for ASR", 2021
16. arXiv:2606.23048 — "HALAS: A Human-Annotated Dataset of Hallucinations of Modern ASR Systems", 2026
17. arXiv:2103.12258 — Serai et al., "Hallucination of speech recognition errors with sequence to sequence learning", 2021 [Terminology collision: synthetic error generation, not hallucination mitigation]
18. IEEE ICASSP 2023 — "META LEARNING WITH ADAPTIVE LOSS WEIGHT FOR LOW-RESOURCE SPEECH RECOGNITION" [Adaptive loss weighting precedent in ASR]
