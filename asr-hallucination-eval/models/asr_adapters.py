"""
ASR model adapters for the four model classes defined in §3.

Class A: Conventional Encoder-Decoder ASR (e.g., Whisper)
Class B: CTC or Transducer ASR (e.g., Emformer-RNNT)
Class C: Autoregressive Speech-Language Models (e.g., AudioLM)
Class D: General Multimodal Models (e.g., Gemini)

Each adapter implements a common interface:
  - transcribe(audio_path, decoder_condition) -> dict with transcript, tokens, metadata
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import urllib.request
import urllib.error
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class TranscriptionResult:
    """Result from a single transcription call."""
    transcript: str
    tokens: list[dict]  # word-level: {word, start_time, end_time, confidence}
    model_class: str
    model_name: str
    decoder_condition: str
    metadata: dict = field(default_factory=dict)
    raw_response: dict | None = None


class ASRAdapter(ABC):
    """Base class for ASR model adapters."""

    model_class: str = ""
    model_name: str = ""

    @abstractmethod
    def transcribe(
        self,
        audio_path: str,
        decoder_condition: str = "deterministic",
    ) -> TranscriptionResult:
        """Transcribe an audio file."""
        ...

    def is_available(self) -> bool:
        """Check if this model is available on the system."""
        return False


# ─── Class A: Whisper (Encoder-Decoder) ───────────────────────────────

class WhisperAdapter(ASRAdapter):
    """
    Class A: Conventional Encoder-Decoder ASR.
    Uses OpenAI Whisper via the whisper Python package or the faster-whisper backend.
    """

    model_class = "A"
    model_name = "whisper"

    def __init__(self, model_size: str = "base", device: str = "auto"):
        self.model_size = model_size
        self.device = device
        self._model = None

    def _load_model(self):
        if self._model is not None:
            return self._model

        try:
            import faster_whisper
            self._model = faster_whisper.WhisperModel(
                self.model_size, device=self.device if self.device != "auto" else "cpu"
            )
        except ImportError:
            try:
                import whisper
                self._model = whisper.load_model(self.model_size)
            except ImportError:
                raise RuntimeError(
                    "Neither faster-whisper nor whisper is installed. "
                    "Install with: pip install faster-whisper  OR  pip install openai-whisper"
                )
        return self._model

    def transcribe(self, audio_path: str, decoder_condition: str = "deterministic") -> TranscriptionResult:
        model = self._load_model()

        # Map decoder condition to parameters
        if decoder_condition == "deterministic":
            beam_size = 1
            temperature = 0.0
            sample = False
        else:
            beam_size = 1
            temperature = 0.8
            sample = True

        tokens = []
        transcript_text = ""

        if hasattr(model, "transcribe"):
            # faster-whisper
            segments, info = model.transcribe(
                audio_path,
                beam_size=beam_size,
                temperature=temperature,
                sample=sample,
                word_timestamps=True,
            )
            for seg in segments:
                transcript_text += seg.text + " "
                if seg.words:
                    for w in seg.words:
                        tokens.append({
                            "word": w.word.strip(),
                            "start_time": w.start,
                            "end_time": w.end,
                            "confidence": getattr(w, "probability", None),
                        })
        else:
            # openai-whisper
            result = model.transcribe(
                audio_path,
                beam_size=beam_size,
                temperature=temperature,
                word_timestamps=True,
            )
            transcript_text = result.get("text", "")
            for seg in result.get("segments", []):
                for w in seg.get("words", []):
                    tokens.append({
                        "word": w.get("word", "").strip(),
                        "start_time": w.get("start"),
                        "end_time": w.get("end"),
                        "confidence": w.get("probability"),
                    })

        return TranscriptionResult(
            transcript=transcript_text.strip(),
            tokens=tokens,
            model_class=self.model_class,
            model_name=self.model_name,
            decoder_condition=decoder_condition,
            metadata={"model_size": self.model_size},
        )

    def is_available(self) -> bool:
        try:
            import whisper  # noqa: F401
            return True
        except ImportError:
            try:
                import faster_whisper  # noqa: F401
                return True
            except ImportError:
                return False


# ─── Class B: Emformer-RNNT (CTC/Transducer) ──────────────────────────

class EmformerRNNTAdapter(ASRAdapter):
    """
    Class B: CTC or Transducer ASR.
    Uses torchaudio's Emformer-RNNT model.
    """

    model_class = "B"
    model_name = "emformer-rnnt"

    def __init__(self, use_gpu: bool = False):
        self.use_gpu = use_gpu
        self._model = None
        self._decoder = None

    def _load_model(self):
        if self._model is not None:
            return self._model

        import torch
        import torchaudio

        bundle = torchaudio.pipelines.EMFORMER_RNNT_BASE_LIBRISPEECH
        device = torch.device("cuda" if self.use_gpu and torch.cuda.is_available() else "cpu")
        self._model = bundle.get_model().to(device)
        self._decoder = bundle.get_decoder()
        self._labels = bundle.get_labels()
        self._device = device
        return self._model

    def transcribe(self, audio_path: str, decoder_condition: str = "deterministic") -> TranscriptionResult:
        import torch
        import torchaudio

        model = self._load_model()
        waveform, sample_rate = torchaudio.load(audio_path)

        # Resample if needed
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            waveform = resampler(waveform)
            sample_rate = 16000

        # Convert to mono if needed
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        waveform = waveform.to(self._device)

        # Emformer uses greedy decoder (deterministic) or beam search
        if decoder_condition == "deterministic":
            transcript, tokens_raw = self._greedy_decode(waveform)
        else:
            transcript, tokens_raw = self._beam_search(waveform)

        tokens = []
        for i, (word, timing) in enumerate(tokens_raw):
            tokens.append({
                "word": word,
                "start_time": timing.get("start") if isinstance(timing, dict) else None,
                "end_time": timing.get("end") if isinstance(timing, dict) else None,
                "confidence": timing.get("score") if isinstance(timing, dict) else None,
            })

        return TranscriptionResult(
            transcript=transcript,
            tokens=tokens,
            model_class=self.model_class,
            model_name=self.model_name,
            decoder_condition=decoder_condition,
            metadata={"sample_rate": sample_rate},
        )

    def _greedy_decode(self, waveform):
        import torch

        with torch.no_grad():
            hypothesis, _ = self._model.forward(waveform, self._decoder)
        transcript = "".join(hypothesis.tokens).replace("▁", " ").strip()
        return transcript, [(t, {}) for t in hypothesis.tokens]

    def _beam_search(self, waveform):
        # Fallback to greedy for now — beam search requires additional setup
        return self._greedy_decode(waveform)

    def is_available(self) -> bool:
        try:
            import torchaudio  # noqa: F401
            return True
        except ImportError:
            return False


# ─── Class C: AudioLM-style (Autoregressive Speech-Language Model) ────

class AudioLMAdapter(ASRAdapter):
    """
    Class C: Autoregressive Speech-Language Models.
    Placeholder adapter — AudioLM and similar models require custom inference pipelines.
    """

    model_class = "C"
    model_name = "audiolm-placeholder"

    def __init__(self, model_path: str | None = None):
        self.model_path = model_path

    def transcribe(self, audio_path: str, decoder_condition: str = "deterministic") -> TranscriptionResult:
        raise NotImplementedError(
            "AudioLM-style inference requires a custom pipeline. "
            "Implement _load_model and transcribe for your specific model."
        )

    def is_available(self) -> bool:
        return self.model_path is not None and Path(self.model_path).exists()


# ─── Class D: Multimodal Model (Gemini, GPT-4o, etc.) ─────────────────

class MultimodalAdapter(ASRAdapter):
    """
    Class D: General Multimodal Models.
    Feeds raw audio to a unified projection layer alongside text tokens.
    Supports Gemini API and OpenAI GPT-4o audio API.
    """

    model_class = "D"
    model_name = "multimodal"

    def __init__(self, provider: str = "openai", model: str = "gpt-4o-audio-preview"):
        self.provider = provider
        self.model = model

    def transcribe(self, audio_path: str, decoder_condition: str = "deterministic") -> TranscriptionResult:
        if self.provider == "openai":
            return self._transcribe_openai(audio_path, decoder_condition)
        elif self.provider == "gemini":
            return self._transcribe_gemini(audio_path, decoder_condition)
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

    def _transcribe_openai(self, audio_path: str, decoder_condition: str) -> TranscriptionResult:
        import base64

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set")

        # Read and encode audio
        with open(audio_path, "rb") as f:
            audio_data = base64.b64encode(f.read()).decode("utf-8")

        # Determine format from extension
        ext = Path(audio_path).suffix.lower()
        format_map = {".wav": "wav", ".mp3": "mp3", ".m4a": "mp4", ".flac": "flac"}
        audio_format = format_map.get(ext, "wav")

        temperature = 0.0 if decoder_condition == "deterministic" else 0.8

        payload = {
            "model": self.model,
            "modalities": ["text"],
            "audio": {"input": audio_data, "format": audio_format},
            "temperature": temperature,
            "messages": [
                {
                    "role": "user",
                    "content": "Transcribe this audio exactly. Return only the transcript text."
                }
            ],
        }

        request = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                result = json.loads(response.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"OpenAI API error: {e.read().decode()}")

        transcript = ""
        for choice in result.get("choices", []):
            msg = choice.get("message", {})
            transcript += msg.get("content", "")

        return TranscriptionResult(
            transcript=transcript.strip(),
            tokens=[],  # Multimodal models don't typically return word-level tokens
            model_class=self.model_class,
            model_name=f"{self.provider}/{self.model}",
            decoder_condition=decoder_condition,
            metadata={"api_response_id": result.get("id")},
            raw_response=result,
        )

    def _transcribe_gemini(self, audio_path: str, decoder_condition: str) -> TranscriptionResult:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set")

        with open(audio_path, "rb") as f:
            audio_data = f.read()

        ext = Path(audio_path).suffix.lower()
        mime_map = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac"}
        mime_type = mime_map.get(ext, "audio/wav")

        import base64
        encoded = base64.b64encode(audio_data).decode("utf-8")

        temperature = 0.0 if decoder_condition == "deterministic" else 0.8

        payload = {
            "contents": [{
                "parts": [
                    {"text": "Transcribe this audio exactly. Return only the transcript text."},
                    {"inline_data": {"mime_type": mime_type, "data": encoded}},
                ]
            }],
            "generationConfig": {"temperature": temperature},
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={api_key}"
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                result = json.loads(response.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Gemini API error: {e.read().decode()}")

        transcript = ""
        for candidate in result.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                transcript += part.get("text", "")

        return TranscriptionResult(
            transcript=transcript.strip(),
            tokens=[],
            model_class=self.model_class,
            model_name=f"gemini/{self.model}",
            decoder_condition=decoder_condition,
            metadata={"api_response": result.get("usageMetadata", {})},
            raw_response=result,
        )

    def is_available(self) -> bool:
        return bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("GEMINI_API_KEY"))


# ─── Adapter registry ─────────────────────────────────────────────────

def get_available_adapters() -> dict[str, ASRAdapter]:
    """Return all available model adapters."""
    adapters = {}

    whisper = WhisperAdapter()
    if whisper.is_available():
        adapters["whisper"] = whisper

    emformer = EmformerRNNTAdapter()
    if emformer.is_available():
        adapters["emformer-rnnt"] = emformer

    multimodal = MultimodalAdapter()
    if multimodal.is_available():
        adapters["multimodal"] = multimodal

    return adapters


def get_adapter_by_class(model_class: str) -> ASRAdapter | None:
    """Get the first available adapter for a given model class (A, B, C, D)."""
    for adapter in get_available_adapters().values():
        if adapter.model_class == model_class:
            return adapter
    return None
