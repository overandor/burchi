"""
Terminality Web — real webapp exposing the runtime.

Not a mock. Not a sim. Real FastAPI server with:
  - Real execution graph you can populate and query
  - Real inference rollups you can create and continue
  - Real capability graph you can grant and revoke
  - Real marketplace you can register nodes and schedule tasks
  - Real terminal renderer showing execution state
  - Real web UI dashboard
"""

from __future__ import annotations
import os
import json
import time
import asyncio
import hashlib
from typing import Optional, Any
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from gguf_serverless.terminality.runtime import (
    ExecutionObject, ExecutionState, CausalLink, Objective,
    Provenance, ExecutionGraph, ExecutionContext, ExecutionStatus,
    CausalFrontier, CausalReconstructor,
    ObjectiveLayer, CausalRetrievalLayer, RoutingLayer, DeterministicLayer,
    RuntimeStack, ComputationMarket, ComputationBid, ComputationSeed,
    TerminalRenderer, JSONRenderer, AgentRenderer,
    GraphNode, NodeKind, GraphEdge, ExecutionGraphV2,
    InferenceRollup, ReasoningStep, ModelIndependentState,
    RollupStatus, InferenceRollupManager,
    Capability, CapabilityLevel, CapabilityGraph,
    NodeResources, ExecutionRequirements, ExecutionScheduler,
    TerminalityIndex, SearchResult,
    InferencePeer, InferenceCapabilities, InferenceMesh,
    SeededReasoning, PeerStatus,
    UniversalInferenceFrame, FrameGraph, FrameType, Provider,
    TerminalState, TerminalStateGraph, capture_current_state,
    LedgerSystem, LedgerType,
    TerminalityRuntime, TerminalKernel, InferenceKernel,
    MemoryKernel, StorageKernel, RollupKernel,
    VerificationKernel, EvolutionKernel,
    Persistence, LLMClient, LLMResponse,
)

app = FastAPI(title="Terminality Runtime", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Global Runtime State (single instance, real) ───────────────────────

graph_v2 = ExecutionGraphV2()
rollup_mgr = InferenceRollupManager()
cap_graph = CapabilityGraph()
scheduler = ExecutionScheduler(cap_graph)
market = ComputationMarket(peer_id="server")
index = TerminalityIndex(graph_v2, rollup_mgr, cap_graph)
mesh = InferenceMesh(cap_graph)

# ─── Kernel Architecture ────────────────────────────────────────────────
runtime = TerminalityRuntime()
frame_graph = FrameGraph()
ledgers = LedgerSystem()
state_graph = TerminalStateGraph()

# ─── Persistence (SQLite — state survives restarts) ─────────────────────
db = Persistence()

# Initialize root capability
cap_graph.grant("root", "server", CapabilityLevel.ROOT)

# Auto-register this server as a reasoning peer
_server_peer = InferencePeer(
    peer_id="server",
    capabilities=InferenceCapabilities(
        model_family="gguf",
        model_id="gpt-oss:20b",
        context_window=8192,
        available_context=8192,
        supported_tools=["shell", "code", "search"],
        endpoint_url="https://api.llm7.io/v1/chat/completions",
        max_concurrent_tasks=4,
    ),
    rollup_manager=rollup_mgr,
)
mesh.register_peer(_server_peer)

# ─── Pydantic Models ────────────────────────────────────────────────────

class CreateObjectiveRequest(BaseModel):
    description: str
    success_criteria: str = ""
    creator: str = "web"

class ExecuteActionRequest(BaseModel):
    action: str
    execution_hash: Optional[str] = None

class AddGraphNodeRequest(BaseModel):
    kind: str  # "process", "file", "inference", "tool", "command", etc.
    identity: str
    data: dict = {}
    parent_hash: Optional[str] = None
    tags: list[str] = []
    creator: str = "web"

class CreateRollupRequest(BaseModel):
    objective: str

class AddRollupStepRequest(BaseModel):
    rollup_hash: str
    step_id: str
    action: str
    input_state: dict = {}
    output_state: dict = {}
    evidence: str = ""
    model_used: str = "unknown"
    tokens_consumed: int = 0

class ContinueRollupRequest(BaseModel):
    rollup_hash: str
    model_id: str = ""

class VerifyStepRequest(BaseModel):
    rollup_hash: str
    step_id: str
    proof_hash: str

class GrantCapabilityRequest(BaseModel):
    issuer: str
    holder: str
    level: str  # "root", "admin", "execute", "write", "read", etc.

class CheckActionRequest(BaseModel):
    holder: str
    action: str

class RegisterNodeRequest(BaseModel):
    peer_id: str
    cpu_cores: int = 0
    ram_total_mb: int = 0
    ram_available_mb: int = 0
    gpu_count: int = 0
    gpu_vram_mb: int = 0
    gpu_available: bool = False
    cached_models: list[str] = []
    locality_tags: list[str] = []
    cost_per_hour: float = 0.0

class ScheduleRequest(BaseModel):
    min_ram_mb: int = 0
    requires_gpu: bool = False
    required_model: Optional[str] = None
    required_rollup: Optional[str] = None

class SearchRequest(BaseModel):
    query: str
    kind: Optional[str] = None
    verified: Optional[bool] = None
    limit: int = 20

class RegisterPeerRequest(BaseModel):
    peer_id: str
    model_family: str = "gguf"
    model_id: str = "gpt-oss:20b"
    context_window: int = 8192
    available_context: int = 8192
    supported_tools: list[str] = []
    endpoint_url: str = "https://api.llm7.io/v1/chat/completions"
    api_key_env: str = ""
    max_concurrent_tasks: int = 1
    verification_score: float = 1.0
    cost_per_1k_tokens: float = 0.0

class ContinueReasoningRequest(BaseModel):
    rollup_hash: str
    prompt: str = ""

class CrossModelTransferRequest(BaseModel):
    from_peer_id: str
    to_peer_id: str
    rollup_hash: str

class SeedReasoningRequest(BaseModel):
    rollup_hash: str
    confidence: float = 0.8

class FindSeedsRequest(BaseModel):
    objective: Optional[str] = None
    min_confidence: float = 0.0


class NLQueryRequest(BaseModel):
    question: str


# ─── API Routes ─────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "timestamp": time.time(),
        "uptime_s": time.time() - _start_time,
    }

_start_time = time.time()

@app.get("/")
async def dashboard():
    """Serve the web UI dashboard."""
    html_path = Path(__file__).parent / "static" / "index.html"
    if html_path.exists():
        return HTMLResponse(html_path.read_text())
    return HTMLResponse("<h1>Terminality Runtime</h1><p>UI not found</p>")

# ─── Execution Graph V2 ─────────────────────────────────────────────────

@app.post("/api/graph/nodes")
async def add_graph_node(req: AddGraphNodeRequest):
    """Add a node to the execution graph."""
    try:
        kind = NodeKind(req.kind)
    except ValueError:
        return JSONResponse({"error": f"Invalid kind: {req.kind}"}, status_code=400)

    node = GraphNode.create(
        kind=kind,
        identity=req.identity,
        data=req.data,
        parents=[req.parent_hash] if req.parent_hash else [],
        provenance={"creator": req.creator},
        tags=req.tags,
    )
    graph_v2.add_node(node)
    index._rebuild_index()
    return {"hash": node.hash, "short_hash": node.short_hash, "node": node.to_dict()}

@app.get("/api/graph/stats")
async def graph_stats():
    return graph_v2.stats()

@app.get("/api/graph/nodes")
async def list_nodes(kind: Optional[str] = None, verified: Optional[bool] = None):
    try:
        node_kind = NodeKind(kind) if kind else None
    except ValueError:
        node_kind = None
    nodes = graph_v2.query(kind=node_kind, verified=verified)
    return {"nodes": [n.to_dict() for n in nodes], "count": len(nodes)}

@app.get("/api/graph/causes/{hash}")
async def trace_causes(hash: str, depth: int = -1):
    chain = graph_v2.trace_causes(hash, depth)
    return {"chain": [n.to_dict() for n in chain]}

@app.get("/api/graph/effects/{hash}")
async def trace_effects(hash: str, depth: int = -1):
    chain = graph_v2.trace_effects(hash, depth)
    return {"chain": [n.to_dict() for n in chain]}

# ─── Inference Rollups ──────────────────────────────────────────────────

@app.post("/api/rollups")
async def create_rollup(req: CreateRollupRequest):
    rollup = rollup_mgr.create(req.objective)
    return {"hash": rollup.hash, "short_hash": rollup.short_hash, "rollup": rollup.to_dict()}

@app.post("/api/rollups/steps")
async def add_rollup_step(req: AddRollupStepRequest):
    try:
        step = ReasoningStep(
            step_id=req.step_id,
            action=req.action,
            input_state=req.input_state,
            output_state=req.output_state,
            evidence=req.evidence,
            model_used=req.model_used,
            tokens_consumed=req.tokens_consumed,
        )
        new_hash = rollup_mgr.add_step(req.rollup_hash, step)
        rollup = rollup_mgr.get(new_hash)
        return {"new_hash": new_hash, "rollup": rollup.to_dict()}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)

@app.post("/api/rollups/continue")
async def continue_rollup(req: ContinueRollupRequest):
    try:
        forked = rollup_mgr.continue_from(req.rollup_hash, req.model_id)
        return {"hash": forked.hash, "rollup": forked.to_dict()}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)

@app.post("/api/rollups/verify")
async def verify_step(req: VerifyStepRequest):
    new_hash = rollup_mgr.verify_step(req.rollup_hash, req.step_id, req.proof_hash)
    if new_hash is None:
        return JSONResponse({"error": "Rollup or step not found"}, status_code=404)
    return {"new_hash": new_hash, "rollup": rollup_mgr.get(new_hash).to_dict()}

@app.post("/api/rollups/merge")
async def merge_rollups(hash_a: str, hash_b: str):
    try:
        merged = rollup_mgr.merge_rollups(hash_a, hash_b)
        return {"hash": merged.hash, "rollup": merged.to_dict()}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)

@app.get("/api/rollups/{hash}")
async def get_rollup(hash: str):
    rollup = rollup_mgr.get(hash)
    if not rollup:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return rollup.to_dict()

@app.get("/api/rollups/{hash}/prompt")
async def get_rollup_prompt(hash: str):
    rollup = rollup_mgr.get(hash)
    if not rollup:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return {"prompt": rollup.to_prompt_context()}

@app.get("/api/rollups/stats")
async def rollup_stats():
    return rollup_mgr.stats()

# ─── Capability Graph ───────────────────────────────────────────────────

@app.post("/api/capabilities/grant")
async def grant_capability(req: GrantCapabilityRequest):
    try:
        level = CapabilityLevel(req.level)
    except ValueError:
        return JSONResponse({"error": f"Invalid level: {req.level}"}, status_code=400)
    try:
        cap = cap_graph.grant(req.issuer, req.holder, level)
        return cap.to_dict()
    except PermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)

@app.post("/api/capabilities/check")
async def check_action(req: CheckActionRequest):
    allowed, reason = cap_graph.check_action(req.holder, req.action)
    return {"allowed": allowed, "reason": reason}

@app.get("/api/capabilities/{holder}")
async def get_capabilities(holder: str):
    caps = cap_graph.get_capabilities(holder)
    return {"holder": holder, "capabilities": [c.to_dict() for c in caps]}

@app.delete("/api/capabilities/{capability_id}")
async def revoke_capability(capability_id: str, revoked_by: str = "root"):
    ok = cap_graph.revoke(capability_id, revoked_by)
    return {"revoked": ok}

@app.get("/api/capabilities/stats")
async def cap_stats():
    return cap_graph.stats()

# ─── Execution Marketplace ──────────────────────────────────────────────

@app.post("/api/market/nodes")
async def register_node(req: RegisterNodeRequest):
    resources = NodeResources(
        peer_id=req.peer_id,
        cpu_cores=req.cpu_cores,
        ram_total_mb=req.ram_total_mb,
        ram_available_mb=req.ram_available_mb,
        gpu_count=req.gpu_count,
        gpu_vram_mb=req.gpu_vram_mb,
        gpu_available=req.gpu_available,
        cached_models=req.cached_models,
        locality_tags=req.locality_tags,
        cost_per_hour=req.cost_per_hour,
    )
    scheduler.register_node(resources)
    return {"registered": True, "peer_id": req.peer_id}

@app.post("/api/market/schedule")
async def schedule_task(req: ScheduleRequest):
    requirements = ExecutionRequirements(
        min_ram_mb=req.min_ram_mb,
        requires_gpu=req.requires_gpu,
        required_model=req.required_model,
        required_rollup=req.required_rollup,
    )
    best = scheduler.schedule(requirements)
    if best:
        return {"assigned": True, "peer_id": best.peer_id, "resources": best.to_dict()}
    return {"assigned": False, "reason": "No suitable node found"}

@app.get("/api/market/state")
async def market_state():
    return scheduler.get_market_state()

# ─── Terminality Index ──────────────────────────────────────────────────

@app.post("/api/index/search")
async def search_index(req: SearchRequest):
    try:
        kind = NodeKind(req.kind) if req.kind else None
    except ValueError:
        kind = None
    results = index.search(req.query, kind=kind, verified=req.verified, limit=req.limit)
    return {
        "results": [
            {"node": r.node.to_dict(), "score": r.score, "summary": r.summary,
             "matched_on": r.matched_on, "causal_depth": r.causal_depth}
            for r in results
        ],
        "count": len(results),
    }

@app.post("/api/index/nl-query")
async def natural_language_query(req: NLQueryRequest):
    results = index.query_natural_language(req.question)
    return {
        "question": req.question,
        "results": [
            {"node": r.node.to_dict(), "score": r.score, "summary": r.summary}
            for r in results
        ],
        "count": len(results),
    }

@app.get("/api/index/stats")
async def index_stats():
    return index.stats()

# ─── Inference Mesh ────────────────────────────────────────────────────

@app.get("/api/mesh/peers")
async def list_mesh_peers():
    """List all reasoning peers in the mesh."""
    return {"peers": mesh.list_peers(), "count": len(mesh.peers)}

@app.post("/api/mesh/peers")
async def register_mesh_peer(req: RegisterPeerRequest):
    """Register a reasoning peer (LLM) in the mesh."""
    caps = InferenceCapabilities(
        model_family=req.model_family,
        model_id=req.model_id,
        context_window=req.context_window,
        available_context=req.available_context,
        supported_tools=req.supported_tools,
        endpoint_url=req.endpoint_url,
        api_key_env=req.api_key_env,
        max_concurrent_tasks=req.max_concurrent_tasks,
        verification_score=req.verification_score,
        estimated_cost_per_1k_tokens=req.cost_per_1k_tokens,
    )
    peer = InferencePeer(peer_id=req.peer_id, capabilities=caps)
    mesh.register_peer(peer)
    return {"registered": True, "peer_id": req.peer_id, "advertisement": peer.advertise()}

@app.delete("/api/mesh/peers/{peer_id}")
async def unregister_mesh_peer(peer_id: str):
    mesh.unregister_peer(peer_id)
    return {"unregistered": True}

@app.get("/api/mesh/peers/{peer_id}/stats")
async def mesh_peer_stats(peer_id: str):
    peer = mesh.get_peer(peer_id)
    if not peer:
        return JSONResponse({"error": "Peer not found"}, status_code=404)
    return peer.stats()

@app.post("/api/mesh/seed")
async def seed_reasoning(req: SeedReasoningRequest):
    """Seed verified reasoning to the mesh."""
    rollup = rollup_mgr.get(req.rollup_hash)
    if not rollup:
        return JSONResponse({"error": "Rollup not found"}, status_code=404)
    peer = mesh.get_peer("server")
    if not peer:
        return JSONResponse({"error": "No peer to seed from"}, status_code=404)
    seed = peer.seed_reasoning(rollup, confidence=req.confidence)
    return {"seeded": True, "seed": seed.to_dict()}

@app.post("/api/mesh/find-seeds")
async def find_seeds(req: FindSeedsRequest):
    """Find seeded reasoning in the mesh."""
    seeds = mesh.find_seeds(objective=req.objective, min_confidence=req.min_confidence)
    return {"seeds": [s.to_dict() for s in seeds], "count": len(seeds)}

@app.post("/api/mesh/continue")
async def mesh_continue_reasoning(req: ContinueReasoningRequest):
    """Route continuation to best reasoning peer and continue inference.

    This is the core mesh operation:
    1. Find the rollup
    2. Route to the best reasoning peer (not best machine)
    3. The peer continues the reasoning using its model
    4. Result is seeded back to the mesh
    """
    result = await mesh.continue_on_best_peer(req.rollup_hash, req.prompt)
    return result

@app.post("/api/mesh/transfer")
async def mesh_cross_model_transfer(req: CrossModelTransferRequest):
    """Transfer reasoning state between different models.

    Claude analyzed 8M lines → GPT continues from Claude's state.
    Model-independent structured state, not raw KV cache.
    """
    return mesh.cross_model_transfer(
        req.from_peer_id, req.to_peer_id, req.rollup_hash
    )

@app.get("/api/mesh/stats")
async def mesh_stats():
    return mesh.stats()

# ─── Kernel Architecture ────────────────────────────────────────────────

@app.get("/api/runtime/stats")
async def runtime_stats():
    """Full runtime stats — all seven kernels + ledgers + state root."""
    return runtime.stats()

@app.get("/api/runtime/kernels/{kernel}")
async def kernel_stats(kernel: str):
    """Get stats for a specific kernel."""
    kernels = {
        "terminal": runtime.terminal.stats,
        "inference": runtime.inference.stats,
        "memory": runtime.memory.stats,
        "storage": runtime.storage.stats,
        "rollup": runtime.rollup.stats,
        "verification": runtime.verification.stats,
        "evolution": runtime.evolution.stats,
    }
    fn = kernels.get(kernel)
    if not fn:
        return JSONResponse({"error": f"Unknown kernel: {kernel}"}, status_code=400)
    return fn()

# ─── Universal Inference Frames ─────────────────────────────────────────

class CreateFrameRequest(BaseModel):
    prompt: str
    model_id: str = "gpt-oss:20b"
    provider: str = "custom"
    response: str = ""
    parent_frames: list[str] = []

@app.post("/api/frames")
async def create_frame(req: CreateFrameRequest):
    """Create a universal inference frame."""
    try:
        prov = Provider(req.provider)
    except ValueError:
        prov = Provider.CUSTOM
    frame = UniversalInferenceFrame(
        frame_id=hashlib.sha256(f"frame:{time.time()}".encode()).hexdigest()[:16],
        frame_type=FrameType.INFERENCE,
        parent_frames=req.parent_frames,
        prompt=req.prompt,
        model_id=req.model_id,
        provider=prov,
        response=req.response,
    )
    frame_graph.add(frame)
    return {"cid": frame.cid, "short_cid": frame.short_cid, "frame": frame.to_dict()}

@app.get("/api/frames/stats")
async def frame_stats():
    return frame_graph.stats()

@app.get("/api/frames/{cid}")
async def get_frame(cid: str):
    frame = frame_graph.get(cid)
    if not frame:
        return JSONResponse({"error": "Frame not found"}, status_code=404)
    return frame.to_dict()

@app.get("/api/frames/{cid}/chain")
async def get_frame_chain(cid: str, depth: int = -1):
    chain = frame_graph.get_chain(cid, depth)
    return {"chain": [f.to_dict() for f in chain], "count": len(chain)}

@app.post("/api/frames/{cid}/branch")
async def branch_frame(cid: str, prompt: str = "", model_id: str = ""):
    try:
        branched = frame_graph.branch(cid, prompt, model_id)
        return {"cid": branched.cid, "frame": branched.to_dict()}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)

@app.post("/api/frames/merge")
async def merge_frames(cid_a: str, cid_b: str, model_id: str = ""):
    try:
        merged = frame_graph.merge(cid_a, cid_b, model_id)
        return {"cid": merged.cid, "frame": merged.to_dict()}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)

@app.post("/api/frames/{cid}/verify")
async def verify_frame(cid: str, verifier: str = "system", method: str = "deterministic"):
    ok = frame_graph.verify(cid, verifier, method)
    return {"verified": ok, "frame": frame_graph.get(cid).to_dict() if frame_graph.get(cid) else None}

@app.post("/api/frames/{cid}/compress")
async def compress_frame(cid: str):
    compressed = frame_graph.compress(cid)
    return {"cid": compressed.cid, "frame": compressed.to_dict()}

@app.get("/api/frames/{cid}/to/{provider}")
async def frame_to_provider(cid: str, provider: str):
    """Convert a frame to a provider-specific format."""
    frame = frame_graph.get(cid)
    if not frame:
        return JSONResponse({"error": "Frame not found"}, status_code=404)
    try:
        prov = Provider(provider)
    except ValueError:
        prov = Provider.CUSTOM
    return frame.to_provider_format(prov)

# ─── Terminal State ─────────────────────────────────────────────────────

@app.post("/api/state/capture")
async def capture_state(working_dir: str = "."):
    """Capture the real terminal state from the environment."""
    state = capture_current_state(working_dir)
    state_graph.add(state)
    return {"cid": state.short_cid, "state": state.to_dict()}

@app.get("/api/state/current")
async def get_current_state():
    state = state_graph.get_current()
    if not state:
        return JSONResponse({"error": "No state captured yet"}, status_code=404)
    return state.to_dict()

@app.get("/api/state/{cid}/history")
async def get_state_history(cid: str, depth: int = -1):
    history = state_graph.get_history(cid, depth)
    return {"history": [s.to_dict() for s in history], "count": len(history)}

@app.post("/api/state/checkpoint")
async def state_checkpoint():
    cid = state_graph.checkpoint()
    return {"checkpoint_cid": cid[:12]}

@app.get("/api/state/stats")
async def state_stats():
    return state_graph.stats()

# ─── Ledgers ────────────────────────────────────────────────────────────

class LedgerAppendRequest(BaseModel):
    ledger_type: str
    data: dict
    signer: str = "web"

@app.post("/api/ledgers/append")
async def ledger_append(req: LedgerAppendRequest):
    """Append to a ledger."""
    try:
        lt = LedgerType(req.ledger_type)
    except ValueError:
        return JSONResponse({"error": f"Invalid ledger type: {req.ledger_type}"}, status_code=400)
    entry = ledgers.append(lt, req.data, req.signer)
    return {"hash": entry.hash, "entry": entry.to_dict()}

@app.get("/api/ledgers")
async def ledger_list():
    """List all ledgers and their stats."""
    return ledgers.stats()

@app.get("/api/ledgers/state-root")
async def ledger_state_root():
    """Get the state root hash of all ledgers."""
    return {
        "state_root": ledgers.get_state_root_hash(),
        "roots": ledgers.get_state_root(),
        "verified": ledgers.verify_all(),
    }

@app.get("/api/ledgers/{ledger_type}")
async def ledger_detail(ledger_type: str):
    try:
        lt = LedgerType(ledger_type)
    except ValueError:
        return JSONResponse({"error": f"Invalid ledger type: {ledger_type}"}, status_code=400)
    return ledgers.get(lt).to_dict()

# ─── Persistence (SQLite-backed) ────────────────────────────────────────

@app.get("/api/persist/stats")
async def persist_stats():
    """SQLite database stats — real persistent storage."""
    return db.stats()

@app.get("/api/persist/frames")
async def persist_list_frames(limit: int = 50):
    """List frames from SQLite."""
    return {"frames": db.list_frames(limit), "count": db.count_frames()}

@app.get("/api/persist/frames/{cid}")
async def persist_get_frame(cid: str):
    frame = db.get_frame(cid)
    if not frame:
        return JSONResponse({"error": "Frame not found"}, status_code=404)
    return frame

@app.get("/api/persist/rollups")
async def persist_list_rollups(limit: int = 50):
    """List rollups from SQLite."""
    return {"rollups": db.list_rollups(limit), "count": len(db.list_rollups(limit))}

@app.get("/api/persist/rollups/{hash}")
async def persist_get_rollup(hash: str):
    rollup = db.get_rollup(hash)
    if not rollup:
        return JSONResponse({"error": "Rollup not found"}, status_code=404)
    return rollup

@app.get("/api/persist/peers")
async def persist_list_peers():
    """List peers from SQLite."""
    return {"peers": db.list_peers(), "count": len(db.list_peers())}

@app.get("/api/persist/seeds")
async def persist_list_seeds(objective: str = ""):
    """List seeds from SQLite."""
    seeds = db.list_seeds(objective=objective)
    return {"seeds": seeds, "count": len(seeds)}

@app.get("/api/persist/ledgers/{ledger_type}")
async def persist_ledger_entries(ledger_type: str, limit: int = 50):
    """List entries in a specific ledger from SQLite."""
    entries = db.list_ledger_entries(ledger_type, limit)
    return {"entries": entries, "count": len(entries)}

# ─── Real LLM invocation ────────────────────────────────────────────────

class LLMInvokeRequest(BaseModel):
    prompt: str
    model: str = "gpt-4o-mini"
    provider: str = "openai"
    endpoint: str = ""
    max_tokens: int = 512
    temperature: float = 0.3
    from_rollup: str = ""

@app.post("/api/llm/invoke")
async def llm_invoke(req: LLMInvokeRequest):
    """Call a real LLM API, create a rollup, store in SQLite, seed to mesh.

    This is the real end-to-end flow:
    1. Build context (optionally from a previous rollup)
    2. Call the LLM API
    3. Create a rollup and universal frame
    4. Store everything in SQLite
    5. Append to ledgers
    6. Seed the reasoning
    """
    import hashlib as _hashlib
    import time as _time

    # Build context from previous rollup if specified
    context_messages = []
    parent_rollup = None
    if req.from_rollup:
        parent_rollup = db.get_rollup(req.from_rollup)
        if parent_rollup:
            for step in parent_rollup.get("steps", []):
                context_messages.append({
                    "role": "assistant",
                    "content": f"{step.get('action', '')}: {str(step.get('output_state', ''))[:200]}",
                })

    system_msg = "You are a reasoning engine in the Terminality runtime. Be concise and precise."
    if parent_rollup:
        facts = parent_rollup.get("state", {}).get("verified_facts", [])
        if facts:
            system_msg += "\n\nVerified facts:\n" + "\n".join(f"- {f}" for f in facts[:20])

    messages = [{"role": "system", "content": system_msg}]
    messages.extend(context_messages[-10:])
    messages.append({"role": "user", "content": req.prompt})

    # Create LLM client
    client = LLMClient(provider=req.provider, model=req.model, endpoint=req.endpoint)

    try:
        response = client.chat(messages, max_tokens=req.max_tokens, temperature=req.temperature)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    # Create rollup
    from gguf_serverless.terminality.runtime.inference_rollups import (
        InferenceRollup as _Rollup, ReasoningStep as _Step,
        ModelIndependentState as _State,
    )
    rollup = _Rollup(
        rollup_id=_hashlib.sha256(f"rollup:{_time.time()}".encode()).hexdigest()[:16],
        state=_State(objectives_remaining=[req.prompt]),
        steps=[],
        parent_rollups=[req.from_rollup] if req.from_rollup else [],
    )
    rollup.add_step(_Step(
        step_id="s1",
        action=req.prompt[:100],
        input_state={"context_steps": len(context_messages)},
        output_state={"response": response.text[:500]},
        evidence="llm_response",
        model_used=response.model,
        tokens_consumed=response.total_tokens,
    ))

    rollup_dict = {
        "hash": rollup.hash,
        "rollup_id": rollup.rollup_id,
        "status": rollup.status.value,
        "parent_rollups": [req.from_rollup] if req.from_rollup else [],
        "model_provenance": [response.model],
        "steps": [
            {"step_id": s.step_id, "action": s.action,
             "input_state": s.input_state, "output_state": s.output_state,
             "evidence": s.evidence, "model_used": s.model_used,
             "tokens_consumed": s.tokens_consumed, "verified": s.verified}
            for s in rollup.steps
        ],
        "state": {
            "verified_facts": [],
            "objectives_remaining": [req.prompt],
            "token_lineage": [{"step": "s1", "model": response.model, "tokens": response.total_tokens}],
        },
    }
    db.store_rollup(rollup_dict)

    # Create frame
    try:
        prov = Provider(response.provider)
    except ValueError:
        prov = Provider.CUSTOM

    frame = UniversalInferenceFrame(
        frame_id=_hashlib.sha256(f"frame:{_time.time()}".encode()).hexdigest()[:16],
        frame_type=FrameType.INFERENCE,
        prompt=req.prompt,
        model_id=response.model,
        provider=prov,
        response=response.text,
        tokens_consumed=response.total_tokens,
    )
    db.store_frame(frame.to_dict())

    # Append to ledgers
    db.append_ledger("inference", {
        "model": response.model, "provider": response.provider,
        "tokens_in": response.tokens_in, "tokens_out": response.tokens_out,
        "objective": req.prompt[:100],
        "rollup_hash": rollup.hash, "frame_cid": frame.cid,
        "elapsed_ms": response.elapsed_ms,
    }, signer="web")
    db.append_ledger("execution", {
        "command": f"llm:invoke '{req.prompt[:50]}'",
        "model": response.model, "tokens": response.total_tokens,
    }, signer="web")

    # Seed
    db.store_seed({
        "peer_id": "web",
        "rollup_hash": rollup.hash,
        "objective": req.prompt,
        "verified_conclusions": [],
        "evidence_frontier": [frame.cid],
        "confidence": 0.5,
        "tokens_invested": response.total_tokens,
        "seed_count": 0,
    })

    return {
        "ok": True,
        "response": response.text,
        "model": response.model,
        "tokens": response.total_tokens,
        "tokens_in": response.tokens_in,
        "tokens_out": response.tokens_out,
        "elapsed_ms": response.elapsed_ms,
        "rollup_hash": rollup.hash[:12],
        "frame_cid": frame.short_cid,
    }

# ─── Runtime Stack (real execution) ─────────────────────────────────────

@app.post("/api/runtime/create")
async def runtime_create(req: CreateObjectiveRequest):
    """Create an objective and start the runtime stack."""
    runtime = RuntimeStack()
    obj = runtime.create_objective(req.description, req.success_criteria, req.creator)
    return {"hash": obj.hash, "short_hash": obj.short_hash, "status": obj.status.value}

@app.post("/api/runtime/execute")
async def runtime_execute(req: ExecuteActionRequest):
    """Execute an action deterministically."""
    runtime = RuntimeStack()
    if req.execution_hash:
        obj = runtime.graph.get(req.execution_hash)
        if not obj:
            obj = runtime.create_objective("Continue execution")
    else:
        obj = runtime.create_objective("Execute action")

    result, new_obj = await runtime.deterministic_layer.execute(obj, req.action)
    return {
        "ok": result.ok,
        "elapsed_ms": result.elapsed_ms,
        "error": result.error,
        "new_hash": new_obj.short_hash,
        "status": new_obj.status.value,
        "output": new_obj.state.terminal_output,
        "facts": new_obj.state.verified_facts,
    }

# ─── WebSocket for live updates ─────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong", "timestamp": time.time()})
            elif msg.get("type") == "stats":
                await ws.send_json({
                    "type": "stats",
                    "graph": graph_v2.stats(),
                    "rollups": rollup_mgr.stats(),
                    "capabilities": cap_graph.stats(),
                    "market": scheduler.get_market_state(),
                    "index": index.stats(),
                    "mesh": mesh.stats(),
                })
            await asyncio.sleep(0.01)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
