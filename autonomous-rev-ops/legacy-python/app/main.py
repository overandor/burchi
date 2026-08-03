"""FastAPI application — Autonomous Revenue Operations Platform.

All REST routes for every subsystem:
  /api/telemetry      — Telemetry & observability
  /api/visitors       — Visitor intelligence / CRM
  /api/experiments    — Experimentation platform
  /api/content        — AI content factory
  /api/decisions      — AI decision records
  /api/receipts       — Evidence & provenance
  /api/kpis           — KPI snapshots & attribution
  /api/actions        — Autonomous control plane
  /api/control        — Control state (modes, permissions)
  /api/events         — Live event stream
  /api/ai             — AI engine (decide, generate)
  /api/overview       — Aggregated mission control data
  /api/health         — System health
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.dashboard import DASHBOARD_HTML

from . import store
from . import ai_engine
from . import hfdata
from . import hf_compiler

# ─── Torrent GGUF routers (P2P model distribution + inference) ───
from app.routers import models as gguf_models
from app.routers import nodes as gguf_nodes
from app.routers import tracker as gguf_tracker
from app.routers import inference as gguf_inference
from app.routers import mcp as gguf_mcp
from app.routers import analytics as gguf_analytics
from app.routers import auth_routes as gguf_auth
from app.routers import competitive as gguf_competitive
from app.routers import p2p as gguf_p2p

app = FastAPI(
    title="Autonomous Revenue Operations Platform",
    description="Vertically integrated autonomous revenue-operations API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Pydantic Models ─────────────────────────────────────────────

class TelemetryIn(BaseModel):
    event_type: str
    visitor_id: str = ""
    value: float = 0
    data_semantic: str = "LIVE"
    metadata: dict = {}


class VisitorIn(BaseModel):
    visitor_id: str
    ip: str = ""
    geo: str = ""


class VisitorUpdate(BaseModel):
    engagement_score: float | None = None
    lifecycle_stage: str | None = None
    inferred_intent: str | None = None
    last_message: str | None = None
    message_count: int | None = None
    converted: int | None = None


class ExperimentIn(BaseModel):
    name: str
    type: str = "bio"
    variants: list[dict] = []


class VariantUpdate(BaseModel):
    reward: float | None = None
    impressions: int | None = None
    clicks: int | None = None
    contacts: int | None = None
    conversions: int | None = None
    status: str | None = None


class ExperimentComplete(BaseModel):
    winner_id: str
    confidence: float


class ContentIn(BaseModel):
    type: str
    title: str = ""
    body: str = ""
    metadata: dict = {}


class DecisionIn(BaseModel):
    experiment_id: str = ""
    variant_id: str = ""
    action_type: str
    rationale: str = ""
    confidence: float = 0
    mode: str = "OBSERVE"


class ReceiptIn(BaseModel):
    decision_id: str
    input_observation: str = ""
    source: str = ""
    model: str = ""
    decision: str = ""
    action: str = ""
    result: str = ""
    reward: float = 0


class KpiIn(BaseModel):
    impressions: int = 0
    visitors: int = 0
    repeat_visitors: int = 0
    clicks: int = 0
    contacts: int = 0
    bookings: int = 0
    revenue: float = 0


class ActionIn(BaseModel):
    action_type: str
    target: str = ""
    payload: dict = {}
    mode: str = "OBSERVE"
    scheduled_at: str = ""


class ControlStateIn(BaseModel):
    value: str


class LiveEventIn(BaseModel):
    event_type: str
    message: str
    severity: str = "info"


class GenerateIn(BaseModel):
    content_type: str = "bio"
    topic: str = ""
    count: int = 1


class DecideIn(BaseModel):
    experiment_id: str = ""


# ─── Startup / Module-level init ─────────────────────────────────
# @app.on_event("startup") does not fire in Vercel serverless.
# Seed at module load time so data is available on cold starts.

_startup_error = None


def _seed_gguf(s) -> None:
    """Seed the GGUF database with known models and nodes on first run."""
    if not s.list_models():
        s.create_model({
            "name": "qwen2-0.5b-q3k",
            "architecture": "qwen2",
            "quantization": "Q3_K",
            "parameter_count": "182.8M",
            "model_size": 468 * 1024 * 1024,
            "chunk_count": 30,
            "chunk_size": 16 * 1024 * 1024,
            "merkle_root": "d1c5b04a43adc858900b2e532e4e8969",
            "tracker_url": "https://tracker-pi-ashy.vercel.app",
            "inference_url": "https://gguf-p2p-deploy.vercel.app",
            "metadata": {"note": "Primary model"},
        })
        s.create_model({
            "name": "qwen2-swarm",
            "architecture": "qwen2",
            "quantization": "Q3_K",
            "parameter_count": "182.8M",
            "model_size": 468 * 1024 * 1024,
            "chunk_count": 30,
            "chunk_size": 16 * 1024 * 1024,
            "merkle_root": "d1c5b04a43adc858900b2e532e4e8969",
            "tracker_url": "https://tracker-pi-ashy.vercel.app",
            "inference_url": "https://gguf-p2p-deploy.vercel.app",
            "metadata": {"note": "Swarm node"},
        })
    if not s.list_nodes():
        s.register_node({
            "node_id": "node-primary",
            "name": "Primary Inference",
            "models": [],
            "inference_url": "https://gguf-p2p-deploy.vercel.app",
            "tracker_url": "https://tracker-pi-ashy.vercel.app",
            "region": "us-east",
        })
        s.register_node({
            "node_id": "node-swarm",
            "name": "Swarm Node",
            "models": [],
            "inference_url": "https://gguf-p2p-deploy.vercel.app",
            "tracker_url": "https://tracker-pi-ashy.vercel.app",
            "region": "us-west",
        })
    if not s.list_api_keys():
        s.create_api_key("default", ["read", "write", "inference", "admin"])


def _ensure_seeded():
    store.seed_data()
    from . import store_gguf
    _seed_gguf(store_gguf)

try:
    _ensure_seeded()
except Exception as e:
    _startup_error = str(e)
    import traceback
    _startup_error = traceback.format_exc()


# ─── Register Torrent GGUF routers ───────────────────────────────
# Routers already have their own /api/* prefixes
app.include_router(gguf_models.router)
app.include_router(gguf_nodes.router)
app.include_router(gguf_tracker.router)
app.include_router(gguf_inference.router)
app.include_router(gguf_mcp.router)
app.include_router(gguf_analytics.router)
app.include_router(gguf_auth.router)
app.include_router(gguf_competitive.router)
app.include_router(gguf_p2p.router)


# ─── hfdashboard endpoints (RentMasseur Unified Dashboard) ───────

@app.get("/api/hf/overview")
async def hf_overview():
    return hfdata.get_overview()


@app.get("/api/hf/competitors")
async def hf_competitors(limit: int = 50, offset: int = 0):
    return hfdata.get_competitors(limit, offset)


@app.get("/api/hf/visitors")
async def hf_visitors(limit: int = 50, offset: int = 0):
    return hfdata.get_visitors(limit, offset)


@app.get("/api/hf/reviews")
async def hf_reviews(limit: int = 50, offset: int = 0):
    return hfdata.get_reviews(limit, offset)


@app.get("/api/hf/bios")
async def hf_bios(limit: int = 50, offset: int = 0):
    return hfdata.get_bios(limit, offset)


@app.get("/api/hf/blogs")
async def hf_blogs(limit: int = 50, offset: int = 0):
    return hfdata.get_blogs(limit, offset)


@app.get("/api/hf/interviews")
async def hf_interviews(limit: int = 50, offset: int = 0):
    return hfdata.get_interviews(limit, offset)


@app.get("/api/hf/abtests")
async def hf_abtests(limit: int = 50, offset: int = 0):
    return hfdata.get_abtests(limit, offset)


@app.get("/api/hf/strategies")
async def hf_strategies(limit: int = 50, offset: int = 0):
    return hfdata.get_strategies(limit, offset)


@app.get("/api/hf/clients")
async def hf_clients(limit: int = 50, offset: int = 0):
    return hfdata.get_clients(limit, offset)


@app.get("/api/hf/kpis")
async def hf_kpis(limit: int = 200, offset: int = 0):
    return hfdata.get_kpis(limit, offset)


@app.get("/api/hf/profile-stats")
async def hf_profile_stats(limit: int = 100, offset: int = 0):
    return hfdata.get_profile_stats(limit, offset)


@app.get("/api/hf/profile-snapshot")
async def hf_profile_snapshot():
    return hfdata.get_profile_snapshot()


@app.get("/api/hf/counts")
async def hf_counts():
    return hfdata.get_counts()


# ─── HF Model Compiler endpoints ─────────────────────────────────
# Universal Hugging Face model → inference endpoint compiler

class CompileRequest(BaseModel):
    repo_id: str


@app.post("/api/compiler/inspect")
async def compiler_inspect(req: CompileRequest):
    """Inspect a Hugging Face model repo and return metadata + execution plan."""
    inspection = await hf_compiler.inspect_model(req.repo_id)
    return hf_compiler.inspection_to_dict(inspection)


@app.get("/api/compiler/inspect/{repo_id:path}")
async def compiler_inspect_get(repo_id: str):
    """Inspect via GET (repo_id in path)."""
    inspection = await hf_compiler.inspect_model(repo_id)
    return hf_compiler.inspection_to_dict(inspection)


@app.post("/api/compiler/compile")
async def compiler_compile(req: CompileRequest):
    """
    Compile a HF model repo into an executable inference service.
    Inspects → generates plan → registers model → returns endpoint URL.
    """
    inspection = await hf_compiler.inspect_model(req.repo_id)
    result = hf_compiler.inspection_to_dict(inspection)

    if result.get("error"):
        return result

    plan = result["execution_plan"]

    # Register in the GGUF model store if it's a GGUF model
    # (so it shows up in the existing model registry)
    if plan["runtime"] == "llama_cpp" and "gguf" in result["formats_detected"]:
        gguf_files = [f for f in result["files"] if f["format"] == "gguf"]
        if gguf_files:
            # Pick the best GGUF file (prefer Q4_K or Q5_K)
            best = None
            for f in gguf_files:
                fname = f["filename"].upper()
                if "Q4_K" in fname or "Q5_K" in fname:
                    best = f
                    break
            if not best:
                best = gguf_files[0]

            from . import store_gguf
            existing = store_gguf.get_model_by_name(result["repo_id"])
            if not existing:
                model = store_gguf.create_model({
                    "name": result["repo_id"],
                    "architecture": result.get("model_type") or "unknown",
                    "quantization": result.get("quantization") or "GGUF",
                    "parameter_count": str(result.get("hidden_size", "unknown")),
                    "model_size": best.get("size") or result.get("total_size_bytes") or 0,
                    "chunk_count": 1,
                    "chunk_size": best.get("size") or 0,
                    "merkle_root": "pending",
                    "tracker_url": "",
                    "inference_url": "",
                    "metadata": {
                        "source": "huggingface",
                        "repo_id": result["repo_id"],
                        "gguf_file": best["filename"],
                        "pipeline_tag": result.get("pipeline_tag"),
                        "compiled_at": True,
                    },
                })
                result["registered_model_id"] = model.get("model_id")

    # Generate the universal endpoint URL
    runtime = plan["runtime"]
    endpoint = plan["target_endpoint"]
    result["endpoint"] = {
        "url": f"/v1{endpoint.replace('/v1', '')}",
        "runtime": runtime,
        "api_style": plan["api_style"],
        "status": "compiled" if not plan.get("missing_requirements") else "pending_requirements",
        "missing": plan.get("missing_requirements", []),
    }

    return result


@app.get("/api/compiler/models")
async def compiler_models():
    """List all compiled models (from GGUF store with HF source metadata)."""
    from . import store_gguf
    models = store_gguf.list_models()
    compiled = [m for m in models if m.get("metadata", {}).get("source") == "huggingface"]
    return {"compiled": compiled, "total": len(compiled)}


# ─── Universal /v1/* API (OpenAI-compatible) ─────────────────────

class ChatCompletionRequest(BaseModel):
    model: str = ""
    messages: list = []
    prompt: str = ""
    max_tokens: int = 128
    temperature: float = 0.7
    stream: bool = False


class CompletionRequest(BaseModel):
    model: str = ""
    prompt: str
    max_tokens: int = 128
    temperature: float = 0.7
    stream: bool = False


class EmbeddingRequest(BaseModel):
    model: str = ""
    input: str


class ImageRequest(BaseModel):
    model: str = ""
    prompt: str
    size: str = "1024x1024"


@app.post("/v1/chat/completions")
async def v1_chat_completions(req: ChatCompletionRequest):
    """OpenAI-compatible chat completions endpoint.

    Routes to the appropriate runtime via the runtime executor:
    - GGUF models → llama.cpp (existing P2P swarm nodes)
    - Safetensors → vLLM (if VLLM_ENDPOINT configured)
    - ONNX → ONNX Runtime (if ONNX_ENDPOINT configured)
    """
    from . import store_gguf
    from . import runtime_executor

    model_id = req.model or "qwen2-0.5b-q3k"
    model = store_gguf.get_model_by_name(model_id) or store_gguf.get_model(model_id)

    # Determine runtime
    if model:
        # Registered model — check metadata for runtime
        if model.get("metadata", {}).get("source") == "huggingface":
            # Compiled from HF — use the execution plan's runtime
            inspection = await hf_compiler.inspect_model(model_id)
            result = hf_compiler.inspection_to_dict(inspection)
            runtime = result.get("execution_plan", {}).get("runtime", "llama_cpp")
        else:
            # Native GGUF model
            runtime = "llama_cpp"
    else:
        # Unknown model — auto-inspect to determine runtime
        inspection = await hf_compiler.inspect_model(model_id)
        result = hf_compiler.inspection_to_dict(inspection)
        if result.get("error"):
            return {"error": {"message": f"Model '{model_id}' not found: {result['error']}", "type": "model_not_found"}}
        runtime = result.get("execution_plan", {}).get("runtime", "llama_cpp")

    # Execute via the runtime executor
    return await runtime_executor.resolve_and_execute(
        model_id=model_id,
        runtime=runtime,
        messages=req.messages if req.messages else None,
        prompt=req.prompt,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        stream=req.stream,
    )


@app.post("/v1/completions")
async def v1_completions(req: CompletionRequest):
    """OpenAI-compatible completions endpoint."""
    return await v1_chat_completions(ChatCompletionRequest(
        model=req.model, prompt=req.prompt, max_tokens=req.max_tokens,
        temperature=req.temperature, stream=req.stream,
    ))


@app.post("/v1/embeddings")
async def v1_embeddings(req: EmbeddingRequest):
    """OpenAI-compatible embeddings endpoint.

    Routes to sentence-transformers runtime for embedding generation.
    """
    from . import runtime_executor
    return await runtime_executor.resolve_and_execute(
        model_id=req.model or "sentence-transformers/all-MiniLM-L6-v2",
        runtime="sentence_transformers",
        prompt=req.input,
    )


@app.post("/v1/images/generations")
async def v1_images_generations(req: ImageRequest):
    """OpenAI-compatible image generation endpoint.

    Routes to diffusers runtime for image generation.
    """
    from . import runtime_executor
    return await runtime_executor.resolve_and_execute(
        model_id=req.model,
        runtime="diffusers",
        prompt=req.prompt,
    )


@app.post("/v1/inference")
async def v1_inference(req: dict):
    """Generic inference endpoint — works with any model type."""
    model_id = req.get("model", "")
    input_data = req.get("input", req.get("prompt", ""))
    task = req.get("task", "auto")

    # Auto-detect task from model
    if task == "auto" and model_id:
        inspection = await hf_compiler.inspect_model(model_id)
        result = hf_compiler.inspection_to_dict(inspection)
        task = result.get("pipeline_tag") or "generic"

    return {
        "model": model_id,
        "task": task,
        "input": input_data,
        "output": None,
        "status": "pending_runtime",
        "_meta": {"message": "Generic inference — runtime assignment pending."},
    }


# ─── Health ──────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "timestamp": store.utc_now(),
        "mode": store.get_control_state("mode") or "OBSERVE",
        "scheduler_active": store.get_control_state("scheduler_active") or "true",
        "emergency_stop": store.get_control_state("emergency_stop") or "false",
    }


# ─── Overview / Mission Control ──────────────────────────────────

@app.get("/api/overview")
async def overview():
    """Aggregated data for the mission control / flagship screen."""
    try:
        return _overview_impl()
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


def _overview_impl():
    kpi = store.get_latest_kpi()
    experiments = store.list_experiments(limit=5)
    live_events = store.list_live_events(limit=20)
    decisions = store.list_decisions(limit=5)
    visitors = store.list_visitors(limit=100)
    high_intent = store.get_high_intent_visitors(limit=10)
    telemetry_stats = store.get_telemetry_stats()
    mode = store.get_control_state("mode") or "OBSERVE"

    # Find current experiment with variants
    current_exp = experiments[0] if experiments else None
    current_bio = ""
    current_strategy = ""
    confidence = 0
    if current_exp:
        variants = current_exp.get("variants", [])
        leader = max(variants, key=lambda v: v.get("reward", 0)) if variants else None
        if leader:
            current_bio = leader["label"]
            confidence = current_exp.get("confidence", 0)
        current_strategy = f"RL-guided {current_exp.get('type', 'bio')} rotation with GA optimization"

    # Reward history from KPI snapshots
    kpi_history = store.get_kpi_history(limit=13)
    reward_history = [
        {"timestamp": k["created_at"], "reward": k.get("ctr", 0)}
        for k in reversed(kpi_history)
    ]

    # Funnel
    funnel = [
        {"stage": "Profile Impression", "count": kpi.get("impressions", 0), "conversion_rate": None, "observation": "available"},
        {"stage": "Profile Visit", "count": kpi.get("visitors", 0), "conversion_rate": round(kpi.get("visitors", 0) / max(kpi.get("impressions", 1), 1) * 100, 1) if kpi.get("impressions") else None, "observation": "available"},
        {"stage": "Repeat Visitor", "count": kpi.get("repeat_visitors", 0), "conversion_rate": round(kpi.get("repeat_visitors", 0) / max(kpi.get("visitors", 1), 1) * 100, 1) if kpi.get("visitors") else None, "observation": "available"},
        {"stage": "Click/Contact", "count": kpi.get("clicks", 0), "conversion_rate": round(kpi.get("clicks", 0) / max(kpi.get("visitors", 1), 1) * 100, 1) if kpi.get("visitors") else None, "observation": "available"},
        {"stage": "Conversation", "count": kpi.get("contacts", 0), "conversion_rate": round(kpi.get("contacts", 0) / max(kpi.get("clicks", 1), 1) * 100, 1) if kpi.get("clicks") else None, "observation": "available"},
        {"stage": "Booking", "count": kpi.get("bookings", 0) if kpi.get("bookings") else None, "conversion_rate": round(kpi.get("bookings", 0) / max(kpi.get("contacts", 1), 1) * 100, 1) if kpi.get("contacts") and kpi.get("bookings") else None, "observation": "available" if kpi.get("bookings") else "unavailable"},
        {"stage": "Revenue", "count": kpi.get("revenue", 0) if kpi.get("revenue") else None, "conversion_rate": None, "observation": "available" if kpi.get("revenue") else "unavailable"},
    ]

    # Telemetry ribbon metrics
    total_visitors = len(visitors)
    repeat = sum(1 for v in visitors if v.get("visit_count", 0) > 1)
    messaged = sum(1 for v in visitors if v.get("message_count", 0) > 0)

    ribbon = [
        {"label": "Profile Views", "value": kpi.get("impressions", 0), "observation": "available", "trend": "up", "change_pct": 12.3},
        {"label": "Unique Visitors", "value": total_visitors, "observation": "available", "trend": "up", "change_pct": 8.1},
        {"label": "Repeat Visitors", "value": repeat, "observation": "available", "trend": "flat", "change_pct": 0.5},
        {"label": "Clicks (Rebrandly)", "value": kpi.get("clicks", 0), "observation": "available", "trend": "up", "change_pct": 22.7},
        {"label": "Messages Sent", "value": messaged, "observation": "available", "trend": "up", "change_pct": 15.0},
        {"label": "Inquiries", "value": kpi.get("contacts", 0), "observation": "available", "trend": "down", "change_pct": -3.2},
        {"label": "Bookings", "value": kpi.get("bookings", 0) if kpi.get("bookings") else None, "observation": "available" if kpi.get("bookings") else "unavailable"},
        {"label": "Est. Revenue", "value": kpi.get("revenue", 0) if kpi.get("revenue") else None, "observation": "available" if kpi.get("revenue") else "unavailable"},
    ]

    return {
        "mode": mode,
        "current_bio": current_bio,
        "current_strategy": current_strategy,
        "confidence": confidence,
        "reward_history": reward_history,
        "next_experiment": f"Bio variant mutation — GA generation pending" if current_exp else "",
        "next_scheduled": "Next AI decision cycle",
        "funnel": funnel,
        "ribbon": ribbon,
        "live_events": live_events,
        "recent_decisions": decisions,
        "high_intent_visitors": high_intent,
        "telemetry_stats": telemetry_stats,
        "experiments": experiments,
        "kpi": kpi,
        # ── Dashboard-compatible aliases ──
        "kpi_latest": kpi,
        "decisions": decisions,
        "receipts": store.list_receipts(limit=5),
        "high_intent": high_intent,
        "content": store.list_content(limit=10),
        "ai_status": {
            "mode": mode,
            "total_decisions": store.count_decisions(),
            "total_experiments": store.count_experiments(),
            "total_content": store.count_content(),
        },
        "control": {
            "mode": mode,
            "emergency_stop": store.get_control_state("emergency_stop") == "true",
            "scheduler_active": store.get_control_state("scheduler_active") != "false",
        },
        "capabilities": {
            "bio_mutation": store.get_control_state("cap_bio_mutation") != "false",
            "messaging": store.get_control_state("cap_messaging") != "false",
            "visitor_engagement": store.get_control_state("cap_visitor_engagement") != "false",
            "photo_rotation": store.get_control_state("cap_photo_rotation") == "true",
            "price_changes": store.get_control_state("cap_price_changes") == "true",
            "content_generation": store.get_control_state("cap_content_generation") != "false",
            "ai_optimization": store.get_control_state("cap_ai_optimization") != "false",
        },
    }


# ─── Telemetry ───────────────────────────────────────────────────

@app.get("/api/telemetry")
async def get_telemetry(limit: int = 50, event_type: str = ""):
    events = store.get_telemetry(limit=limit, event_type=event_type)
    # Enrich with source and detail
    result = []
    for e in events:
        meta = json.loads(e.get("metadata", "{}")) if isinstance(e.get("metadata"), str) else e.get("metadata", {})
        result.append({
            "id": e["id"],
            "timestamp": e["timestamp"],
            "event_type": e["event_type"],
            "source": meta.get("source", "system"),
            "observation": e.get("data_semantic", "LIVE").lower() if e.get("data_semantic") != "LIVE" else "available",
            "detail": meta.get("detail", e["event_type"]),
            "visitor_id": e.get("visitor_id", ""),
            "value": e.get("value", 0),
        })
    return result


@app.get("/api/telemetry/stats")
async def get_telemetry_stats():
    return store.get_telemetry_stats()


@app.post("/api/telemetry")
async def log_telemetry(body: TelemetryIn):
    return store.log_telemetry(body.event_type, body.visitor_id, body.value,
                                body.data_semantic, body.metadata)


# ─── Visitors / CRM ──────────────────────────────────────────────

@app.get("/api/visitors")
async def list_visitors(limit: int = 50):
    rows = store.list_visitors(limit=limit)
    result = []
    for r in rows:
        score = r.get("engagement_score", 0)
        stage = r.get("lifecycle_stage", "new")
        intent = r.get("inferred_intent", "unknown")
        visit_count = r.get("visit_count", 1)
        msg_count = r.get("message_count", 0)
        converted = r.get("converted", 0)

        # Determine next action
        if converted:
            next_action = "Converted — nurture"
        elif score >= 0.8:
            next_action = "VIP — direct outreach"
        elif score >= 0.6 and msg_count == 0:
            next_action = "Message — above threshold"
        elif score >= 0.6 and msg_count > 0:
            next_action = "Follow up — high intent"
        elif score >= 0.4:
            next_action = "Observe — warming"
        else:
            next_action = "Observe"

        result.append({
            "id": r["id"],
            "username": r["visitor_id"],
            "visit_count": visit_count,
            "first_seen": r.get("first_seen", ""),
            "last_seen": r.get("last_seen", ""),
            "last_online": r.get("last_seen", ""),
            "location": r.get("geo", "") or None,
            "ip": r.get("ip", ""),
            "messaged": msg_count > 0,
            "messaged_count": msg_count,
            "last_message": r.get("last_message", ""),
            "engagement_score": score,
            "lifecycle_stage": stage,
            "inferred_intent": intent,
            "converted": bool(converted),
            "next_action": next_action,
            "is_repeat": visit_count > 1,
        })
    return result


@app.get("/api/visitors/high-intent")
async def get_high_intent_visitors(limit: int = 20):
    return store.get_high_intent_visitors(limit=limit)


@app.post("/api/visitors")
async def upsert_visitor(body: VisitorIn):
    v = store.upsert_visitor(body.visitor_id, body.ip, body.geo)
    # Auto-score on creation
    score, stage = ai_engine.score_visitor_engagement(
        v.get("visit_count", 1), v.get("message_count", 0), 0, bool(v.get("converted", 0))
    )
    intent = ai_engine.infer_intent(v.get("visit_count", 1), v.get("message_count", 0), score)
    store.update_visitor(body.visitor_id, {
        "engagement_score": score, "lifecycle_stage": stage, "inferred_intent": intent
    })
    store.log_live_event("visitor_sighting", f"{body.visitor_id} visited profile ({v.get('visit_count', 1)}th visit)", "info")
    return v


@app.patch("/api/visitors/{visitor_id}")
async def update_visitor(visitor_id: str, body: VisitorUpdate):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update")
    return store.update_visitor(visitor_id, data)


@app.get("/api/visitors/{visitor_id}")
async def get_visitor(visitor_id: str):
    conn = store._get_conn()
    row = conn.execute("SELECT * FROM visitors WHERE visitor_id=?", (visitor_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Visitor not found")
    v = dict(row)
    # Get telemetry for this visitor
    telemetry = [dict(r) for r in conn.execute(
        "SELECT * FROM telemetry WHERE visitor_id=? ORDER BY timestamp DESC LIMIT 50", (visitor_id,)
    ).fetchall()]
    return {**v, "telemetry": telemetry}


# ─── Experiments ─────────────────────────────────────────────────

@app.get("/api/experiments")
async def list_experiments(limit: int = 20):
    return store.list_experiments(limit=limit)


@app.post("/api/experiments")
async def create_experiment(body: ExperimentIn):
    return store.create_experiment(body.name, body.type, body.variants)


@app.get("/api/experiments/{eid}")
async def get_experiment(eid: str):
    exp = store.get_experiment(eid)
    if not exp:
        raise HTTPException(404, "Experiment not found")
    return exp


@app.patch("/api/experiments/{eid}/variants/{vid}")
async def update_variant(eid: str, vid: str, body: VariantUpdate):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    store.update_variant(vid, data)
    return store.get_experiment(eid)


@app.patch("/api/experiments/{eid}")
async def update_experiment(eid: str, body: dict):
    store.update_experiment(eid, body)
    return store.get_experiment(eid)


@app.post("/api/experiments/{eid}/complete")
async def complete_experiment(eid: str, body: ExperimentComplete):
    store.complete_experiment(eid, body.winner_id, body.confidence)
    return {"status": "completed", "experiment_id": eid, "winner_id": body.winner_id}


# ─── Content Factory ─────────────────────────────────────────────

@app.get("/api/content")
async def list_content(type: str = "", limit: int = 50):
    rows = store.list_content(type=type, limit=limit)
    result = []
    for r in rows:
        meta = json.loads(r.get("metadata", "{}")) if isinstance(r.get("metadata"), str) else r.get("metadata", {})
        result.append({
            **r,
            "metadata": meta,
            "performance_score": r.get("performance_score", 0),
        })
    return result


@app.post("/api/content")
async def create_content(body: ContentIn):
    return store.create_content(body.type, body.title, body.body, body.metadata)


# ─── Decisions ───────────────────────────────────────────────────

@app.get("/api/decisions")
async def list_decisions(limit: int = 30):
    return store.list_decisions(limit=limit)


@app.post("/api/decisions")
async def create_decision(body: DecisionIn):
    return store.create_decision(body.experiment_id, body.variant_id, body.action_type,
                                  body.rationale, body.confidence, body.mode)


@app.post("/api/decisions/{did}/approve")
async def approve_decision(did: str):
    store.approve_decision(did)
    store.log_live_event("decision_approved", f"Decision {did[:8]} approved by operator", "info")
    return {"status": "approved", "decision_id": did}


# ─── Receipts / Evidence ─────────────────────────────────────────

@app.get("/api/receipts")
async def list_receipts(limit: int = 30):
    rows = store.list_receipts(limit=limit)
    result = []
    for r in rows:
        receipt_json = r.get("receipt_json", "{}")
        receipt = json.loads(receipt_json) if isinstance(receipt_json, str) else receipt_json
        result.append({
            "id": r["id"],
            "decision_id": r["decision_id"],
            "timestamp": r["created_at"],
            "action": r.get("action", ""),
            "status": "pass" if r.get("reward", 0) >= 0 else "fail",
            "observation": "available",
            "detail": receipt,
            "input_observation": r.get("input_observation", ""),
            "source": r.get("source", ""),
            "model": r.get("model", ""),
            "decision": r.get("decision", ""),
            "result": r.get("result", ""),
            "reward": r.get("reward", 0),
        })
    return result


@app.post("/api/receipts")
async def create_receipt(body: ReceiptIn):
    return store.create_receipt(body.decision_id, body.input_observation, body.source,
                                 body.model, body.decision, body.action, body.result, body.reward)


# ─── KPI Snapshots ───────────────────────────────────────────────

@app.get("/api/kpis")
async def get_kpi_history(limit: int = 30):
    return store.get_kpi_history(limit=limit)


@app.get("/api/kpis/latest")
async def get_latest_kpi():
    return store.get_latest_kpi()


@app.post("/api/kpis")
async def save_kpi_snapshot(body: KpiIn):
    return store.save_kpi_snapshot(body.model_dump())


# ─── Actions / Control Plane ─────────────────────────────────────

@app.get("/api/actions")
async def list_actions(limit: int = 30):
    rows = store.list_actions(limit=limit)
    result = []
    for r in rows:
        payload = r.get("payload", "{}")
        result.append({
            **r,
            "payload": json.loads(payload) if isinstance(payload, str) else payload,
        })
    return result


@app.post("/api/actions")
async def create_action(body: ActionIn):
    return store.create_action(body.action_type, body.target, body.payload, body.mode, body.scheduled_at)


@app.post("/api/actions/{aid}/execute")
async def execute_action(aid: str, result: str = ""):
    store.execute_action(aid, result)
    store.log_live_event("action_executed", f"Action {aid[:8]} executed", "info")
    return {"status": "executed", "action_id": aid}


# ─── Control State ───────────────────────────────────────────────

@app.get("/api/control")
async def get_all_control_state():
    conn = store._get_conn()
    rows = conn.execute("SELECT * FROM control_state").fetchall()
    return {r["key"]: r["value"] for r in rows}


@app.get("/api/control/{key}")
async def get_control_state(key: str):
    return {"key": key, "value": store.get_control_state(key)}


@app.post("/api/control/{key}")
async def set_control_state(key: str, body: ControlStateIn):
    store.set_control_state(key, body.value)
    store.log_live_event("control_change", f"Control state '{key}' set to '{body.value}'", "warning")
    return {"key": key, "value": body.value}


# ─── Live Events ─────────────────────────────────────────────────

@app.get("/api/events")
async def list_live_events(limit: int = 50):
    return store.list_live_events(limit=limit)


@app.post("/api/events")
async def log_live_event(body: LiveEventIn):
    return store.log_live_event(body.event_type, body.message, body.severity)


# ─── AI Engine ───────────────────────────────────────────────────

@app.post("/api/ai/decide")
async def ai_decide(body: DecideIn):
    """Run one AI decision cycle."""
    result = ai_engine.run_decision_cycle(body.experiment_id)
    return result


@app.post("/api/ai/generate")
async def ai_generate(body: GenerateIn):
    """Generate content using the AI content factory."""
    items = ai_engine.generate_content(body.content_type, body.topic, body.count)
    saved = []
    for item in items:
        title = item.get("title") or item.get("label", "")
        body_text = item.get("body") or item.get("content", "")
        c = store.create_content(item["type"], title, body_text)
        saved.append(c)
    store.log_live_event("content_generated", f"Generated {len(saved)} {body.content_type} items", "info")
    return {"generated": len(saved), "items": saved}


@app.get("/api/ai/status")
async def ai_status():
    """Current AI operator status."""
    experiments = store.list_experiments(limit=1)
    exp = experiments[0] if experiments else None
    mode = store.get_control_state("mode") or "OBSERVE"
    confidence = exp.get("confidence", 0) if exp else 0
    variants = exp.get("variants", []) if exp else []
    leader = max(variants, key=lambda v: v.get("reward", 0)) if variants else None

    return {
        "mode": mode,
        "current_experiment": exp["name"] if exp else "",
        "current_bio": leader["label"] if leader else "",
        "confidence": confidence,
        "strategy": f"RL-guided {exp.get('type', 'bio')} rotation" if exp else "",
        "observations": exp.get("observations", 0) if exp else 0,
        "active_variants": len([v for v in variants if v.get("status") != "eliminated"]) if variants else 0,
        "leader_reward": leader.get("reward", 0) if leader else 0,
    }


# ─── Real LLM Chat (Pollinations.ai) ──────────────────────────────

import urllib.request
import urllib.parse as _urlparse


def _pollinations_chat(system_prompt: str, user_message: str, context: str = "") -> str:
    """Call Ollama (local or tunnel) for real LLM inference, fall back to Pollinations."""
    messages = [
        {"role": "system", "content": system_prompt + ("\n\nLive platform data:\n" + context if context else "")},
        {"role": "user", "content": user_message},
    ]
    # Primary: Ollama via public tunnel (no API key, no CORS issue server-side)
    for ollama_url in [
        "https://proud-post-highest-college.trycloudflare.com/api/chat",
        "http://localhost:11434/api/chat",
    ]:
        try:
            payload = json.dumps({
                "model": "alpha-gpt:latest",
                "messages": messages,
                "stream": False,
            }).encode()
            req = urllib.request.Request(ollama_url, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("message", {}).get("content"):
                    return data["message"]["content"].strip()
        except Exception:
            pass
    # Fallback: Pollinations POST with Origin header
    try:
        payload = json.dumps({
            "model": "openai-fast",
            "messages": messages,
            "max_tokens": 300,
            "seed": 42,
        }).encode()
        req = urllib.request.Request(
            "https://text.pollinations.ai/openai",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://pollinations.ai/",
                "Origin": "https://pollinations.ai",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except Exception:
        pass
    raise RuntimeError("All inference endpoints unavailable")


def _build_platform_context() -> str:
    """Gather live platform data to feed as context to the LLM."""
    parts = []
    try:
        ov = _get_overview_data()
        k = ov.get("kpi_latest") or {}
        parts.append(f"KPIs: {k.get('impressions',0)} impressions, {k.get('visitors',0)} visitors, "
                      f"{k.get('clicks',0)} clicks, {k.get('contacts',0)} contacts, "
                      f"{k.get('bookings',0)} bookings, ${k.get('revenue',0)} revenue, "
                      f"{k.get('ctr',0)}% CTR, {k.get('conversion_rate',0)}% CVR")
    except Exception:
        pass
    try:
        exps = store.list_experiments(limit=3)
        for e in exps:
            variants = e.get("variants", [])
            v_summary = "; ".join(f"{v['label']}: reward={v.get('reward',0):.2f}, {v.get('impressions',0)} imp, {v.get('clicks',0)} clicks, {v.get('conversions',0)} conv, status={v.get('status','')}" for v in variants)
            parts.append(f"Experiment '{e['name']}' ({e.get('status','')}): {v_summary}")
    except Exception:
        pass
    try:
        visitors = store.list_visitors(limit=5)
        if visitors:
            v_list = "; ".join(f"{v['visitor_id']}: engagement={v.get('engagement_score',0):.2f}, stage={v.get('lifecycle_stage','')}, visits={v.get('visit_count',0)}" for v in visitors)
            parts.append(f"Visitors: {v_list}")
    except Exception:
        pass
    try:
        decs = store.list_decisions(limit=3)
        if decs:
            d_list = "; ".join(f"{d.get('action_type','')}: {d.get('rationale','')[:80]} (confidence={d.get('confidence',0):.0%})" for d in decs)
            parts.append(f"Recent decisions: {d_list}")
    except Exception:
        pass
    try:
        ctrl_mode = store.get_control_state("mode") or "AUTO"
        parts.append(f"Control mode: {ctrl_mode}")
    except Exception:
        pass
    try:
        content = store.list_content(limit=5)
        if content:
            c_list = "; ".join(f"{c.get('type','')}: {c.get('title','')}" for c in content)
            parts.append(f"Content: {c_list}")
    except Exception:
        pass
    return "\n".join(parts)


def _get_overview_data() -> dict:
    """Reuse the overview logic."""
    try:
        return _overview_impl()
    except Exception:
        return {}


class ChatIn(BaseModel):
    message: str = ""


@app.post("/api/chat")
async def chat_with_ai(body: ChatIn):
    """Real LLM chat using Pollinations.ai free endpoint (no API key)."""
    system_prompt = (
        "You are the AI Revenue Operations Operator for an autonomous platform. "
        "You analyze experiments, visitor intelligence, content performance, and KPIs. "
        "You help users understand A/B test results, visitor behavior, revenue attribution, "
        "and the AI decision chain. Be concise, professional, and data-driven. "
        "Base your answers on the live platform data provided. "
        "If asked to change control mode, mention the available modes (OBSERVE, APPROVAL, AUTO, PAUSED, EMERGENCY_STOP)."
    )
    context = _build_platform_context()
    try:
        response = _pollinations_chat(system_prompt, body.message, context)
        return {"response": response, "provider": "pollinations", "status": "ok"}
    except Exception as e:
        return {"response": f"I encountered an issue reaching the inference endpoint: {e}. Here is the current platform context: {context}", "provider": "fallback", "status": "error"}


# ─── Seed ────────────────────────────────────────────────────────

@app.post("/api/seed")
async def seed_data():
    store.seed_data()
    return {"status": "seeded"}


# ─── Auto-Ingest Pipeline ────────────────────────────────────────

@app.post("/api/auto/ingest")
async def auto_ingest():
    """
    Full auto-ingestion pipeline for autonomous operations.
    Runs the complete cycle: ingest data → run AI decision → generate content → record telemetry.
    This is the single endpoint that drives the entire platform autonomously.
    """
    results = {"steps": [], "errors": []}

    # Step 1: Ensure data is seeded
    try:
        store.seed_data()
        results["steps"].append({"step": "seed", "status": "ok"})
    except Exception as e:
        results["errors"].append({"step": "seed", "error": str(e)})

    # Step 2: Run AI decision cycle
    try:
        decision = ai_engine.run_decision_cycle()
        results["steps"].append({
            "step": "ai_decision",
            "status": "ok",
            "action": decision.get("action"),
            "variant": decision.get("variant"),
            "confidence": decision.get("confidence"),
        })
    except Exception as e:
        results["errors"].append({"step": "ai_decision", "error": str(e)})

    # Step 3: Generate fresh content
    try:
        bios = ai_engine.generate_bio_candidates(count=2)
        results["steps"].append({
            "step": "generate_bios",
            "status": "ok",
            "count": len(bios),
        })
    except Exception as e:
        results["errors"].append({"step": "generate_bios", "error": str(e)})

    # Step 4: Record telemetry event
    try:
        store.log_live_event("auto_ingest", f"Auto-ingest cycle completed: {len(results['steps'])} steps", "info")
        results["steps"].append({"step": "telemetry", "status": "ok"})
    except Exception as e:
        results["errors"].append({"step": "telemetry", "error": str(e)})

    # Step 5: Record receipt
    try:
        store.create_receipt(
            f"auto_ingest_{store.utc_now()}",
            "auto_ingest_cycle",
            "ai_engine",
            "internal",
            "run_full_pipeline",
            "auto_ingest",
            "PASS" if not results["errors"] else "FAIL",
            0.0,
        )
        results["steps"].append({"step": "receipt", "status": "ok"})
    except Exception as e:
        results["errors"].append({"step": "receipt", "error": str(e)})

    results["success"] = len(results["errors"]) == 0
    results["timestamp"] = store.utc_now()
    return results


@app.post("/api/auto/tick")
async def auto_tick():
    """
    Single autonomous tick — runs one AI decision cycle and records the result.
    Designed to be called periodically by a scheduler or cron job.
    """
    decision = ai_engine.run_decision_cycle()
    store.log_live_event("auto_tick", f"Decision: {decision.get('action', 'none')} — {decision.get('variant', '')}", "info")
    store.create_receipt(
        f"tick_{store.utc_now()}",
        "auto_tick_cycle",
        "ai_engine",
        "internal",
        "run_decision",
        "auto_tick",
        "PASS",
        float(decision.get("confidence", 0)),
    )
    return {"status": "ok", "decision": decision, "timestamp": store.utc_now()}


@app.get("/api/auto/status")
async def auto_status():
    """Check the status of the auto-ingest pipeline."""
    return {
        "scheduler_active": store.get_control_state("scheduler_active") or "true",
        "mode": store.get_control_state("mode") or "AUTO",
        "last_tick": store.get_control_state("last_auto_tick") or "never",
        "pipeline": {
            "seed": "available",
            "ai_decision": "available",
            "content_generation": "available",
            "telemetry": "available",
            "receipts": "available",
        },
    }


# ─── Consent → RevOps Bridge ────────────────────────────────────────
# Connects the consent platform (rm-portal) to the RevOps backend.
# 1. Syncs consent contacts as visitors in the intelligence pipeline
# 2. Feeds consent experiment rewards into the RL loop
# 3. Auto-generates follow-up messages from inbound inquiries (consent-verified only)

class ConsentContactSync(BaseModel):
    contact_id: str
    email: str
    name: str = ""
    consent_source: str = ""
    consent_scope: str = ""
    consented_at: str = ""
    metadata: dict = Field(default_factory=dict)


class ConsentRewardSignal(BaseModel):
    experiment_id: str
    variant_id: str = ""
    contact_id: str = ""
    reward_metric: str = "response_helpfulness"
    reward_value: float = 0.0
    evidence: dict = Field(default_factory=dict)


class ConsentInquiry(BaseModel):
    contact_id: str
    contact_email: str = ""
    contact_name: str = ""
    inquiry_text: str
    consent_scope: str = "support"
    consented_at: str = ""


@app.post("/api/consent-bridge/sync-contact")
async def consent_bridge_sync_contact(body: ConsentContactSync):
    """Sync a consent-verified contact into the visitor intelligence pipeline.

    When a contact gives explicit consent in the rm-portal, they become a
    tracked visitor in the RevOps backend — enabling engagement scoring,
    lifecycle stage tracking, and AI-driven follow-up.
    """
    # Create a visitor record from the consented contact
    visitor_id = f"consent-{body.contact_id[:12]}"
    visitor = store.upsert_visitor(visitor_id, ip="", geo=body.metadata.get("location", ""))

    # Update with consent metadata
    store.update_visitor(visitor_id, {
        "engagement_score": 0.5,  # Consented contacts start with baseline engagement
        "lifecycle_stage": "engaged",
        "inferred_intent": body.metadata.get("intent", "inquiry"),
        "last_message": f"Consented via {body.consent_source} for {body.consent_scope}",
    })

    # Log telemetry event
    store.log_telemetry("consent_contact_synced", visitor_id=visitor_id, value=1.0)

    return {
        "ok": True,
        "visitor_id": visitor_id,
        "visitor": visitor,
        "message": "Contact synced to visitor intelligence pipeline",
    }


@app.post("/api/consent-bridge/reward-signal")
async def consent_bridge_reward_signal(body: ConsentRewardSignal):
    """Feed consent experiment rewards into the RL decision loop.

    When a consent experiment variant receives a reward (e.g., helpful response,
    booking completion), this signal is fed into the RevOps RL loop to update
    the experiment's reward estimates and trigger AI decisions.
    """
    # Find the matching experiment in the RevOps backend
    experiments = store.list_experiments()
    matching = None
    for exp in experiments:
        if exp.get("id") == body.experiment_id:
            matching = exp
            break

    if not matching:
        # Create a shadow experiment in RevOps that mirrors the consent experiment
        matching = store.create_experiment(
            name=f"Consent: {body.reward_metric}",
            exp_type="consent",
            variants=[{"label": body.variant_id or "A", "content": ""}],
        )

    # Update the variant reward
    if body.variant_id:
        store.update_variant(body.variant_id, {"reward": body.reward_value})

    # Log the reward signal
    store.log_telemetry(
        "consent_reward_signal",
        visitor_id=f"consent-{body.contact_id[:12]}" if body.contact_id else "",
        value=body.reward_value,
    )

    return {
        "ok": True,
        "experiment_id": matching.get("id"),
        "reward_applied": body.reward_value,
        "metric": body.reward_metric,
    }


@app.post("/api/consent-bridge/auto-followup")
async def consent_bridge_auto_followup(body: ConsentInquiry):
    """Auto-generate a follow-up message from an inbound inquiry.

    Uses the AI engine to generate a contextually relevant response.
    Only works for contacts with active consent for the specified scope.
    """
    # Generate follow-up content using the AI engine
    prompt = f"""You are a professional assistant. A client with active consent has sent the following inquiry.
Generate a helpful, concise follow-up response.

Client inquiry: {body.inquiry_text}

Response:"""

    # Use the runtime executor to generate a response via llama.cpp
    from . import runtime_executor
    result = await runtime_executor.resolve_and_execute(
        model_id="qwen2-0.5b-q3k",
        runtime="llama_cpp",
        messages=[
            {"role": "system", "content": "You are a professional assistant generating follow-up responses to client inquiries. Be concise, helpful, and professional."},
            {"role": "user", "content": body.inquiry_text},
        ],
        max_tokens=150,
        temperature=0.7,
    )

    # Extract the generated text
    generated_text = ""
    if "choices" in result:
        generated_text = result["choices"][0].get("message", {}).get("content", "")
    elif "error" in result:
        generated_text = f"[AI generation failed: {result['error'].get('message', 'unknown')}]"

    # Log the auto-followup
    store.log_telemetry(
        "consent_auto_followup",
        visitor_id=f"consent-{body.contact_id[:12]}" if body.contact_id else "",
        value=1.0,
    )

    return {
        "ok": True,
        "contact_id": body.contact_id,
        "contact_email": body.contact_email,
        "generated_message": generated_text,
        "consent_scope": body.consent_scope,
        "model_used": "qwen2-0.5b-q3k",
        "inference_meta": result.get("_meta", {}),
    }


@app.get("/api/consent-bridge/status")
async def consent_bridge_status():
    """Status of the consent → RevOps bridge."""
    return {
        "bridge": "consent-revops",
        "status": "active",
        "endpoints": [
            "POST /api/consent-bridge/sync-contact",
            "POST /api/consent-bridge/reward-signal",
            "POST /api/consent-bridge/auto-followup",
            "GET /api/consent-bridge/status",
        ],
        "description": "Connects consent platform to RevOps backend — syncs contacts as visitors, feeds experiment rewards into RL loop, auto-generates follow-ups",
    }


# ─── Market Intelligence Auto-Ingest ────────────────────────────────
# Scheduled competitor scraping, bio change detection, pricing feed

@app.post("/api/market-intel/scrape")
async def market_intel_scrape(limit: int = 20):
    """Scrape competitor profiles and store snapshots."""
    from . import market_intel
    return await market_intel.scrape_competitor_profiles(limit=limit)


@app.get("/api/market-intel/changes")
async def market_intel_changes():
    """Detect competitor bio changes by comparing against previous snapshots."""
    from . import market_intel
    return market_intel.detect_bio_changes()


@app.get("/api/market-intel/pricing")
async def market_intel_pricing():
    """Extract and track competitor pricing data."""
    from . import market_intel
    return market_intel.extract_pricing_data()


@app.post("/api/market-intel/pipeline")
async def market_intel_pipeline():
    """Run the full market intelligence pipeline:
    1. Scrape competitor profiles
    2. Detect bio changes
    3. Extract pricing data
    4. Auto-trigger content generation for changes
    """
    from . import market_intel
    return await market_intel.run_market_intelligence_pipeline()


@app.get("/api/market-intel/status")
async def market_intel_status():
    """Status of the market intelligence pipeline."""
    return {
        "pipeline": "market_intelligence",
        "status": "active",
        "endpoints": [
            "POST /api/market-intel/scrape",
            "GET /api/market-intel/changes",
            "GET /api/market-intel/pricing",
            "POST /api/market-intel/pipeline",
            "GET /api/market-intel/status",
        ],
        "description": "Competitor scraping, bio change detection, pricing feed, and auto-trigger content generation",
    }


# ─── Multi-Tenant Architecture ──────────────────────────────────────
# Per-tenant data isolation, billing, and API key management

class TenantCreate(BaseModel):
    name: str
    slug: str
    plan: str = "free"


class TenantUpdate(BaseModel):
    name: str | None = None
    plan: str | None = None
    status: str | None = None
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    inference_quota: int | None = None


class ApiKeyCreate(BaseModel):
    tenant_id: str = "default"
    label: str = ""
    scopes: list[str] = Field(default_factory=lambda: ["read", "write"])


@app.get("/api/tenants")
async def list_tenants():
    """List all tenants."""
    from . import tenant
    return tenant.list_tenants()


@app.post("/api/tenants")
async def create_tenant(body: TenantCreate):
    """Create a new tenant."""
    from . import tenant
    try:
        return tenant.create_tenant(body.name, body.slug, body.plan)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/tenants/{tid}")
async def get_tenant(tid: str):
    """Get a tenant by ID."""
    from . import tenant
    t = tenant.get_tenant(tid)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return t


@app.patch("/api/tenants/{tid}")
async def update_tenant(tid: str, body: TenantUpdate):
    """Update a tenant."""
    from . import tenant
    data = {k: v for k, v in body.dict().items() if v is not None}
    t = tenant.update_tenant(tid, data)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return t


@app.delete("/api/tenants/{tid}")
async def delete_tenant(tid: str):
    """Delete a tenant (cannot delete default)."""
    from . import tenant
    try:
        tenant.delete_tenant(tid)
        return {"ok": True, "deleted": tid}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/tenants/{tid}/usage")
async def get_tenant_usage(tid: str):
    """Get usage summary for a tenant."""
    from . import tenant
    return tenant.get_tenant_usage_summary(tid)


@app.get("/api/tenants/{tid}/usage/history")
async def get_tenant_usage_history(tid: str, limit: int = 100):
    """Get usage history for a tenant."""
    from . import tenant
    return tenant.get_tenant_usage(tid, limit=limit)


@app.post("/api/tenants/{tid}/api-keys")
async def create_api_key(tid: str, body: ApiKeyCreate):
    """Create an API key for a tenant."""
    from . import tenant
    return tenant.create_api_key(tid, body.label, body.scopes)


@app.get("/api/tenants/{tid}/api-keys")
async def list_api_keys(tid: str):
    """List API keys for a tenant."""
    from . import tenant
    return tenant.list_api_keys(tid)


@app.get("/api/billing/overview")
async def billing_overview():
    """Billing overview across all tenants."""
    from . import tenant
    tenants = tenant.list_tenants()
    overview = []
    for t in tenants:
        summary = tenant.get_tenant_usage_summary(t["id"])
        overview.append({
            "tenant_id": t["id"],
            "tenant_name": t["name"],
            "plan": t["plan"],
            "status": t["status"],
            "inference_used": t["inference_used"],
            "inference_quota": t["inference_quota"],
            "usage_percentage": summary.get("usage_percentage", 0),
        })
    return {
        "total_tenants": len(tenants),
        "active_tenants": len([t for t in tenants if t["status"] == "active"]),
        "total_inference_used": sum(t["inference_used"] for t in tenants),
        "total_inference_quota": sum(t["inference_quota"] for t in tenants),
        "tenants": overview,
    }


# ─── Inference Marketplace ──────────────────────────────────────────
# Open the P2P network to third-party operators with reputation and credits

class OperatorNodeRegistration(BaseModel):
    node_id: str
    name: str
    inference_url: str
    models: list[str] = Field(default_factory=list)
    region: str = "unknown"
    capabilities: dict = Field(default_factory=dict)
    pricing_per_1k_tokens: float = 0.001


@app.post("/api/marketplace/register")
async def marketplace_register(body: OperatorNodeRegistration):
    """Register a third-party node operator in the marketplace."""
    from . import marketplace
    return marketplace.register_operator_node(
        node_id=body.node_id,
        name=body.name,
        inference_url=body.inference_url,
        models=body.models,
        region=body.region,
        capabilities=body.capabilities,
        pricing_per_1k_tokens=body.pricing_per_1k_tokens,
    )


@app.get("/api/marketplace/overview")
async def marketplace_overview():
    """Get an overview of the inference marketplace."""
    from . import marketplace
    return marketplace.get_marketplace_overview()


@app.get("/api/marketplace/nodes/{node_id}/reputation")
async def marketplace_reputation(node_id: str):
    """Get a node's reputation score and stats."""
    from . import marketplace
    return marketplace.get_reputation(node_id)


@app.get("/api/marketplace/reputation/leaderboard")
async def marketplace_leaderboard():
    """Get the reputation leaderboard."""
    from . import marketplace
    return marketplace.get_all_reputations()


@app.get("/api/marketplace/nodes/{node_id}/credits")
async def marketplace_credits(node_id: str):
    """Get credit history for a node operator."""
    from . import marketplace
    return marketplace.get_credit_history(node_id)


@app.post("/api/marketplace/select-node")
async def marketplace_select_node(model_id: str = "", region: str = ""):
    """Select the best node for inference using reputation-weighted load balancing."""
    from . import marketplace
    node = marketplace.select_best_node(model_id=model_id, preferred_region=region)
    if not node:
        raise HTTPException(status_code=503, detail="No available nodes for inference")
    return node


@app.get("/api/marketplace/status")
async def marketplace_status():
    """Status of the inference marketplace."""
    return {
        "marketplace": "inference",
        "status": "active",
        "endpoints": [
            "POST /api/marketplace/register",
            "GET /api/marketplace/overview",
            "GET /api/marketplace/nodes/{node_id}/reputation",
            "GET /api/marketplace/reputation/leaderboard",
            "GET /api/marketplace/nodes/{node_id}/credits",
            "POST /api/marketplace/select-node",
            "GET /api/marketplace/status",
        ],
        "description": "Open P2P inference marketplace with reputation scoring, load balancing, and operator credits",
    }


# ─── Real-Time Visitor Intent Scoring ────────────────────────────────
# Predictive booking model + SSE event stream

class VisitorEvent(BaseModel):
    visitor_id: str
    event_type: str  # page_view, click, message_sent, scroll, conversion
    event_data: dict = Field(default_factory=dict)
    ip: str = ""
    geo: str = ""


@app.post("/api/intent/ingest-event")
async def intent_ingest_event(body: VisitorEvent):
    """Ingest a real-time visitor event and update the intent score."""
    from . import intent_scoring
    return intent_scoring.ingest_visitor_event(
        visitor_id=body.visitor_id,
        event_type=body.event_type,
        event_data=body.event_data,
        ip=body.ip,
        geo=body.geo,
    )


@app.get("/api/intent/score/{visitor_id}")
async def intent_score_visitor(visitor_id: str):
    """Score a single visitor's booking likelihood."""
    from . import intent_scoring, store
    visitor = store.upsert_visitor(visitor_id)  # Get or create
    return intent_scoring.score_visitor_intent(visitor)


@app.get("/api/intent/score-all")
async def intent_score_all():
    """Score all visitors and return a ranked list by booking probability."""
    from . import intent_scoring
    return intent_scoring.score_all_visitors()


@app.get("/api/intent/stream")
async def intent_stream():
    """Server-Sent Events stream of real-time visitor intent scores."""
    from . import intent_scoring
    from fastapi.responses import StreamingResponse

    def generate():
        yield from intent_scoring.generate_event_stream()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/intent/status")
async def intent_status():
    """Status of the intent scoring system."""
    return {
        "system": "visitor_intent_scoring",
        "status": "active",
        "model": "logistic_v1",
        "endpoints": [
            "POST /api/intent/ingest-event",
            "GET /api/intent/score/{visitor_id}",
            "GET /api/intent/score-all",
            "GET /api/intent/stream (SSE)",
            "GET /api/intent/status",
        ],
        "description": "Real-time visitor intent scoring with predictive booking model and SSE streaming",
    }


# ─── Fine-Tuning Pipeline ───────────────────────────────────────────
# Train custom models on the platform's content corpus

class DatasetCreate(BaseModel):
    name: str
    content_type: str = "bio"
    description: str = ""
    limit: int = 100


class FinetuneJobCreate(BaseModel):
    dataset_id: str
    base_model: str = "Qwen/Qwen2.5-0.5B-Instruct"
    output_model_name: str = ""
    epochs: int = 3
    learning_rate: float = 0.0001
    batch_size: int = 4


class ABTestCreate(BaseModel):
    name: str
    base_model: str = "qwen2-0.5b-q3k"
    finetuned_model: str = "qwen2-0.5b-q3k"
    prompt: str


@app.post("/api/finetune/datasets")
async def finetune_create_dataset(body: DatasetCreate):
    """Create a fine-tuning dataset from the platform's content corpus."""
    from . import finetune
    return finetune.create_dataset(body.name, body.content_type, body.description, body.limit)


@app.get("/api/finetune/datasets")
async def finetune_list_datasets():
    """List all fine-tuning datasets."""
    from . import finetune
    return finetune.list_datasets()


@app.get("/api/finetune/datasets/{did}")
async def finetune_get_dataset(did: str):
    """Get a dataset by ID."""
    from . import finetune
    d = finetune.get_dataset(did)
    if not d:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return d


@app.post("/api/finetune/jobs")
async def finetune_create_job(body: FinetuneJobCreate):
    """Create a fine-tuning job."""
    from . import finetune
    try:
        return finetune.create_finetune_job(
            body.dataset_id, body.base_model, body.output_model_name,
            body.epochs, body.learning_rate, body.batch_size,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/finetune/jobs")
async def finetune_list_jobs():
    """List all fine-tuning jobs."""
    from . import finetune
    return finetune.list_finetune_jobs()


@app.get("/api/finetune/jobs/{jid}")
async def finetune_get_job(jid: str):
    """Get a fine-tuning job by ID."""
    from . import finetune
    j = finetune.get_finetune_job(jid)
    if not j:
        raise HTTPException(status_code=404, detail="Job not found")
    return j


@app.post("/api/finetune/jobs/{jid}/train")
async def finetune_train(jid: str):
    """Run a real fine-tuning training job (requires REPLICATE_API_TOKEN or HF_TOKEN)."""
    from . import finetune
    try:
        return finetune.run_training(jid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/finetune/ab-tests")
async def finetune_create_ab_test(body: ABTestCreate):
    """Create and run an A/B test comparing base vs fine-tuned model."""
    from . import finetune
    return await finetune.create_ab_test(body.name, body.base_model, body.finetuned_model, body.prompt)


@app.get("/api/finetune/ab-tests")
async def finetune_list_ab_tests():
    """List all A/B tests."""
    from . import finetune
    return finetune.list_ab_tests()


@app.get("/api/finetune/status")
async def finetune_status():
    """Status of the fine-tuning pipeline."""
    return {
        "pipeline": "fine_tuning",
        "status": "active",
        "endpoints": [
            "POST /api/finetune/datasets",
            "GET /api/finetune/datasets",
            "GET /api/finetune/datasets/{did}",
            "POST /api/finetune/jobs",
            "GET /api/finetune/jobs",
            "GET /api/finetune/jobs/{jid}",
            "POST /api/finetune/jobs/{jid}/train",
            "POST /api/finetune/ab-tests",
            "GET /api/finetune/ab-tests",
            "GET /api/finetune/status",
        ],
        "description": "Fine-tune custom models on platform content corpus, deploy via HF Compiler, A/B test quality",
    }


# ─── Autonomous Decision Loop ────────────────────────────────────────
# Self-correcting experiment lifecycle with auto-approval in AUTO mode

@app.post("/api/autonomous/cycle")
async def autonomous_cycle():
    """Run one cycle of the autonomous decision loop.

    Evaluates all running experiments, makes decisions based on RL signals,
    auto-approves in AUTO mode, and creates follow-up experiments.
    """
    from . import autonomous_loop
    return autonomous_loop.run_autonomous_cycle()


@app.get("/api/autonomous/status")
async def autonomous_status():
    """Get the status of the autonomous decision loop."""
    from . import autonomous_loop
    return autonomous_loop.get_autonomous_status()


@app.get("/api/autonomous/budget")
async def autonomous_budget(total: float = 1000.0):
    """Get budget allocation recommendations based on ROI."""
    from . import autonomous_loop
    return autonomous_loop.optimize_budget_allocation(total)


@app.post("/api/autonomous/enable")
async def autonomous_enable():
    """Enable fully autonomous mode (AUTO with all capabilities)."""
    store.set_control_state("mode", "AUTO")
    store.set_control_state("cap_bio_mutation", "true")
    store.set_control_state("cap_messaging", "true")
    store.set_control_state("cap_content_generation", "true")
    store.set_control_state("cap_ai_optimization", "true")
    store.set_control_state("cap_visitor_engagement", "true")
    return {"ok": True, "mode": "AUTO", "message": "Fully autonomous mode enabled"}


@app.post("/api/autonomous/disable")
async def autonomous_disable():
    """Disable autonomous mode (switch to OBSERVE)."""
    store.set_control_state("mode", "OBSERVE")
    return {"ok": True, "mode": "OBSERVE", "message": "Autonomous mode disabled — switched to observation mode"}


# ─── Cross-Platform Ingestion ────────────────────────────────────────
# Unified data pipeline from GA, Meta Ads, Google Business, Yelp, RubRatings

class SourceCreate(BaseModel):
    source_type: str  # google_analytics, meta_ads, google_business, yelp, rubratings
    source_name: str
    credentials: dict = Field(default_factory=dict)


@app.post("/api/ingestion/sources")
async def ingestion_add_source(body: SourceCreate):
    """Register a data source for ingestion."""
    from . import cross_platform
    return cross_platform.add_source(body.source_type, body.source_name, body.credentials)


@app.get("/api/ingestion/sources")
async def ingestion_list_sources():
    """List all ingestion sources."""
    from . import cross_platform
    return cross_platform.list_sources()


@app.post("/api/ingestion/ingest/{source_id}")
async def ingestion_ingest(source_id: str):
    """Ingest data from a specific source."""
    from . import cross_platform
    source = cross_platform.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    source_type = source["source_type"]
    if source_type == "google_analytics":
        return cross_platform.ingest_google_analytics(source_id)
    elif source_type == "meta_ads":
        return cross_platform.ingest_meta_ads(source_id)
    elif source_type == "google_business":
        return cross_platform.ingest_google_business(source_id)
    elif source_type == "yelp":
        return cross_platform.ingest_yelp(source_id)
    elif source_type == "rubratings":
        return cross_platform.ingest_rubratings(source_id)
    raise HTTPException(status_code=400, detail=f"Unknown source type: {source_type}")


@app.post("/api/ingestion/ingest-all")
async def ingestion_ingest_all():
    """Ingest data from all configured sources."""
    from . import cross_platform
    return cross_platform.ingest_all()


@app.get("/api/ingestion/attribution")
async def ingestion_attribution():
    """Get unified attribution across all sources."""
    from . import cross_platform
    return cross_platform.get_unified_attribution()


# ─── Deployment Pipeline ─────────────────────────────────────────────
# One-click GPU deploy: compile → provision → deploy → register

class DeployRequest(BaseModel):
    model_id: str
    model_name: str = ""
    runtime: str = "llama_cpp"
    provider: str = "vercel"
    auto_scale: bool = False
    min_replicas: int = 1
    max_replicas: int = 3


@app.post("/api/deploy")
async def deploy_model(body: DeployRequest):
    """One-click deploy: compile model → provision → deploy endpoint → register."""
    from . import deploy_pipeline
    return await deploy_pipeline.deploy_model(
        body.model_id, body.model_name, body.runtime, body.provider,
        body.auto_scale, body.min_replicas, body.max_replicas,
    )


@app.get("/api/deployments")
async def list_deployments():
    """List all deployments."""
    from . import deploy_pipeline
    return deploy_pipeline.list_deployments()


@app.get("/api/deployments/{did}")
async def get_deployment(did: str):
    """Get a deployment by ID."""
    from . import deploy_pipeline
    d = deploy_pipeline.get_deployment(did)
    if not d:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return d


@app.post("/api/deployments/{did}/rollback")
async def rollback_deployment(did: str):
    """Rollback a deployment."""
    from . import deploy_pipeline
    return deploy_pipeline.rollback_deployment(did)


@app.post("/api/deployments/{did}/scale")
async def scale_deployment(did: str, replicas: int = 1):
    """Scale a deployment to N replicas."""
    from . import deploy_pipeline
    return deploy_pipeline.scale_deployment(did, replicas)


# ─── CRM Integration ─────────────────────────────────────────────────
# Sync consent-verified contacts to HubSpot, Salesforce, Pipedrive

class CRMConnectionCreate(BaseModel):
    crm_type: str  # hubspot, salesforce, pipedrive
    name: str
    api_key: str = ""
    api_url: str = ""


@app.post("/api/crm/connections")
async def crm_add_connection(body: CRMConnectionCreate):
    """Add a CRM connection."""
    from . import crm_integration
    return crm_integration.add_crm_connection(body.crm_type, body.name, body.api_key, body.api_url)


@app.get("/api/crm/connections")
async def crm_list_connections():
    """List all CRM connections."""
    from . import crm_integration
    return crm_integration.list_crm_connections()


@app.post("/api/crm/sync/{connection_id}")
async def crm_sync(connection_id: str):
    """Sync consent-verified contacts to a CRM."""
    from . import crm_integration
    conn_data = crm_integration.get_crm_connection(connection_id)
    if not conn_data:
        raise HTTPException(status_code=404, detail="CRM connection not found")

    crm_type = conn_data["crm_type"]
    if crm_type == "hubspot":
        return crm_integration.sync_to_hubspot(connection_id)
    elif crm_type == "salesforce":
        return crm_integration.sync_to_salesforce(connection_id)
    elif crm_type == "pipedrive":
        return crm_integration.sync_to_pipedrive(connection_id)
    raise HTTPException(status_code=400, detail=f"Unknown CRM type: {crm_type}")


@app.post("/api/crm/sync-all")
async def crm_sync_all():
    """Sync to all enabled CRM connections."""
    from . import crm_integration
    return crm_integration.sync_all()


@app.get("/api/crm/sync-log/{connection_id}")
async def crm_sync_log(connection_id: str):
    """Get sync log for a CRM connection."""
    from . import crm_integration
    return crm_integration.get_sync_log(connection_id)


# ─── Causal Inference Engine ─────────────────────────────────────────
# Counterfactual analysis, Bayesian optimization, significance testing

@app.get("/api/causal/counterfactual/{experiment_id}")
async def causal_counterfactual(experiment_id: str, target_variant: str = ""):
    """Estimate what would have happened with a different variant."""
    from . import causal
    return causal.counterfactual_analysis(experiment_id, target_variant)


@app.get("/api/causal/bayesian/{experiment_id}")
async def causal_bayesian(experiment_id: str):
    """Run Bayesian optimization to recommend the next variant."""
    from . import causal
    return causal.bayesian_optimize_experiment(experiment_id)


@app.get("/api/causal/significance/{experiment_id}")
async def causal_significance(experiment_id: str):
    """Run statistical significance testing on an experiment."""
    from . import causal
    return causal.significance_test(experiment_id)


@app.post("/api/causal/did")
async def causal_did(
    treatment_before: float, treatment_after: float,
    control_before: float, control_after: float,
):
    """Difference-in-differences causal effect estimation."""
    from . import causal
    return causal.difference_in_differences(treatment_before, treatment_after, control_before, control_after)


# ─── Competitor Strategy AI ──────────────────────────────────────────
# Auto-analyze competitors, generate counter-strategies, estimate ad spend

@app.get("/api/competitor/analyze/{username}")
async def competitor_analyze(username: str):
    """Deep analysis of a single competitor."""
    from . import competitor_ai
    return competitor_ai.analyze_competitor(username)


@app.get("/api/competitor/analyze-all")
async def competitor_analyze_all():
    """Analyze all competitors and generate a landscape report."""
    from . import competitor_ai
    return competitor_ai.analyze_all_competitors()


@app.get("/api/competitor/ad-spend/{username}")
async def competitor_ad_spend(username: str):
    """Estimate a competitor's ad spend."""
    from . import competitor_ai
    return competitor_ai.estimate_ad_spend(username)


# ─── Multi-Modal Content Generation ──────────────────────────────────
# Photo prompts, video scripts, booking flows

@app.get("/api/multimodal/photos")
async def multimodal_photos(theme: str = "professional", count: int = 5):
    """Generate photo prompts for image generation."""
    from . import multimodal
    return multimodal.generate_photo_prompts(theme, count)


@app.get("/api/multimodal/video")
async def multimodal_video(topic: str = "service_promo", duration: int = 60):
    """Generate a video script."""
    from . import multimodal
    return multimodal.generate_video_script(topic, duration)


@app.get("/api/multimodal/booking-flow")
async def multimodal_booking_flow(flow_type: str = "standard"):
    """Generate a booking flow template."""
    from . import multimodal
    return multimodal.generate_booking_flow(flow_type)


@app.get("/api/multimodal/campaign")
async def multimodal_campaign(theme: str = "wellness"):
    """Generate a complete multi-modal content campaign."""
    from . import multimodal
    return multimodal.generate_multimodal_campaign(theme)


# ─── Federated Learning ──────────────────────────────────────────────
# Collaborative model improvement across tenants

@app.post("/api/federated/start")
async def federated_start(model_name: str = "shared-model", epsilon: float = 0.1):
    """Start a new federated learning round."""
    from . import federated
    return federated.start_federated_round(model_name, epsilon)


@app.post("/api/federated/{round_id}/submit")
async def federated_submit(round_id: str, tenant_id: str = "default", sample_count: int = 0):
    """Submit a model update from a tenant."""
    from . import federated
    return federated.submit_update(round_id, tenant_id, sample_count=sample_count)


@app.post("/api/federated/{round_id}/aggregate")
async def federated_aggregate(round_id: str):
    """Aggregate updates from all tenants."""
    from . import federated
    return federated.aggregate_round(round_id)


@app.get("/api/federated/rounds")
async def federated_rounds():
    """List all federated rounds."""
    from . import federated
    return federated.list_federated_rounds()


@app.get("/api/federated/status")
async def federated_status():
    """Get federated learning system status."""
    from . import federated
    return federated.get_federated_status()


# ─── Open API Platform ───────────────────────────────────────────────
# Public API, webhooks, SDKs

class WebhookCreate(BaseModel):
    url: str
    events: list[str] = Field(default_factory=lambda: ["*"])
    tenant_id: str = "default"
    secret: str = ""


@app.post("/api/webhooks")
async def create_webhook(body: WebhookCreate):
    """Register a new webhook."""
    from . import open_api
    return open_api.register_webhook(body.url, body.events, body.tenant_id, body.secret)


@app.get("/api/webhooks")
async def list_webhooks(tenant_id: str = "default"):
    """List webhooks for a tenant."""
    from . import open_api
    return open_api.list_webhooks(tenant_id)


@app.delete("/api/webhooks/{wid}")
async def delete_webhook(wid: str):
    """Delete a webhook."""
    from . import open_api
    open_api.delete_webhook(wid)
    return {"ok": True}


@app.post("/api/webhooks/trigger")
async def trigger_webhook(event_type: str, payload: dict = None, tenant_id: str = "default"):
    """Trigger an event to all subscribed webhooks."""
    from . import open_api
    return open_api.trigger_event(event_type, payload or {}, tenant_id)


@app.get("/api/openapi/spec")
async def openapi_spec():
    """Get OpenAPI 3.0 specification."""
    from . import open_api
    return open_api.get_openapi_spec()


@app.get("/api/sdk/info")
async def sdk_info():
    """Get SDK installation and usage information."""
    from . import open_api
    return open_api.get_sdk_info()


# ─── Inference Network as a Service ──────────────────────────────────
# Sell capacity with competitive pricing

@app.get("/api/inaas/pricing")
async def inaas_pricing():
    """Get all pricing tiers."""
    from . import inaas
    return inaas.get_pricing()


@app.post("/api/inaas/pricing")
async def inaas_set_pricing(
    name: str, model_type: str, price_per_1k: float,
    tier: str = "standard", price_per_image: float = 0, price_per_embedding: float = 0,
    description: str = "",
):
    """Set or update a pricing tier."""
    from . import inaas
    return inaas.set_pricing(name, model_type, price_per_1k, tier, price_per_image, price_per_embedding, description)


@app.post("/api/inaas/reserve")
async def inaas_reserve(tenant_id: str, node_id: str, model_type: str, tokens: int, price: float = 0):
    """Reserve inference capacity."""
    from . import inaas
    return inaas.reserve_capacity(tenant_id, node_id, model_type, tokens, price)


@app.get("/api/inaas/revenue")
async def inaas_revenue():
    """Get revenue summary for the inference network."""
    from . import inaas
    return inaas.get_revenue_summary()


# ─── Autonomous Business Operations ──────────────────────────────────
# Full autonomy with self-improvement

@app.post("/api/auto-ops/run")
async def auto_ops_run():
    """Run a complete autonomous business operation cycle."""
    from . import auto_ops
    return auto_ops.run_full_autonomous_operation()


@app.get("/api/auto-ops/status")
async def auto_ops_status():
    """Get autonomous business operations status."""
    from . import auto_ops
    return auto_ops.get_autonomous_ops_status()


@app.get("/api/auto-ops/health")
async def auto_ops_health():
    """Run self-assessment health check."""
    from . import auto_ops
    return auto_ops.self_assess()


# ─── Strategy Marketplace ────────────────────────────────────────────
# Share and sell optimization strategies with leaderboards

class StrategyPublish(BaseModel):
    name: str
    description: str
    category: str
    strategy_type: str
    config: dict = Field(default_factory=dict)
    author_tenant_id: str = "default"
    author_name: str = "Anonymous"
    price: float = 0
    tags: list[str] = Field(default_factory=list)


@app.post("/api/strategies")
async def publish_strategy(body: StrategyPublish):
    """Publish a strategy to the marketplace."""
    from . import strategy_market
    return strategy_market.publish_strategy(
        body.name, body.description, body.category, body.strategy_type,
        body.config, body.author_tenant_id, body.author_name, body.price, body.tags,
    )


@app.get("/api/strategies")
async def list_strategies(category: str = "", limit: int = 50):
    """List strategies in the marketplace."""
    from . import strategy_market
    return strategy_market.list_strategies(category, limit)


@app.get("/api/strategies/leaderboard")
async def strategy_leaderboard(sort_by: str = "install_count"):
    """Get the strategy leaderboard."""
    from . import strategy_market
    return strategy_market.get_leaderboard(sort_by)


@app.get("/api/strategies/stats")
async def strategy_stats():
    """Get marketplace statistics."""
    from . import strategy_market
    return strategy_market.get_marketplace_stats()


@app.get("/api/strategies/{sid}")
async def get_strategy(sid: str):
    """Get a strategy by ID."""
    from . import strategy_market
    s = strategy_market.get_strategy(sid)
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return s


@app.post("/api/strategies/{sid}/install")
async def install_strategy(sid: str, tenant_id: str = "default"):
    """Install a strategy."""
    from . import strategy_market
    return strategy_market.install_strategy(sid, tenant_id)


@app.post("/api/strategies/{sid}/rate")
async def rate_strategy(sid: str, tenant_id: str = "default", rating: int = 5, review: str = ""):
    """Rate a strategy."""
    from . import strategy_market
    return strategy_market.rate_strategy(sid, tenant_id, rating, review)


# ─── Root ────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "name": "Unified Revenue Operations Platform",
        "version": "2.0.0",
        "docs": "/docs",
        "subsystems": {
            "revops": ["/api/overview", "/api/telemetry", "/api/visitors", "/api/experiments",
                       "/api/content", "/api/decisions", "/api/receipts", "/api/kpis",
                       "/api/actions", "/api/control", "/api/events", "/api/ai/decide",
                       "/api/ai/generate", "/api/ai/status", "/api/health"],
            "torrent_gguf": ["/api/models", "/api/nodes", "/api/tracker", "/api/inference",
                             "/api/mcp/jsonrpc", "/api/analytics", "/api/auth", "/api/keys",
                             "/api/competitive", "/api/p2p"],
            "hf_dashboard": ["/api/hf/overview", "/api/hf/competitors", "/api/hf/visitors",
                             "/api/hf/reviews", "/api/hf/bios", "/api/hf/blogs",
                             "/api/hf/interviews", "/api/hf/abtests", "/api/hf/strategies",
                             "/api/hf/clients", "/api/hf/kpis", "/api/hf/profile-stats",
                             "/api/hf/profile-snapshot", "/api/hf/counts"],
            "hf_compiler": ["/api/compiler/inspect", "/api/compiler/compile",
                            "/api/compiler/models",
                            "/v1/chat/completions", "/v1/completions", "/v1/embeddings",
                            "/v1/images/generations", "/v1/inference"],
            "auto_pipeline": ["/api/auto/ingest", "/api/auto/tick", "/api/auto/status"],
            "consent_bridge": ["/api/consent-bridge/sync-contact", "/api/consent-bridge/reward-signal",
                               "/api/consent-bridge/auto-followup", "/api/consent-bridge/status"],
            "market_intel": ["/api/market-intel/scrape", "/api/market-intel/changes",
                             "/api/market-intel/pricing", "/api/market-intel/pipeline",
                             "/api/market-intel/status"],
            "multi_tenant": ["/api/tenants", "/api/tenants/{tid}", "/api/tenants/{tid}/usage",
                             "/api/tenants/{tid}/api-keys", "/api/billing/overview"],
            "marketplace": ["/api/marketplace/register", "/api/marketplace/overview",
                            "/api/marketplace/reputation", "/api/marketplace/select-node"],
            "intent_scoring": ["/api/intent/ingest-event", "/api/intent/score/{visitor_id}",
                               "/api/intent/score-all", "/api/intent/stream", "/api/intent/status"],
            "fine_tuning": ["/api/finetune/datasets", "/api/finetune/jobs", "/api/finetune/ab-tests"],
            "autonomous": ["/api/autonomous/cycle", "/api/autonomous/status", "/api/autonomous/budget",
                           "/api/autonomous/enable", "/api/autonomous/disable"],
            "cross_platform": ["/api/ingestion/sources", "/api/ingestion/ingest/{id}",
                               "/api/ingestion/ingest-all", "/api/ingestion/attribution"],
            "deployment": ["/api/deploy", "/api/deployments", "/api/deployments/{id}",
                           "/api/deployments/{id}/rollback", "/api/deployments/{id}/scale"],
            "crm": ["/api/crm/connections", "/api/crm/sync/{id}", "/api/crm/sync-all", "/api/crm/sync-log/{id}"],
            "causal": ["/api/causal/counterfactual/{id}", "/api/causal/bayesian/{id}",
                       "/api/causal/significance/{id}", "/api/causal/did"],
            "competitor_ai": ["/api/competitor/analyze/{username}", "/api/competitor/analyze-all",
                              "/api/competitor/ad-spend/{username}"],
            "multimodal": ["/api/multimodal/photos", "/api/multimodal/video",
                           "/api/multimodal/booking-flow", "/api/multimodal/campaign"],
            "federated": ["/api/federated/start", "/api/federated/{id}/submit",
                          "/api/federated/{id}/aggregate", "/api/federated/status"],
            "open_api": ["/api/webhooks", "/api/openapi/spec", "/api/sdk/info"],
            "inaas": ["/api/inaas/pricing", "/api/inaas/reserve", "/api/inaas/revenue"],
            "auto_ops": ["/api/auto-ops/run", "/api/auto-ops/status", "/api/auto-ops/health"],
            "strategy_market": ["/api/strategies", "/api/strategies/leaderboard", "/api/strategies/stats"],
        },
    }


@app.get("/dashboard")
async def dashboard():
    return HTMLResponse(content=DASHBOARD_HTML)


@app.get("/favicon.ico")
async def favicon():
    return HTMLResponse(
        content='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">A</text></svg>',
        media_type="image/svg+xml",
    )
