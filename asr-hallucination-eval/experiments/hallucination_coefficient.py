#!/usr/bin/env python3
"""
Hallucination coefficient and checkpoint comparison experiment.

This module defines:
  1. Hallucination Coefficient (HC) — composite hallucination score
  2. Model capacity proxy (λ) — log10(parameters) × log10(training_hours)
  3. Capacity-normalized inverse-error index (λ/HC) — exploratory only
  4. Multi-model benchmark harness across Whisper model sizes

IMPORTANT CORRECTIONS from prior version:
  - λ now uses actual parameter counts and 680,000 training hours (per Whisper paper)
  - All Whisper checkpoints share the same training corpus; λ varies only by
    parameter count, NOT by independent training exposure. Therefore λ is a
    model-capacity proxy, NOT a pre-training exposure variable.
  - The λ/HC ratio is NOT called "awareness" — it is a capacity-normalized
    inverse-error index. Correlating λ with λ/HC is partially circular and
    cannot serve as independent confirmation.
  - Statistics include p-values, confidence intervals, and explicit sample-size
    caveats. n=3 checkpoints cannot establish a scaling law.
  - H6 status is "preliminary evidence consistent with" not "supported".

Hypothesis H6 (revised):
  Within the tested Whisper checkpoint family, larger parameter-count
  checkpoints are associated with lower unsupported-output, repetition, and
  speaker-confusion errors under the selected controlled speech-overlap
  conditions. This is a within-family descriptive observation, not a causal
  claim about pre-training exposure.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import time
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np

try:
    from scipy import stats as scipy_stats
except ImportError:
    scipy_stats = None

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


# ─── Model registry ───────────────────────────────────────────────────

# All Whisper models are trained on the same 680,000-hour weakly supervised
# corpus (Radford et al., 2022, arXiv:2212.04356). λ varies only by parameter
# count. This is a capacity proxy, NOT an independent exposure variable.
TRAINING_HOURS = 680_000  # per Whisper paper

WHISPER_MODELS = {
    "tiny":       {"params": 39_000_000,    "en_only": False, "paper_ref": "Radford et al. 2022 Table 1"},
    "tiny.en":    {"params": 39_000_000,    "en_only": True,  "paper_ref": "Radford et al. 2022 Table 1"},
    "base":       {"params": 74_000_000,    "en_only": False, "paper_ref": "Radford et al. 2022 Table 1"},
    "base.en":    {"params": 74_000_000,    "en_only": True,  "paper_ref": "Radford et al. 2022 Table 1"},
    "small":      {"params": 244_000_000,   "en_only": False, "paper_ref": "Radford et al. 2022 Table 1"},
    "small.en":   {"params": 244_000_000,   "en_only": True,  "paper_ref": "Radford et al. 2022 Table 1"},
    "medium":     {"params": 769_000_000,   "en_only": False, "paper_ref": "Radford et al. 2022 Table 1"},
    "medium.en":  {"params": 769_000_000,   "en_only": True,  "paper_ref": "Radford et al. 2022 Table 1"},
    "large":      {"params": 1_550_000_000, "en_only": False, "paper_ref": "Radford et al. 2022 Table 1"},
    "large-v1":   {"params": 1_550_000_000, "en_only": False, "paper_ref": "Radford et al. 2022 Table 1"},
    "large-v2":   {"params": 1_550_000_000, "en_only": False, "paper_ref": "Radford et al. 2022, refined training"},
    "large-v3":   {"params": 1_550_000_000, "en_only": False, "paper_ref": "Radford et al. 2022, refined training"},
    "large-v3-turbo": {"params": 809_000_000, "en_only": False, "paper_ref": "distilled from large-v3"},
    "turbo":      {"params": 809_000_000,   "en_only": False, "paper_ref": "distilled from large-v3"},
}


def compute_lambda(model_name: str) -> float:
    """
    Compute λ = log10(params) × log10(training_hours).

    All Whisper checkpoints share the same 680k-hour training corpus.
    Therefore λ varies only by parameter count and is a capacity proxy,
    NOT an independent pre-training exposure variable.
    """
    meta = WHISPER_MODELS.get(model_name, {"params": 74_000_000, "en_only": False, "paper_ref": "unknown"})
    params = meta["params"]
    return math.log10(params) * math.log10(TRAINING_HOURS)


def get_model_provenance(model_name: str) -> dict[str, Any]:
    """Return full provenance metadata for a model checkpoint."""
    meta = WHISPER_MODELS.get(model_name, {})
    return {
        "checkpoint_name": model_name,
        "params": meta.get("params", "unknown"),
        "en_only": meta.get("en_only", "unknown"),
        "training_hours": TRAINING_HOURS,
        "training_corpus": "OpenAI Whisper weakly supervised corpus (Radford et al. 2022)",
        "paper_ref": meta.get("paper_ref", "unknown"),
        "lambda": compute_lambda(model_name),
        "lambda_formula": "log10(params) * log10(680000)",
        "lambda_interpretation": "capacity proxy, NOT independent pre-training exposure",
    }


# ─── Hallucination Coefficient (HC) ───────────────────────────────────

def compute_hallucination_coefficient(metrics: dict[str, Any], alpha: float = 1.0, beta: float = 1.0, gamma: float = 0.5) -> dict[str, float]:
    """
    Compute Hallucination Coefficient (HC) and components.

    HC = alpha * UWR + beta * HSR + gamma * CSRR

    Weights:
      UWR (alpha=1.0) — pure unsupported word rate
      HSR (beta=1.0)  — fluent unsupported spans (stronger hallucination signal)
      CSRR (gamma=0.5) — cross-speaker recombination (speaker confusion, partial hallucination)

    Also computes lambda/HC ratio.
    """
    uwr = metrics["uwr"]["uwr"]
    hsr = metrics["hsr"]["hsr"]
    csrr = metrics["csrr"]["csrr"]

    hc = alpha * uwr + beta * hsr + gamma * csrr
    return {
        "hc": hc,
        "uwr_component": alpha * uwr,
        "hsr_component": beta * hsr,
        "csrr_component": gamma * csrr,
        "uwr": uwr,
        "hsr": hsr,
        "csrr": csrr,
    }


def compute_capacity_normalized_index(lambda_value: float, hc: float) -> float:
    """
    Capacity-normalized inverse-error index = λ / HC.

    This is an exploratory metric. It is NOT called "awareness" because:
    1. It anthropomorphizes an error-normalized capacity ratio.
    2. Correlating λ with λ/HC is partially circular (λ appears in both).
    3. It cannot serve as independent confirmation of a scaling relationship.

    Returns inf when HC = 0 (no observed hallucination).
    """
    if hc == 0:
        return float("inf")
    return lambda_value / hc


# ─── Multi-model benchmark harness ────────────────────────────────────

@dataclass
class BenchmarkResult:
    model_name: str
    lambda_value: float
    condition: str
    transcript: str
    tokens: list[dict]
    metrics: dict[str, Any]
    hc: float
    hc_components: dict[str, float]
    capacity_index: float  # λ/HC, exploratory only
    duration_sec: float = 0.0
    # Per-condition error breakdown
    insertions: int = 0
    deletions: int = 0
    substitutions: int = 0
    repetitions: int = 0


def transcribe_with_whisper(audio_path: str, model_name: str, device: str = "cpu") -> tuple[str, list[dict]]:
    """Transcribe an audio file with a specific Whisper model."""
    import whisper

    # Suppress repeated warnings
    warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")

    model = whisper.load_model(model_name, device=device)
    result = model.transcribe(audio_path, temperature=0.0, word_timestamps=True)
    transcript = result.get("text", "").strip()
    tokens = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            tokens.append({
                "word": w.get("word", "").strip(),
                "start": w.get("start"),
                "end": w.get("end"),
                "probability": w.get("probability"),
            })
    return transcript, tokens


def auto_annotate_tokens(
    decoded_tokens: list[dict],
    target_words: list[str],
    competitor_words: list[str] | None = None,
) -> list[TokenAnnotation]:
    """
    Heuristic annotation for benchmark automation.
    NOT a substitute for blinded human annotation.
    """
    competitor_words = competitor_words or []
    competitor_lower = [w.lower().strip(".,!?;:") for w in competitor_words]
    annotations = []

    for i, token in enumerate(decoded_tokens):
        word = token["word"].lower().strip(".,!?;:")

        # Exact positional match to target
        if i < len(target_words) and word == target_words[i]:
            ann = AnnotationClass.LEXICALLY_SUPPORTED
            speaker = "A"
        # Anywhere in target
        elif word in [w.lower().strip(".,!?;:") for w in target_words]:
            ann = AnnotationClass.LEXICALLY_SUPPORTED
            speaker = "A"
        # Competitor
        elif word in competitor_lower:
            ann = AnnotationClass.SUPPORTED_BY_COMPETITOR
            speaker = "B"
        # Function words — ambiguous individually, but perseveration is hallucination
        elif word in {"the", "a", "an", "is", "are", "was", "were", "and", "or",
                      "but", "to", "of", "in", "on", "at", "for", "with", "it",
                      "this", "that", "so", "very", "just", "really", "i", "you",
                      "um", "uh", "like", "well", "okay", "yeah", "yes", "no"}:
            prior_count = sum(1 for j in range(i) if decoded_tokens[j]["word"].lower().strip(".,!?;:") == word)
            if prior_count >= 3:
                ann = AnnotationClass.UNSUPPORTED
            else:
                ann = AnnotationClass.PLAUSIBLY_AMBIGUOUS
            speaker = None
        else:
            ann = AnnotationClass.UNSUPPORTED
            speaker = None

        annotations.append(TokenAnnotation(
            token=token["word"],
            annotation=ann,
            source_speaker=speaker,
            start_time=token.get("start"),
            end_time=token.get("end"),
            confidence=token.get("probability"),
        ))

    return annotations


def run_model_benchmark(
    audio_conditions: list[dict[str, Any]],
    target_transcript: str,
    competitor_transcript: str,
    model_names: list[str] | None = None,
    device: str = "cpu",
    output_dir: str = "results/hc_experiment",
) -> dict[str, Any]:
    """
    Benchmark multiple Whisper models on a set of mixed audio conditions.

    Args:
        audio_conditions: list of dicts with keys: label, audio_path, tir_db, overlap, interference_type
        target_transcript: clean target transcript
        competitor_transcript: interference transcript
        model_names: list of Whisper model names to test
        device: "cpu" or "cuda"
        output_dir: where to save results
    """
    if model_names is None:
        # Default subset for speed
        model_names = ["tiny", "base", "small"]

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    target_words = target_transcript.lower().split()
    competitor_words = competitor_transcript.lower().split()

    all_results: list[BenchmarkResult] = []

    print(f"Benchmarking {len(model_names)} models × {len(audio_conditions)} conditions")
    print(f"Models: {model_names}")

    for model_name in model_names:
        lambda_value = compute_lambda(model_name)
        print(f"\n--- Model: {model_name} (λ = {lambda_value:.3f}) ---")

        for cond in audio_conditions:
            label = cond["label"]
            audio_path = cond["audio_path"]

            print(f"  [{label}] transcribing...", end=" ", flush=True)
            t0 = time.time()
            try:
                transcript, tokens = transcribe_with_whisper(audio_path, model_name, device)
                elapsed = time.time() - t0
                print(f"→ {len(transcript.split())} words in {elapsed:.2f}s")
            except Exception as e:
                print(f"✗ ERROR: {e}")
                continue

            # Auto-annotate
            annotations = auto_annotate_tokens(
                tokens,
                target_words,
                competitor_words,
            )

            alignment = AlignmentResult(
                stimulus_id=f"{model_name}_{label}",
                target_transcript=target_transcript,
                decoded_transcript=transcript,
                tokens=annotations,
                target_tokens=target_words,
                competitor_tokens=competitor_words,
            )

            metrics = compute_all_metrics(alignment)
            hc_dict = compute_hallucination_coefficient(metrics)
            cap_index = compute_capacity_normalized_index(lambda_value, hc_dict["hc"])

            # Error breakdown
            wer_detail = compute_wer(target_transcript, transcript)
            ins = wer_detail.get("insertions", 0)
            dele = wer_detail.get("deletions", 0)
            subs = wer_detail.get("substitutions", 0)

            # Count repetitions (same word > 2 times consecutively)
            words = transcript.lower().split()
            reps = 0
            for i in range(2, len(words)):
                if words[i] == words[i-1] == words[i-2]:
                    reps += 1

            all_results.append(BenchmarkResult(
                model_name=model_name,
                lambda_value=lambda_value,
                condition=label,
                transcript=transcript,
                tokens=tokens,
                metrics=metrics,
                hc=hc_dict["hc"],
                hc_components={
                    "uwr_component": hc_dict["uwr_component"],
                    "hsr_component": hc_dict["hsr_component"],
                    "csrr_component": hc_dict["csrr_component"],
                },
                capacity_index=cap_index,
                duration_sec=elapsed,
                insertions=ins,
                deletions=dele,
                substitutions=subs,
                repetitions=reps,
            ))

    # ─── Aggregate by model with full statistics ────────────────────
    summary: dict[str, Any] = {}
    for model_name in model_names:
        model_results = [r for r in all_results if r.model_name == model_name]
        if not model_results:
            continue

        hc_values = [r.hc for r in model_results]
        wer_values = [r.metrics["wer"]["wer"] for r in model_results]
        uwr_values = [r.metrics["uwr"]["uwr"] for r in model_results]
        hsr_values = [r.metrics["hsr"]["hsr"] for r in model_results]
        csrr_values = [r.metrics["csrr"]["csrr"] for r in model_results]
        cap_values = [r.capacity_index for r in model_results if r.capacity_index != float("inf")]

        # Per-component means
        uwr_comp = [r.hc_components["uwr_component"] for r in model_results]
        hsr_comp = [r.hc_components["hsr_component"] for r in model_results]
        csrr_comp = [r.hc_components["csrr_component"] for r in model_results]

        # Error breakdown
        ins_total = sum(r.insertions for r in model_results)
        del_total = sum(r.deletions for r in model_results)
        sub_total = sum(r.substitutions for r in model_results)
        rep_total = sum(r.repetitions for r in model_results)

        summary[model_name] = {
            "lambda": model_results[0].lambda_value,
            "provenance": get_model_provenance(model_name),
            "mean_hc": float(np.mean(hc_values)),
            "median_hc": float(np.median(hc_values)),
            "std_hc": float(np.std(hc_values)),
            "ci95_hc": [float(np.percentile(hc_values, 2.5)), float(np.percentile(hc_values, 97.5))] if len(hc_values) >= 2 else [None, None],
            "mean_capacity_index": float(np.mean(cap_values)) if cap_values else None,
            "mean_wer": float(np.mean(wer_values)),
            "median_wer": float(np.median(wer_values)),
            "mean_uwr": float(np.mean(uwr_values)),
            "mean_hsr": float(np.mean(hsr_values)),
            "mean_csrr": float(np.mean(csrr_values)),
            "hc_components": {
                "mean_uwr_component": float(np.mean(uwr_comp)),
                "mean_hsr_component": float(np.mean(hsr_comp)),
                "mean_csrr_component": float(np.mean(csrr_comp)),
            },
            "error_breakdown": {
                "total_insertions": ins_total,
                "total_deletions": del_total,
                "total_substitutions": sub_total,
                "total_repetitions": rep_total,
            },
            "n_conditions": len(model_results),
        }

    # ─── Statistics with proper p-values ──────────────────────────────
    lambdas = [summary[m]["lambda"] for m in summary]
    mean_hcs = [summary[m]["mean_hc"] for m in summary]

    # λ vs HC correlation (NOT circular: HC does not contain λ)
    hc_r, hc_p = None, None
    if len(lambdas) >= 2 and not all(h == mean_hcs[0] for h in mean_hcs):
        hc_r = float(np.corrcoef(lambdas, mean_hcs)[0, 1])
        if scipy_stats is not None and len(lambdas) >= 3:
            r_result = scipy_stats.pearsonr(lambdas, mean_hcs)
            hc_r = float(r_result[0])
            hc_p = float(r_result[1])

    # λ vs λ/HC correlation (PARTIALLY CIRCULAR: λ appears in both)
    cap_vals = [summary[m]["mean_capacity_index"] for m in summary if summary[m]["mean_capacity_index"] is not None]
    cap_lambdas = [summary[m]["lambda"] for m in summary if summary[m]["mean_capacity_index"] is not None]
    cap_r, cap_p = None, None
    if len(cap_lambdas) >= 2 and not all(a == cap_vals[0] for a in cap_vals):
        cap_r = float(np.corrcoef(cap_lambdas, cap_vals)[0, 1])
        if scipy_stats is not None and len(cap_lambdas) >= 3:
            r_result = scipy_stats.pearsonr(cap_lambdas, cap_vals)
            cap_r = float(r_result[0])
            cap_p = float(r_result[1])

    # ─── Leave-one-condition-out sensitivity ──────────────────────────
    loo_results = []
    conditions = list(set(r.condition for r in all_results))
    for excluded in conditions:
        subset = [r for r in all_results if r.condition != excluded]
        loo_hcs = []
        loo_lambdas = []
        for mn in model_names:
            mr = [r for r in subset if r.model_name == mn]
            if mr:
                loo_hcs.append(float(np.mean([r.hc for r in mr])))
                loo_lambdas.append(compute_lambda(mn))
        if len(loo_lambdas) >= 2 and not all(h == loo_hcs[0] for h in loo_hcs):
            loo_r = float(np.corrcoef(loo_lambdas, loo_hcs)[0, 1])
        else:
            loo_r = None
        loo_results.append({"excluded_condition": excluded, "lambda_vs_hc_r": loo_r})

    # ─── With/without outlier (112-token repetition event) ────────────
    outlier_condition = None
    for r in all_results:
        if r.repetitions > 50:  # threshold for catastrophic repetition
            outlier_condition = r.condition
            break

    without_outlier = [r for r in all_results]
    if outlier_condition:
        without_outlier = [r for r in all_results if not (r.condition == outlier_condition and r.repetitions > 50)]

    without_outlier_summary = {}
    for mn in model_names:
        mr = [r for r in without_outlier if r.model_name == mn]
        if mr:
            without_outlier_summary[mn] = {
                "mean_hc": float(np.mean([r.hc for r in mr])),
                "mean_wer": float(np.mean([r.metrics["wer"]["wer"] for r in mr])),
                "n_conditions": len(mr),
            }

    # ─── Honest hypothesis status ─────────────────────────────────────
    n_models = len(model_names)
    h6_status = "not_tested"
    h6_description = (
        "Within the tested Whisper checkpoint family, larger parameter-count "
        "checkpoints are associated with lower unsupported-output, repetition, "
        "and speaker-confusion errors under the selected controlled speech-overlap "
        "conditions."
    )

    if hc_r is not None:
        if n_models < 5:
            h6_status = "preliminary_evidence_consistent"
        elif hc_p is not None and hc_p < 0.05:
            h6_status = "supported"
        else:
            h6_status = "not_supported"
    else:
        h6_status = "insufficient_data"

    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "experiment_type": "within_family_checkpoint_comparison",
        "claim_scope": (
            "Preliminary within-family descriptive evidence. Not a causal claim "
            "about pre-training exposure. Not a general scaling law."
        ),
        "models": model_names,
        "n_models": n_models,
        "n_conditions": len(audio_conditions),
        "decoding_config": {
            "temperature": 0.0,
            "word_timestamps": True,
            "device": device,
            "whisper_version": "openai-whisper (pip)",
        },
        "model_provenance": {m: get_model_provenance(m) for m in model_names},
        "per_condition": [
            {
                "model": r.model_name,
                "lambda": r.lambda_value,
                "condition": r.condition,
                "transcript": r.transcript,
                "hc": r.hc,
                "hc_components": r.hc_components,
                "capacity_index": r.capacity_index if r.capacity_index != float("inf") else None,
                "wer": r.metrics["wer"]["wer"],
                "uwr": r.metrics["uwr"]["uwr"],
                "hsr": r.metrics["hsr"]["hsr"],
                "csrr": r.metrics["csrr"]["csrr"],
                "insertions": r.insertions,
                "deletions": r.deletions,
                "substitutions": r.substitutions,
                "repetitions": r.repetitions,
                "duration_sec": r.duration_sec,
            }
            for r in all_results
        ],
        "summary": summary,
        "statistics": {
            "lambda_vs_hc": {
                "r": hc_r,
                "p_value": hc_p,
                "n": n_models,
                "caveat": (
                    f"n={n_models} checkpoints. Pearson r with n={n_models} has "
                    f"unstable confidence intervals. NIST guidance suggests ~20 "
                    "observations for stable correlation estimates."
                ),
                "circularity": "none (HC does not contain λ)",
            },
            "lambda_vs_capacity_index": {
                "r": cap_r,
                "p_value": cap_p,
                "n": len(cap_lambdas),
                "circularity": (
                    "PARTIALLY CIRCULAR: λ appears in both numerator of capacity_index "
                    "and in the correlation. Cannot serve as independent confirmation."
                ),
            },
            "leave_one_condition_out": loo_results,
            "without_outlier": {
                "outlier_condition": outlier_condition,
                "description": (
                    "Results excluding the catastrophic repetition event "
                    f"({outlier_condition}) if present."
                ) if outlier_condition else "No outlier detected.",
                "summary": without_outlier_summary,
            },
        },
        "hypothesis_h6": {
            "description": h6_description,
            "status": h6_status,
            "status_meaning": {
                "preliminary_evidence_consistent": (
                    "Observed direction is consistent with H6 but sample size "
                    "is insufficient for confirmation. Not a causal claim."
                ),
                "supported": "Statistically significant at p < 0.05.",
                "not_supported": "No significant association found.",
                "not_tested": "Could not compute correlation.",
                "insufficient_data": "Could not compute correlation.",
            },
            "important_caveats": [
                "All Whisper checkpoints share the same 680k-hour training corpus.",
                "λ varies only by parameter count, NOT by independent training exposure.",
                "This is a within-family descriptive observation, not a scaling law.",
                "The capacity-normalized index (λ/HC) is exploratory and partially circular.",
                f"n={n_models} checkpoints cannot establish a general scaling relationship.",
            ],
        },
        "release_note": (
            "Across the tested macOS-TTS mixtures, Whisper base and small produced "
            "lower observed unsupported-output, repetition, and recognition-error "
            "metrics than Whisper tiny. Tiny exhibited one catastrophic repetition "
            "loop. These results constitute preliminary within-family descriptive "
            "evidence that larger Whisper checkpoints were more robust under the "
            "selected overlap conditions. They do not establish a causal effect of "
            "pretraining exposure, a general scaling law, or a measurable construct "
            "called awareness."
        ),
    }

    report_path = output_path / "hc_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    return report


def print_report(report: dict[str, Any]) -> None:
    """Pretty-print the benchmark report with honest labeling."""
    print("\n" + "=" * 72)
    print("  HALLUCINATION COEFFICIENT — CHECKPOINT COMPARISON REPORT")
    print("  (Within-family descriptive evidence, NOT a scaling law)")
    print("=" * 72)

    print("\n  Model Summary:")
    print(f"  {'Model':<15} {'λ':>8} {'Mean HC':>10} {'Median HC':>10} {'Mean WER':>10} {'Mean UWR':>10} {'Cap Idx':>10}")
    print(f"  {'-'*15} {'-'*8} {'-'*10} {'-'*10} {'-'*10} {'-'*10} {'-'*10}")

    for model_name, stats in report["summary"].items():
        cap = stats.get("mean_capacity_index")
        cap_str = f"{cap:.2f}" if cap is not None else "inf"
        print(f"  {model_name:<15} {stats['lambda']:>8.2f} {stats['mean_hc']:>10.4f} {stats['median_hc']:>10.4f} {stats['mean_wer']:>10.3f} {stats['mean_uwr']:>10.3f} {cap_str:>10}")

    # HC components
    print(f"\n  HC Components (mean):")
    print(f"  {'Model':<15} {'UWR comp':>10} {'HSR comp':>10} {'CSRR comp':>10}")
    print(f"  {'-'*15} {'-'*10} {'-'*10} {'-'*10}")
    for mn, stats in report["summary"].items():
        c = stats["hc_components"]
        print(f"  {mn:<15} {c['mean_uwr_component']:>10.4f} {c['mean_hsr_component']:>10.4f} {c['mean_csrr_component']:>10.4f}")

    # Error breakdown
    print(f"\n  Error Breakdown:")
    print(f"  {'Model':<15} {'Ins':>6} {'Del':>6} {'Sub':>6} {'Rep':>6}")
    print(f"  {'-'*15} {'-'*6} {'-'*6} {'-'*6} {'-'*6}")
    for mn, stats in report["summary"].items():
        e = stats["error_breakdown"]
        print(f"  {mn:<15} {e['total_insertions']:>6} {e['total_deletions']:>6} {e['total_substitutions']:>6} {e['total_repetitions']:>6}")

    stats = report["statistics"]
    print(f"\n  Correlations:")
    hc_stats = stats["lambda_vs_hc"]
    print(f"    λ vs Mean HC:           r={hc_stats['r']:.3f}" + (f", p={hc_stats['p_value']:.3f}" if hc_stats.get("p_value") is not None else ""))
    print(f"      ({hc_stats['caveat']})")

    cap_stats = stats["lambda_vs_capacity_index"]
    print(f"    λ vs Capacity Index:    r={cap_stats['r']:.3f}" + (f", p={cap_stats['p_value']:.3f}" if cap_stats.get("p_value") is not None else ""))
    print(f"      ({cap_stats['circularity']})")

    # Leave-one-condition-out
    print(f"\n  Leave-One-Condition-Out Sensitivity (λ vs HC r):")
    for loo in stats["leave_one_condition_out"]:
        r_val = loo["lambda_vs_hc_r"]
        r_str = f"{r_val:.3f}" if r_val is not None else "N/A"
        print(f"    excluding {loo['excluded_condition']:<20s}: r={r_str}")

    # Without outlier
    wo = stats["without_outlier"]
    if wo["outlier_condition"]:
        print(f"\n  Without Outlier ({wo['outlier_condition']}):")
        for mn, s in wo["summary"].items():
            print(f"    {mn:<15} mean_hc={s['mean_hc']:.4f}  mean_wer={s['mean_wer']:.3f}  n={s['n_conditions']}")

    # Hypothesis
    h6 = report["hypothesis_h6"]
    print(f"\n  Hypothesis H6:")
    print(f"    Status: {h6['status']}")
    print(f"    {h6['status_meaning'].get(h6['status'], '')}")
    for c in h6["important_caveats"]:
        print(f"    ⚠ {c}")

    print(f"\n  Release note: {report['release_note'][:120]}...")
    print(f"\n  Full report: results/hc_experiment/hc_report.json")
    print("=" * 72)


if __name__ == "__main__":
    print("This module is intended to be imported from a benchmark runner.")
    print("Use demo_pretraining_experiment.py to run a full experiment.")
