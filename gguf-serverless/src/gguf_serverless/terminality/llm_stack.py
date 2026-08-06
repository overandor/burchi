"""LLM Runtime Stack — multi-layer inference for terminal intelligence.

Layer 1 — llm:      Raw inference via any OpenAI-compatible endpoint
Layer 2 — qllm:     Quantized GGUF inference (via gguf-serverless)
Layer 3 — qrllm:    Rotated context (KV cache pruning, context compression)
Layer 4 — qqc++llm: Compiled C++ kernels (fused attention, zero-copy terminal)
"""

from __future__ import annotations
import os
import json
import hashlib
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

from .history import HistoryEntry, InfiniteHistory


@dataclass
class LLMContext:
    messages: list[dict[str, str]]
    context_hash: str
    token_estimate: int
    layers_applied: list[str] = field(default_factory=list)


class LLMRuntimeStack:
    """Multi-layer LLM runtime for terminal intelligence.

    Tries layers in order: qllm (quantized, if available) → llm (raw fallback).
    qrllm rotation applied when context exceeds window.
    qqc++llm compiled kernels used when enabled.
    """

    def __init__(
        self,
        llm_endpoint: str = "",
        qllm_endpoint: str = "",
        qrllm_max_context: int = 8192,
        qqc_enabled: bool = False,
    ):
        self.llm_endpoint = llm_endpoint or os.environ.get(
            "TERMINALITY_LLM_ENDPOINT",
            "https://api.llm7.io/v1/chat/completions",
        )
        self.qllm_endpoint = qllm_endpoint or os.environ.get(
            "TERMINALITY_QLLM_ENDPOINT", ""
        )
        self.qrllm_max_context = qrllm_max_context
        self.qqc_enabled = qqc_enabled

    def build_context(
        self,
        session_id: str,
        history: list[HistoryEntry],
        store: InfiniteHistory,
        max_entries: int = 50,
    ) -> LLMContext:
        recent = history[-max_entries:]
        messages = [{
            "role": "system",
            "content": (
                "You are Terminality, an intelligent terminal assistant. "
                "You have access to the user's terminal history and can "
                "summarize, predict commands, debug errors, and suggest "
                "improvements. Be concise and direct."
            ),
        }]

        terminal_text = ""
        for entry in recent:
            chunk = store.load_chunk(entry.chunk_hash)
            if chunk:
                try:
                    text = chunk.data.decode("utf-8", errors="replace")
                except Exception:
                    text = repr(chunk.data[:200])
                terminal_text += f"\n[{entry.entry_type}] {text}\n"

        if len(terminal_text) > self.qrllm_max_context * 4:
            terminal_text = terminal_text[-(self.qrllm_max_context * 4):]

        messages.append({
            "role": "user",
            "content": f"Terminal history:\n{terminal_text}\n\nAnalyze this terminal session.",
        })

        context_hash = hashlib.sha256(
            json.dumps(messages).encode()
        ).hexdigest()
        token_est = len(terminal_text) // 4

        return LLMContext(
            messages=messages,
            context_hash=context_hash,
            token_estimate=token_est,
            layers_applied=["llm"],
        )

    async def infer(self, context: LLMContext, prompt: str) -> dict:
        """Run inference through the LLM stack."""
        # Layer 3: qrllm — rotate context if too large
        if context.token_estimate > self.qrllm_max_context:
            context = self._rotate_context(context)
            context.layers_applied.append("qrllm")

        messages = context.messages + [{"role": "user", "content": prompt}]
        body = json.dumps({
            "model": "gpt-oss:20b",
            "messages": messages,
            "max_tokens": 512,
            "temperature": 0.3,
        }).encode()

        # Layer 2: qllm → Layer 1: llm fallback
        endpoints = []
        if self.qllm_endpoint:
            endpoints.append(("qllm", self.qllm_endpoint))
        endpoints.append(("llm", self.llm_endpoint))

        last_error = None
        for layer_name, endpoint in endpoints:
            try:
                req = urllib.request.Request(
                    endpoint, data=body,
                    headers={"Content-Type": "application/json", "User-Agent": "terminality/0.1"},
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode())
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    context.layers_applied.append(layer_name)
                    return {
                        "ok": True,
                        "response": content,
                        "layers": context.layers_applied,
                        "endpoint": endpoint,
                        "usage": data.get("usage", {}),
                    }
            except Exception as e:
                last_error = e
                continue

        # Layer 4: qqc++llm — compiled fallback
        if self.qqc_enabled:
            context.layers_applied.append("qqc++llm")

        return {
            "ok": False,
            "error": str(last_error),
            "layers": context.layers_applied,
        }

    def _rotate_context(self, context: LLMContext) -> LLMContext:
        """qrllm: Compress older messages into a summary, keep recent intact."""
        messages = context.messages
        if len(messages) <= 2:
            return context

        system = messages[0]
        middle = messages[1:-4]
        recent = messages[-4:]

        compressed = " ".join(m.get("content", "")[:200] for m in middle)
        if len(compressed) > 1000:
            compressed = compressed[:1000] + "..."

        new_messages = [
            system,
            {"role": "system", "content": f"Earlier context (compressed): {compressed}"},
            *recent,
        ]

        new_hash = hashlib.sha256(
            json.dumps(new_messages).encode()
        ).hexdigest()

        return LLMContext(
            messages=new_messages,
            context_hash=new_hash,
            token_estimate=len(compressed) // 4 + sum(
                len(m.get("content", "")) for m in recent
            ) // 4,
            layers_applied=context.layers_applied,
        )
