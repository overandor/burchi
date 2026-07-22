#!/usr/bin/env python3
"""
Checkpoint comparison experiment runner.

Tests hypothesis H6 (revised):
  Within the tested Whisper checkpoint family, larger parameter-count
  checkpoints are associated with lower HC under controlled speech-overlap
  conditions. This is a within-family descriptive observation, NOT a causal
  claim about pre-training exposure.

This runner:
  1. Generates controlled mixed audio conditions with FFmpeg
  2. Transcribes each with multiple Whisper model sizes
  3. Computes HC and capacity-normalized index per model per condition
  4. Reports correlation between λ and HC with proper statistics
"""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from experiments.hallucination_coefficient import (
    run_model_benchmark,
    print_report,
)

# ─── Audio generation ─────────────────────────────────────────────────

def generate_tone(path: str, freq: int, duration: float = 3.0):
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"sine=frequency={freq}:duration={duration}:sample_rate=48000",
        "-ac", "1", "-c:a", "pcm_s16le", path,
    ], capture_output=True, timeout=10)


def generate_speech(text: str, path: str, voice: str = "Samantha"):
    """Generate speech audio using macOS `say` TTS, converted to WAV."""
    # Use .aiff as intermediate because `say` writes AIFF/CAF naturally
    aiff_path = path.replace(".wav", ".aiff")
    subprocess.run([
        "say", "-v", voice, text, "-o", aiff_path,
    ], capture_output=True, timeout=30)
    subprocess.run([
        "ffmpeg", "-y", "-i", aiff_path,
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path,
    ], capture_output=True, timeout=30)


def aiff_to_wav(aiff_path: str, wav_path: str):
    subprocess.run([
        "ffmpeg", "-y", "-i", aiff_path,
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav_path,
    ], capture_output=True, timeout=30)


def normalize(input_path: str, output_path: str):
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path,
        "-af", "loudnorm=I=-23:TP=-2:LRA=11:linear=true",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output_path,
    ], capture_output=True, timeout=30)


def mix(target: str, interference: str, output: str, tir_db: float, overlap_frac: float, duration: float = 3.0):
    gain = 10 ** (-tir_db / 20)
    delay_ms = int(duration * (1 - overlap_frac) * 1000)
    filt = (
        f"[1:a]volume={gain},adelay={delay_ms}|{delay_ms}[delayed];"
        f"[0:a][delayed]amix=inputs=2:duration=longest:normalize=0[out]"
    )
    subprocess.run([
        "ffmpeg", "-y", "-i", target, "-i", interference,
        "-filter_complex", filt, "-map", "[out]",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output,
    ], capture_output=True, timeout=30)


def reverse(input_path: str, output_path: str):
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path, "-af", "areverse",
        "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output_path,
    ], capture_output=True, timeout=30)


# ─── Main experiment ──────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default="tiny,base", help="Comma-separated Whisper model names")
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    parser.add_argument("--use-live-mic", action="store_true", help="Use live microphone recordings")
    parser.add_argument("--target-text", default="The quick brown fox jumps over the lazy dog", help="Target TTS text")
    parser.add_argument("--interference-text", default="The cat sat on the mat today", help="Interference TTS text")
    parser.add_argument("--target-audio", default="", help="Path to existing target audio (overrides TTS)")
    parser.add_argument("--interference-audio", default="", help="Path to existing interference audio (overrides TTS)")
    parser.add_argument("--duration", type=float, default=3.0, help="Audio duration in seconds")
    args = parser.parse_args()

    model_names = [m.strip() for m in args.models.split(",")]

    print("=" * 72)
    print("  CHECKPOINT COMPARISON EXPERIMENT")
    print("  Testing: are larger Whisper checkpoints associated with lower HC?")
    print("  (Within-family descriptive evidence, NOT a scaling law)")
    print("=" * 72)

    tmpdir = tempfile.mkdtemp(prefix="pretrain_exp_")
    duration = args.duration

    target_transcript = args.target_text
    competitor_transcript = args.interference_text

    # Generate or load audio
    print("\n▶ Generating controlled audio conditions...")
    target_raw = os.path.join(tmpdir, "target.wav")
    interference_raw = os.path.join(tmpdir, "interference.wav")

    if args.target_audio:
        aiff_to_wav(args.target_audio, target_raw)
        print(f"  Using target audio: {args.target_audio}")
    else:
        generate_speech(target_transcript, target_raw, voice="Samantha")
        print(f"  Generated target TTS: \"{target_transcript}\"")

    if args.interference_audio:
        aiff_to_wav(args.interference_audio, interference_raw)
        print(f"  Using interference audio: {args.interference_audio}")
    else:
        generate_speech(competitor_transcript, interference_raw, voice="Alex")
        print(f"  Generated interference TTS: \"{competitor_transcript}\"")

    target_norm = os.path.join(tmpdir, "target_norm.wav")
    interference_norm = os.path.join(tmpdir, "interference_norm.wav")
    normalize(target_raw, target_norm)
    normalize(interference_raw, interference_norm)

    rev_interference = os.path.join(tmpdir, "interference_rev.wav")
    reverse(interference_norm, rev_interference)

    conditions = [
        ("clean", None, None, None, target_norm),
        ("tir_20_ol100", 20.0, 1.0, "intelligible", None),
        ("tir_6_ol100", 6.0, 1.0, "intelligible", None),
        ("tir_0_ol100", 0.0, 1.0, "intelligible", None),
        ("tir_neg3_ol100", -3.0, 1.0, "intelligible", None),
        ("tir_0_ol50", 0.0, 0.5, "intelligible", None),
        ("tir_0_ol25", 0.0, 0.25, "intelligible", None),
        ("tir_neg3_rev", -3.0, 1.0, "time_reversed", None),
    ]

    audio_conditions = []
    for label, tir, overlap, itype, explicit_path in conditions:
        if explicit_path:
            audio_path = explicit_path
        else:
            audio_path = os.path.join(tmpdir, f"{label}.wav")
            if itype == "time_reversed":
                mix(target_norm, rev_interference, audio_path, tir, overlap, duration)
            else:
                mix(target_norm, interference_norm, audio_path, tir, overlap, duration)

        audio_conditions.append({
            "label": label,
            "audio_path": audio_path,
            "tir_db": tir,
            "overlap": overlap,
            "interference_type": itype,
        })

    print(f"  Generated {len(audio_conditions)} conditions")

    # Run benchmark
    print("\n▶ Running multi-model benchmark...")
    print("  (This may take a while on CPU; each model loads separately)")

    report = run_model_benchmark(
        audio_conditions=audio_conditions,
        target_transcript=target_transcript,
        competitor_transcript=competitor_transcript,
        model_names=model_names,
        device=args.device,
        output_dir="results/hc_experiment",
    )

    print_report(report)

    # Keep tmpdir path for reference
    print(f"\n  Audio files preserved at: {tmpdir}")


if __name__ == "__main__":
    main()
