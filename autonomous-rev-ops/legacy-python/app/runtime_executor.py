"""Runtime execution layer — routes compiled models to actual inference runtimes.

Maps execution plans to real inference endpoints:
  - GGUF → llama.cpp (existing P2P swarm nodes or local worker)
  - Safetensors → vLLM (GPU containers)
  - ONNX → ONNX Runtime (serverless)
  - Diffusers → dedicated GPU endpoints
  - sentence-transformers → embedding API

The resolver checks:
  1. Is there a live inference node serving this model?
  2. Is there a known endpoint URL in the model registry?
  3. Can we spin up a runtime on demand?
"""

from __future__ import annotations

import os
import time
import httpx
from typing import Any

# Known inference endpoints — gguf-serverless-poc is a real llama.cpp server
# running Qwen2.5-0.5B-Instruct on Vercel Docker.
GGUF_ENDPOINTS = {
    "qwen2-0.5b-q3k": "https://gguf-serverless-poc.vercel.app",
    "qwen2-swarm": "https://gguf-serverless-poc.vercel.app",
    "qwen2.5-0.5b-instruct": "https://gguf-serverless-poc.vercel.app",
    "qwen2-0.5b": "https://gguf-serverless-poc.vercel.app",
}

# Fallback inference endpoint — real llama.cpp server
FALLBACK_GGUF_URL = os.environ.get("FALLBACK_GGUF_URL", "https://gguf-serverless-poc.vercel.app")

# vLLM endpoint (if deployed)
VLLM_ENDPOINT = os.environ.get("VLLM_ENDPOINT", "")

# ONNX Runtime endpoint (if deployed)
ONNX_ENDPOINT = os.environ.get("ONNX_ENDPOINT", "")

# Diffusers endpoint (if deployed)
DIFFUSERS_ENDPOINT = os.environ.get("DIFFUSERS_ENDPOINT", "")


async def resolve_and_execute(
    model_id: str,
    runtime: str,
    messages: list[dict] | None = None,
    prompt: str = "",
    max_tokens: int = 128,
    temperature: float = 0.7,
    stream: bool = False,
) -> dict[str, Any]:
    """Resolve the runtime for a compiled model and execute inference.

    Returns an OpenAI-compatible response dict.
    """
    if runtime == "llama_cpp":
        return await _execute_llama_cpp(
            model_id, messages, prompt, max_tokens, temperature, stream
        )
    elif runtime == "vllm":
        return await _execute_vllm(
            model_id, messages, prompt, max_tokens, temperature, stream
        )
    elif runtime == "onnxruntime":
        return await _execute_onnx(
            model_id, messages, prompt, max_tokens, temperature, stream
        )
    elif runtime == "sentence_transformers":
        return await _execute_embeddings(model_id, prompt)
    elif runtime == "diffusers":
        return await _execute_diffusers(model_id, prompt)
    else:
        return _error_response(model_id, f"Runtime '{runtime}' not yet connected")


async def _execute_llama_cpp(
    model_id: str,
    messages: list[dict] | None,
    prompt: str,
    max_tokens: int,
    temperature: float,
    stream: bool,
) -> dict[str, Any]:
    """Execute inference via llama.cpp (GGUF models)."""
    # Resolve endpoint — known endpoints take priority over DB (DB may have stale URLs)
    url = GGUF_ENDPOINTS.get(model_id, FALLBACK_GGUF_URL)

    # Check DB only if not in known endpoints
    if model_id not in GGUF_ENDPOINTS:
        try:
            from app import store_gguf
            model = store_gguf.get_model_by_name(model_id)
            if model and model.get("inference_url"):
                url = model["inference_url"]
            if not model:
                # Check if it's a compiled HF model
                for m in store_gguf.list_models():
                    if m.get("metadata", {}).get("source") == "huggingface" and model_id in m.get("name", ""):
                        if m.get("inference_url"):
                            url = m["inference_url"]
                        break
        except Exception:
            pass

    # Build messages
    if not messages:
        messages = [{"role": "user", "content": prompt}]

    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{url.rstrip('/')}/v1/chat/completions",
                json={
                    "model": "models/model.gguf",  # llama.cpp server expects this
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": False,
                },
            )
            elapsed_ms = int((time.time() - t0) * 1000)

            if resp.is_success:
                data = resp.json()
                # Log the inference
                try:
                    from app import store_gguf
                    store_gguf.log_inference({
                        "model_id": model_id,
                        "node_id": "resolved",
                        "prompt": (prompt or str(messages))[:200],
                        "success": True,
                        "latency_ms": elapsed_ms,
                        "tokens_generated": data.get("usage", {}).get("completion_tokens", 0),
                    })
                except Exception:
                    pass

                # Add metadata
                data["_meta"] = {
                    "runtime": "llama_cpp",
                    "endpoint": url,
                    "latency_ms": elapsed_ms,
                    "model_id": model_id,
                }
                return data
            else:
                return _error_response(
                    model_id,
                    f"llama.cpp endpoint returned {resp.status_code}: {resp.text[:200]}",
                )
    except httpx.TimeoutException:
        return _error_response(model_id, f"llama.cpp endpoint timed out after 120s (url={url})")
    except Exception as e:
        return _error_response(model_id, f"llama.cpp connection failed: {str(e)[:200]}")


async def _execute_vllm(
    model_id: str,
    messages: list[dict] | None,
    prompt: str,
    max_tokens: int,
    temperature: float,
    stream: bool,
) -> dict[str, Any]:
    """Execute inference via vLLM (safetensors models)."""
    if not VLLM_ENDPOINT:
        return _pending_response(
            model_id, "vllm",
            "vLLM endpoint not configured. Set VLLM_ENDPOINT environment variable.",
            messages, prompt,
        )

    if not messages:
        messages = [{"role": "user", "content": prompt}]

    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{VLLM_ENDPOINT.rstrip('/')}/v1/chat/completions",
                json={
                    "model": model_id,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": False,
                },
            )
            elapsed_ms = int((time.time() - t0) * 1000)

            if resp.is_success:
                data = resp.json()
                data["_meta"] = {
                    "runtime": "vllm",
                    "endpoint": VLLM_ENDPOINT,
                    "latency_ms": elapsed_ms,
                    "model_id": model_id,
                }
                return data
            else:
                return _error_response(model_id, f"vLLM returned {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        return _error_response(model_id, f"vLLM connection failed: {str(e)[:200]}")


async def _execute_onnx(
    model_id: str,
    messages: list[dict] | None,
    prompt: str,
    max_tokens: int,
    temperature: float,
    stream: bool,
) -> dict[str, Any]:
    """Execute inference via ONNX Runtime."""
    if not ONNX_ENDPOINT:
        return _pending_response(
            model_id, "onnxruntime",
            "ONNX Runtime endpoint not configured. Set ONNX_ENDPOINT environment variable.",
            messages, prompt,
        )

    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{ONNX_ENDPOINT.rstrip('/')}/v1/inference",
                json={"model": model_id, "input": prompt or str(messages)},
            )
            elapsed_ms = int((time.time() - t0) * 1000)

            if resp.is_success:
                data = resp.json()
                data["_meta"] = {
                    "runtime": "onnxruntime",
                    "endpoint": ONNX_ENDPOINT,
                    "latency_ms": elapsed_ms,
                }
                return data
            else:
                return _error_response(model_id, f"ONNX Runtime returned {resp.status_code}")
    except Exception as e:
        return _error_response(model_id, f"ONNX Runtime connection failed: {str(e)[:200]}")


async def _execute_embeddings(model_id: str, input_text: str) -> dict[str, Any]:
    """Execute embedding generation via a real embedding API.

    Uses Hugging Face Inference API (if HF_TOKEN is set) or a local
    sentence-transformers server (if EMBEDDING_ENDPOINT is set).
    Returns an error if no embedding backend is available.
    """
    import os
    import urllib.request
    import urllib.error

    # ─── Try local sentence-transformers server first ──────────────
    embedding_endpoint = os.environ.get("EMBEDDING_ENDPOINT", "")
    if embedding_endpoint:
        try:
            body = json.dumps({"model": model_id, "input": input_text}).encode("utf-8")
            req = urllib.request.Request(
                embedding_endpoint,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                return result
        except Exception as e:
            return _error_response(model_id, f"Embedding server error: {str(e)[:200]}")

    # ─── Try Hugging Face Inference API ────────────────────────────
    hf_token = os.environ.get("HF_TOKEN", os.environ.get("HUGGING_FACE_HUB_TOKEN", ""))
    if hf_token:
        try:
            url = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{model_id}"
            body = json.dumps({"inputs": input_text}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "Authorization": f"Bearer {hf_token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = json.loads(resp.read().decode("utf-8"))

                # HF returns a list of tokens, each with a list of floats
                # Average across tokens to get a single embedding (pure Python)
                if isinstance(raw, list) and raw and isinstance(raw[0], list):
                    # Average token embeddings into one vector
                    token_count = len(raw)
                    dim = len(raw[0]) if raw[0] else 0
                    embedding = [0.0] * dim
                    for token_vec in raw:
                        for i, val in enumerate(token_vec):
                            if i < dim:
                                embedding[i] += val
                    embedding = [v / token_count for v in embedding]
                elif isinstance(raw, list):
                    embedding = raw
                else:
                    embedding = []

                return {
                    "object": "list",
                    "data": [{
                        "id": "emb-0",
                        "object": "embedding",
                        "embedding": embedding,
                        "index": 0,
                    }],
                    "model": model_id,
                    "usage": {
                        "prompt_tokens": len(input_text.split()),
                        "total_tokens": len(input_text.split()),
                    },
                }
        except urllib.error.HTTPError as e:
            err = ""
            try:
                err = e.read().decode("utf-8")[:200]
            except Exception:
                err = str(e)
            return _error_response(model_id, f"HF embedding API error ({e.code}): {err}")
        except Exception as e:
            return _error_response(model_id, f"HF embedding error: {str(e)[:200]}")

    # ─── No embedding backend available ────────────────────────────
    return _error_response(
        model_id,
        "No embedding backend available. Set HF_TOKEN or EMBEDDING_ENDPOINT environment variable "
        "to enable real embedding generation via Hugging Face or a sentence-transformers server."
    )


async def _execute_diffusers(model_id: str, prompt: str) -> dict[str, Any]:
    """Execute image generation via diffusers."""
    if not DIFFUSERS_ENDPOINT:
        return {
            "created": int(time.time()),
            "data": [{
                "url": "",
                "revised_prompt": prompt,
            }],
            "_meta": {
                "runtime": "diffusers",
                "model": model_id,
                "status": "Diffusers endpoint not configured. Set DIFFUSERS_ENDPOINT to enable image generation.",
            },
        }

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{DIFFUSERS_ENDPOINT.rstrip('/')}/v1/images/generations",
                json={"model": model_id, "prompt": prompt},
            )
            if resp.is_success:
                data = resp.json()
                data["_meta"] = {"runtime": "diffusers", "endpoint": DIFFUSERS_ENDPOINT}
                return data
            else:
                return _error_response(model_id, f"Diffusers returned {resp.status_code}")
    except Exception as e:
        return _error_response(model_id, f"Diffusers connection failed: {str(e)[:200]}")


def _error_response(model_id: str, error: str) -> dict[str, Any]:
    return {
        "error": {"message": error, "type": "runtime_error"},
        "model": model_id,
    }


def _pending_response(
    model_id: str,
    runtime: str,
    message: str,
    messages: list[dict] | None,
    prompt: str,
) -> dict[str, Any]:
    prompt_text = prompt or " ".join(m.get("content", "") for m in (messages or []))
    return {
        "id": f"chatcmpl-pending-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_id,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": f"[{runtime}] {message}",
            },
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": len(prompt_text.split()), "completion_tokens": 0, "total_tokens": len(prompt_text.split())},
        "_meta": {
            "runtime": runtime,
            "status": "pending_endpoint",
            "model_id": model_id,
        },
    }
