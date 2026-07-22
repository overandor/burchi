# Controlled Evaluation of Hallucination and Speaker-Confusion Errors in ASR Under Single-Channel Speech Overlap

## Overview

This project implements a controlled evaluation framework for studying ASR hallucination under overlapping speech conditions. Unlike ordinary WER measurement, this framework specifically tests whether acoustic overlap produces **fluent output unsupported by any recoverable source** at a rate not explained by ordinary recognition error alone.

## Architecture

```
src/mix_audios_dynamic.js    — Controlled audio mixer (FFmpeg-based, spawnSync)
src/generate_stimuli.js      — Full factorial stimulus generator
evaluation/compute_metrics.py — UWR, CSRR, HSR, WER, speaker-attributed WER
evaluation/run_experiment.py  — Experiment runner with H1-H5 hypothesis testing
annotation/annotate.py        — Blinded 5-class annotation protocol + Krippendorff's alpha
models/asr_adapters.py        — Adapters for Class A/B/C/D ASR models
tests/                        — Unit tests for mixer and metrics
```

## Experimental Design

### Factorial Matrix (§4)
- **Speaker Count (N):** 1, 2, 4, 8, 16
- **TIR:** +20, +10, +6, +3, 0, -3 dB
- **Temporal Overlap:** 0%, 25%, 50%, 75%, 100%
- **Interference Type:** intelligible, foreign, time-reversed, speech-shaped noise, silence
- **Decoder Condition:** deterministic (greedy) vs. stochastic (nucleus sampling)

### Preregistered Hypotheses (§4.2)
- **H1:** WER increases monotonically with speaker count, overlap, and decreasing TIR
- **H2:** Unsupported-span rate increases after controlling for WER
- **H3:** Intelligible competing speech produces higher CSRR than time-reversed or noise
- **H4:** Source separation reduces speaker-attributed WER but may still produce unsupported output
- **H5:** Composite abstention detector outperforms token entropy alone

### Metrics (§5)
- **UWR** — Unsupported Word Rate
- **CSRR** — Cross-Speaker Recombination Rate (min 3-word spans)
- **HSR** — Hallucinated Span Rate
- **WER** — Word Error Rate (with S/I/D breakdown)
- **Speaker-Attributed WER** — Target-only error rate

### Annotation Protocol (§6)
Five blinded classes:
1. Lexically Supported
2. Semantically Supported
3. Supported by Competitor
4. Plausibly Ambiguous
5. Unsupported

Inter-annotator agreement: Krippendorff's alpha ≥ 0.80 required.

### Stimulus Generation (§7)
- `normalize=0` in amix to preserve absolute gain (TIR as true independent variable)
- EBU R128 loudness standardization (-23 LUFS)
- 48 kHz sample rate, mono
- `spawnSync` for all FFmpeg calls (no string concatenation → no command injection)

## Usage

### 1. Generate Stimuli
```bash
node src/generate_stimuli.js target.wav interference1.wav interference2.wav --out ./output
```

### 2. Run ASR Models
```bash
python3 evaluation/run_experiment.py --manifest output/stimulus_manifest.json --out results
```

### 3. Create Blinded Annotation Tasks
```bash
python3 annotation/annotate.py create --decoded results/raw_transcriptions.json --reference reference.json --out annotation/tasks.json
```

### 4. Compute Metrics
```bash
python3 evaluation/compute_metrics.py --alignments annotation/alignments.json --out results/metrics.json
```

### 5. Run Tests
```bash
python3 tests/test_metrics.py
node tests/test_mixer.js
```

## Model Classes (§3)
| Class | Architecture | Example | Adapter |
|-------|-------------|---------|---------|
| A | Encoder-Decoder | Whisper | `WhisperAdapter` |
| B | CTC/Transducer | Emformer-RNNT | `EmformerRNNTAdapter` |
| C | Speech-LM | AudioLM | `AudioLMAdapter` (placeholder) |
| D | Multimodal | Gemini/GPT-4o | `MultimodalAdapter` |

## Dependencies
- FFmpeg + ffprobe (for audio mixing)
- Node.js 18+ (for stimulus generation)
- Python 3.10+ (for metrics, annotation, experiment runner)
- `openai-whisper` or `faster-whisper` (for Class A model)
- `torchaudio` (for Class B model)
- `OPENAI_API_KEY` or `GEMINI_API_KEY` (for Class D model)
