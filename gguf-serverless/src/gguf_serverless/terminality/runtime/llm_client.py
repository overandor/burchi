"""
Real LLM client — actually connects to OpenAI, Anthropic, and local APIs.

This is not metadata. This makes real HTTP calls to real model providers
and returns real responses with real token counts.

Supports:
  - OpenAI-compatible endpoints (OpenAI, local GGUF, vLLM, etc.)
  - Anthropic Claude
  - Any OpenAI-compatible endpoint (Ollama, LM Studio, etc.)

Uses environment variables for API keys — never hardcodes credentials.
"""

from __future__ import annotations
import json
import os
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Optional, Any


@dataclass
class LLMResponse:
    """Real response from a real model."""
    text: str
    model: str
    tokens_in: int
    tokens_out: int
    elapsed_ms: float
    provider: str
    raw: dict = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        return self.tokens_in + self.tokens_out


class LLMClient:
    """Real LLM client that makes real API calls.

    Uses urllib (no external deps needed).
    API keys come from environment variables.
    """

    # Default endpoints
    ENDPOINTS = {
        "openai": "https://api.openai.com/v1/chat/completions",
        "anthropic": "https://api.anthropic.com/v1/messages",
        "local": "http://localhost:8080/v1/chat/completions",
        "llm7": "https://api.llm7.io/v1/chat/completions",
        "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    }

    def __init__(self, provider: str = "openai", model: str = "",
                 endpoint: str = "", api_key: str = ""):
        self.provider = provider
        self.model = model
        self.endpoint = endpoint or self.ENDPOINTS.get(provider, "")
        self.api_key = api_key or self._get_api_key(provider)

    def _get_api_key(self, provider: str) -> str:
        keys = {
            "openai": "OPENAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "google": "GOOGLE_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
            "local": "",
            "llm7": "",
        }
        env_var = keys.get(provider, "")
        return os.environ.get(env_var, "") if env_var else ""

    def chat(self, messages: list[dict[str, str]],
             max_tokens: int = 512,
             temperature: float = 0.3) -> LLMResponse:
        """Send a chat request and get a real response.

        messages: [{"role": "system"/"user"/"assistant", "content": "..."}]
        """
        if self.provider == "anthropic":
            return self._call_anthropic(messages, max_tokens, temperature)
        else:
            return self._call_openai_compatible(messages, max_tokens, temperature)

    def _call_openai_compatible(self, messages: list[dict],
                                max_tokens: int,
                                temperature: float) -> LLMResponse:
        """OpenAI-compatible API (OpenAI, Ollama, vLLM, LM Studio, llm7, etc.)."""
        body = json.dumps({
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }).encode()

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        start = time.time()
        req = urllib.request.Request(self.endpoint, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ""
            raise RuntimeError(f"API error {e.code}: {error_body}")
        elapsed = (time.time() - start) * 1000

        text = ""
        choices = data.get("choices", [])
        if choices:
            text = choices[0].get("message", {}).get("content", "")

        usage = data.get("usage", {})
        return LLMResponse(
            text=text,
            model=data.get("model", self.model),
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
            elapsed_ms=elapsed,
            provider=self.provider,
            raw=data,
        )

    def _call_anthropic(self, messages: list[dict],
                        max_tokens: int,
                        temperature: float) -> LLMResponse:
        """Anthropic Claude API."""
        # Anthropic requires system message separate
        system = ""
        chat_messages = []
        for m in messages:
            if m["role"] == "system":
                system += m["content"] + "\n"
            else:
                chat_messages.append(m)

        body = json.dumps({
            "model": self.model,
            "messages": chat_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system.strip(),
        }).encode()

        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }

        start = time.time()
        req = urllib.request.Request(self.endpoint, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ""
            raise RuntimeError(f"Anthropic API error {e.code}: {error_body}")
        elapsed = (time.time() - start) * 1000

        text = ""
        content = data.get("content", [])
        if isinstance(content, list):
            text = " ".join(
                block.get("text", "") for block in content
                if block.get("type") == "text"
            )

        usage = data.get("usage", {})
        return LLMResponse(
            text=text,
            model=data.get("model", self.model),
            tokens_in=usage.get("input_tokens", 0),
            tokens_out=usage.get("output_tokens", 0),
            elapsed_ms=elapsed,
            provider="anthropic",
            raw=data,
        )

    @staticmethod
    def from_peer_capabilities(caps: dict) -> "LLMClient":
        """Create a client from peer capabilities dict."""
        provider = caps.get("provider", "openai")
        model = caps.get("model_id", "")
        endpoint = caps.get("endpoint_url", "")
        api_key_env = caps.get("api_key_env", "")
        api_key = os.environ.get(api_key_env, "") if api_key_env else ""
        return LLMClient(provider=provider, model=model,
                         endpoint=endpoint, api_key=api_key)
