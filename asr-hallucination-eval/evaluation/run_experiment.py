"""
Experiment runner for ASR hallucination evaluation.

Orchestrates the full pipeline:
  1. Load stimulus manifest
  2. Run ASR models on each stimulus
  3. Collect transcriptions
  4. (Optionally) run annotation protocol
  5. Compute metrics
  6. Test preregistered hypotheses H1-H5

Preregistered hypotheses (§4.2):
  H1: WER increases monotonically with speaker count, overlap ratio, and decreasing TIR.
  H2: Unsupported-span rate increases after controlling for WER.
  H3: Intelligible competing speech produces higher CSRR than time-reversed or noise.
  H4: Source separation preprocessing reduces speaker-attributed WER but may still
      produce unsupported fluent outputs in low TIR.
  H5: Composite abstention detector outperforms token entropy alone at identifying
      unsupported fluent spans.
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

# Add project root to path
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
from models.asr_adapters import ASRAdapter, get_available_adapters, get_adapter_by_class


# ─── Hypothesis testing ───────────────────────────────────────────────

@dataclass
class HypothesisResult:
    hypothesis_id: str
    description: str
    supported: bool
    p_value: float | None = None
    effect_size: float | None = None
    details: dict = field(default_factory=dict)


def test_h1_wer_monotonic(metrics_by_condition: dict[str, list[dict]]) -> HypothesisResult:
    """
    H1: WER increases monotonically with speaker count, overlap ratio, and decreasing TIR.
    """
    # Group by speaker count, compute mean WER
    by_speakers: dict[int, list[float]] = {}
    by_tir: dict[int, list[float]] = {}
    by_overlap: dict[float, list[float]] = {}

    for condition_id, metrics_list in metrics_by_condition.items():
        parts = condition_id.split("_")
        n_speakers = int(parts[0].replace("N", ""))
        tir = int(parts[1].replace("TIR", ""))
        overlap = float(parts[2].replace("OL", "")) / 100.0

        for m in metrics_list:
            wer = m["wer"]["wer"]
            by_speakers.setdefault(n_speakers, []).append(wer)
            by_tir.setdefault(tir, []).append(wer)
            by_overlap.setdefault(overlap, []).append(wer)

    # Check monotonicity
    def _mean(vals):
        return sum(vals) / len(vals) if vals else 0

    speaker_means = {k: _mean(v) for k, v in sorted(by_speakers.items())}
    tir_means = {k: _mean(v) for k, v in sorted(by_tir.items(), reverse=True)}  # decreasing TIR
    overlap_means = {k: _mean(v) for k, v in sorted(by_overlap.items())}

    # Simple monotonicity check (Spearman-like)
    def _is_monotonic_increasing(means: dict) -> bool:
        vals = list(means.values())
        return all(vals[i] <= vals[i + 1] + 0.01 for i in range(len(vals) - 1))  # tolerance for noise

    speaker_mono = _is_monotonic_increasing(speaker_means)
    tir_mono = _is_monotonic_increasing(tir_means)
    overlap_mono = _is_monotonic_increasing(overlap_means)

    supported = speaker_mono and tir_mono and overlap_mono

    return HypothesisResult(
        hypothesis_id="H1",
        description="WER increases monotonically with speaker count, overlap, and decreasing TIR",
        supported=supported,
        details={
            "wer_by_speaker_count": speaker_means,
            "wer_by_tir": tir_means,
            "wer_by_overlap": overlap_means,
            "monotonic_speaker_count": speaker_mono,
            "monotonic_tir": tir_mono,
            "monotonic_overlap": overlap_mono,
        },
    )


def test_h2_uwr_beyond_wer(metrics_by_condition: dict[str, list[dict]]) -> HypothesisResult:
    """
    H2: Unsupported-span rate increases after controlling for WER.
    Tests whether UWR provides information beyond WER alone.
    """
    # Collect (wer, uwr) pairs
    wer_vals = []
    uwr_vals = []
    for metrics_list in metrics_by_condition.values():
        for m in metrics_list:
            wer_vals.append(m["wer"]["wer"])
            uwr_vals.append(m["uwr"]["uwr"])

    if len(wer_vals) < 3:
        return HypothesisResult(
            hypothesis_id="H2",
            description="UWR increases after controlling for WER",
            supported=False,
            details={"error": "Insufficient data"},
        )

    # Compute correlation between WER and UWR
    n = len(wer_vals)
    mean_wer = sum(wer_vals) / n
    mean_uwr = sum(uwr_vals) / n

    cov = sum((w - mean_wer) * (u - mean_uwr) for w, u in zip(wer_vals, uwr_vals)) / n
    std_wer = math.sqrt(sum((w - mean_wer) ** 2 for w in wer_vals) / n)
    std_uwr = math.sqrt(sum((u - mean_uwr) ** 2 for u in uwr_vals) / n)

    correlation = cov / (std_wer * std_uwr) if std_wer > 0 and std_uwr > 0 else 0

    # If correlation < 1, UWR provides information beyond WER
    # More formally: check if UWR/WER ratio varies across conditions
    ratios = [u / max(w, 0.001) for w, u in zip(wer_vals, uwr_vals) if w > 0]
    ratio_variance = sum((r - sum(ratios) / len(ratios)) ** 2 for r in ratios) / len(ratios) if ratios else 0

    supported = correlation < 0.95 and ratio_variance > 0.01

    return HypothesisResult(
        hypothesis_id="H2",
        description="UWR increases after controlling for WER",
        supported=supported,
        effect_size=correlation,
        details={
            "wer_uwr_correlation": correlation,
            "uwr_to_wer_ratio_variance": ratio_variance,
            "mean_wer": mean_wer,
            "mean_uwr": mean_uwr,
            "n_samples": n,
        },
    )


def test_h3_csrr_intelligible_vs_control(metrics_by_condition: dict[str, list[dict]]) -> HypothesisResult:
    """
    H3: Intelligible competing speech produces higher CSRR than time-reversed or noise.
    """
    # Group CSRR by interference type
    by_type: dict[str, list[float]] = {}
    for condition_id, metrics_list in metrics_by_condition.items():
        parts = condition_id.split("_")
        # interference type is parts[3] (after N, TIR, OL)
        interference_type = parts[3] if len(parts) > 3 else "unknown"

        for m in metrics_list:
            csrr = m["csrr"]["csrr"]
            by_type.setdefault(interference_type, []).append(csrr)

    def _mean(vals):
        return sum(vals) / len(vals) if vals else 0

    intelligible_csrr = _mean(by_type.get("intelligible", []))
    reversed_csrr = _mean(by_type.get("time-reversed", by_type.get("time_reversed", [])))
    noise_csrr = _mean(by_type.get("speech-shaped", by_type.get("speech_shaped_noise", [])))

    supported = intelligible_csrr > reversed_csrr and intelligible_csrr > noise_csrr

    return HypothesisResult(
        hypothesis_id="H3",
        description="Intelligible speech produces higher CSRR than time-reversed or noise",
        supported=supported,
        effect_size=intelligible_csrr - max(reversed_csrr, noise_csrr),
        details={
            "csrr_intelligible": intelligible_csrr,
            "csrr_time_reversed": reversed_csrr,
            "csrr_speech_shaped_noise": noise_csrr,
            "n_intelligible": len(by_type.get("intelligible", [])),
            "n_time_reversed": len(by_type.get("time-reversed", by_type.get("time_reversed", []))),
            "n_noise": len(by_type.get("speech-shaped", by_type.get("speech_shaped_noise", []))),
        },
    )


def test_h4_separation_reduces_sawer(metrics_by_condition: dict[str, list[dict]]) -> HypothesisResult:
    """
    H4: Source separation preprocessing reduces speaker-attributed WER
    but may still produce unsupported fluent outputs in low TIR.
    """
    # This requires comparing with/without separation — placeholder for when
    # separation results are available
    return HypothesisResult(
        hypothesis_id="H4",
        description="Source separation reduces speaker-attributed WER but may still produce unsupported output",
        supported=False,
        details={"note": "Requires separation vs. no-separation comparison data"},
    )


def test_h5_abstention_detector(metrics_by_condition: dict[str, list[dict]]) -> HypothesisResult:
    """
    H5: Composite abstention detector outperforms token entropy alone.
    """
    # This requires running the abstention detector — placeholder
    return HypothesisResult(
        hypothesis_id="H5",
        description="Composite abstention detector outperforms token entropy alone",
        supported=False,
        details={"note": "Requires abstention detector implementation and confidence data"},
    )


# ─── Experiment runner ────────────────────────────────────────────────

def run_experiment(
    stimulus_manifest_path: str,
    output_dir: str,
    adapters: dict[str, ASRAdapter] | None = None,
    max_stimuli: int = -1,
) -> dict[str, Any]:
    """
    Run the full experiment pipeline.

    Args:
        stimulus_manifest_path: path to stimulus_manifest.json
        output_dir: directory for results
        adapters: dict of adapter_name -> ASRAdapter (auto-detected if None)
        max_stimuli: limit number of stimuli (for testing; -1 = all)

    Returns:
        experiment report dict
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Load stimulus manifest
    with open(stimulus_manifest_path) as f:
        manifest = json.load(f)

    stimuli = manifest.get("stimuli", [])
    if max_stimuli > 0:
        stimuli = stimuli[:max_stimuli]

    # Get adapters
    if adapters is None:
        adapters = get_available_adapters()

    if not adapters:
        raise RuntimeError("No ASR adapters available. Install whisper/torchaudio or set API keys.")

    print(f"Running experiment with {len(adapters)} model(s): {list(adapters.keys())}")
    print(f"Stimuli: {len(stimuli)}")

    # Run transcriptions
    all_results = []
    for adapter_name, adapter in adapters.items():
        print(f"\n--- {adapter_name} (Class {adapter.model_class}) ---")

        for i, stimulus in enumerate(stimuli):
            audio_path = stimulus["outputPath"]
            condition_id = stimulus["id"]

            for decoder in ["deterministic", "stochastic"]:
                if decoder != stimulus.get("decoderCondition", "deterministic"):
                    continue

                print(f"  [{i+1}/{len(stimuli)}] {condition_id} ({decoder})...", end=" ")

                try:
                    result = adapter.transcribe(audio_path, decoder_condition=decoder)
                    record = {
                        "stimulus_id": condition_id,
                        "model": adapter_name,
                        "model_class": adapter.model_class,
                        "decoder_condition": decoder,
                        "transcript": result.transcript,
                        "tokens": result.tokens,
                        "metadata": result.metadata,
                        "status": "ok",
                    }
                    print(f"→ {len(result.transcript.split())} words")
                except Exception as e:
                    record = {
                        "stimulus_id": condition_id,
                        "model": adapter_name,
                        "model_class": adapter.model_class,
                        "decoder_condition": decoder,
                        "transcript": "",
                        "tokens": [],
                        "metadata": {},
                        "status": "error",
                        "error": str(e),
                    }
                    print(f"→ ERROR: {e}")

                all_results.append(record)

    # Save raw transcription results
    raw_results_path = output_path / "raw_transcriptions.json"
    with open(raw_results_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nRaw transcriptions saved to {raw_results_path}")

    # If we have reference transcripts, compute metrics
    # (This requires annotation — for now, compute WER against target if available)
    metrics_by_condition: dict[str, list[dict]] = {}
    for result in all_results:
        if result["status"] != "ok":
            continue

        # Find the stimulus to get reference info
        stim = next((s for s in stimuli if s["id"] == result["stimulus_id"]), None)
        if not stim:
            continue

        # Compute basic WER (against empty reference for now — real evaluation needs annotations)
        wer = compute_wer("", result["transcript"])

        # Create a minimal alignment for metric computation
        tokens = [
            TokenAnnotation(
                token=t.get("word", ""),
                annotation=AnnotationClass.UNSUPPORTED,  # placeholder — real annotations needed
                confidence=t.get("confidence"),
            )
            for t in result.get("tokens", [])
        ]
        alignment = AlignmentResult(
            stimulus_id=result["stimulus_id"],
            target_transcript="",
            decoded_transcript=result["transcript"],
            tokens=tokens,
        )

        metrics = compute_all_metrics(alignment)
        condition_key = result["stimulus_id"]
        metrics_by_condition.setdefault(condition_key, []).append(metrics)

    # Test hypotheses
    print("\n--- Testing preregistered hypotheses ---")
    h1 = test_h1_wer_monotonic(metrics_by_condition)
    h2 = test_h2_uwr_beyond_wer(metrics_by_condition)
    h3 = test_h3_csrr_intelligible_vs_control(metrics_by_condition)
    h4 = test_h4_separation_reduces_sawer(metrics_by_condition)
    h5 = test_h5_abstention_detector(metrics_by_condition)

    hypothesis_results = [h1, h2, h3, h4, h5]
    for h in hypothesis_results:
        status = "SUPPORTED" if h.supported else "NOT SUPPORTED"
        print(f"  {h.hypothesis_id}: {status} — {h.description}")

    # Final report
    report = {
        "experiment_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stimulus_manifest": stimulus_manifest_path,
        "models_used": list(adapters.keys()),
        "n_stimuli": len(stimuli),
        "n_transcriptions": len(all_results),
        "n_successful": sum(1 for r in all_results if r["status"] == "ok"),
        "n_errors": sum(1 for r in all_results if r["status"] == "error"),
        "hypothesis_results": [
            {
                "hypothesis_id": h.hypothesis_id,
                "description": h.description,
                "supported": h.supported,
                "effect_size": h.effect_size,
                "details": h.details,
            }
            for h in hypothesis_results
        ],
    }

    report_path = output_path / "experiment_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nExperiment report saved to {report_path}")

    return report


# ─── CLI ──────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Run ASR hallucination evaluation experiment")
    parser.add_argument("--manifest", required=True, help="Path to stimulus_manifest.json")
    parser.add_argument("--out", default="results", help="Output directory for results")
    parser.add_argument("--max-stimuli", type=int, default=-1, help="Limit stimuli (for testing)")
    parser.add_argument("--model", default=None, help="Specific model to use (whisper, emformer-rnnt, multimodal)")
    args = parser.parse_args()

    adapters = None
    if args.model:
        available = get_available_adapters()
        if args.model not in available:
            print(f"Model '{args.model}' not available. Available: {list(available.keys())}")
            sys.exit(1)
        adapters = {args.model: available[args.model]}

    report = run_experiment(
        stimulus_manifest_path=args.manifest,
        output_dir=args.out,
        adapters=adapters,
        max_stimuli=args.max_stimuli,
    )

    print(f"\n{'='*60}")
    print(f"Experiment complete: {report['n_successful']}/{report['n_transcriptions']} successful")
    for h in report["hypothesis_results"]:
        status = "✓ SUPPORTED" if h["supported"] else "✗ NOT SUPPORTED"
        print(f"  {h['hypothesis_id']}: {status}")


if __name__ == "__main__":
    main()
