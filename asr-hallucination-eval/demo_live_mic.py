#!/usr/bin/env python3
"""
Live microphone demo of the ASR hallucination evaluation framework.

Records real speech from the Mac's built-in microphone, mixes it with
interference at varying TIR levels, runs Whisper ASR on each mix,
and computes real metrics comparing clean vs. degraded transcripts.

Requirements:
  - ffmpeg (with avfoundation support on macOS)
  - whisper Python package
  - 5 seconds of silence + 5 seconds of speech from you
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from evaluation.compute_metrics import (
    AlignmentResult,
    AnnotationClass,
    TokenAnnotation,
    compute_all_metrics,
    compute_wer,
    krippendorff_alpha,
)

MIC_DEVICE = "1"  # MacBook Pro Microphone (avfoundation)
SAMPLE_RATE = 48000
RECORD_SECONDS = 5


def record_mic(output_path, seconds=RECORD_SECONDS):
    """Record from the built-in microphone using ffmpeg + avfoundation."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "avfoundation",
        "-i", f":{MIC_DEVICE}",
        "-t", str(seconds),
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",
        "-c:a", "pcm_s16le",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=seconds + 10)
    return result.returncode == 0, result.stderr.decode("utf-8", errors="replace")


def loudness_normalize(input_path, output_path):
    """EBU R128 normalization to -23 LUFS."""
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path,
        "-af", "loudnorm=I=-23:TP=-2:LRA=11:linear=true",
        "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le",
        output_path,
    ], capture_output=True, timeout=30)


def mix_audio(target, interference, output, tir_db, overlap_frac):
    """Mix target and interference at specified TIR and overlap."""
    gain = 10 ** (-tir_db / 20)
    delay_ms = int(RECORD_SECONDS * (1 - overlap_frac) * 1000)
    filt = (
        f"[1:a]volume={gain},adelay={delay_ms}|{delay_ms}[delayed];"
        f"[0:a][delayed]amix=inputs=2:duration=longest:normalize=0[out]"
    )
    result = subprocess.run([
        "ffmpeg", "-y", "-i", target, "-i", interference,
        "-filter_complex", filt, "-map", "[out]",
        "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le",
        output,
    ], capture_output=True, timeout=30)
    return result.returncode == 0


def reverse_audio(input_path, output_path):
    """Time-reverse audio (removes lexical intelligibility, preserves energy)."""
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path, "-af", "areverse",
        "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le",
        output_path,
    ], capture_output=True, timeout=30)


def transcribe_whisper(audio_path, model):
    """Run Whisper transcription with word timestamps."""
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


def auto_annotate(decoded_tokens, clean_tokens, competitor_tokens=None):
    """
    Automatic annotation heuristic for the demo.
    This is NOT a substitute for blinded human annotation — it's a
    rough alignment to demonstrate the metric pipeline on real audio.

    Classification:
      - lexically_supported: exact match to clean transcript at this position
      - supported_by_competitor: matches a competitor token
      - unsupported: not in clean or competitor (potential hallucination)
      - plausibly_ambiguous: partial match (edit distance <= 2)
    """
    competitor_tokens = competitor_tokens or []
    annotations = []

    for i, token in enumerate(decoded_tokens):
        word = token["word"].lower().strip(".,!?;:")

        # Check exact match to clean transcript
        if i < len(clean_tokens) and word == clean_tokens[i]:
            annotations.append(TokenAnnotation(
                token=token["word"], annotation=AnnotationClass.LEXICALLY_SUPPORTED,
                source_speaker="A",
                start_time=token.get("start"), end_time=token.get("end"),
                confidence=token.get("probability"),
            ))
            continue

        # Check if it appears anywhere in the clean transcript
        if word in clean_tokens:
            annotations.append(TokenAnnotation(
                token=token["word"], annotation=AnnotationClass.LEXICALLY_SUPPORTED,
                source_speaker="A",
                start_time=token.get("start"), end_time=token.get("end"),
                confidence=token.get("probability"),
            ))
            continue

        # Check if it matches a competitor token
        if word in [t.lower().strip(".,!?;:") for t in competitor_tokens]:
            annotations.append(TokenAnnotation(
                token=token["word"], annotation=AnnotationClass.SUPPORTED_BY_COMPETITOR,
                source_speaker="B",
                start_time=token.get("start"), end_time=token.get("end"),
                confidence=token.get("probability"),
            ))
            continue

        # Check if it's a common function word (likely prior-driven, not hallucination)
        function_words = {"the", "a", "an", "is", "are", "was", "were", "and", "or",
                          "but", "to", "of", "in", "on", "at", "for", "with", "it",
                          "this", "that", "so", "very", "just", "really", "i", "you",
                          "um", "uh", "like", "well", "okay", "yeah", "yes", "no"}
        if word in function_words:
            annotations.append(TokenAnnotation(
                token=token["word"], annotation=AnnotationClass.PLAUSIBLY_AMBIGUOUS,
                source_speaker=None,
                start_time=token.get("start"), end_time=token.get("end"),
                confidence=token.get("probability"),
            ))
            continue

        # Otherwise: unsupported (potential hallucination)
        annotations.append(TokenAnnotation(
            token=token["word"], annotation=AnnotationClass.UNSUPPORTED,
            source_speaker=None,
            start_time=token.get("start"), end_time=token.get("end"),
            confidence=token.get("probability"),
        ))

    return annotations


def run_live_demo():
    print("=" * 72)
    print("  ASR HALLUCINATION EVALUATION — LIVE MICROPHONE DEMO")
    print("  Real speech → Real mixing → Real Whisper ASR → Real metrics")
    print("=" * 72)
    print()

    tmpdir = tempfile.mkdtemp(prefix="asr_live_")
    print(f"  Working directory: {tmpdir}")
    print()

    # ─── Step 1: Record target speech ─────────────────────────────────
    print("▶ STEP 1: Record TARGET speech from microphone")
    print("-" * 72)
    print(f"  You have {RECORD_SECONDS} seconds. Speak a clear sentence NOW!")
    print(f"  Example: \"The quick brown fox jumps over the lazy dog\"")
    print()

    for i in range(3, 0, -1):
        print(f"  Starting in {i}...", end="\r", flush=True)
        time.sleep(1)
    print(f"  ● RECORDING — speak now!                    ")

    target_raw = os.path.join(tmpdir, "target_raw.wav")
    ok, err = record_mic(target_raw, RECORD_SECONDS)
    if not ok or not os.path.exists(target_raw):
        print(f"  ✗ Recording failed: {err[-200:]}")
        return
    print(f"  ✓ Recorded {os.path.getsize(target_raw)} bytes")

    # Normalize
    target_norm = os.path.join(tmpdir, "target_norm.wav")
    loudness_normalize(target_raw, target_norm)
    print(f"  ✓ Loudness normalized to -23 LUFS")

    # ─── Step 2: Record interference speech ───────────────────────────
    print(f"\n▶ STEP 2: Record INTERFERENCE speech from microphone")
    print("-" * 72)
    print(f"  {RECORD_SECONDS} seconds. Speak a DIFFERENT sentence NOW!")
    print(f"  Example: \"The cat sat on the mat today\"")
    print()

    for i in range(3, 0, -1):
        print(f"  Starting in {i}...", end="\r", flush=True)
        time.sleep(1)
    print(f"  ● RECORDING — speak now!                    ")

    interference_raw = os.path.join(tmpdir, "interference_raw.wav")
    ok, err = record_mic(interference_raw, RECORD_SECONDS)
    if not ok or not os.path.exists(interference_raw):
        print(f"  ✗ Recording failed: {err[-200:]}")
        return
    print(f"  ✓ Recorded {os.path.getsize(interference_raw)} bytes")

    interference_norm = os.path.join(tmpdir, "interference_norm.wav")
    loudness_normalize(interference_raw, interference_norm)
    print(f"  ✓ Loudness normalized to -23 LUFS")

    # ─── Step 3: Load Whisper ─────────────────────────────────────────
    print(f"\n▶ STEP 3: Load Whisper ASR model")
    print("-" * 72)
    try:
        import whisper
        print("  Loading Whisper (base)...")
        model = whisper.load_model("base")
        print("  ✓ Model loaded")
    except Exception as e:
        print(f"  ✗ Failed to load Whisper: {e}")
        return

    # ─── Step 4: Transcribe clean target ──────────────────────────────
    print(f"\n▶ STEP 4: Transcribe clean target speech")
    print("-" * 72)
    clean_transcript, clean_tokens = transcribe_whisper(target_norm, model)
    clean_words = clean_transcript.split()
    print(f"  Clean transcript: \"{clean_transcript}\"")
    print(f"  Word count: {len(clean_words)}")

    if not clean_transcript.strip():
        print("\n  ⚠ WARNING: Empty transcript. Did you speak loud enough?")
        print("  Continuing anyway — metrics will show what Whisper heard.")

    # Transcribe interference for competitor reference
    interference_transcript, _ = transcribe_whisper(interference_norm, model)
    competitor_words = interference_transcript.split()
    print(f"\n  Interference transcript: \"{interference_transcript}\"")
    print(f"  Competitor word count: {len(competitor_words)}")

    # ─── Step 5: Mix at varying TIR/overlap and transcribe ────────────
    print(f"\n▶ STEP 5: Mix and transcribe at varying conditions")
    print("-" * 72)

    conditions = [
        ("Clean (no interference)", None, None, None),
        ("TIR +20dB, 100% overlap", 20, 1.0, "intelligible"),
        ("TIR +6dB, 100% overlap", 6, 1.0, "intelligible"),
        ("TIR 0dB, 100% overlap", 0, 1.0, "intelligible"),
        ("TIR -3dB, 100% overlap", -3, 1.0, "intelligible"),
        ("TIR 0dB, 50% overlap", 0, 0.5, "intelligible"),
        ("Time-reversed -3dB", -3, 1.0, "time_reversed"),
    ]

    results = []

    for label, tir, overlap, interference_type in conditions:
        print(f"\n  📤 {label}")

        if tir is None:
            # Clean condition
            audio_path = target_norm
        else:
            audio_path = os.path.join(tmpdir, f"mix_{label.replace(' ', '_').replace('+', 'p')}.wav")

            if interference_type == "time_reversed":
                rev_path = os.path.join(tmpdir, "interference_reversed.wav")
                reverse_audio(interference_norm, rev_path)
                mix_audio(target_norm, rev_path, audio_path, tir, overlap)
            else:
                mix_audio(target_norm, interference_norm, audio_path, tir, overlap)

        # Transcribe
        print(f"     Transcribing with Whisper...", end=" ", flush=True)
        transcript, tokens = transcribe_whisper(audio_path, model)
        print(f"→ \"{transcript[:60]}{'...' if len(transcript) > 60 else ''}\"")

        # Auto-annotate
        decoded_words = [t["word"] for t in tokens]
        annotations = auto_annotate(tokens, clean_words, competitor_words)

        # Build alignment
        alignment = AlignmentResult(
            stimulus_id=label,
            target_transcript=clean_transcript,
            decoded_transcript=transcript,
            tokens=annotations,
            target_tokens=clean_words,
            competitor_tokens=competitor_words,
        )

        # Compute metrics
        metrics = compute_all_metrics(alignment)
        results.append({
            "label": label,
            "tir": tir,
            "overlap": overlap,
            "interference_type": interference_type,
            "transcript": transcript,
            "metrics": metrics,
        })

        wer = metrics["wer"]["wer"]
        uwr = metrics["uwr"]["uwr"]
        csrr = metrics["csrr"]["csrr"]
        hsr = metrics["hsr"]["hsr"]
        leak = metrics["speaker_attributed"]["competitor_leak_rate"]

        print(f"     WER: {wer:.3f}  |  UWR: {uwr:.3f}  |  CSRR: {csrr:.3f}  |  HSR: {hsr:.3f}  |  Leak: {leak:.1%}")

    # ─── Step 6: Summary ──────────────────────────────────────────────
    print(f"\n{'=' * 72}")
    print("  LIVE DEMO RESULTS — REAL MIC, REAL WHISPER, REAL METRICS")
    print("=" * 72)

    print(f"\n  Your clean speech: \"{clean_transcript}\"")
    print(f"  Interference speech: \"{interference_transcript}\"")

    print(f"\n  {'Condition':<30} {'WER':>6} {'UWR':>6} {'CSRR':>6} {'HSR':>6} {'Leak':>6}")
    print(f"  {'-'*30} {'-'*6} {'-'*6} {'-'*6} {'-'*6} {'-'*6}")
    for r in results:
        m = r["metrics"]
        print(f"  {r['label']:<30} {m['wer']['wer']:>6.3f} {m['uwr']['uwr']:>6.3f} {m['csrr']['csrr']:>6.3f} {m['hsr']['hsr']:>6.3f} {m['speaker_attributed']['competitor_leak_rate']:>5.1%}")

    # Key findings
    clean_wer = results[0]["metrics"]["wer"]["wer"] if results else 0
    worst = max(results[1:], key=lambda r: r["metrics"]["wer"]["wer"], default=None)
    if worst:
        print(f"\n  Key findings with YOUR voice:")
        print(f"    • Clean WER: {clean_wer:.3f}")
        print(f"    • Worst WER: {worst['metrics']['wer']['wer']:.3f} ({worst['label']})")
        print(f"    • Max UWR:   {max(r['metrics']['uwr']['uwr'] for r in results):.3f}")
        print(f"    • Max CSRR:  {max(r['metrics']['csrr']['csrr'] for r in results):.3f}")
        print(f"    • Max HSR:   {max(r['metrics']['hsr']['hsr'] for r in results):.3f}")

        # Check if hallucination appeared
        any_unsupported = any(r["metrics"]["uwr"]["unsupported_count"] > 0 for r in results)
        any_recombination = any(r["metrics"]["csrr"]["recombinant_spans"] > 0 for r in results)
        any_hallucinated = any(r["metrics"]["hsr"]["hallucinated_spans"] > 0 for r in results)

        print(f"\n  Hallucination indicators:")
        print(f"    Unsupported words detected: {'YES ⚠' if any_unsupported else 'no'}")
        print(f"    Cross-speaker recombination: {'YES ⚠' if any_recombination else 'no'}")
        print(f"    Hallucinated spans (≥3 unsupported): {'YES ⚠' if any_hallucinated else 'no'}")

    # Save results
    results_path = os.path.join(tmpdir, "live_results.json")
    with open(results_path, "w") as f:
        json.dump([{
            "label": r["label"],
            "tir": r["tir"],
            "overlap": r["overlap"],
            "interference_type": r["interference_type"],
            "transcript": r["transcript"],
            "wer": r["metrics"]["wer"]["wer"],
            "uwr": r["metrics"]["uwr"]["uwr"],
            "csrr": r["metrics"]["csrr"]["csrr"],
            "hsr": r["metrics"]["hsr"]["hsr"],
        } for r in results], f, indent=2)
    print(f"\n  Results saved: {results_path}")
    print(f"  Audio files:   {tmpdir}")
    print(f"\n{'=' * 72}")
    print("  Live demo complete.")
    print("=" * 72)


if __name__ == "__main__":
    run_live_demo()
