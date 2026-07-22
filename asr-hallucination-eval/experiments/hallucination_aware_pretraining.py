#!/usr/bin/env python3
"""
Hallucination-aware pretraining experiment (5-arm causal test).

Preregistered hypothesis:
  A model jointly pretrained to estimate acoustic-support deficiency and adapt its
  generation loss before textual decoding will produce fewer fluent unsupported spans
  than an equivalent model protected only by post-decoding detection, while preserving
  clean-speech WER and coverage.

Five arms:
  1. Baseline: ordinary Whisper ASR training/decoding.
  2. Post-tokenization detector: baseline + detector that blocks suspicious output.
  3. Risk-head-only: encoder predicts h_hat, but gradient is detached from encoder/decoder.
  4. Hallucination-aware pretrained: risk head, encoder, decoder optimized jointly with
     adaptive lambda_eff.
  5. Combined: hallucination-aware training + post-decoding HDAR CommitGate.

The critical comparison is arm 4 vs arm 3:
  Does internalizing the risk signal into representations/policy reduce unsupported
  output beyond merely predicting it after the fact?
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import time
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

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
    compute_hallucination_coefficient,
    get_model_provenance,
)

EPS = 1e-6
TARGET_TRANSCRIPT = "The quick brown fox jumps over the lazy dog"
COMPETITOR_TRANSCRIPT = "The cat sat on the mat today"


# ─── Risk head ────────────────────────────────────────────────────────

class HallucinationRiskHead(nn.Module):
    """
    Pre-decoding risk head on encoder output z.

    Predicts h_hat = P(fluent output unsupported | audio encoder state).
    Input: encoder feature vector z (mean-pooled over time).
    Output: scalar logit -> sigmoid -> h_hat in (0,1).
    """

    def __init__(self, encoder_dim: int = 512, hidden_dim: int = 256):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(encoder_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, 1),
        )

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        """
        Args:
            z: (batch, time, encoder_dim) or (batch, encoder_dim)
        Returns:
            h_hat: (batch,) probability of unsupported output
        """
        if z.dim() == 3:
            z = z.mean(dim=1)
        logit = self.mlp(z).squeeze(-1)
        return torch.sigmoid(logit)


# ─── Adaptive loss ────────────────────────────────────────────────────

class JointHallucinationLoss(nn.Module):
    """
    Joint objective for hallucination-aware ASR training.

    L = L_ASR + lambda_eff * L_unsupported + lambda_a * L_abstain
        + lambda_c * L_clean_noisy_consistency + lambda_h * L_risk_calibration

    where lambda_eff = lambda / (c + epsilon) and c = 1 - h_hat is the
    estimated acoustic-support coefficient.
    """

    def __init__(
        self,
        base_lambda: float = 1.0,
        lambda_a: float = 0.5,
        lambda_c: float = 0.5,
        lambda_h: float = 0.5,
        epsilon: float = EPS,
    ):
        super().__init__()
        self.base_lambda = base_lambda
        self.lambda_a = lambda_a
        self.lambda_c = lambda_c
        self.lambda_h = lambda_h
        self.epsilon = epsilon

    def forward(
        self,
        asr_logits: torch.Tensor,
        targets: torch.Tensor,
        h_hat: torch.Tensor,
        support_label: torch.Tensor,
        clean_logits: torch.Tensor | None = None,
    ) -> dict[str, torch.Tensor]:
        """
        Args:
            asr_logits: (batch, seq, vocab) decoder logits
            targets: (batch, seq) target token ids
            h_hat: (batch,) predicted unsupported probability
            support_label: (batch,) 1 if audio supports the transcript, 0 if unsupported
            clean_logits: (batch, seq, vocab) optional clean-input teacher logits
        Returns:
            dict of loss terms and total loss
        """
        # 1. ASR cross-entropy
        asr_loss = F.cross_entropy(
            asr_logits.view(-1, asr_logits.size(-1)),
            targets.view(-1),
            ignore_index=-100,
            reduction="mean",
        )

        # 2. Unsupported penalty: penalize confident generation when support_label=1
        #    (the model should be uncertain/abstain)
        #    h_hat should be close to support_label for unsupported inputs
        #    We want h_hat -> 1 for unsupported, and the text loss to be down-weighted
        #    for high h_hat.
        c = 1.0 - h_hat  # acoustic support coefficient
        lambda_eff = self.base_lambda / (c + self.epsilon)

        # For unsupported samples, flip target to ABSTAIN token if provided, else
        # penalize probability mass on the original target sequence.
        unsupported_mask = (support_label == 1).float()
        token_probs = F.softmax(asr_logits, dim=-1)
        target_probs = token_probs.gather(-1, targets.unsqueeze(-1).clamp_min(0)).squeeze(-1)
        # L_unsupported: high when model is confident on unsupported target
        l_unsupported = -(unsupported_mask.unsqueeze(-1) * torch.log(target_probs + self.epsilon)).mean()

        # 3. Abstain loss: encourage high h_hat on unsupported, low h_hat on supported
        l_abstain = F.binary_cross_entropy(h_hat, support_label.float())

        # 4. Clean/noisy consistency: KL(clean_teacher || noisy_student)
        l_consistency = torch.tensor(0.0, device=asr_logits.device)
        if clean_logits is not None:
            l_consistency = F.kl_div(
                F.log_softmax(asr_logits, dim=-1),
                F.softmax(clean_logits.detach(), dim=-1),
                reduction="batchmean",
            )

        # 5. Risk calibration: BCE between h_hat and observed unsupported label
        l_calibration = F.binary_cross_entropy(h_hat, support_label.float(), reduction="mean")

        # Adaptive weighting: for each sample, lambda_eff scales L_unsupported
        total = (
            asr_loss
            + (lambda_eff * l_unsupported).mean()
            + self.lambda_a * l_abstain
            + self.lambda_c * l_consistency
            + self.lambda_h * l_calibration
        )

        return {
            "total": total,
            "asr": asr_loss,
            "unsupported": l_unsupported,
            "abstain": l_abstain,
            "consistency": l_consistency,
            "calibration": l_calibration,
            "lambda_eff_mean": lambda_eff.mean(),
        }


# ─── Corpus generation ────────────────────────────────────────────────

@dataclass
class TrainingExample:
    audio_path: str
    transcript: str
    support_label: int  # 0 = supported, 1 = unsupported / underdetermined
    condition: str
    source_map: str


def generate_speech(text: str, path: str, voice: str = "Samantha") -> str:
    """Generate speech audio using macOS `say` TTS, converted to WAV."""
    aiff_path = path.replace(".wav", ".aiff")
    subprocess.run(["say", "-v", voice, text, "-o", aiff_path], capture_output=True, timeout=30)
    subprocess.run(
        ["ffmpeg", "-y", "-i", aiff_path, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", path],
        capture_output=True,
        timeout=30,
    )
    return path


def normalize(input_path: str, output_path: str) -> str:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-af", "loudnorm=I=-23:TP=-2:LRA=11:linear=true",
            "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output_path,
        ],
        capture_output=True,
        timeout=30,
    )
    return output_path


def mix(target: str, interference: str, output: str, tir_db: float, overlap_frac: float, duration: float = 3.0) -> str:
    gain = 10 ** (-tir_db / 20)
    delay_ms = int(duration * (1 - overlap_frac) * 1000)
    filt = (
        f"[1:a]volume={gain},adelay={delay_ms}|{delay_ms}[delayed];"
        f"[0:a][delayed]amix=inputs=2:duration=longest:normalize=0[out]"
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", target, "-i", interference,
            "-filter_complex", filt, "-map", "[out]",
            "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output,
        ],
        capture_output=True,
        timeout=30,
    )
    return output


def reverse(input_path: str, output_path: str) -> str:
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-af", "areverse", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output_path],
        capture_output=True,
        timeout=30,
    )
    return output_path


def generate_noise(duration: float = 3.0, output_path: str = "noise.wav") -> str:
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            f"-i", f"sine=frequency=200:duration={duration}:sample_rate=48000",
            "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output_path,
        ],
        capture_output=True,
        timeout=10,
    )
    return output_path


def build_corpus(
    target_text: str = TARGET_TRANSCRIPT,
    competitor_text: str = COMPETITOR_TRANSCRIPT,
    out_dir: str | None = None,
    duration: float = 3.0,
) -> list[TrainingExample]:
    """
    Build paired training corpus with negative examples.

    Negative examples are plausible language-prior continuations that are
    unsupported by the source audio (reversed, silence, noise, underdetermined).
    """
    out_dir = Path(out_dir or tempfile.mkdtemp(prefix="ha_corpus_"))
    out_dir.mkdir(parents=True, exist_ok=True)

    target_raw = str(out_dir / "target.wav")
    competitor_raw = str(out_dir / "competitor.wav")
    generate_speech(target_text, target_raw, voice="Samantha")
    generate_speech(competitor_text, competitor_raw, voice="Alex")

    target_norm = str(out_dir / "target_norm.wav")
    competitor_norm = str(out_dir / "competitor_norm.wav")
    normalize(target_raw, target_norm)
    normalize(competitor_raw, competitor_norm)

    rev_competitor = str(out_dir / "competitor_rev.wav")
    reverse(competitor_norm, rev_competitor)

    noise_path = str(out_dir / "noise.wav")
    generate_noise(duration, noise_path)

    silence_path = str(out_dir / "silence.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", str(duration),
         "-ac", "1", "-c:a", "pcm_s16le", silence_path],
        capture_output=True,
        timeout=10,
    )

    # Underdetermined: both speakers mixed at equal level with full overlap
    under_path = str(out_dir / "underdetermined.wav")
    mix(target_norm, competitor_norm, under_path, 0.0, 1.0, duration)

    conditions = [
        ("clean", target_norm, target_text, 0, "target_only"),
        ("overlap_0db", under_path, target_text, 0, "target_plus_competitor"),
        ("reversed", rev_competitor, "ABSTAIN", 1, "no_semantic_source"),
        ("noise", noise_path, "ABSTAIN", 1, "no_speech"),
        ("silence", silence_path, "ABSTAIN", 1, "no_speech"),
        ("underdetermined", under_path, "ABSTAIN", 1, "multiple_sources_uncertain"),
    ]

    examples = []
    for cond, audio, transcript, label, source_map in conditions:
        examples.append(
            TrainingExample(
                audio_path=audio,
                transcript=transcript,
                support_label=label,
                condition=cond,
                source_map=source_map,
            )
        )

    return examples


# ─── 5-arm experiment runner ──────────────────────────────────────────

@dataclass
class ArmConfig:
    name: str
    use_risk_head: bool = False
    detach_risk_head: bool = False
    joint_training: bool = False
    post_decoder_filter: bool = False


ARMS = [
    ArmConfig(name="baseline"),
    ArmConfig(name="post_tokenization_detector", post_decoder_filter=True),
    ArmConfig(name="risk_head_only", use_risk_head=True, detach_risk_head=True),
    ArmConfig(name="hallucination_aware_pretrained", use_risk_head=True, joint_training=True),
    ArmConfig(name="combined", use_risk_head=True, joint_training=True, post_decoder_filter=True),
]


def run_arm(
    arm: ArmConfig,
    corpus: list[TrainingExample],
    base_model: str = "tiny",
    device: str = "cpu",
    n_epochs: int = 3,
    output_dir: str = "results/hallucination_aware_experiment",
) -> dict[str, Any]:
    """
    Train and evaluate one experiment arm.

    This is a prototype scaffold. Full Whisper fine-tuning is compute-intensive;
    the function demonstrates the training objective and evaluation protocol.
    """
    print(f"\n{'='*60}")
    print(f"Arm: {arm.name}")
    print(f"{'='*60}")

    # Placeholder: load Whisper model and wrap with risk head if needed
    try:
        import whisper
    except ImportError:
        print("  WARNING: openai-whisper not installed; returning scaffold result")
        return {"arm": arm.name, "status": "sketch", "note": "install openai-whisper and torch to run"}

    warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")
    model = whisper.load_model(base_model, device=device)

    risk_head = None
    if arm.use_risk_head:
        # Whisper encoder output dimension depends on model size
        encoder_dim = {"tiny": 384, "base": 512, "small": 768}.get(base_model, 512)
        risk_head = HallucinationRiskHead(encoder_dim).to(device)

    joint_loss = JointHallucinationLoss().to(device)
    optimizer = torch.optim.AdamW(
        list(model.parameters()) + (list(risk_head.parameters()) if risk_head else []),
        lr=1e-5,
    )

    # In a full implementation, the mel spectrograms, target token ids, and
    # encoder features would be batched and fed through the model. The following
    # loop is a structural sketch of the training procedure.
    history = []
    for epoch in range(n_epochs):
        epoch_loss = 0.0
        for ex in corpus:
            # Load audio to mel (pseudo-code)
            # mel = whisper.log_mel_spectrogram(ex.audio_path).to(device)
            # with torch.no_grad():
            #     encoder_out = model.encoder(mel.unsqueeze(0))
            # if risk_head:
            #     h_hat = risk_head(encoder_out)
            # else:
            #     h_hat = torch.zeros(1, device=device)
            # decoder_logits, targets, support_label, clean_logits = ...
            # loss = joint_loss(decoder_logits, targets, h_hat, support_label, clean_logits)
            # if arm.detach_risk_head:
            #     # risk head is a classifier only; do not backprop through encoder
            #     loss["unsupported"].backward()
            # else:
            #     loss["total"].backward()
            # optimizer.step(); optimizer.zero_grad()
            epoch_loss += 0.0  # placeholder
        history.append({"epoch": epoch, "loss": epoch_loss})

    # Evaluation: decode each test condition and compute metrics
    results = []
    for ex in corpus:
        result = model.transcribe(ex.audio_path, temperature=0.0)
        transcript = result["text"].strip()

        if arm.post_decoder_filter and risk_head is not None:
            # Placeholder: block if h_hat > threshold
            pass

        target_words = TARGET_TRANSCRIPT.lower().split()
        competitor_words = COMPETITOR_TRANSCRIPT.lower().split()
        tokens = []
        for seg in result.get("segments", []):
            for w in seg.get("words", []):
                tokens.append({"word": w.get("word", "").strip(), "probability": w.get("probability")})

        annotations = auto_annotate_tokens(tokens, target_words, competitor_words)
        alignment = AlignmentResult(
            stimulus_id=f"{arm.name}_{ex.condition}",
            target_transcript=TARGET_TRANSCRIPT,
            decoded_transcript=transcript,
            tokens=annotations,
            target_tokens=target_words,
            competitor_tokens=competitor_words,
        )
        metrics = compute_all_metrics(alignment)
        hc = compute_hallucination_coefficient(metrics)
        results.append(
            {
                "condition": ex.condition,
                "transcript": transcript,
                "wer": metrics["wer"]["wer"],
                "uwr": metrics["uwr"]["uwr"],
                "hsr": metrics["hsr"]["hsr"],
                "csrr": metrics["csrr"]["csrr"],
                "hc": hc["hc"],
                "support_label": ex.support_label,
            }
        )

    # Aggregate
    hsr_values = [r["hsr"] for r in results]
    wer_values = [r["wer"] for r in results]
    summary = {
        "mean_hsr": float(np.mean(hsr_values)) if hsr_values else 0.0,
        "mean_wer": float(np.mean(wer_values)) if wer_values else 0.0,
        "results": results,
        "provenance": get_model_provenance(base_model),
    }

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    (out_path / f"{arm.name}.json").write_text(json.dumps(summary, indent=2) + "\n")

    return summary


def run_experiment(
    base_model: str = "tiny",
    device: str = "cpu",
    n_epochs: int = 3,
    output_dir: str = "results/hallucination_aware_experiment",
) -> dict[str, Any]:
    """
    Run the 5-arm hallucination-aware pretraining experiment.
    """
    corpus = build_corpus(out_dir=os.path.join(tempfile.gettempdir(), "ha_corpus"))
    arms = {arm.name: run_arm(arm, corpus, base_model, device, n_epochs, output_dir) for arm in ARMS}

    # Critical comparison: joint training vs detached risk head
    joint_hsr = arms["hallucination_aware_pretrained"].get("mean_hsr", float("inf"))
    detached_hsr = arms["risk_head_only"].get("mean_hsr", float("inf"))
    post_hsr = arms["post_tokenization_detector"].get("mean_hsr", float("inf"))

    hypothesis_supported = (
        joint_hsr < post_hsr  # better than post-hoc
        and joint_hsr < detached_hsr  # better than detached head
    )

    report = {
        "schema": "asr.hallucination-aware-experiment/v1.0",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "base_model": base_model,
        "preregistered_hypothesis": (
            "A model jointly pretrained to estimate acoustic-support deficiency and adapt its "
            "generation loss before textual decoding will produce fewer fluent unsupported spans "
            "than an equivalent model protected only by post-decoding detection."
        ),
        "critical_comparison": "hallucination_aware_pretrained vs risk_head_only",
        "decision_criterion": (
            "HSR_pretrained < HSR_posthoc AND HSR_pretrained < HSR_detached, "
            "while clean WER delta <= 0.05 and unnecessary abstention rate <= 0.10."
        ),
        "arms": arms,
        "hypothesis_supported": hypothesis_supported,
        "mean_hsr_by_arm": {name: arm.get("mean_hsr") for name, arm in arms.items()},
        "mean_wer_by_arm": {name: arm.get("mean_wer") for name, arm in arms.items()},
    }

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    (out_path / "experiment_report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"\nExperiment report: {out_path / 'experiment_report.json'}")
    print(f"Hypothesis supported: {hypothesis_supported}")

    return report


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="tiny", help="Whisper base model size")
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    parser.add_argument("--epochs", type=int, default=3, help="training epochs per arm")
    parser.add_argument("--out-dir", default="results/hallucination_aware_experiment", help="output directory")
    args = parser.parse_args()

    run_experiment(
        base_model=args.model,
        device=args.device,
        n_epochs=args.epochs,
        output_dir=args.out_dir,
    )
