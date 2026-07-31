"""Inference router — route prompts to the right node and model."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app import store_gguf as store
from app.schemas_gguf import InferenceRequest, InferenceResponse
from app.auth_gguf import verify_api_key

router = APIRouter(prefix="/api/inference", tags=["inference"])

# Known inference endpoints
INFERENCE_ENDPOINTS = {
    "qwen2-0.5b-q3k": "https://gguf-p2p-deploy.vercel.app",
    "qwen2-swarm": "https://gguf-p2p-deploy.vercel.app",
}

# Fallback: check nodes for inference URLs
FALLBACK_URL = "https://gguf-p2p-deploy.vercel.app"


def _resolve_endpoint(model_id: Optional[str], node_id: Optional[str]) -> tuple[str, str, str]:
    """Resolve which inference endpoint to use.

    Returns: (url, model_id, node_id)
    """
    # 1. Explicit node
    if node_id:
        node = store.get_node(node_id)
        if node and node.get("inference_url"):
            return node["inference_url"], model_id or "", node_id

    # 2. Explicit model → find node serving it
    if model_id:
        model = store.get_model(model_id)
        if model and model.get("inference_url"):
            return model["inference_url"], model_id, node_id or ""

        # Check if any node serves this model
        for node in store.list_nodes():
            if model_id in node.get("models", []) and node.get("inference_url"):
                return node["inference_url"], model_id, node["node_id"]

    # 3. Known endpoint
    if model_id and model_id in INFERENCE_ENDPOINTS:
        return INFERENCE_ENDPOINTS[model_id], model_id, node_id or ""

    # 4. Fallback
    return FALLBACK_URL, model_id or "qwen2-0.5b-q3k", node_id or "default"


@router.post("", response_model=InferenceResponse)
async def inference(body: InferenceRequest, key_info: dict = Depends(verify_api_key)):
    """Run inference on a torrent-served model."""
    url, model_id, node_id = _resolve_endpoint(body.model_id, body.node_id)

    store.log_event("inference_request", model_id=model_id, node_id=node_id)

    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            messages = []
            if body.system_prompt:
                messages.append({"role": "system", "content": body.system_prompt})
            messages.append({"role": "user", "content": body.prompt})

            resp = await client.post(
                f"{url.rstrip('/')}/v1/chat/completions",
                json={
                    "model": "gguf-model",
                    "messages": messages,
                    "max_tokens": body.max_tokens,
                    "temperature": body.temperature,
                    "stream": False,
                },
            )
            elapsed_ms = int((time.time() - t0) * 1000)

            if not resp.is_success:
                error_detail = resp.text[:200]
                store.log_inference({
                    "model_id": model_id, "node_id": node_id,
                    "prompt": body.prompt[:200], "success": False,
                    "error": error_detail, "elapsed_ms": elapsed_ms,
                })
                return InferenceResponse(
                    ok=False, error=f"Inference server returned {resp.status_code}",
                    detail=error_detail, model_id=model_id, node_id=node_id,
                    elapsed_ms=elapsed_ms,
                )

            data = resp.json()
            response_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            usage = data.get("usage", {})
            perf = data.get("timings", {})

            gen_tps = perf.get("predicted_per_second", 0)
            prompt_tps = perf.get("prompt_per_second", 0)

            store.log_inference({
                "model_id": model_id, "node_id": node_id,
                "prompt": body.prompt[:200], "response": response_text[:200],
                "success": True, "elapsed_ms": elapsed_ms,
                "tokens_prompt": usage.get("prompt_tokens", 0),
                "tokens_completion": usage.get("completion_tokens", 0),
                "gen_tok_per_sec": gen_tps,
                "prompt_tok_per_sec": prompt_tps,
            })

            return InferenceResponse(
                ok=True, response=response_text,
                model_id=model_id, node_id=node_id,
                elapsed_ms=elapsed_ms,
                tokens={
                    "prompt": usage.get("prompt_tokens", 0),
                    "completion": usage.get("completion_tokens", 0),
                },
                performance={
                    "genTokPerSec": gen_tps,
                    "promptTokPerSec": prompt_tps,
                    "genMs": perf.get("predicted_ms", 0),
                    "promptMs": perf.get("prompt_ms", 0),
                },
            )

    except httpx.ReadTimeout:
        elapsed_ms = int((time.time() - t0) * 1000)
        return InferenceResponse(
            ok=False, error="Inference server timed out. Container may be cold-starting.",
            coldStart=True, model_id=model_id, node_id=node_id, elapsed_ms=elapsed_ms,
        )
    except Exception as e:
        elapsed_ms = int((time.time() - t0) * 1000)
        store.log_inference({
            "model_id": model_id, "node_id": node_id,
            "prompt": body.prompt[:200], "success": False,
            "error": str(e), "elapsed_ms": elapsed_ms,
        })
        return InferenceResponse(
            ok=False, error=str(e), model_id=model_id, node_id=node_id,
            elapsed_ms=elapsed_ms,
        )


@router.post("/stream")
async def inference_stream(body: InferenceRequest, key_info: dict = Depends(verify_api_key)):
    """Stream inference via SSE."""
    url, model_id, node_id = _resolve_endpoint(body.model_id, body.node_id)

    async def generate():
        async with httpx.AsyncClient(timeout=120.0) as client:
            messages = []
            if body.system_prompt:
                messages.append({"role": "system", "content": body.system_prompt})
            messages.append({"role": "user", "content": body.prompt})

            async with client.stream(
                "POST",
                f"{url.rstrip('/')}/v1/chat/completions",
                json={
                    "model": "gguf-model",
                    "messages": messages,
                    "max_tokens": body.max_tokens,
                    "temperature": body.temperature,
                    "stream": True,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        yield f"{line}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/logs")
async def get_inference_logs(limit: int = 50, key_info: dict = Depends(verify_api_key)):
    """Get recent inference logs."""
    import sqlite3
    conn = store._get_conn()
    rows = conn.execute(
        "SELECT * FROM inference_logs ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    return [
        {
            "id": r["id"],
            "model_id": r["model_id"],
            "node_id": r["node_id"],
            "elapsed_ms": r["elapsed_ms"],
            "tokens_prompt": r["tokens_prompt"],
            "tokens_completion": r["tokens_completion"],
            "gen_tok_per_sec": r["gen_tok_per_sec"],
            "success": bool(r["success"]),
            "error": r["error"],
            "timestamp": r["timestamp"],
        }
        for r in rows
    ]
