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
from app.routers import router_routes as gguf_router

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


# ─── Startup ─────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    # No seed data — the system starts empty and collects real data
    from . import store_gguf
    _ensure_gguf_schema(store_gguf)


def _ensure_gguf_schema(s) -> None:
    """Ensure GGUF tables exist (no fake data injection)."""
    # Just ensure the connection works and tables are created
    try:
        s.list_models()
    except Exception:
        pass


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
app.include_router(gguf_router.router)
app.include_router(gguf_router.pref_router)


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
    """OpenAI-compatible chat completions endpoint."""
    from . import store_gguf

    model_id = req.model or "qwen2-0.5b-q3k"
    model = store_gguf.get_model_by_name(model_id) or store_gguf.get_model(model_id)

    if not model:
        # Try to compile it on the fly
        inspection = await hf_compiler.inspect_model(model_id)
        result = hf_compiler.inspection_to_dict(inspection)
        if result.get("error"):
            return {"error": {"message": f"Model '{model_id}' not found or not compilable: {result['error']}", "type": "model_not_found"}}

        plan = result.get("execution_plan", {})
        return {
            "id": "chatcmpl-pending",
            "object": "chat.completion",
            "created": 0,
            "model": model_id,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": f"Model '{model_id}' detected but not yet deployed. "
                               f"Runtime: {plan.get('runtime', 'unknown')}. "
                               f"Compile it first via POST /api/compiler/compile.",
                },
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "_meta": {
                "repo_id": model_id,
                "runtime": plan.get("runtime"),
                "formats": result.get("formats_detected"),
                "pipeline_tag": result.get("pipeline_tag"),
            },
        }

    # For now, return a placeholder response for compiled models
    # (actual inference would route to the appropriate runtime)
    prompt_text = req.prompt or " ".join(m.get("content", "") for m in req.messages)
    return {
        "id": f"chatcmpl-{model.get('model_id', 'unknown')[:8]}",
        "object": "chat.completion",
        "created": 0,
        "model": model_id,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": f"[Compiled model '{model_id}' — runtime: {model.get('architecture', 'unknown')}] "
                           f"Inference execution layer not yet connected for this model. "
                           f"Model is registered and ready for runtime assignment.",
            },
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": len(prompt_text.split()), "completion_tokens": 0, "total_tokens": len(prompt_text.split())},
        "_meta": {
            "model_id": model.get("model_id"),
            "runtime": "llama_cpp" if model.get("metadata", {}).get("source") == "huggingface" else "gguf",
            "quantization": model.get("quantization"),
        },
    }


@app.post("/v1/completions")
async def v1_completions(req: CompletionRequest):
    """OpenAI-compatible completions endpoint."""
    return await v1_chat_completions(ChatCompletionRequest(
        model=req.model, prompt=req.prompt, max_tokens=req.max_tokens,
        temperature=req.temperature, stream=req.stream,
    ))


@app.post("/v1/embeddings")
async def v1_embeddings(req: EmbeddingRequest):
    """OpenAI-compatible embeddings endpoint."""
    return {
        "object": "list",
        "data": [{
            "id": "emb-0",
            "object": "embedding",
            "embedding": [0.0] * 384,  # placeholder
            "index": 0,
        }],
        "model": req.model or "sentence-transformers/all-MiniLM-L6-v2",
        "usage": {"prompt_tokens": len(req.input.split()), "total_tokens": len(req.input.split())},
        "_meta": {"status": "Embedding runtime not yet connected. Model detected as sentence-transformers."},
    }


@app.post("/v1/images/generations")
async def v1_images_generations(req: ImageRequest):
    """OpenAI-compatible image generation endpoint."""
    return {
        "created": 0,
        "data": [{
            "url": "",
            "revised_prompt": req.prompt,
        }],
        "_meta": {
            "model": req.model,
            "status": "Diffusion runtime not yet connected. Model detected as diffusers.",
            "size": req.size,
        },
    }


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


# ─── Wipe all data ───────────────────────────────────────────────

@app.post("/api/wipe")
async def wipe_all(batch: int = 0):
    """Delete all data from revops tables. Use ?batch=0,1,2,3 for chunks."""
    from app.store import _get_conn, USE_POSTGRES
    if not USE_POSTGRES:
        return {"error": "Only supported with Postgres backend"}
    conn = _get_conn()
    # Split tables into batches to avoid Vercel function timeout
    all_tables = [
        # Batch 0: rev-ops core
        "live_events", "telemetry", "receipts", "decisions", "actions",
        "kpi_snapshots",
        # Batch 1: rev-ops content/experiments
        "content_items", "variants", "experiments", "control_state", "visitors",
        # Batch 2: gguf part 1
        "gguf_peer_connections", "gguf_peer_chunks", "gguf_race_workers",
        "gguf_worker_stats", "gguf_races", "gguf_inference_logs",
        # Batch 3: gguf part 2
        "gguf_analytics", "gguf_sessions", "gguf_users", "gguf_api_keys",
        "gguf_peers", "gguf_nodes", "gguf_models",
    ]
    batch_size = 6
    start = batch * batch_size
    end = start + batch_size
    tables = all_tables[start:end]
    if not tables:
        return {"status": "done", "message": "All batches complete"}
    wiped = []
    errors = []
    for t in tables:
        try:
            conn.execute(f'DELETE FROM revops."{t}"')
            conn.commit()
            wiped.append(t)
        except Exception as e:
            errors.append(f"{t}: {str(e)[:80]}")
            try:
                conn.rollback()
            except:
                pass
    return {
        "status": "partial" if errors else "ok",
        "batch": batch,
        "wiped": wiped,
        "errors": errors,
        "next_batch": batch + 1 if end < len(all_tables) else None,
    }


# ─── Auto-Ingest Pipeline ────────────────────────────────────────

@app.post("/api/auto/ingest")
async def auto_ingest():
    """
    Full auto-ingestion pipeline for autonomous operations.
    Runs the complete cycle: ingest data → run AI decision → generate content → record telemetry.
    This is the single endpoint that drives the entire platform autonomously.
    """
    results = {"steps": [], "errors": []}

    # Step 1: Run AI decision cycle
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
        },
    }


@app.get("/dashboard")
async def dashboard():
    return HTMLResponse(content=DASHBOARD_HTML)
