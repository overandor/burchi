#!/usr/bin/env python3
"""
Replay an existing hc_report.json through the corrected metric pipeline.

This avoids re-running Whisper. It takes the raw transcripts from the prior
run, recomputes all metrics using the current (corrected) code in
hallucination_coefficient.py and compute_metrics.py, and emits a canonical
rebuilt report with honest terminology, CIs, sensitivity, and outlier handling.
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from evaluation.compute_metrics import AlignmentResult, TokenAnnotation, compute_all_metrics, compute_wer
from experiments.hallucination_coefficient import (
    auto_annotate_tokens,
    compute_capacity_normalized_index,
    compute_hallucination_coefficient,
    compute_lambda,
    get_model_provenance,
)

TARGET_TRANSCRIPT = "The quick brown fox jumps over the lazy dog"
COMPETITOR_TRANSCRIPT = "The cat sat on the mat today"

REPORT_IN = PROJECT_ROOT / "results" / "hc_experiment" / "hc_report.json"
REPORT_OUT = PROJECT_ROOT / "results" / "hc_experiment" / "hc_report_rebuilt.json"
SUMMARY_OUT = PROJECT_ROOT / "results" / "hc_experiment" / "hc_report_rebuilt.md"


def _mean(values: list[float]) -> float:
    return float(np.mean(values)) if values else 0.0


def _std(values: list[float]) -> float:
    return float(np.std(values, ddof=1)) if len(values) > 1 else 0.0


def _median(values: list[float]) -> float:
    return float(np.median(values)) if values else 0.0


def _ci95(values: list[float]) -> tuple[float, float]:
    if not values:
        return (0.0, 0.0)
    arr = np.array(values, dtype=float)
    if len(arr) == 1:
        return (float(arr[0]), float(arr[0]))
    rng = np.random.default_rng(0)
    boots = [np.mean(rng.choice(arr, size=len(arr), replace=True)) for _ in range(2000)]
    return float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))


def _recompute(transcript: str, condition: str, model: str) -> dict[str, Any]:
    target_words = TARGET_TRANSCRIPT.lower().split()
    competitor_words = COMPETITOR_TRANSCRIPT.lower().split()
    words = transcript.split()
    tokens = [{"word": w, "probability": None} for w in words]
    annotations = auto_annotate_tokens(tokens, target_words, competitor_words)
    alignment = AlignmentResult(
        stimulus_id=f"{model}_{condition}",
        target_transcript=TARGET_TRANSCRIPT,
        decoded_transcript=transcript,
        tokens=annotations,
        target_tokens=target_words,
        competitor_tokens=competitor_words,
    )
    metrics = compute_all_metrics(alignment)
    hc_dict = compute_hallucination_coefficient(metrics)
    lambda_value = compute_lambda(model)
    cap_index = compute_capacity_normalized_index(lambda_value, hc_dict["hc"])
    wer_detail = compute_wer(TARGET_TRANSCRIPT, transcript)

    reps = 0
    lowered = [w.lower().strip(".,!?;:") for w in words]
    for i in range(2, len(lowered)):
        if lowered[i] == lowered[i - 1] == lowered[i - 2]:
            reps += 1

    return {
        "model": model,
        "model_full_name": f"openai/whisper-{model}",
        "condition": condition,
        "transcript": transcript,
        "target_transcript": TARGET_TRANSCRIPT,
        "competitor_transcript": COMPETITOR_TRANSCRIPT,
        "lambda": lambda_value,
        "provenance": get_model_provenance(model),
        "hc": hc_dict["hc"],
        "hc_components": {
            "uwr_component": hc_dict["uwr_component"],
            "hsr_component": hc_dict["hsr_component"],
            "csrr_component": hc_dict["csrr_component"],
        },
        "uwr": metrics["uwr"]["uwr"],
        "hsr": metrics["hsr"]["hsr"],
        "csrr": metrics["csrr"]["csrr"],
        "wer": wer_detail["wer"],
        "wer_components": {
            "substitutions": wer_detail["substitutions"],
            "insertions": wer_detail["insertions"],
            "deletions": wer_detail["deletions"],
            "ref_words": wer_detail["ref_words"],
            "hyp_words": wer_detail["hyp_words"],
        },
        "capacity_index": cap_index if cap_index != float("inf") else None,
        "repetitions": reps,
    }


def _model_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    hc = [r["hc"] for r in rows]
    cap = [r["capacity_index"] for r in rows if r["capacity_index"] is not None]
    wer = [r["wer"] for r in rows]
    uwr = [r["uwr"] for r in rows]
    hsr = [r["hsr"] for r in rows]
    csrr = [r["csrr"] for r in rows]
    reps = [r["repetitions"] for r in rows]
    return {
        "lambda": rows[0]["lambda"],
        "provenance": rows[0]["provenance"],
        "n_conditions": len(rows),
        "hc": {"mean": _mean(hc), "median": _median(hc), "std": _std(hc), "ci95": _ci95(hc), "min": min(hc), "max": max(hc)},
        "capacity_index": {"mean": _mean(cap), "median": _median(cap), "std": _std(cap), "ci95": _ci95(cap), "min": min(cap), "max": max(cap)},
        "wer": {"mean": _mean(wer), "median": _median(wer), "std": _std(wer), "ci95": _ci95(wer), "min": min(wer), "max": max(wer)},
        "uwr": {"mean": _mean(uwr), "median": _median(uwr), "std": _std(uwr)},
        "hsr": {"mean": _mean(hsr), "median": _median(hsr), "std": _std(hsr)},
        "csrr": {"mean": _mean(csrr), "median": _median(csrr), "std": _std(csrr)},
        "repetitions": {"total": sum(reps), "mean": _mean(reps)},
    }


def main() -> int:
    raw = json.loads(REPORT_IN.read_text())

    per_condition = []
    for r in raw["per_condition"]:
        row = _recompute(r["transcript"], r["condition"], r["model"])
        per_condition.append(row)

    by_model: dict[str, list[dict[str, Any]]] = {}
    for row in per_condition:
        by_model.setdefault(row["model"], []).append(row)

    models = sorted(by_model.keys())
    summary = {m: _model_stats(by_model[m]) for m in models}

    # Outlier exclusion (tiny tir_neg3_rev 112-token repetition)
    by_model_excl = {m: [r for r in rows if r["condition"] != "tir_neg3_rev"] for m, rows in by_model.items()}
    summary_excl = {m: _model_stats(rows) for m, rows in by_model_excl.items() if rows}

    # Leave-one-out sensitivity
    def loo(values: dict[str, list[float]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for m, arr in values.items():
            if len(arr) <= 1:
                out[m] = {"mean_full": _mean(arr), "max_delta": 0.0}
                continue
            full = _mean(arr)
            loo_means = [_mean(arr[:i] + arr[i + 1 :]) for i in range(len(arr))]
            out[m] = {"mean_full": full, "max_delta": max(abs(full - x) for x in loo_means), "condition_deltas": [abs(full - x) for x in loo_means]}
        return out

    hc_loo = loo({m: [r["hc"] for r in rows] for m, rows in by_model.items()})
    cap_loo = loo({m: [r["capacity_index"] for r in rows if r["capacity_index"] is not None] for m, rows in by_model.items()})

    lambdas = [summary[m]["lambda"] for m in models]
    mean_hcs = [summary[m]["hc"]["mean"] for m in models]
    mean_caps = [summary[m]["capacity_index"]["mean"] for m in models]

    def corr(x: list[float], y: list[float]) -> float:
        if len(x) < 3 or len(set(x)) == 1 or len(set(y)) == 1:
            return 0.0
        return float(np.corrcoef(x, y)[0, 1])

    hc_corr = corr(lambdas, mean_hcs)
    cap_corr = corr(lambdas, mean_caps)
    hc_corr_excl = corr(
        [summary_excl[m]["lambda"] for m in sorted(summary_excl.keys())],
        [summary_excl[m]["hc"]["mean"] for m in sorted(summary_excl.keys())],
    )
    cap_corr_excl = corr(
        [summary_excl[m]["lambda"] for m in sorted(summary_excl.keys())],
        [summary_excl[m]["capacity_index"]["mean"] for m in sorted(summary_excl.keys())],
    )

    preliminary = hc_corr < -0.3 and cap_corr > 0.3

    h6 = {
        "claim": (
            "Within the tested Whisper checkpoint family, larger parameter-count checkpoints "
            "are associated with lower unsupported-output, repetition, and speaker-confusion "
            "errors under the selected controlled speech-overlap conditions."
        ),
        "assessment": "Preliminary evidence consistent with H6; not confirmed." if preliminary else "Not supported by this limited sample.",
        "reason": (
            "Only 3 checkpoints were evaluated. Correlation with n=3 is unstable and cannot "
            "support a causal claim about pre-training exposure or a general scaling law."
        ),
        "lambda_vs_hc_correlation": hc_corr,
        "lambda_vs_hc_correlation_excluding_tir_neg3_rev": hc_corr_excl,
        "lambda_vs_capacity_index_correlation": cap_corr,
        "lambda_vs_capacity_index_correlation_excluding_tir_neg3_rev": cap_corr_excl,
        "n_models": len(models),
        "n_conditions_per_model": raw["n_conditions"],
    }

    metadata = {
        "rebuilt_from": str(REPORT_IN),
        "rebuild_method": "Recomputed via current hallucination_coefficient.py and compute_metrics.py from existing transcripts",
        "exact_checkpoint_names": [f"openai/whisper-{m}" for m in models],
        "whisper_version": "openai-whisper (exact pip version not captured)",
        "decoding_configuration": {"temperature": 0.0, "word_timestamps": True, "language": "en"},
        "audio_conditions": list({r["condition"] for r in per_condition}),
    }

    report = {
        "schema": "asr.hallucination-coefficient/v2.0-rebuilt",
        "original_timestamp": raw["timestamp"],
        "rebuild_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "models": models,
        "n_conditions": raw["n_conditions"],
        "per_condition": per_condition,
        "summary": summary,
        "summary_excluding_tir_neg3_rev": summary_excl,
        "leave_one_condition_out": {"hc": hc_loo, "capacity_index": cap_loo},
        "hypothesis_h6": h6,
        "metadata": metadata,
        "report_disclaimers": [
            "This report is descriptive, not causal. It compares three Whisper checkpoints on eight synthetic overlap conditions.",
            "lambda is log10(params) * log10(680000) and is a unitless capacity proxy, not a direct measure of pre-training exposure to overlapping speech.",
            "capacity_index (lambda/HC) is an exploratory capacity-normalized inverse-error index, not a measure of awareness.",
            "Correlation coefficients are computed across n=3 models and are for illustration only; they do not support a scaling law.",
            "The tir_neg3_rev condition for tiny produced a 112-token 'yeah' repetition loop; statistics excluding this outlier are reported separately.",
        ],
    }

    REPORT_OUT.write_text(json.dumps(report, indent=2) + "\n")

    # Markdown summary
    lines = [
        "# Rebuilt Hallucination-Coefficient Report",
        "",
        "**Status:** Preliminary evidence only — not a confirmed scaling law.",
        "",
        "## Models",
        "",
        "| Model | Full name | Params | λ | n conditions |",
        "|-------|-----------|--------|---|---------------|",
    ]
    for m in models:
        prov = summary[m]["provenance"]
        lines.append(f"| {m} | {prov['checkpoint_name']} | {prov['params']:,} | {summary[m]['lambda']:.3f} | {summary[m]['n_conditions']} |")

    lines += ["", "## Per-Model Summary (mean [95% CI])", "", "| Model | Mean HC | Median HC | λ/HC mean | λ/HC median | Mean WER | Total Reps |", "|-------|---------|-----------|-----------|-------------|----------|------------|"]
    for m in models:
        s = summary[m]
        hc_ci = s["hc"]["ci95"]
        cap_ci = s["capacity_index"]["ci95"]
        lines.append(
            f"| {m} | {s['hc']['mean']:.3f} [{hc_ci[0]:.3f}, {hc_ci[1]:.3f}] | {s['hc']['median']:.3f} | "
            f"{s['capacity_index']['mean']:.2f} [{cap_ci[0]:.2f}, {cap_ci[1]:.2f}] | {s['capacity_index']['median']:.2f} | "
            f"{s['wer']['mean']:.3f} | {s['repetitions']['total']} |"
        )

    lines += ["", "## Robustness Check: Excluding tir_neg3_rev (tiny 112-token repetition loop)", "", "| Model | Mean HC (excl.) | λ/HC mean (excl.) |", "|-------|-----------------|---------------------|"]
    for m in sorted(summary_excl.keys()):
        s = summary_excl[m]
        lines.append(f"| {m} | {s['hc']['mean']:.3f} | {s['capacity_index']['mean']:.2f} |")

    lines += ["", "## Leave-One-Condition-Out Sensitivity", "", "| Model | Max Δ mean HC | Max Δ mean λ/HC |", "|-------|---------------|-----------------|"]
    for m in models:
        lines.append(f"| {m} | {hc_loo[m]['max_delta']:.4f} | {cap_loo[m]['max_delta']:.2f} |")

    lines += ["", "## Hypothesis H6", "", f"**Claim:** {h6['claim']}", "", f"**Assessment:** {h6['assessment']}", "", f"**Reason:** {h6['reason']}", "", f"- λ vs mean HC correlation: {hc_corr:.3f} (excl. outlier: {hc_corr_excl:.3f})", f"- λ vs λ/HC correlation: {cap_corr:.3f} (excl. outlier: {cap_corr_excl:.3f})", ""]

    lines += ["## Disclaimers", ""]
    for d in report["report_disclaimers"]:
        lines.append(f"- {d}")

    lines += ["", "## Canonical JSON", "", f"All displayed values regenerate from `{REPORT_OUT.relative_to(PROJECT_ROOT)}`.", ""]
    SUMMARY_OUT.write_text("\n".join(lines) + "\n")

    print(f"Wrote {REPORT_OUT}")
    print(f"Wrote {SUMMARY_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
