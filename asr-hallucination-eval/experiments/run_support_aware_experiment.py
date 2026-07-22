#!/usr/bin/env python3
"""
Support-aware acoustic continued pretraining experiment runner.

Research question:
  Can support-aware acoustic continued pretraining internalize hallucination
  awareness early enough to suppress prior-driven text generation before token
  release, and does it outperform post-tokenization detection at matched
  transcription accuracy and abstention cost?

5 intervention conditions:
  1. Baseline ASR (no intervention)
  2. Baseline + post-decoding hallucination gate
  3. Decoder-only hallucination-aware fine-tuning
  4. Acoustic encoder + decoder continued pretraining on underdetermined speech
  5. Continued pretraining + release-time gate

Evaluation metrics:
  - Hallucinated spans per minute
  - Unsupported-span rate
  - False-provenance release rate
  - Correct abstention rate
  - Unnecessary abstention rate
  - Clean-speech WER regression
  - Competitor leakage
  - Calibration error for h_theta(x)

Decisive test: context-capture test
  Same ambiguous waveform presented under different textual contexts.
  A successfully pretrained model should resist producing different
  context-driven narratives from the same waveform.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import warnings
from dataclasses import dataclass
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
from experiments.hallucination_coefficient import (
    auto_annotate_tokens,
    transcribe_with_whisper,
)
from experiments.support_aware_pretraining import (
    adaptive_penalty,
    calibration_error,
    compute_abstention_rates,
    compute_competitor_leakage,
    compute_false_provenance_rate,
    compute_hallucinated_spans_per_minute,
    contrastive_prior_loss,
    evaluate_support_aware_model,
    hallucination_risk_score,
    simulate_intervention,
    context_capture_test,
)

warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")


# ─── Contrastive corpus generation ────────────────────────────────────

@dataclass
class ContrastiveExample:
    """One training example with supported and unsupported outputs."""
    audio_path: str
    y_supported: str       # verified transcription or correct abstention
    y_unsupported: str     # fluent but acoustically unsupported continuation
    condition: str         # clean, overlapped, reversed, noisy, underdetermined
    should_abstain: bool   # is the input too ambiguous to transcribe?


def generate_tts(text: str, output_wav: str, voice: str = "Samantha"):
    aiff = output_wav.replace(".wav", ".aiff")
    subprocess.run(["say", "-v", voice, text, "-o", aiff], capture_output=True, timeout=30)
    subprocess.run([
        "ffmpeg", "-y", "-i", aiff, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output_wav,
    ], capture_output=True, timeout=30)


def pad_or_trim(path: str, out: str, dur: float = 3.0):
    subprocess.run([
        "ffmpeg", "-y", "-i", path,
        "-af", f"apad=whole_len={int(dur*48000)},atrim=0:{dur}",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out,
    ], capture_output=True, timeout=30)


def loudnorm(path: str, out: str):
    subprocess.run([
        "ffmpeg", "-y", "-i", path, "-af", "loudnorm=I=-23:TP=-2:LRA=11",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out,
    ], capture_output=True, timeout=60)


def mix(target: str, interference: str, out: str, tir_db: float, overlap: float, dur: float = 3.0):
    gain = 10 ** (-tir_db / 20)
    delay_ms = int(dur * (1 - overlap) * 1000)
    fg = (f"[1:a]volume={gain},adelay={delay_ms}|{delay_ms}[delayed];"
          f"[0:a][delayed]amix=inputs=2:duration=longest:normalize=0[out]")
    subprocess.run([
        "ffmpeg", "-y", "-i", target, "-i", interference,
        "-filter_complex", fg, "-map", "[out]",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out,
    ], capture_output=True, timeout=60)


def reverse_audio(path: str, out: str):
    subprocess.run([
        "ffmpeg", "-y", "-i", path, "-af", "areverse",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out,
    ], capture_output=True, timeout=30)


def generate_contrastive_corpus(work_dir: str) -> list[ContrastiveExample]:
    """
    Generate contrastive training/eval corpus with 5 condition types.

    Each example has:
      - x: audio input
      - y_supported: verified transcription or abstention
      - y_unsupported: fluent continuation absent from all source stems
    """
    examples = []

    # Source texts
    target_text = "The quick brown fox jumps over the lazy dog"
    competitor_text = "The cat sat on the mat today"

    # Unsupported continuations (fluent but absent from sources)
    unsupported_clean = "The quick brown fox jumps over the lazy dog and then runs away"
    unsupported_overlap = "The cat and the fox both jumped over the mat together"
    unsupported_reversed = "The dog was lazy but the fox was very energetic today"
    unsupported_noisy = "Someone said something about a fox and a dog nearby"
    unsupported_underdet = "I think maybe the fox might have been running somewhere"

    # Generate source audio
    target_raw = os.path.join(work_dir, "target_raw.wav")
    competitor_raw = os.path.join(work_dir, "competitor_raw.wav")
    generate_tts(target_text, target_raw, "Samantha")
    generate_tts(competitor_text, competitor_raw, "Alex")

    target_norm = os.path.join(work_dir, "target_norm.wav")
    competitor_norm = os.path.join(work_dir, "competitor_norm.wav")
    pad_or_trim(target_raw, target_norm)
    pad_or_trim(competitor_raw, competitor_norm)
    loudnorm(target_norm, os.path.join(work_dir, "target_final.wav"))
    loudnorm(competitor_norm, os.path.join(work_dir, "competitor_final.wav"))
    target_final = os.path.join(work_dir, "target_final.wav")
    competitor_final = os.path.join(work_dir, "competitor_final.wav")

    rev_path = os.path.join(work_dir, "competitor_rev.wav")
    reverse_audio(competitor_final, rev_path)

    # 1. Clean condition
    clean_path = os.path.join(work_dir, "clean.wav")
    subprocess.run(["cp", target_final, clean_path])
    examples.append(ContrastiveExample(
        audio_path=clean_path,
        y_supported=target_text,
        y_unsupported=unsupported_clean,
        condition="clean",
        should_abstain=False,
    ))

    # 2. Overlapped (intelligible competitor at TIR=0, 100% overlap)
    overlap_path = os.path.join(work_dir, "overlap.wav")
    mix(target_final, competitor_final, overlap_path, 0.0, 1.0)
    examples.append(ContrastiveExample(
        audio_path=overlap_path,
        y_supported=target_text,
        y_unsupported=unsupported_overlap,
        condition="overlapped",
        should_abstain=False,
    ))

    # 3. Time-reversed interference
    rev_mix_path = os.path.join(work_dir, "reversed.wav")
    mix(target_final, rev_path, rev_mix_path, -3.0, 1.0)
    examples.append(ContrastiveExample(
        audio_path=rev_mix_path,
        y_supported=target_text,
        y_unsupported=unsupported_reversed,
        condition="time_reversed",
        should_abstain=False,
    ))

    # 4. Noisy (high TIR but with background noise)
    noise_path = os.path.join(work_dir, "noise.wav")
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", "anoisesrc=color=white:amplitude=0.3:duration=3:sample_rate=48000",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", noise_path,
    ], capture_output=True, timeout=30)
    noisy_path = os.path.join(work_dir, "noisy.wav")
    mix(target_final, noise_path, noisy_path, 3.0, 1.0)
    examples.append(ContrastiveExample(
        audio_path=noisy_path,
        y_supported=target_text,
        y_unsupported=unsupported_noisy,
        condition="noisy",
        should_abstain=False,
    ))

    # 5. Underdetermined (very low TIR, 100% overlap — too ambiguous)
    underdet_path = os.path.join(work_dir, "underdetermined.wav")
    mix(target_final, competitor_final, underdet_path, -6.0, 1.0)
    examples.append(ContrastiveExample(
        audio_path=underdet_path,
        y_supported="",  # correct abstention
        y_unsupported=unsupported_underdet,
        condition="underdetermined",
        should_abstain=True,
    ))

    return examples


# ─── Full experiment runner ───────────────────────────────────────────

def run_support_aware_experiment(
    model_name: str = "base",
    output_dir: str = "results/support_aware_experiment",
) -> dict[str, Any]:
    """
    Run the 5-condition support-aware pretraining experiment.

    Since we cannot actually fine-tune Whisper models in this environment,
    this proof-of-concept uses the simulate_intervention function to model
    the expected effects of each intervention condition on baseline outputs.
    """
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    work_dir = tempfile.mkdtemp(prefix="support_aware_")

    print("=" * 72)
    print("  SUPPORT-AWARE ACOUSTIC CONTINUED PRETRAINING EXPERIMENT")
    print("  5-condition intervention comparison")
    print("=" * 72)

    # Step 1: Generate contrastive corpus
    print("\n▶ Step 1: Generate contrastive corpus")
    corpus = generate_contrastive_corpus(work_dir)
    print(f"  Generated {len(corpus)} contrastive examples")
    for ex in corpus:
        print(f"    {ex.condition}: supported=\"{ex.y_supported[:40]}...\" unsupported=\"{ex.y_unsupported[:40]}...\"")

    # Step 2: Transcribe all examples with baseline Whisper
    print(f"\n▶ Step 2: Transcribe with Whisper ({model_name})")
    import whisper
    model = whisper.load_model(model_name)

    baseline_results = []
    for ex in corpus:
        print(f"  [{ex.condition}] transcribing...", end=" ", flush=True)
        result = model.transcribe(ex.audio_path, temperature=0.0, word_timestamps=True)
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
        print(f"→ {len(transcript.split())} words")

        # Auto-annotate
        target_words = ex.y_supported.lower().split() if ex.y_supported else []
        competitor_words = "the cat sat on the mat today".split()
        annotations = auto_annotate_tokens(tokens, target_words, competitor_words)

        alignment = AlignmentResult(
            stimulus_id=ex.condition,
            target_transcript=ex.y_supported,
            decoded_transcript=transcript,
            tokens=annotations,
            target_tokens=target_words,
            competitor_tokens=competitor_words,
        )

        metrics = compute_all_metrics(alignment)
        h_risk = hallucination_risk_score(metrics)
        baseline_results.append({
            "example": ex,
            "transcript": transcript,
            "tokens": tokens,
            "alignment": alignment,
            "metrics": metrics,
            "h_risk": h_risk,
        })

    # Step 3: Compute contrastive loss for each example
    print("\n▶ Step 3: Compute contrastive prior loss")
    for br in baseline_results:
        ex = br["example"]
        # Estimate log P(y_supported | x) and log P(y_unsupported | x)
        # using token-level probabilities from Whisper
        supported_words = ex.y_supported.lower().split()
        unsupported_words = ex.y_unsupported.lower().split()

        # Use mean token probability as proxy for log P
        sup_probs = [t["probability"] for t in br["tokens"] if t["probability"] and t["word"].lower().strip(".,!?;:") in [w.lower() for w in supported_words]]
        unsup_probs = [0.3] * len(unsupported_words)  # unsupported gets lower proxy

        log_p_sup = np.log(np.mean(sup_probs)) if sup_probs else np.log(0.01)
        log_p_unsup = np.log(np.mean(unsup_probs)) if unsup_probs else np.log(0.01)

        loss = contrastive_prior_loss(log_p_sup, log_p_unsup, margin=1.0)
        br["contrastive_loss"] = loss
        print(f"  [{ex.condition}] L_prior = {loss:.4f} (log_p_sup={log_p_sup:.3f}, log_p_unsup={log_p_unsup:.3f})")

    # Step 4: Simulate 5 intervention conditions
    print("\n▶ Step 4: Simulate 5 intervention conditions")
    conditions = [
        "baseline",
        "post_gate",
        "decoder_finetuned",
        "encoder_pretrain",
        "encoder_pretrain_plus_gate",
    ]

    all_intervention_results = {}
    should_abstain = [br["example"].should_abstain for br in baseline_results]

    for cond in conditions:
        print(f"\n  Condition: {cond}")
        modified_alignments = simulate_intervention(
            cond,
            [br["alignment"] for br in baseline_results],
            [br["h_risk"] for br in baseline_results],
            gate_threshold=0.5,
        )

        # Evaluate
        eval_result = evaluate_support_aware_model(
            modified_alignments,
            should_abstain,
            audio_duration_min=3.0 / 60.0,
            clean_wer_baseline=None,
        )

        # Also compute per-example h_risk for calibration
        per_example_metrics = []
        for align in modified_alignments:
            m = compute_all_metrics(align)
            per_example_metrics.append(m)

        risks = [hallucination_risk_score(m) for m in per_example_metrics]
        observed = [m["uwr"]["uwr"] + m["hsr"]["hsr"] for m in per_example_metrics]
        cal_err = calibration_error(risks, observed)

        eval_result["calibration_error"] = cal_err
        eval_result["per_example_risks"] = risks
        eval_result["per_example_observed"] = observed

        all_intervention_results[cond] = eval_result

        print(f"    Mean WER:      {eval_result['mean_wer']:.4f}")
        print(f"    Mean UWR:      {eval_result['mean_uwr']:.4f}")
        print(f"    Mean HSR:      {eval_result['mean_hsr']:.4f}")
        print(f"    HSR/min:       {eval_result['hallucinated_spans_per_minute']:.2f}")
        print(f"    False prov:    {eval_result['false_provenance_rate']:.4f}")
        print(f"    Comp leak:     {eval_result['competitor_leakage']:.4f}")
        print(f"    Correct abst:  {eval_result['correct_abstention_rate']:.4f}")
        print(f"    Unnec abst:    {eval_result['unnecessary_abstention_rate']:.4f}")
        print(f"    Cal error:     {cal_err:.4f}")

    # Step 5: Context-capture test
    print("\n▶ Step 5: Context-capture test")
    # Use the overlapped condition as the ambiguous waveform
    ambiguous_audio = corpus[1].audio_path  # overlapped
    contexts = [
        "The quick brown fox",
        "The cat sat on the mat",
        "Once upon a time there was",
    ]
    ctx_result = context_capture_test(ambiguous_audio, model, contexts)
    print(f"  Ambiguous audio: {corpus[1].condition}")
    for ctx, trans in zip(ctx_result["contexts"], ctx_result["transcripts"]):
        print(f"    Context: \"{ctx}\" → \"{trans}\"")
    print(f"  Mean Jaccard: {ctx_result['mean_jaccard']:.3f}")
    print(f"  Context captured: {ctx_result['context_captured']}")

    # Step 6: Adaptive penalty analysis
    print("\n▶ Step 6: Adaptive penalty analysis")
    lambda_0 = 1.0
    for br in baseline_results:
        h = br["h_risk"]
        pen_direct = adaptive_penalty(h, lambda_0, mode="direct")
        pen_inverse = adaptive_penalty(h, lambda_0, mode="inverse")
        print(f"  [{br['example'].condition}] h={h:.4f} → λ_eff(direct)={pen_direct:.4f}, λ_eff(inverse)={pen_inverse:.4f}")

    # Step 7: Build report
    print("\n▶ Step 7: Building report")

    # Comparison table
    print("\n  Intervention Comparison:")
    print(f"  {'Condition':<30} {'WER':>8} {'UWR':>8} {'HSR':>8} {'HSR/min':>8} {'FPR':>8} {'Leak':>8} {'C.Abst':>8} {'U.Abst':>8} {'CalErr':>8}")
    print(f"  {'-'*30} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8}")
    for cond in conditions:
        r = all_intervention_results[cond]
        print(f"  {cond:<30} {r['mean_wer']:>8.4f} {r['mean_uwr']:>8.4f} {r['mean_hsr']:>8.4f} {r['hallucinated_spans_per_minute']:>8.2f} {r['false_provenance_rate']:>8.4f} {r['competitor_leakage']:>8.4f} {r['correct_abstention_rate']:>8.4f} {r['unnecessary_abstention_rate']:>8.4f} {r['calibration_error']:>8.4f}")

    # Success criteria check
    print("\n  Success Criteria (ΔHSR < 0, ΔWER_clean ≤ δ, Unnec Abst ≤ τ):")
    baseline_hsr = all_intervention_results["baseline"]["mean_hsr"]
    baseline_wer = all_intervention_results["baseline"]["mean_wer"]
    delta = 0.05  # WER regression threshold
    tau = 0.15    # unnecessary abstention threshold

    for cond in conditions[1:]:  # skip baseline
        r = all_intervention_results[cond]
        d_hsr = r["mean_hsr"] - baseline_hsr
        d_wer = r["mean_wer"] - baseline_wer
        un_abst = r["unnecessary_abstention_rate"]

        hsr_pass = d_hsr < 0
        wer_pass = d_wer <= delta
        abst_pass = un_abst <= tau

        status = "PASS" if (hsr_pass and wer_pass and abst_pass) else "FAIL"
        print(f"    {cond:<30} ΔHSR={d_hsr:+.4f} {'✓' if hsr_pass else '✗'}  ΔWER={d_wer:+.4f} {'✓' if wer_pass else '✗'}  U.Abst={un_abst:.4f} {'✓' if abst_pass else '✗'}  → {status}")

    # Full report
    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "experiment_type": "support_aware_continued_pretraining",
        "research_question": (
            "Can support-aware acoustic continued pretraining internalize "
            "hallucination awareness early enough to suppress prior-driven "
            "text generation before token release, and does it outperform "
            "post-tokenization detection at matched transcription accuracy "
            "and abstention cost?"
        ),
        "model": model_name,
        "decoding_config": {
            "temperature": 0.0,
            "word_timestamps": True,
        },
        "corpus": [
            {
                "condition": ex.condition,
                "y_supported": ex.y_supported,
                "y_unsupported": ex.y_unsupported,
                "should_abstain": ex.should_abstain,
            }
            for ex in corpus
        ],
        "contrastive_losses": {
            br["example"].condition: br["contrastive_loss"]
            for br in baseline_results
        },
        "baseline_transcripts": {
            br["example"].condition: br["transcript"]
            for br in baseline_results
        },
        "intervention_results": all_intervention_results,
        "context_capture_test": ctx_result,
        "adaptive_penalties": {
            br["example"].condition: {
                "h_risk": br["h_risk"],
                "lambda_eff_direct": adaptive_penalty(br["h_risk"], lambda_0, mode="direct"),
                "lambda_eff_inverse": adaptive_penalty(br["h_risk"], lambda_0, mode="inverse"),
            }
            for br in baseline_results
        },
        "success_criteria": {
            "delta_wer_threshold": delta,
            "tau_abstention_threshold": tau,
            "results": {
                cond: {
                    "delta_hsr": all_intervention_results[cond]["mean_hsr"] - baseline_hsr,
                    "delta_wer": all_intervention_results[cond]["mean_wer"] - baseline_wer,
                    "unnecessary_abstention": all_intervention_results[cond]["unnecessary_abstention_rate"],
                    "passes": (
                        (all_intervention_results[cond]["mean_hsr"] - baseline_hsr) < 0
                        and (all_intervention_results[cond]["mean_wer"] - baseline_wer) <= delta
                        and all_intervention_results[cond]["unnecessary_abstention_rate"] <= tau
                    ),
                }
                for cond in conditions[1:]
            },
        },
        "important_caveats": [
            "This is a proof-of-concept using simulated interventions, not actual model fine-tuning.",
            "Real experiments require training separate Whisper checkpoints with the contrastive objective.",
            "The simulate_intervention function approximates expected effects of each training condition.",
            "Context-capture test uses Whisper's initial_prompt parameter, not actual context conditioning.",
            "All Whisper checkpoints share the same training corpus; 'continued pretraining' would require",
            "  additional training on the contrastive corpus with the multi-objective loss.",
        ],
    }

    report_path = out_path / "support_aware_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"\n  Full report: {report_path}")
    print("=" * 72)

    return report


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base", help="Whisper model name")
    parser.add_argument("--out", default="results/support_aware_experiment")
    args = parser.parse_args()

    run_support_aware_experiment(model_name=args.model, output_dir=args.out)
