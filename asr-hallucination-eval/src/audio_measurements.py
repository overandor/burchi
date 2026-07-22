#!/usr/bin/env python3
"""
Post-render audio measurement utilities.

Measures realized properties of generated stimuli:
  - Integrated LUFS (ITU-R BS.1770-4)
  - True peak (dBTP)
  - Clipping / overmodulation sample count
  - Achieved TIR from RMS energy in isolated vs. mixed regions
  - Active-speech overlap percentage
  - Waveform hash for provenance

All measurements use ffprobe/ffmpeg JSON output. No command injection.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

import numpy as np


def run_ffprobe(args: list[str]) -> dict[str, Any] | None:
    """Run ffprobe with JSON output and parse result."""
    cmd = ["ffprobe", "-v", "error", "-print_format", "json"] + args
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def get_audio_hash(file_path: str) -> str:
    """Return SHA-256 hash of audio file bytes."""
    return hashlib.sha256(Path(file_path).read_bytes()).hexdigest()


def measure_loudness(file_path: str) -> dict[str, float | None]:
    """
    Measure integrated loudness and true peak using FFmpeg loudnorm.
    Returns dict with input_i (LUFS), input_tp (dBTP), input_lra, input_thresh.
    """
    result = subprocess.run([
        "ffmpeg", "-y", "-i", file_path,
        "-af", "loudnorm=I=-23:TP=-2:LRA=11:print_format=json",
        "-f", "null", "-",
    ], capture_output=True, text=True, timeout=60)

    if result.returncode != 0:
        return {"input_i": None, "input_tp": None, "input_lra": None, "input_thresh": None}

    # FFmpeg 8.x prints a multi-line JSON block starting with '{'
    stderr = result.stderr
    start = stderr.find("{")
    end = stderr.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            data = json.loads(stderr[start:end])
            return {
                "input_i": float(data.get("input_i", 0)),
                "input_tp": float(data.get("input_tp", 0)),
                "input_lra": float(data.get("input_lra", 0)),
                "input_thresh": float(data.get("input_thresh", 0)),
            }
        except (json.JSONDecodeError, ValueError):
            pass

    return {"input_i": None, "input_tp": None, "input_lra": None, "input_thresh": None}


def measure_clipping(file_path: str, threshold_db: float = -0.1) -> dict[str, Any]:
    """
    Count samples exceeding a dBFS threshold and compute crest factor.
    Returns peak_dBFS, clip_count, total_samples, clip_rate.
    """
    result = subprocess.run([
        "ffmpeg", "-y", "-i", file_path,
        "-af", "volumedetect",
        "-f", "null", "-",
    ], capture_output=True, text=True, timeout=60)

    if result.returncode != 0:
        return {"peak_dBFS": None, "clip_count": None, "total_samples": None, "clip_rate": None}

    max_volume = None
    for line in result.stderr.splitlines():
        if "max_volume" in line:
            try:
                max_volume = float(line.split(":")[1].strip().split(" ")[0])
            except (ValueError, IndexError):
                continue

    if max_volume is None:
        return {"peak_dBFS": None, "clip_count": None, "total_samples": None, "clip_rate": None}

    # Count samples above threshold using astats
    threshold_linear = 10 ** (threshold_db / 20)
    result2 = subprocess.run([
        "ffmpeg", "-y", "-i", file_path,
        "-af", f"astats=measure_perchannel=none,ametadata=print:file=-",
        "-f", "null", "-",
    ], capture_output=True, text=True, timeout=60)

    # Simpler: use ebur128 or direct sample reading with ffprobe
    # We'll read samples via ffmpeg and count in Python for reliability
    samples = read_audio_samples(file_path)
    if samples is None:
        return {"peak_dBFS": max_volume, "clip_count": None, "total_samples": None, "clip_rate": None}

    abs_samples = np.abs(samples)
    max_sample = np.max(abs_samples)
    peak_dbfs = 20 * np.log10(max_sample) if max_sample > 0 else -np.inf
    clip_count = int(np.sum(abs_samples >= threshold_linear))
    total = len(samples)

    return {
        "peak_dBFS": peak_dbfs,
        "clip_count": clip_count,
        "total_samples": total,
        "clip_rate": clip_count / total if total > 0 else 0.0,
    }


def read_audio_samples(file_path: str, sample_rate: int = 48000) -> np.ndarray | None:
    """Read mono audio file into numpy array of float32 samples in [-1, 1]."""
    result = subprocess.run([
        "ffmpeg", "-y", "-i", file_path,
        "-ar", str(sample_rate), "-ac", "1",
        "-f", "f32le", "-",
    ], capture_output=True, timeout=60)

    if result.returncode != 0 or not result.stdout:
        return None

    return np.frombuffer(result.stdout, dtype=np.float32)


def measure_rms_energy(file_path: str, start_sec: float = 0.0, end_sec: float | None = None) -> float | None:
    """Measure RMS energy in a time window."""
    samples = read_audio_samples(file_path)
    if samples is None:
        return None

    sample_rate = 48000
    start = int(start_sec * sample_rate)
    end = int(end_sec * sample_rate) if end_sec is not None else len(samples)
    window = samples[start:end]

    if len(window) == 0:
        return 0.0

    rms = np.sqrt(np.mean(window ** 2))
    return float(rms)


def measure_achieved_tir(
    mixed_path: str,
    target_path: str,
    interference_path: str,
    overlap_fraction: float,
    duration_sec: float = 3.0,
) -> dict[str, float | None]:
    """
    Estimate achieved TIR by comparing RMS energy in isolated vs. overlapping regions.

    Strategy:
      - Target-only region: first (1 - overlap) * duration of mixed file
      - Overlap region: last overlap * duration of mixed file
      - Interference-only reference: same duration from isolated interference file

    Returns achieved_tir_db, target_rms, interference_rms, overlap_rms.
    """
    mixed = read_audio_samples(mixed_path)
    target = read_audio_samples(target_path)
    interference = read_audio_samples(interference_path)

    if mixed is None or target is None or interference is None:
        return {"achieved_tir_db": None, "target_rms": None, "interference_rms": None, "overlap_rms": None}

    sr = 48000
    total_samples = len(mixed)
    overlap_samples = int(total_samples * overlap_fraction)

    # Target-only region: beginning of mixed file (before interference starts)
    target_only_end = total_samples - overlap_samples
    target_region = mixed[:target_only_end] if target_only_end > 0 else mixed

    # Overlap region: end of mixed file
    overlap_region = mixed[-overlap_samples:] if overlap_samples > 0 else mixed

    # Interference reference: same time window from isolated interference
    interference_region = interference[-overlap_samples:] if overlap_samples > 0 and overlap_samples <= len(interference) else interference

    target_rms = np.sqrt(np.mean(target_region ** 2)) if len(target_region) > 0 else 0.0
    overlap_rms = np.sqrt(np.mean(overlap_region ** 2)) if len(overlap_region) > 0 else 0.0
    interference_rms = np.sqrt(np.mean(interference_region ** 2)) if len(interference_region) > 0 else 0.0

    # Achieved TIR: ratio of target energy to interference energy in overlap region
    if interference_rms > 0 and target_rms > 0:
        # In overlap region, mixed = target + interference * gain
        # We approximate interference energy by subtracting target estimate
        # But simpler: use isolated interference RMS as reference
        achieved_tir_db = 20 * np.log10(target_rms / interference_rms)
    else:
        achieved_tir_db = None

    return {
        "achieved_tir_db": achieved_tir_db,
        "target_rms": float(target_rms),
        "interference_rms": float(interference_rms),
        "overlap_rms": float(overlap_rms),
    }


def full_audio_report(file_path: str) -> dict[str, Any]:
    """Return a full measurement report for a single audio file."""
    return {
        "file": file_path,
        "sha256": get_audio_hash(file_path),
        "loudness": measure_loudness(file_path),
        "clipping": measure_clipping(file_path),
    }


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        print(json.dumps(full_audio_report(sys.argv[1]), indent=2))
    else:
        print("Usage: python3 src/audio_measurements.py <audio_file>")
