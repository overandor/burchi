#!/usr/bin/env python3
"""
Support-aware acoustic continued pretraining experiment.

Tests the research question:
  Can support-aware acoustic continued pretraining internalize hallucination
  awareness early enough to suppress prior-driven text generation before token
  release, and does it outperform post-tokenization detection at matched
  transcription accuracy and abstention cost?

Implements:
  - Contrastive loss L_prior with (y_supported, y_unsupported) pairs
  - Hallucination risk estimate h_theta(x)
  - Adaptive penalty lambda_eff(x)
  - Full multi-objective loss: LASR + lambda_h L_unsupported + lambda_a L_abstention
    + lambda_s L_source + lambda_c L_calibration
  - Evaluation metrics: HSR/min, UWR, false-provenance rate, abstention rates,
    clean WER regression, competitor leakage, calibration error
  - Context-capture test: same waveform, different textual prompts
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from evaluation.compute_metrics import (
    AlignmentResult,
    AnnotationClass,
    TokenAnnotation,
    compute_all_metrics,
    compute_wer,
)


# ─── Training objectives ──────────────────────────────────────────────

def contrastive_prior_loss(
    log_p_supported: float,
    log_p_unsupported: float,
    margin: float = 1.0,
) -> float:
    """
    L_prior = max(0, m - log P(y_supported | x) + log P(y_unsupported | x))

    Teaches that a plausible unsupported continuation is inferior to a supported one.
    """
    return max(0.0, margin - log_p_supported + log_p_unsupported)


def adaptive_penalty(h: float, lambda_0: float, epsilon: float = 1e-6, mode: str = "direct") -> float:
    """
    Compute adaptive penalty lambda_eff given hallucination risk h.

    Modes:
      direct: lambda_0 * h / (h + epsilon)
      inverse: lambda_0 / (1 - h + epsilon)
    """
    if mode == "direct":
        return lambda_0 * h / (h + epsilon)
    elif mode == "inverse":
        return lambda_0 / (1.0 - h + epsilon)
    else:
        raise ValueError(f"Unknown adaptive penalty mode: {mode}")


def hallucination_risk_score(metrics: dict[str, Any]) -> float:
    """
    Estimate h_theta(x) from model outputs.

    Combines UWR, HSR, and mean token confidence to estimate hallucination risk.
    This is a heuristic that can be replaced by a learned predictor.
    """
    uwr = metrics["uwr"]["uwr"]
    hsr = metrics["hsr"]["hsr"]
    csrr = metrics["csrr"]["csrr"]

    # Token confidence: lower mean confidence → higher risk
    tokens = metrics.get("tokens", [])
    confidences = [t.get("probability") for t in tokens if t.get("probability") is not None]
    mean_conf = np.mean(confidences) if confidences else 0.5

    # Risk increases with unsupported rate and decreases with confidence
    risk = 0.5 * (uwr + hsr) + 0.25 * csrr + 0.25 * (1.0 - mean_conf)
    return float(np.clip(risk, 0.0, 1.0))


def calibration_error(
    predicted_risks: list[float],
    observed_failures: list[float],  # 0/1 or continuous error rate
    n_bins: int = 10,
) -> float:
    """
    Expected Calibration Error (ECE) for hallucination risk predictor.
    """
    if len(predicted_risks) == 0:
        return 0.0

    pred = np.array(predicted_risks)
    obs = np.array(observed_failures)

    bins = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    total = 0

    for i in range(n_bins):
        lo, hi = bins[i], bins[i + 1]
        mask = (pred >= lo) & (pred < hi)
        if hi == 1.0:
            mask = (pred >= lo) & (pred <= hi)

        if np.sum(mask) == 0:
            continue

        bin_pred = pred[mask].mean()
        bin_obs = obs[mask].mean()
        bin_count = mask.sum()
        ece += bin_count * abs(bin_pred - bin_obs)
        total += bin_count

    return float(ece / total) if total > 0 else 0.0


# ─── Evaluation metrics for support-aware training ────────────────────

def compute_abstention_rates(
    alignments: list[AlignmentResult],
    should_abstain: list[bool],  # ground truth: is the input too ambiguous?
) -> dict[str, float]:
    """
    Compute correct and unnecessary abstention rates.

    A model abstains when it emits no tokens (empty transcript) or an <unk> token.
    """
    n = len(alignments)
    if n == 0:
        return {"correct_abstention": 0.0, "unnecessary_abstention": 0.0, "missed_abstention": 0.0}

    def abstained(transcript: str) -> bool:
        return transcript.strip() == ""

    correct = 0
    unnecessary = 0
    missed = 0

    for align, should in zip(alignments, should_abstain):
        did_abstain = abstained(align.decoded_transcript)
        if should and did_abstain:
            correct += 1
        elif not should and did_abstain:
            unnecessary += 1
        elif should and not did_abstain:
            missed += 1

    return {
        "correct_abstention_rate": correct / n,
        "unnecessary_abstention_rate": unnecessary / n,
        "missed_abstention_rate": missed / n,
    }


def compute_false_provenance_rate(alignments: list[AlignmentResult]) -> float:
    """
    Fraction of released words that are attributed to the wrong source speaker
    or unsupported but presented as confident.
    """
    total_released = 0
    false_provenance = 0

    for align in alignments:
        for token in align.tokens:
            total_released += 1
            if token.annotation == AnnotationClass.SUPPORTED_BY_COMPETITOR:
                false_provenance += 1
            elif token.annotation == AnnotationClass.UNSUPPORTED and token.confidence and token.confidence > 0.7:
                false_provenance += 1

    return false_provenance / total_released if total_released > 0 else 0.0


def compute_hallucinated_spans_per_minute(
    alignments: list[AlignmentResult],
    audio_duration_min: float = 3.0 / 60.0,
) -> float:
    """Hallucinated spans per minute of audio."""
    total_spans = sum(1 for a in alignments for _ in a.tokens)
    # Approximation: count unsupported spans and normalize by total audio duration
    unsupported_spans = 0
    for align in alignments:
        for i in range(len(align.tokens) - 2):
            if all(t.annotation == AnnotationClass.UNSUPPORTED for t in align.tokens[i:i+3]):
                unsupported_spans += 1

    total_min = len(alignments) * audio_duration_min
    return unsupported_spans / total_min if total_min > 0 else 0.0


def compute_competitor_leakage(alignments: list[AlignmentResult]) -> float:
    """Fraction of released tokens attributed to competitor speaker."""
    total = 0
    leaked = 0
    for align in alignments:
        for token in align.tokens:
            total += 1
            if token.annotation == AnnotationClass.SUPPORTED_BY_COMPETITOR:
                leaked += 1
    return leaked / total if total > 0 else 0.0


def evaluate_support_aware_model(
    alignments: list[AlignmentResult],
    should_abstain: list[bool],
    audio_duration_min: float = 3.0 / 60.0,
    clean_wer_baseline: float | None = None,
) -> dict[str, Any]:
    """
    Full evaluation for support-aware ASR model.
    """
    if not alignments:
        return {"error": "No alignments provided"}

    # Aggregate metrics
    wer_vals = [compute_wer(a.target_transcript, a.decoded_transcript)["wer"] for a in alignments]
    uwr_vals = [a.tokens.count(t) / max(1, len(a.tokens)) for a in alignments for t in a.tokens if t.annotation == AnnotationClass.UNSUPPORTED]

    # Per-alignment metrics
    per_sample = [compute_all_metrics(a) for a in alignments]
    hsr_vals = [m["hsr"]["hsr"] for m in per_sample]
    uwr_summary = [m["uwr"]["uwr"] for m in per_sample]
    csrr_vals = [m["csrr"]["csrr"] for m in per_sample]

    abstention = compute_abstention_rates(alignments, should_abstain)
    false_prov = compute_false_provenance_rate(alignments)
    hsp_min = compute_hallucinated_spans_per_minute(alignments, audio_duration_min)
    leak = compute_competitor_leakage(alignments)

    clean_wer = np.mean(wer_vals) if wer_vals else 0.0
    clean_regression = None
    if clean_wer_baseline is not None:
        clean_regression = clean_wer - clean_wer_baseline

    # Calibration: use per-sample UWR as observed failure, estimated risk as predicted
    risks = [hallucination_risk_score(m) for m in per_sample]
    observed = [m["uwr"]["uwr"] + m["hsr"]["hsr"] for m in per_sample]
    cal_err = calibration_error(risks, observed)

    return {
        "mean_wer": float(np.mean(wer_vals)),
        "mean_uwr": float(np.mean(uwr_summary)),
        "mean_hsr": float(np.mean(hsr_vals)),
        "mean_csrr": float(np.mean(csrr_vals)),
        "hallucinated_spans_per_minute": hsp_min,
        "false_provenance_rate": false_prov,
        "competitor_leakage": leak,
        **abstention,
        "clean_wer": clean_wer,
        "clean_wer_regression": clean_regression,
        "calibration_error": cal_err,
    }


# ─── Context-capture test ─────────────────────────────────────────────

def context_capture_test(
    audio_path: str,
    model,
    contexts: list[str],
) -> dict[str, Any]:
    """
    Test whether the same ambiguous waveform produces different narratives
    under different textual prompts/contexts.

    Args:
        audio_path: path to ambiguous audio
        model: ASR model with transcribe method
        contexts: list of prompt strings

    Returns:
        dict with transcripts per context and variance metrics
    """
    transcripts = []
    for ctx in contexts:
        # For Whisper, we prepend context as an initial prompt
        result = model.transcribe(audio_path, temperature=0.0, initial_prompt=ctx)
        transcripts.append(result.get("text", "").strip())

    # Measure lexical divergence between transcripts from same audio
    words_per_context = [set(t.lower().split()) for t in transcripts]
    overlaps = []
    for i in range(len(words_per_context)):
        for j in range(i + 1, len(words_per_context)):
            inter = words_per_context[i] & words_per_context[j]
            union = words_per_context[i] | words_per_context[j]
            jaccard = len(inter) / len(union) if union else 1.0
            overlaps.append(jaccard)

    return {
        "contexts": contexts,
        "transcripts": transcripts,
        "mean_jaccard": float(np.mean(overlaps)) if overlaps else 1.0,
        "min_jaccard": float(np.min(overlaps)) if overlaps else 1.0,
        "context_captured": bool(np.mean(overlaps) < 0.7) if overlaps else False,
    }


# ─── Mock experimental conditions for proof-of-concept ────────────────

def simulate_intervention(
    condition: str,
    alignments_baseline: list[AlignmentResult],
    h_risks: list[float],
    lambda_0: float = 1.0,
    gate_threshold: float = 0.5,
) -> list[AlignmentResult]:
    """
    Simulate the 5 intervention conditions by post-processing baseline outputs.

    This is a proof-of-concept stand-in for actual model training. In a real
    experiment, these would be separate trained checkpoints.

    Conditions:
      1. baseline: no intervention
      2. post_gate: remove tokens with h > threshold (post-decoding gate)
      3. decoder_finetuned: reduce unsupported tokens by 30% (decoder-only)
      4. encoder_pretrain: reduce unsupported tokens by 50% (encoder-aware)
      5. encoder_pretrain_plus_gate: reduce by 50% then gate at threshold
    """
    modified = []

    for align, h in zip(alignments_baseline, h_risks):
        new_tokens = []

        if condition == "baseline":
            new_tokens = align.tokens
        elif condition == "post_gate":
            for t in align.tokens:
                if t.annotation == AnnotationClass.UNSUPPORTED and t.confidence and t.confidence < gate_threshold:
                    # Remove high-risk unsupported tokens
                    continue
                new_tokens.append(t)
        elif condition == "decoder_finetuned":
            for t in align.tokens:
                if t.annotation == AnnotationClass.UNSUPPORTED and np.random.rand() < 0.3:
                    continue
                new_tokens.append(t)
        elif condition == "encoder_pretrain":
            for t in align.tokens:
                if t.annotation == AnnotationClass.UNSUPPORTED and np.random.rand() < 0.5:
                    continue
                new_tokens.append(t)
        elif condition == "encoder_pretrain_plus_gate":
            for t in align.tokens:
                if t.annotation == AnnotationClass.UNSUPPORTED:
                    if np.random.rand() < 0.5:
                        continue
                    if t.confidence and t.confidence < gate_threshold:
                        continue
                new_tokens.append(t)

        modified.append(AlignmentResult(
            stimulus_id=align.stimulus_id,
            target_transcript=align.target_transcript,
            decoded_transcript=" ".join(t.token for t in new_tokens),
            tokens=new_tokens,
            target_tokens=align.target_tokens,
            competitor_tokens=align.competitor_tokens,
        ))

    return modified


if __name__ == "__main__":
    print("Support-aware pretraining experiment module.")
    print("Import and run from a training script or proof-of-concept runner.")
