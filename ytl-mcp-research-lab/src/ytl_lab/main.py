"""FastAPI + MCP server for YTL-MCP Research Lab."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ytl_lab.config import Settings
from ytl_lab.db import LabDB
from ytl_lab.discover import find_competitors, proxy_page
from ytl_lab.receipts import ReceiptLedger
from ytl_lab.tools import LabTools

app = FastAPI(title="YTL-MCP Research Lab")

settings = Settings.load_settings()
tools = LabTools(settings)


class IngestRequest(BaseModel):
    task_id: str
    intent: str
    video_url: str


class ExperimentIdRequest(BaseModel):
    experiment_id: str


class CreateProjectRequest(BaseModel):
    project_id: str
    name: str


class CreateQueryRequest(BaseModel):
    query_id: str
    project_id: str
    query: str
    status: str = "open"


class ListQueriesRequest(BaseModel):
    project_id: str | None = None
    limit: int = 100


class MCPRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: Any
    method: str
    params: Dict[str, Any] | None = None


class DiscoverRequest(BaseModel):
    niche: str
    max_results: int = 6


class ProxyRequest(BaseModel):
    url: str


# ─── P2P Signaling Relay ───
# In-memory store for WebRTC signaling. Works on Vercel serverless
# because each request hits the same instance within a session.
# For production, use Redis/Upstash — but this works for peer discovery.
_SIGNAL_STORE: Dict[str, Dict[str, Any]] = {}
_SIGNAL_TTL = 300  # 5 minutes


class SignalRequest(BaseModel):
    node_id: str
    type: str  # "register", "offer", "answer", "ice", "poll", "unregister"
    target: str | None = None
    sdp: str | None = None
    ice: str | None = None
    capabilities: Dict[str, Any] | None = None


@app.get("/", response_class=HTMLResponse)
def dashboard() -> str:
    return _DASHBOARD_HTML


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "ytl-mcp-research-lab"}


@app.get("/api/status")
def api_status() -> Dict[str, Any]:
    return tools.status()


@app.post("/api/discover")
def api_discover(req: DiscoverRequest) -> Dict[str, Any]:
    if not req.niche or len(req.niche.strip()) < 2:
        raise HTTPException(status_code=400, detail="niche is required (min 2 chars)")
    competitors = find_competitors(req.niche.strip(), req.max_results)
    return {
        "ok": True,
        "niche": req.niche.strip(),
        "competitors": competitors,
        "total_found": len(competitors),
        "reachable_count": sum(1 for c in competitors if c["reachable"]),
        "with_apis_count": sum(1 for c in competitors if c["api_endpoints"]),
    }


@app.post("/api/proxy")
def api_proxy(req: ProxyRequest) -> Dict[str, Any]:
    if not req.url or not req.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="valid url is required")
    return proxy_page(req.url)


@app.get("/api/proxy")
def api_proxy_get(url: str) -> Dict[str, Any]:
    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="valid url query param is required")
    return proxy_page(url)


# ─── P2P Signaling Relay endpoints ───

@app.post("/api/signal")
def api_signal(req: SignalRequest) -> Dict[str, Any]:
    """WebRTC signaling relay for cross-device peer discovery."""
    import time
    now = time.time()

    # Clean expired entries
    expired = [k for k, v in _SIGNAL_STORE.items() if now - v.get("_ts", 0) > _SIGNAL_TTL]
    for k in expired:
        del _SIGNAL_STORE[k]

    if req.type == "register":
        _SIGNAL_STORE[req.node_id] = {
            "_ts": now,
            "capabilities": req.capabilities or {},
            "offers": [],
            "answers": [],
            "ice_candidates": [],
        }
        # Return list of other registered nodes
        peers = [
            {"node_id": nid, "capabilities": v.get("capabilities", {})}
            for nid, v in _SIGNAL_STORE.items()
            if nid != req.node_id
        ]
        return {"ok": True, "peers": peers}

    elif req.type == "offer":
        # Send offer to target node
        target = _SIGNAL_STORE.get(req.target)
        if not target:
            return {"ok": False, "error": "target node not found"}
        target["offers"].append({
            "from": req.node_id,
            "sdp": req.sdp,
            "ts": now,
        })
        return {"ok": True}

    elif req.type == "answer":
        target = _SIGNAL_STORE.get(req.target)
        if not target:
            return {"ok": False, "error": "target node not found"}
        target["answers"].append({
            "from": req.node_id,
            "sdp": req.sdp,
            "ts": now,
        })
        return {"ok": True}

    elif req.type == "ice":
        target = _SIGNAL_STORE.get(req.target)
        if not target:
            return {"ok": False, "error": "target node not found"}
        target["ice_candidates"].append({
            "from": req.node_id,
            "ice": req.ice,
            "ts": now,
        })
        return {"ok": True}

    elif req.type == "poll":
        # Check for incoming offers, answers, ICE candidates
        node = _SIGNAL_STORE.get(req.node_id)
        if not node:
            return {"ok": False, "error": "not registered"}
        node["_ts"] = now  # refresh TTL
        offers = node["offers"]
        answers = node["answers"]
        ice = node["ice_candidates"]
        # Clear after reading
        node["offers"] = []
        node["answers"] = []
        node["ice_candidates"] = []
        # Also return updated peer list
        peers = [
            {"node_id": nid, "capabilities": v.get("capabilities", {})}
            for nid, v in _SIGNAL_STORE.items()
            if nid != req.node_id
        ]
        return {
            "ok": True,
            "offers": offers,
            "answers": answers,
            "ice_candidates": ice,
            "peers": peers,
        }

    elif req.type == "unregister":
        _SIGNAL_STORE.pop(req.node_id, None)
        return {"ok": True}

    return {"ok": False, "error": "unknown signal type"}


@app.get("/api/peers")
def api_peers() -> Dict[str, Any]:
    """List all registered nodes and their capabilities."""
    import time
    now = time.time()
    expired = [k for k, v in _SIGNAL_STORE.items() if now - v.get("_ts", 0) > _SIGNAL_TTL]
    for k in expired:
        del _SIGNAL_STORE[k]
    peers = [
        {"node_id": nid, "capabilities": v.get("capabilities", {})}
        for nid, v in _SIGNAL_STORE.items()
    ]
    return {"ok": True, "peers": peers, "count": len(peers)}


@app.get("/browse", response_class=HTMLResponse)
def browse_page(url: str = "") -> str:
    """Browser-in-browser — full navigation, tabs, history. No iframe."""
    return _BROWSER_HTML


@app.get("/desktop", response_class=HTMLResponse)
def desktop_page() -> str:
    """macOS-like desktop environment in the browser with apps."""
    return _DESKTOP_HTML


@app.get("/web", response_class=HTMLResponse)
def screenshot_web() -> str:
    """Screenshot web — pages as images with link overlays. 2MB not 300MB."""
    return _SCREENSHOT_WEB_HTML


@app.get("/node", response_class=HTMLResponse)
def compute_node() -> str:
    """Real browser compute node — WebLLM inference, OPFS filesystem, P2P."""
    return _NODE_HTML


@app.post("/api/ingest")
def api_ingest(req: IngestRequest) -> Dict[str, Any]:
    return tools.ingest_video(req.task_id, req.intent, req.video_url)


@app.post("/api/score")
def api_score(req: ExperimentIdRequest) -> Dict[str, Any]:
    try:
        return tools.score_transcript(req.experiment_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/script")
def api_script(req: ExperimentIdRequest) -> Dict[str, Any]:
    try:
        return tools.generate_script(req.experiment_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/metadata")
def api_metadata(req: ExperimentIdRequest) -> Dict[str, Any]:
    try:
        return tools.generate_metadata(req.experiment_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/shotlist")
def api_shotlist(req: ExperimentIdRequest) -> Dict[str, Any]:
    try:
        return tools.generate_shotlist(req.experiment_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/policy-check")
def api_policy_check(req: ExperimentIdRequest) -> Dict[str, Any]:
    try:
        return tools.policy_check(req.experiment_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/prepare-upload")
def api_prepare_upload(req: ExperimentIdRequest) -> Dict[str, Any]:
    try:
        return tools.prepare_upload_package(req.experiment_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/projects")
def api_create_project(req: CreateProjectRequest) -> Dict[str, Any]:
    try:
        return tools.create_project(req.project_id, req.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/projects")
def api_list_projects(limit: int = 100) -> Dict[str, Any]:
    return tools.list_projects(limit)


@app.post("/api/queries")
def api_create_query(req: CreateQueryRequest) -> Dict[str, Any]:
    try:
        return tools.create_research_query(req.query_id, req.project_id, req.query, req.status)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/queries/list")
def api_list_queries(req: ListQueriesRequest) -> Dict[str, Any]:
    return tools.list_research_queries(req.project_id, req.limit)


@app.post("/mcp")
def mcp(req: MCPRequest) -> Dict[str, Any]:
    params = req.params or {}
    method = req.method

    if method == "initialize":
        return {"jsonrpc": "2.0", "id": req.id, "result": {"protocolVersion": "2024-11-05", "capabilities": {}, "serverInfo": {"name": "ytl-mcp-lab", "version": "0.1.0"}}}

    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req.id,
            "result": {
                "tools": [
                    {
                        "name": "lab_ingest_video",
                        "description": "Ingest a video URL and create an experiment record.",
                        "inputSchema": {"type": "object", "properties": {"task_id": {"type": "string"}, "intent": {"type": "string"}, "video_url": {"type": "string"}}, "required": ["task_id", "intent", "video_url"]},
                    },
                    {
                        "name": "lab_score_transcript",
                        "description": "Score an experiment's transcript.",
                        "inputSchema": {"type": "object", "properties": {"experiment_id": {"type": "string"}}, "required": ["experiment_id"]},
                    },
                    {
                        "name": "lab_generate_script",
                        "description": "Generate a script candidate for an experiment.",
                        "inputSchema": {"type": "object", "properties": {"experiment_id": {"type": "string"}}, "required": ["experiment_id"]},
                    },
                    {
                        "name": "lab_policy_check",
                        "description": "Run policy/compliance check on an experiment.",
                        "inputSchema": {"type": "object", "properties": {"experiment_id": {"type": "string"}}, "required": ["experiment_id"]},
                    },
                    {
                        "name": "lab_prepare_upload_package",
                        "description": "Prepare an upload package for an approved experiment.",
                        "inputSchema": {"type": "object", "properties": {"experiment_id": {"type": "string"}}, "required": ["experiment_id"]},
                    },
                    {
                        "name": "lab_status",
                        "description": "Get lab status summary.",
                        "inputSchema": {"type": "object", "properties": {}},
                    },
                    {
                        "name": "lab_create_project",
                        "description": "Create a research project.",
                        "inputSchema": {"type": "object", "properties": {"project_id": {"type": "string"}, "name": {"type": "string"}}, "required": ["project_id", "name"]},
                    },
                    {
                        "name": "lab_list_projects",
                        "description": "List research projects.",
                        "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer"}}},
                    },
                    {
                        "name": "lab_create_query",
                        "description": "Create a research query under a project.",
                        "inputSchema": {"type": "object", "properties": {"query_id": {"type": "string"}, "project_id": {"type": "string"}, "query": {"type": "string"}, "status": {"type": "string"}}, "required": ["query_id", "project_id", "query"]},
                    },
                    {
                        "name": "lab_list_queries",
                        "description": "List research queries for a project.",
                        "inputSchema": {"type": "object", "properties": {"project_id": {"type": "string"}, "limit": {"type": "integer"}}},
                    },
                ]
            },
        }

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments", {})
        try:
            if name == "lab_ingest_video":
                result = tools.ingest_video(args["task_id"], args["intent"], args["video_url"])
            elif name == "lab_score_transcript":
                result = tools.score_transcript(args["experiment_id"])
            elif name == "lab_generate_script":
                result = tools.generate_script(args["experiment_id"])
            elif name == "lab_policy_check":
                result = tools.policy_check(args["experiment_id"])
            elif name == "lab_prepare_upload_package":
                result = tools.prepare_upload_package(args["experiment_id"])
            elif name == "lab_status":
                result = tools.status()
            elif name == "lab_create_project":
                result = tools.create_project(args["project_id"], args["name"])
            elif name == "lab_list_projects":
                result = tools.list_projects(args.get("limit", 100))
            elif name == "lab_create_query":
                result = tools.create_research_query(args["query_id"], args["project_id"], args["query"], args.get("status", "open"))
            elif name == "lab_list_queries":
                result = tools.list_research_queries(args.get("project_id"), args.get("limit", 100))
            else:
                return {"jsonrpc": "2.0", "id": req.id, "error": {"code": -32601, "message": f"Tool {name} not found"}}
            return {"jsonrpc": "2.0", "id": req.id, "result": {"content": [{"type": "text", "text": json.dumps(result)}]}}
        except Exception as e:
            return {"jsonrpc": "2.0", "id": req.id, "error": {"code": -32000, "message": str(e)}}

    return {"jsonrpc": "2.0", "id": req.id, "error": {"code": -32601, "message": f"Method {method} not found"}}


_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>YTL-MCP Research Lab</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; }
.header { background: #161b22; border-bottom: 1px solid #30363d; padding: 20px 40px; display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 22px; color: #58a6ff; }
.header .badge { background: #238636; color: #fff; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.container { max-width: 1200px; margin: 0 auto; padding: 30px 40px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 30px; }
.stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; text-align: center; }
.stat-card .value { font-size: 32px; font-weight: 700; color: #58a6ff; }
.stat-card .label { font-size: 13px; color: #8b949e; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.panel { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 24px; }
.panel-header { padding: 16px 20px; border-bottom: 1px solid #30363d; font-size: 16px; font-weight: 600; color: #f0f6fc; display: flex; justify-content: space-between; align-items: center; }
.panel-body { padding: 20px; }
.form-row { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.form-row input, .form-row textarea { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 10px 14px; color: #c9d1d9; font-size: 14px; flex: 1; min-width: 200px; }
.form-row input:focus, .form-row textarea:focus { outline: none; border-color: #58a6ff; }
.btn { background: #238636; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn:hover { background: #2ea043; }
.btn:disabled { background: #21262d; color: #6e7681; cursor: not-allowed; }
.btn-secondary { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; }
.btn-secondary:hover { background: #30363d; }
.receipts { max-height: 400px; overflow-y: auto; }
.receipt { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; font-family: 'SF Mono', monospace; font-size: 12px; }
.receipt .step { color: #58a6ff; font-weight: 600; }
.receipt .status { float: right; }
.receipt .status.success { color: #3fb950; }
.receipt .status.approved { color: #3fb950; }
.receipt .hash { color: #8b949e; word-break: break-all; margin-top: 4px; }
.experiment { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 14px 16px; margin-bottom: 8px; }
.experiment .id { font-family: 'SF Mono', monospace; color: #f0883e; font-size: 13px; }
.experiment .score { float: right; font-weight: 700; }
.experiment .score.high { color: #3fb950; }
.experiment .score.mid { color: #d29922; }
.experiment .score.low { color: #f85149; }
.log { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 12px; font-family: 'SF Mono', monospace; font-size: 12px; max-height: 200px; overflow-y: auto; color: #8b949e; }
.log .entry { margin-bottom: 4px; }
.log .entry.ok { color: #3fb950; }
.log .entry.err { color: #f85149; }
.tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.tab { padding: 8px 16px; background: #161b22; border: 1px solid #30363d; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 14px; color: #8b949e; }
.tab.active { background: #238636; color: #fff; border-color: #238636; }
a { color: #58a6ff; text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="header">
<h1>YTL-MCP Research Lab</h1>
<div>
<span class="badge" id="health-badge">Loading...</span>
<a href="/docs" target="_blank" style="margin-left:16px;font-size:14px;">API Docs</a>
</div>
</div>
<div class="container">
<div class="stats" id="stats"></div>

<div class="panel">
<div class="panel-header">New Experiment</div>
<div class="panel-body">
<div class="form-row">
<input type="text" id="task-id" placeholder="Task ID (e.g. HF-001)">
<input type="text" id="video-url" placeholder="YouTube URL (https://youtu.be/...)">
</div>
<div class="form-row">
<textarea id="intent" placeholder="Intent / experiment description" rows="2"></textarea>
</div>
<div class="form-row">
<button class="btn" id="run-btn" onclick="runFullCycle()">Run Full Cycle</button>
<button class="btn btn-secondary" id="ingest-btn" onclick="ingestOnly()">Ingest Only</button>
<button class="btn btn-secondary" onclick="loadStatus()">Refresh</button>
</div>
</div>
</div>

<div class="panel">
<div class="panel-header">Competitor Discovery <span style="font-size:12px;color:#8b949e;font-weight:400;">Find APIs + competitors</span></div>
<div class="panel-body">
<div class="form-row">
<input type="text" id="niche" placeholder="Niche (e.g. AI image generation, crypto tracking, resume builder)">
<button class="btn" id="discover-btn" onclick="discoverCompetitors()">Find Competitors</button>
</div>
<div id="discover-results" style="margin-top:12px;"></div>
</div>
</div>

<div class="panel">
<div class="panel-header">Recent Receipts <span style="font-size:12px;color:#8b949e;font-weight:400;" id="receipt-count"></span></div>
<div class="panel-body">
<div class="receipts" id="receipts"><div style="color:#8b949e;text-align:center;padding:20px;">No receipts yet</div></div>
</div>
</div>

<div class="panel">
<div class="panel-header">Activity Log</div>
<div class="panel-body">
<div class="log" id="log"></div>
</div>
</div>
</div>

<script>
function log(msg, ok) {
    const el = document.getElementById('log');
    const div = document.createElement('div');
    div.className = 'entry ' + (ok === false ? 'err' : (ok === true ? 'ok' : ''));
    const time = new Date().toLocaleTimeString();
    div.textContent = `[${time}] ${msg}`;
    el.insertBefore(div, el.firstChild);
}

async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t}`); }
    return r.json();
}

async function loadStatus() {
    try {
        const h = await api('GET', '/health');
        document.getElementById('health-badge').textContent = h.status === 'ok' ? 'Online' : 'Offline';

        const s = await api('GET', '/api/status');
        const sum = s.summary;
        const stats = [
            { label: 'Experiments', value: sum.total_experiments },
            { label: 'Projects', value: sum.projects },
            { label: 'Receipts', value: sum.receipts },
            { label: 'Approved', value: sum.approved },
            { label: 'Pending Policy', value: sum.pending_policy },
            { label: 'Avg Score', value: sum.average_transcript_score.toFixed(3) },
        ];
        document.getElementById('stats').innerHTML = stats.map(s =>
            `<div class="stat-card"><div class="value">${s.value}</div><div class="label">${s.label}</div></div>`
        ).join('');

        const receipts = s.recent_receipts || [];
        document.getElementById('receipt-count').textContent = `(${receipts.length} shown)`;
        if (receipts.length === 0) {
            document.getElementById('receipts').innerHTML = '<div style="color:#8b949e;text-align:center;padding:20px;">No receipts yet</div>';
        } else {
            document.getElementById('receipts').innerHTML = receipts.map(r => `
                <div class="receipt">
                    <span class="step">${r.step}</span>
                    <span class="status ${r.status}">${r.status}</span>
                    <div>Experiment: ${r.experiment_id} | Task: ${r.task_id}</div>
                    <div class="hash">${r.hash}</div>
                </div>
            `).join('');
        }
    } catch (e) {
        log('Failed to load status: ' + e.message, false);
        document.getElementById('health-badge').textContent = 'Error';
    }
}

async function ingestOnly() {
    const taskId = document.getElementById('task-id').value.trim();
    const intent = document.getElementById('intent').value.trim();
    const url = document.getElementById('video-url').value.trim();
    if (!taskId || !intent || !url) { log('All fields required', false); return; }

    document.getElementById('ingest-btn').disabled = true;
    try {
        log('Ingesting video...');
        const r = await api('POST', '/api/ingest', { task_id: taskId, intent, video_url: url });
        log(`Ingested: ${r.experiment_id}`, true);
        log(`Receipt: ${r.receipt.receipt_id}`, true);
        await loadStatus();
    } catch (e) {
        log('Ingest failed: ' + e.message, false);
    }
    document.getElementById('ingest-btn').disabled = false;
}

async function runFullCycle() {
    const taskId = document.getElementById('task-id').value.trim();
    const intent = document.getElementById('intent').value.trim();
    const url = document.getElementById('video-url').value.trim();
    if (!taskId || !intent || !url) { log('All fields required', false); return; }

    const btn = document.getElementById('run-btn');
    btn.disabled = true;
    btn.textContent = 'Running...';

    try {
        log('Step 1/7: Ingesting video...');
        const ingest = await api('POST', '/api/ingest', { task_id: taskId, intent, video_url: url });
        const expId = ingest.experiment_id;
        log(`Ingested: ${expId}`, true);

        log('Step 2/7: Scoring transcript...');
        const score = await api('POST', '/api/score', { experiment_id: expId });
        log(`Score: ${score.score} (${score.dominant_signal})`, true);

        log('Step 3/7: Generating script...');
        await api('POST', '/api/script', { experiment_id: expId });
        log('Script generated', true);

        log('Step 4/7: Generating metadata...');
        await api('POST', '/api/metadata', { experiment_id: expId });
        log('Metadata generated', true);

        log('Step 5/7: Generating shotlist...');
        await api('POST', '/api/shotlist', { experiment_id: expId });
        log('Shotlist generated', true);

        log('Step 6/7: Policy check...');
        const policy = await api('POST', '/api/policy-check', { experiment_id: expId });
        log(`Policy: ${policy.policy_status}`, true);

        log('Step 7/7: Preparing upload package...');
        const pkg = await api('POST', '/api/prepare-upload', { experiment_id: expId });
        log(`Upload package ready (${pkg.package.receipts.length} receipts)`, true);

        log('Full cycle complete!', true);
        await loadStatus();
    } catch (e) {
        log('Cycle failed: ' + e.message, false);
    }

    btn.disabled = false;
    btn.textContent = 'Run Full Cycle';
}

async function discoverCompetitors() {
    const niche = document.getElementById('niche').value.trim();
    if (!niche) { log('Enter a niche first', false); return; }
    const btn = document.getElementById('discover-btn');
    btn.disabled = true; btn.textContent = 'Searching...';
    document.getElementById('discover-results').innerHTML = '<div style="color:#8b949e;padding:20px;">Crawling the web for competitors...</div>';
    try {
        log(`Discovering competitors for "${niche}"...`);
        const r = await api('POST', '/api/discover', { niche, max_results: 6 });
        log(`Found ${r.total_found} competitors (${r.with_apis_count} with APIs)`, true);
        const comps = r.competitors;
        if (!comps.length) {
            document.getElementById('discover-results').innerHTML = '<div style="color:#8b949e;padding:12px;">No competitors found.</div>';
        } else {
            document.getElementById('discover-results').innerHTML = comps.map((c, i) => `
                <div class="experiment" style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:start;">
                        <div>
                            <span style="font-family:'SF Mono',monospace;color:#8b949e;font-size:11px;">#${i+1}</span>
                            <span style="font-weight:600;color:#f0f6fc;">${escapeHtml(c.title)}</span>
                            ${c.reachable ? '<span class="status success" style="float:none;color:#3fb950;font-size:11px;margin-left:8px;">Live</span>' : '<span style="color:#f85149;font-size:11px;margin-left:8px;">Unreachable</span>'}
                            <div style="margin-top:4px;"><a href="${escapeHtml(c.url)}" target="_blank" style="font-size:12px;">${escapeHtml(c.url)}</a></div>
                            ${c.description ? `<div style="font-size:12px;color:#8b949e;margin-top:4px;">${escapeHtml(c.description.slice(0,120))}</div>` : ''}
                        </div>
                        <div style="text-align:right;">
                            <span class="score ${c.score >= 70 ? 'high' : c.score >= 40 ? 'mid' : 'low'}">${c.score}</span>
                        </div>
                    </div>
                    ${c.api_endpoints.length ? `<div style="margin-top:8px;"><span style="font-size:10px;color:#8b949e;text-transform:uppercase;">APIs (${c.api_endpoints.length})</span><div style="margin-top:4px;">${c.api_endpoints.slice(0,3).map(e => `<div style="font-family:'SF Mono',monospace;font-size:11px;color:#f0883e;word-break:break-all;">${escapeHtml(e)}</div>`).join('')}</div></div>` : ''}
                    ${c.tech_stack.length ? `<div style="margin-top:8px;"><span style="font-size:10px;color:#8b949e;text-transform:uppercase;">Tech</span> ${c.tech_stack.map(t => `<span style="font-size:10px;color:#bc8cff;background:#1f1f2e;border:1px solid #30363d;border-radius:10px;padding:1px 8px;margin:2px;display:inline-block;">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                    ${c.pricing_signals.length ? `<div style="margin-top:8px;"><span style="font-size:10px;color:#8b949e;text-transform:uppercase;">Pricing</span> ${c.pricing_signals.map(s => `<span style="font-size:10px;color:#3fb950;background:#0d1f0d;border:1px solid #1f3f1f;border-radius:10px;padding:1px 8px;margin:2px;display:inline-block;">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
                    <div style="margin-top:10px;">
                        <button class="btn" style="background:#da3633;font-size:12px;padding:6px 14px;" onclick="createVideoFromCompetitor(${i})">Create Video</button>
                    </div>
                    <div id="video-result-${i}" style="margin-top:8px;"></div>
                </div>
            `).join('');
            window._competitors = comps;
            window._niche = niche;
        }
    } catch (e) {
        log('Discovery failed: ' + e.message, false);
        document.getElementById('discover-results').innerHTML = `<div style="color:#f85149;padding:12px;">${escapeHtml(e.message)}</div>`;
    }
    btn.disabled = false; btn.textContent = 'Find Competitors';
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function createVideoFromCompetitor(i) {
    const comp = window._competitors[i];
    const niche = window._niche;
    const el = document.getElementById('video-result-' + i);
    el.innerHTML = '<div style="color:#8b949e;font-size:12px;">Creating video experiment...</div>';
    try {
        log(`Creating video for ${comp.title}...`);
        const intent = `Competitor analysis: ${comp.title} (${comp.url}) in ${niche}. APIs: ${comp.api_endpoints.length}. Tech: ${comp.tech_stack.join(', ')}. Pricing: ${comp.pricing_signals.join(', ')}.`;
        const ingest = await api('POST', '/api/ingest', { task_id: 'SIX-BROWSE-' + Date.now(), intent, video_url: comp.url });
        const expId = ingest.experiment_id;
        log(`Ingested: ${expId}`, true);
        await api('POST', '/api/score', { experiment_id: expId });
        await api('POST', '/api/script', { experiment_id: expId });
        await api('POST', '/api/metadata', { experiment_id: expId });
        await api('POST', '/api/shotlist', { experiment_id: expId });
        const policy = await api('POST', '/api/policy-check', { experiment_id: expId });
        const pkg = await api('POST', '/api/prepare-upload', { experiment_id: expId });
        log(`Video created: ${expId} — policy: ${policy.policy_status}`, true);
        el.innerHTML = `<div style="background:#0d1f0d;border:1px solid #1f3f1f;border-radius:6px;padding:10px;font-size:12px;">
            <div style="color:#3fb950;font-weight:600;">Video Experiment Created</div>
            <div style="margin-top:4px;">ID: <span style="font-family:'SF Mono',monospace;color:#58a6ff;">${expId}</span></div>
            <div>Policy: <span style="color:#3fb950;">${policy.policy_status}</span></div>
            <div>Receipts: ${pkg.package.receipts.length}</div>
        </div>`;
        await loadStatus();
    } catch (e) {
        log('Video creation failed: ' + e.message, false);
        el.innerHTML = `<div style="color:#f85149;font-size:12px;">${escapeHtml(e.message)}</div>`;
    }
}

loadStatus();
setInterval(loadStatus, 10000);
</script>
</body>
</html>"""


_BROWSER_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Browser — YTL-MCP Lab</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; display: flex; flex-direction: column; }

/* Chrome */
.chrome { background: #1c1c2e; border-bottom: 1px solid #30363d; flex-shrink: 0; }
.tab-bar { display: flex; align-items: center; padding: 0 8px; height: 36px; gap: 2px; background: #161b22; border-bottom: 1px solid #21262d; }
.tab { display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: #21262d; border: 1px solid #30363d; border-bottom: none; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 12px; color: #8b949e; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative; top: 1px; }
.tab.active { background: #0d1117; color: #f0f6fc; border-color: #30363d; }
.tab:hover:not(.active) { background: #30363d; }
.tab .close { width: 16px; height: 16px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 14px; opacity: 0.5; }
.tab .close:hover { opacity: 1; background: #f85149; color: #fff; }
.tab .favicon { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0; }
.new-tab { padding: 6px 10px; cursor: pointer; color: #8b949e; font-size: 16px; border-radius: 4px; }
.new-tab:hover { background: #30363d; color: #f0f6fc; }

/* Nav bar */
.nav-bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: #161b22; }
.nav-btn { width: 30px; height: 30px; border-radius: 6px; border: none; background: #21262d; color: #8b949e; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.nav-btn:hover:not(:disabled) { background: #30363d; color: #f0f6fc; }
.nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.address-bar { flex: 1; display: flex; align-items: center; gap: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 20px; padding: 4px 14px; }
.address-bar:focus-within { border-color: #58a6ff; }
.address-bar input { flex: 1; background: none; border: none; color: #c9d1d9; font-size: 14px; outline: none; padding: 4px 0; }
.address-bar .security { font-size: 12px; color: #3fb950; flex-shrink: 0; }
.go-btn { background: #238636; color: #fff; border: none; padding: 6px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
.go-btn:hover { background: #2ea043; }
.go-btn:disabled { background: #21262d; color: #6e7681; }
.action-btn { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.action-btn:hover { background: #30363d; }
.action-btn.video { background: #da3633; color: #fff; border-color: #da3633; }
.action-btn.video:hover { background: #f85149; }

/* Viewport */
.viewport { flex: 1; overflow: hidden; position: relative; background: #fff; }
.page-render { width: 100%; height: 100%; overflow-y: auto; border: none; background: #fff; }
.page-render.dark { background: #0d1117; }

/* Loading */
.loading-overlay { position: absolute; inset: 0; background: #0d1117; display: flex; align-items: center; justify-content: center; z-index: 100; }
.loading-overlay .spinner { width: 36px; height: 36px; border: 3px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Error */
.error-page { position: absolute; inset: 0; background: #0d1117; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #f85149; font-size: 16px; gap: 12px; }
.error-page .code { font-size: 48px; font-weight: 700; opacity: 0.3; }

/* New tab page */
.new-tab-page { position: absolute; inset: 0; background: #0d1117; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; }
.new-tab-page h1 { font-size: 28px; color: #f0f6fc; }
.new-tab-page .quick-links { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; max-width: 600px; }
.new-tab-page .quick-link { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px; background: #161b22; border: 1px solid #30363d; border-radius: 12px; cursor: pointer; transition: all 0.2s; }
.new-tab-page .quick-link:hover { border-color: #58a6ff; background: #1c1c2e; }
.new-tab-page .quick-link .icon { font-size: 28px; }
.new-tab-page .quick-link .name { font-size: 12px; color: #8b949e; }

/* History panel */
.history-panel { position: absolute; right: 0; top: 0; bottom: 0; width: 300px; background: #161b22; border-left: 1px solid #30363d; z-index: 50; transform: translateX(100%); transition: transform 0.2s; overflow-y: auto; }
.history-panel.open { transform: translateX(0); }
.history-panel h3 { padding: 16px; font-size: 14px; color: #8b949e; text-transform: uppercase; border-bottom: 1px solid #30363d; }
.history-item { padding: 10px 16px; cursor: pointer; border-bottom: 1px solid #21262d; }
.history-item:hover { background: #21262d; }
.history-item .title { font-size: 13px; color: #c9d1d9; }
.history-item .url { font-size: 11px; color: #8b949e; }
.history-item .time { font-size: 10px; color: #6e7681; }
</style>
</head>
<body>
<div class="chrome">
<!-- Tab bar -->
<div class="tab-bar" id="tab-bar"></div>
<!-- Nav bar -->
<div class="nav-bar">
<button class="nav-btn" id="back-btn" onclick="goBack()" title="Back">←</button>
<button class="nav-btn" id="fwd-btn" onclick="goForward()" title="Forward">→</button>
<button class="nav-btn" onclick="reload()" title="Reload">⟳</button>
<div class="address-bar">
<span class="security" id="security-icon">🔒</span>
<input type="text" id="address-input" placeholder="Search or enter URL" onkeydown="if(event.key==='Enter')navigate()">
</div>
<button class="go-btn" id="go-btn" onclick="navigate()">Go</button>
<button class="action-btn video" onclick="createVideoFromPage()">Create Video</button>
<button class="action-btn" onclick="toggleHistory()">History</button>
<a href="/" class="action-btn" style="text-decoration:none;">Lab ←</a>
</div>
</div>

<!-- Viewport -->
<div class="viewport" id="viewport">
<div class="new-tab-page" id="new-tab-page">
<h1>Browser</h1>
<p style="color:#8b949e;font-size:14px;">Enter a URL above or pick a shortcut</p>
<div class="quick-links">
<div class="quick-link" onclick="browserGo('https://docs.python.org/3/')"><span class="icon">🐍</span><span class="name">Python Docs</span></div>
<div class="quick-link" onclick="browserGo('https://news.ycombinator.com/')"><span class="icon">📰</span><span class="name">Hacker News</span></div>
<div class="quick-link" onclick="browserGo('https://github.com/trending')"><span class="icon">🐙</span><span class="name">GitHub Trending</span></div>
<div class="quick-link" onclick="browserGo('https://en.wikipedia.org/wiki/Main_Page')"><span class="icon">📚</span><span class="name">Wikipedia</span></div>
</div>
</div>
</div>

<!-- History panel -->
<div class="history-panel" id="history-panel">
<h3>History</h3>
<div id="history-list"></div>
</div>

<script>
// ─── Browser state ───
const browser = {
    tabs: [],
    activeTab: null,
    nextTabId: 1,
    history: [], // global history
};

// ─── Tab management ───
function createTab(url = null) {
    const tab = {
        id: browser.nextTabId++,
        url: url || null,
        title: 'New Tab',
        history: [],
        historyIndex: -1,
        loading: false,
        pageData: null,
    };
    browser.tabs.push(tab);
    browser.activeTab = tab.id;
    renderTabs();
    if (url) {
        loadPage(url);
    } else {
        showNewTabPage();
    }
}

function closeTab(id) {
    const idx = browser.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    browser.tabs.splice(idx, 1);
    if (browser.tabs.length === 0) {
        createTab();
        return;
    }
    if (browser.activeTab === id) {
        browser.activeTab = browser.tabs[Math.min(idx, browser.tabs.length - 1)].id;
        renderTab(browser.activeTab);
    }
    renderTabs();
}

function switchTab(id) {
    browser.activeTab = id;
    renderTabs();
    renderTab(id);
}

function renderTabs() {
    const bar = document.getElementById('tab-bar');
    bar.innerHTML = browser.tabs.map(t => `
        <div class="tab ${t.id === browser.activeTab ? 'active' : ''}" onclick="switchTab(${t.id})">
            <span>${escapeHtml(t.title.slice(0, 20))}</span>
            <span class="close" onclick="event.stopPropagation();closeTab(${t.id})">×</span>
        </div>
    `).join('') + `<div class="new-tab" onclick="createTab()">+</div>`;
}

function getActiveTab() {
    return browser.tabs.find(t => t.id === browser.activeTab);
}

// ─── Navigation ───
function navigate() {
    const input = document.getElementById('address-input').value.trim();
    if (!input) return;
    let url = input;
    if (!/^https?:\/\//.test(url)) {
        if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url;
        else url = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(url);
    }
    browserGo(url);
}

// Called by proxied pages (via window.parent.browserGo)
function browserGo(url) {
    const tab = getActiveTab();
    if (!tab) return;
    // Add to tab history
    if (tab.historyIndex < tab.history.length - 1) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
    }
    tab.history.push(url);
    tab.historyIndex = tab.history.length - 1;
    // Add to global history
    browser.history.push({ url, time: new Date().toLocaleTimeString(), title: '' });
    loadPage(url);
}

function goBack() {
    const tab = getActiveTab();
    if (!tab || tab.historyIndex <= 0) return;
    tab.historyIndex--;
    loadPage(tab.history[tab.historyIndex]);
}

function goForward() {
    const tab = getActiveTab();
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex++;
    loadPage(tab.history[tab.historyIndex]);
}

function reload() {
    const tab = getActiveTab();
    if (!tab || !tab.url) return;
    loadPage(tab.url);
}

// ─── Page loading ───
async function loadPage(url) {
    const tab = getActiveTab();
    if (!tab) return;
    tab.url = url;
    tab.loading = true;
    document.getElementById('address-input').value = url;
    updateNavButtons();
    showLoading();

    try {
        const res = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        tab.loading = false;
        tab.pageData = data;

        if (!data.ok) {
            showError(data.error || 'Failed to load page');
        } else {
            tab.title = data.title || 'Untitled';
            renderTabs();
            renderPage(data);
            // Update history title
            if (browser.history.length > 0) {
                browser.history[browser.history.length - 1].title = tab.title;
            }
        }
    } catch (e) {
        tab.loading = false;
        showError(e.message);
    }
    updateNavButtons();
}

function renderPage(data) {
    const viewport = document.getElementById('viewport');
    // Create a shadow DOM container so proxied page styles don't leak
    viewport.innerHTML = '<div id="page-root" style="width:100%;height:100%;overflow-y:auto;"></div>';
    const pageRoot = document.getElementById('page-root');

    // Use srcdoc on an iframe with sandbox — this IS a browser-like context
    // but same-origin (no X-Frame-Options issue since we're serving our own HTML)
    // Actually, let's use a shadow DOM div to avoid iframe entirely
    const shadow = pageRoot.attachShadow({ mode: 'open' });

    // Inject the proxied HTML into the shadow DOM
    shadow.innerHTML = data.html;

    // The proxied HTML has <base> tag so resources load from original domain
    // Links have been rewritten to call browserNavigate() which calls window.parent.browserGo()
}

function showLoading() {
    const viewport = document.getElementById('viewport');
    viewport.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
}

function showError(msg) {
    const viewport = document.getElementById('viewport');
    viewport.innerHTML = `<div class="error-page"><div class="code">!</div><div>${escapeHtml(msg)}</div><button class="action-btn" onclick="reload()">Retry</button></div>`;
}

function showNewTabPage() {
    const viewport = document.getElementById('viewport');
    viewport.innerHTML = `
    <div class="new-tab-page">
        <h1>Browser</h1>
        <p style="color:#8b949e;font-size:14px;">Enter a URL above or pick a shortcut</p>
        <div class="quick-links">
            <div class="quick-link" onclick="browserGo('https://docs.python.org/3/')"><span class="icon">🐍</span><span class="name">Python Docs</span></div>
            <div class="quick-link" onclick="browserGo('https://news.ycombinator.com/')"><span class="icon">📰</span><span class="name">Hacker News</span></div>
            <div class="quick-link" onclick="browserGo('https://github.com/trending')"><span class="icon">🐙</span><span class="name">GitHub</span></div>
            <div class="quick-link" onclick="browserGo('https://en.wikipedia.org/wiki/Main_Page')"><span class="icon">📚</span><span class="name">Wikipedia</span></div>
        </div>
    </div>`;
    document.getElementById('address-input').value = '';
}

function renderTab(id) {
    const tab = browser.tabs.find(t => t.id === id);
    if (!tab) return;
    if (tab.pageData && tab.pageData.ok) {
        renderPage(tab.pageData);
        document.getElementById('address-input').value = tab.url || '';
    } else if (tab.url) {
        loadPage(tab.url);
    } else {
        showNewTabPage();
    }
    updateNavButtons();
}

function updateNavButtons() {
    const tab = getActiveTab();
    document.getElementById('back-btn').disabled = !tab || tab.historyIndex <= 0;
    document.getElementById('fwd-btn').disabled = !tab || tab.historyIndex >= tab.history.length - 1;
}

// ─── History panel ───
function toggleHistory() {
    const panel = document.getElementById('history-panel');
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
    } else {
        panel.classList.add('open');
        renderHistory();
    }
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (browser.history.length === 0) {
        list.innerHTML = '<div style="padding:16px;color:#8b949e;font-size:13px;">No history yet</div>';
        return;
    }
    list.innerHTML = browser.history.slice().reverse().map(h => `
        <div class="history-item" onclick="browserGo('${escapeHtml(h.url)}');toggleHistory();">
            <div class="title">${escapeHtml(h.title || h.url)}</div>
            <div class="url">${escapeHtml(h.url.slice(0, 60))}</div>
            <div class="time">${escapeHtml(h.time)}</div>
        </div>
    `).join('');
}

// ─── Video creation ───
async function createVideoFromPage() {
    const tab = getActiveTab();
    if (!tab || !tab.url) { alert('Open a page first'); return; }
    if (!confirm('Create a video experiment from this page?')) return;

    const intent = 'Browsed page: ' + tab.title + ' (' + tab.url + ')';
    try {
        const res = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: 'BROWSE-' + Date.now(), intent, video_url: tab.url })
        });
        const data = await res.json();
        if (data.experiment_id) {
            const expId = data.experiment_id;
            await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) });
            await fetch('/api/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) });
            await fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) });
            await fetch('/api/shotlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) });
            const policy = await (await fetch('/api/policy-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) })).json();
            await fetch('/api/prepare-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) });
            alert('Video created: ' + expId + '\nPolicy: ' + policy.policy_status);
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// ─── Form submission (called by proxied forms) ───
async function browserSubmitForm(url, form) {
    const formData = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
        params.append(key, value);
    }
    const method = (form.method || 'get').toLowerCase();
    let targetUrl = url;
    if (method === 'get') {
        targetUrl = url + '?' + params.toString();
        browserGo(targetUrl);
    } else {
        // POST — submit through proxy
        try {
            const res = await fetch('/api/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, method: 'POST', body: params.toString() })
            });
            const data = await res.json();
            if (data.ok) {
                const tab = getActiveTab();
                tab.pageData = data;
                tab.title = data.title;
                renderPage(data);
                renderTabs();
            }
        } catch (e) {
            showError(e.message);
        }
    }
    return false;
}

// ─── Utils ───
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── Init ───
createTab();

// Auto-navigate if URL in query string
const params = new URLSearchParams(location.search);
if (params.get('url')) {
    browserGo(params.get('url'));
}
</script>
</body>
</html>"""


_DESKTOP_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HyperFlow OS</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-user-select: none; user-select: none; }
html, body { height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; }
#desktop { width: 100vw; height: 100vh; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #1a1a2e 100%); position: relative; overflow: hidden; }
#desktop::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 30% 20%, rgba(88,166,255,0.08) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(188,140,255,0.06) 0%, transparent 50%); }
#menubar { position: absolute; top: 0; left: 0; right: 0; height: 28px; background: rgba(0,0,0,0.25); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); display: flex; align-items: center; padding: 0 12px; z-index: 10000; font-size: 13px; color: #fff; }
#menubar .apple-logo { font-size: 16px; margin-right: 16px; cursor: pointer; }
#menubar .menu-item { padding: 0 10px; height: 28px; display: flex; align-items: center; cursor: pointer; border-radius: 4px; }
#menubar .menu-item:hover { background: rgba(255,255,255,0.15); }
#menubar .app-name { font-weight: 600; }
#menubar .spacer { flex: 1; }
#menubar .status-item { padding: 0 8px; font-size: 12px; cursor: pointer; border-radius: 4px; }
#menubar .status-item:hover { background: rgba(255,255,255,0.15); }
#menubar .status-item .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; }
#menubar .status-item .dot.green { background: #3fb950; }
#menubar .status-item .dot.red { background: #f85149; }
#desktop-icons { position: absolute; top: 40px; right: 20px; display: flex; flex-direction: column; gap: 16px; z-index: 1; }
.desktop-icon { display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; padding: 8px; border-radius: 8px; width: 80px; }
.desktop-icon:hover { background: rgba(255,255,255,0.1); }
.desktop-icon .icon { font-size: 36px; }
.desktop-icon .label { font-size: 11px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.5); text-align: center; }
.window { position: absolute; background: rgba(28,28,46,0.95); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; z-index: 100; min-width: 300px; min-height: 200px; }
.window.active { box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(88,166,255,0.3); }
.window.maximized { top: 28px !important; left: 0 !important; width: 100vw !important; height: calc(100vh - 28px - 80px) !important; border-radius: 0; }
.titlebar { height: 32px; background: rgba(0,0,0,0.2); display: flex; align-items: center; padding: 0 12px; cursor: grab; border-bottom: 1px solid rgba(255,255,255,0.05); flex-shrink: 0; }
.titlebar:active { cursor: grabbing; }
.traffic-lights { display: flex; gap: 8px; margin-right: 12px; }
.traffic-light { width: 12px; height: 12px; border-radius: 50%; cursor: pointer; }
.traffic-light.close { background: #ff5f57; }
.traffic-light.min { background: #febc2e; }
.traffic-light.max { background: #28c840; }
.window-title { flex: 1; text-align: center; font-size: 13px; color: #aaa; font-weight: 500; }
.window-content { flex: 1; overflow: auto; position: relative; }
#dock { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); display: flex; align-items: flex-end; gap: 8px; padding: 8px 12px; background: rgba(255,255,255,0.1); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; z-index: 10000; }
.dock-item { display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: transform 0.15s; position: relative; }
.dock-item:hover { transform: translateY(-8px) scale(1.15); }
.dock-item .icon { font-size: 40px; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; }
.dock-item .label { font-size: 10px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); margin-top: 2px; opacity: 0; transition: opacity 0.15s; }
.dock-item:hover .label { opacity: 1; }
.dock-item.running::after { content: ''; position: absolute; bottom: -4px; width: 4px; height: 4px; border-radius: 50%; background: #fff; }
.dock-separator { width: 1px; height: 40px; background: rgba(255,255,255,0.2); margin: 0 4px; }
.browser-app { display: flex; flex-direction: column; height: 100%; background: #0d1117; }
.browser-app .tab-bar { display: flex; align-items: center; padding: 0 6px; height: 30px; gap: 2px; background: #161b22; border-bottom: 1px solid #21262d; }
.browser-app .tab { display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: #21262d; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 11px; color: #8b949e; max-width: 160px; white-space: nowrap; overflow: hidden; }
.browser-app .tab.active { background: #0d1117; color: #f0f6fc; }
.browser-app .tab .close { margin-left: 4px; opacity: 0.5; }
.browser-app .tab .close:hover { opacity: 1; }
.browser-app .nav-bar { display: flex; align-items: center; gap: 4px; padding: 6px 10px; background: #161b22; }
.browser-app .nav-btn { width: 26px; height: 26px; border-radius: 5px; border: none; background: #21262d; color: #8b949e; cursor: pointer; font-size: 14px; }
.browser-app .nav-btn:hover:not(:disabled) { background: #30363d; color: #fff; }
.browser-app .nav-btn:disabled { opacity: 0.3; }
.browser-app .address { flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 14px; padding: 3px 12px; color: #c9d1d9; font-size: 12px; outline: none; }
.browser-app .address:focus { border-color: #58a6ff; }
.browser-app .viewport { flex: 1; overflow: hidden; position: relative; background: #fff; }
.browser-app .loading { position: absolute; inset: 0; background: #0d1117; display: flex; align-items: center; justify-content: center; }
.browser-app .loading .spin { width: 28px; height: 28px; border: 3px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.browser-app .newtab { position: absolute; inset: 0; background: #0d1117; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.browser-app .newtab h2 { color: #f0f6fc; font-size: 20px; }
.browser-app .quicklinks { display: grid; grid-template-columns: repeat(4, 80px); gap: 12px; }
.browser-app .quicklink { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px; background: #161b22; border: 1px solid #30363d; border-radius: 10px; cursor: pointer; }
.browser-app .quicklink:hover { border-color: #58a6ff; }
.browser-app .quicklink .ic { font-size: 24px; }
.browser-app .quicklink .nm { font-size: 10px; color: #8b949e; }
.terminal-app { background: #0c0c0c; color: #00ff41; font-family: 'SF Mono', 'Monaco', monospace; font-size: 13px; padding: 12px; height: 100%; overflow-y: auto; line-height: 1.5; }
.terminal-app .line { white-space: pre-wrap; word-break: break-all; }
.terminal-app .prompt { color: #58a6ff; }
.terminal-app .input-line { display: flex; }
.terminal-app .input-line input { background: none; border: none; color: #00ff41; font-family: inherit; font-size: inherit; outline: none; flex: 1; }
.llm-app { display: flex; flex-direction: column; height: 100%; background: #0d1117; }
.llm-app .chat { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.llm-app .msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; }
.llm-app .msg.user { background: #238636; color: #fff; align-self: flex-end; }
.llm-app .msg.assistant { background: #161b22; color: #c9d1d9; border: 1px solid #30363d; align-self: flex-start; }
.llm-app .msg.system { background: #1c1c2e; color: #8b949e; font-size: 12px; font-style: italic; align-self: center; }
.llm-app .input-bar { display: flex; gap: 8px; padding: 12px; background: #161b22; border-top: 1px solid #30363d; }
.llm-app .input-bar textarea { flex: 1; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 10px; color: #c9d1d9; font-size: 14px; font-family: inherit; resize: none; outline: none; min-height: 40px; max-height: 120px; }
.llm-app .input-bar textarea:focus { border-color: #58a6ff; }
.llm-app .input-bar button { background: #238636; color: #fff; border: none; padding: 8px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; }
.llm-app .input-bar button:hover { background: #2ea043; }
.llm-app .input-bar button:disabled { background: #21262d; color: #6e7681; }
.llm-app .model-bar { padding: 8px 16px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 12px; font-size: 12px; color: #8b949e; }
.llm-app .model-bar select { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 4px 8px; color: #c9d1d9; font-size: 12px; }
.discover-app { display: flex; flex-direction: column; height: 100%; background: #0d1117; padding: 16px; gap: 12px; overflow-y: auto; }
.discover-app input { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 10px 14px; color: #c9d1d9; font-size: 14px; outline: none; }
.discover-app input:focus { border-color: #58a6ff; }
.discover-app button { background: #238636; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; }
.discover-app button:disabled { background: #21262d; color: #6e7681; }
.discover-app .result { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; margin-bottom: 8px; }
.discover-app .result .title { font-weight: 600; color: #f0f6fc; font-size: 14px; }
.discover-app .result .url { color: #58a6ff; font-size: 12px; }
.discover-app .result .score { float: right; font-size: 20px; font-weight: 700; color: #58a6ff; }
.discover-app .result .apis { font-family: monospace; font-size: 11px; color: #f0883e; margin-top: 6px; }
.discover-app .result .tech { margin-top: 6px; }
.discover-app .result .tech span { font-size: 10px; color: #bc8cff; background: #1f1f2e; border: 1px solid #30363d; border-radius: 10px; padding: 1px 6px; margin: 2px; display: inline-block; }
.discover-app .result .actions { margin-top: 8px; display: flex; gap: 6px; }
.discover-app .result .actions button { font-size: 11px; padding: 4px 10px; }
.discover-app .result .actions .video-btn { background: #da3633; }
.lab-app { padding: 20px; background: #0d1117; color: #c9d1d9; overflow-y: auto; height: 100%; }
.lab-app h2 { color: #f0f6fc; margin-bottom: 16px; }
.lab-app .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
.lab-app .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; }
.lab-app .stat .val { font-size: 28px; font-weight: 700; color: #58a6ff; }
.lab-app .stat .lbl { font-size: 11px; color: #8b949e; text-transform: uppercase; margin-top: 4px; }
.lab-app .receipt { background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 10px; margin-bottom: 6px; font-family: monospace; font-size: 11px; }
.lab-app .receipt .step { color: #58a6ff; }
.resize-handle { position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: nwse-resize; }
</style>
</head>
<body>
<div id="desktop">
<div id="menubar">
<span class="apple-logo"></span>
<span class="menu-item app-name" id="active-app-name">HyperFlow OS</span>
<span class="menu-item" onclick="openApp('browser')">File</span>
<span class="menu-item" onclick="openApp('terminal')">Edit</span>
<span class="menu-item">View</span>
<span class="spacer"></span>
<span class="status-item" id="lab-status"><span class="dot green"></span>Lab Online</span>
<span class="status-item" id="clock">--:--</span>
</div>
<div id="desktop-icons">
<div class="desktop-icon" ondblclick="openApp('browser')"><span class="icon">🌐</span><span class="label">Browser</span></div>
<div class="desktop-icon" ondblclick="openApp('terminal')"><span class="icon">⬛</span><span class="label">Terminal</span></div>
<div class="desktop-icon" ondblclick="openApp('llm')"><span class="icon">🧠</span><span class="label">LLM Studio</span></div>
<div class="desktop-icon" ondblclick="openApp('discover')"><span class="icon">🔍</span><span class="label">Discover</span></div>
<div class="desktop-icon" ondblclick="openApp('lab')"><span class="icon">📊</span><span class="label">Lab Status</span></div>
</div>
<div id="windows"></div>
<div id="dock">
<div class="dock-item" onclick="openApp('browser')"><span class="icon">🌐</span><span class="label">Browser</span></div>
<div class="dock-item" onclick="openApp('terminal')"><span class="icon">⬛</span><span class="label">Terminal</span></div>
<div class="dock-item" onclick="openApp('llm')"><span class="icon">🧠</span><span class="label">LLM Studio</span></div>
<div class="dock-item" onclick="openApp('discover')"><span class="icon">🔍</span><span class="label">Discover</span></div>
<div class="dock-item" onclick="openApp('lab')"><span class="icon">📊</span><span class="label">Lab Status</span></div>
<div class="dock-separator"></div>
<div class="dock-item" onclick="openApp('browser')"><span class="icon">⚙️</span><span class="label">Settings</span></div>
</div>
</div>
<script>
const wm = { windows: [], nextId: 1, zIndex: 100, active: null };
function createWindow(app, title, w, h, contentFn) {
    const id = wm.nextId++;
    const win = { id, app, title, width: w, height: h, x: 80 + (wm.windows.length * 30), y: 50 + (wm.windows.length * 25), maximized: false, contentFn };
    wm.windows.push(win);
    renderWindow(win);
    setActive(id);
    updateDock();
    return id;
}
function renderWindow(w) {
    let el = document.getElementById('win-' + w.id);
    if (!el) { el = document.createElement('div'); el.id = 'win-' + w.id; el.className = 'window'; document.getElementById('windows').appendChild(el); }
    el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; el.style.width = w.width + 'px'; el.style.height = w.height + 'px'; el.style.zIndex = ++wm.zIndex;
    el.className = 'window' + (w.maximized ? ' maximized' : '') + (wm.active === w.id ? ' active' : '');
    el.innerHTML = '<div class="titlebar" onmousedown="startDrag(' + w.id + ',event)" ondblclick="toggleMaximize(' + w.id + ')"><div class="traffic-lights"><div class="traffic-light close" onclick="closeWindow(' + w.id + ')"></div><div class="traffic-light min" onclick="minimizeWindow(' + w.id + ')"></div><div class="traffic-light max" onclick="toggleMaximize(' + w.id + ')"></div></div><div class="window-title">' + escapeHtml(w.title) + '</div><div style="width:60px"></div></div><div class="window-content" id="win-content-' + w.id + '"></div><div class="resize-handle" onmousedown="startResize(' + w.id + ',event)"></div>';
    w.contentFn(document.getElementById('win-content-' + w.id), w);
}
function setActive(id) {
    wm.active = id;
    document.querySelectorAll('.window').forEach(e => e.classList.remove('active'));
    const el = document.getElementById('win-' + id);
    if (el) { el.style.zIndex = ++wm.zIndex; el.classList.add('active'); }
    const w = wm.windows.find(x => x.id === id);
    if (w) document.getElementById('active-app-name').textContent = w.title;
}
function closeWindow(id) { document.getElementById('win-' + id)?.remove(); wm.windows = wm.windows.filter(w => w.id !== id); updateDock(); }
function minimizeWindow(id) { const el = document.getElementById('win-' + id); if (el) el.style.display = 'none'; }
function toggleMaximize(id) { const w = wm.windows.find(x => x.id === id); if (w) { w.maximized = !w.maximized; renderWindow(w); } }
let dragState = null;
function startDrag(id, e) { const w = wm.windows.find(x => x.id === id); if (!w || w.maximized) return; dragState = { id, sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y }; setActive(id); document.addEventListener('mousemove', onDrag); document.addEventListener('mouseup', stopDrag); }
function onDrag(e) { if (!dragState) return; const w = wm.windows.find(x => x.id === dragState.id); if (!w) return; w.x = dragState.ox + (e.clientX - dragState.sx); w.y = Math.max(28, dragState.oy + (e.clientY - dragState.sy)); const el = document.getElementById('win-' + dragState.id); if (el) { el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; } }
function stopDrag() { dragState = null; document.removeEventListener('mousemove', onDrag); document.removeEventListener('mouseup', stopDrag); }
let resizeState = null;
function startResize(id, e) { e.stopPropagation(); const w = wm.windows.find(x => x.id === id); if (!w) return; resizeState = { id, sx: e.clientX, sy: e.clientY, ow: w.width, oh: w.height }; document.addEventListener('mousemove', onResize); document.addEventListener('mouseup', stopResize); }
function onResize(e) { if (!resizeState) return; const w = wm.windows.find(x => x.id === resizeState.id); if (!w) return; w.width = Math.max(300, resizeState.ow + (e.clientX - resizeState.sx)); w.height = Math.max(200, resizeState.oh + (e.clientY - resizeState.sy)); const el = document.getElementById('win-' + resizeState.id); if (el) { el.style.width = w.width + 'px'; el.style.height = w.height + 'px'; } }
function stopResize() { resizeState = null; document.removeEventListener('mousemove', onResize); document.removeEventListener('mouseup', stopResize); }
function updateDock() { document.querySelectorAll('.dock-item').forEach((item, i) => { const apps = ['browser','terminal','llm','discover','lab']; if (apps[i] && wm.windows.some(w => w.app === apps[i])) item.classList.add('running'); else item.classList.remove('running'); }); }
function openApp(name) {
    const existing = wm.windows.find(w => w.app === name);
    if (existing) { const el = document.getElementById('win-' + existing.id); if (el) el.style.display = ''; setActive(existing.id); return; }
    if (name === 'browser') createWindow('browser', 'Browser', 900, 600, renderBrowserApp);
    else if (name === 'terminal') createWindow('terminal', 'Terminal', 600, 400, renderTerminalApp);
    else if (name === 'llm') createWindow('llm', 'LLM Studio', 500, 600, renderLLMApp);
    else if (name === 'discover') createWindow('discover', 'Discovery', 700, 500, renderDiscoverApp);
    else if (name === 'lab') createWindow('lab', 'Lab Status', 600, 500, renderLabApp);
}
// Browser App
function renderBrowserApp(c, win) {
    c.innerHTML = '<div class="browser-app"><div class="tab-bar" id="brt-' + win.id + '"></div><div class="nav-bar"><button class="nav-btn" onclick="brBack(' + win.id + ')">←</button><button class="nav-btn" onclick="brFwd(' + win.id + ')">→</button><button class="nav-btn" onclick="brReload(' + win.id + ')">⟳</button><input class="address" id="bra-' + win.id + '" placeholder="Search or enter URL" onkeydown="if(event.key===\'Enter\')brNavigate(' + win.id + ')"><button class="nav-btn" onclick="brNavigate(' + win.id + ')" style="background:#238636;color:#fff">Go</button></div><div class="viewport" id="brv-' + win.id + '"><div class="newtab"><h2>Browser</h2><div class="quicklinks"><div class="quicklink" onclick="brGo(' + win.id + ',\'https://docs.python.org/3/\')"><span class="ic">🐍</span><span class="nm">Python</span></div><div class="quicklink" onclick="brGo(' + win.id + ',\'https://news.ycombinator.com/\')"><span class="ic">📰</span><span class="nm">HN</span></div><div class="quicklink" onclick="brGo(' + win.id + ',\'https://github.com/trending\')"><span class="ic">🐙</span><span class="nm">GitHub</span></div><div class="quicklink" onclick="brGo(' + win.id + ',\'https://en.wikipedia.org/wiki/Main_Page\')"><span class="ic">📚</span><span class="nm">Wiki</span></div></div></div></div></div>';
    win.brTabs = [{ id: 1, url: null, title: 'New Tab', history: [], histIdx: -1, pageData: null }];
    win.brActive = 1; win.brNext = 2;
    brRenderTabs(win);
}
function brRenderTabs(win) { const bar = document.getElementById('brt-' + win.id); if (!bar) return; bar.innerHTML = win.brTabs.map(t => '<div class="tab ' + (t.id === win.brActive ? 'active' : '') + '" onclick="brSwitch(' + win.id + ',' + t.id + ')"><span>' + escapeHtml(t.title.slice(0,18)) + '</span><span class="close" onclick="event.stopPropagation();brClose(' + win.id + ',' + t.id + ')">×</span></div>').join('') + '<div class="tab" onclick="brNew(' + win.id + ')" style="background:none;border:none">+</div>'; }
function brNew(winId) { const win = wm.windows.find(w => w.id === winId); if (!win) return; const tid = win.brNext++; win.brTabs.push({ id: tid, url: null, title: 'New Tab', history: [], histIdx: -1, pageData: null }); win.brActive = tid; brRenderTabs(win); brShowNew(win); }
function brClose(winId, tid) { const win = wm.windows.find(w => w.id === winId); if (!win) return; win.brTabs = win.brTabs.filter(t => t.id !== tid); if (!win.brTabs.length) { brNew(winId); return; } if (win.brActive === tid) { win.brActive = win.brTabs[0].id; brRenderTab(win); } brRenderTabs(win); }
function brSwitch(winId, tid) { const win = wm.windows.find(w => w.id === winId); if (!win) return; win.brActive = tid; brRenderTabs(win); brRenderTab(win); }
function brTab(win) { return win.brTabs.find(t => t.id === win.brActive); }
function brNavigate(winId) { const win = wm.windows.find(w => w.id === winId); if (!win) return; let url = document.getElementById('bra-' + winId).value.trim(); if (!url) return; if (!/^https?:\/\//.test(url)) { if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url; else url = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(url); } brGo(winId, url); }
function brGo(winId, url) { const win = wm.windows.find(w => w.id === winId); if (!win) return; const tab = brTab(win); if (!tab) return; if (tab.histIdx < tab.history.length - 1) tab.history = tab.history.slice(0, tab.histIdx + 1); tab.history.push(url); tab.histIdx = tab.history.length - 1; brLoad(win, tab, url); }
function brBack(winId) { const win = wm.windows.find(w => w.id === winId); if (!win) return; const tab = brTab(win); if (!tab || tab.histIdx <= 0) return; tab.histIdx--; brLoad(win, tab, tab.history[tab.histIdx]); }
function brFwd(winId) { const win = wm.windows.find(w => w.id === winId); if (!win) return; const tab = brTab(win); if (!tab || tab.histIdx >= tab.history.length - 1) return; tab.histIdx++; brLoad(win, tab, tab.history[tab.histIdx]); }
function brReload(winId) { const win = wm.windows.find(w => w.id === winId); if (!win) return; const tab = brTab(win); if (tab && tab.url) brLoad(win, tab, tab.url); }
async function brLoad(win, tab, url) {
    tab.url = url;
    document.getElementById('bra-' + win.id).value = url;
    const vp = document.getElementById('brv-' + win.id);
    vp.innerHTML = '<div class="loading"><div class="spin"></div></div>';
    try {
        const res = await fetch('/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        const data = await res.json();
        if (!data.ok) { vp.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:#0d1117;color:#f85149;gap:12px"><div style="font-size:48px">!</div><div>' + escapeHtml(data.error) + '</div></div>'; return; }
        tab.title = data.title || 'Untitled'; tab.pageData = data; brRenderTabs(win);
        vp.innerHTML = '<div id="pr-' + win.id + '" style="width:100%;height:100%;overflow-y:auto"></div>';
        const root = document.getElementById('pr-' + win.id);
        const shadow = root.attachShadow({ mode: 'open' });
        shadow.innerHTML = data.html;
    } catch (e) { vp.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;background:#0d1117;color:#f85149">' + escapeHtml(e.message) + '</div>'; }
}
function brShowNew(win) { const vp = document.getElementById('brv-' + win.id); if (!vp) return; vp.innerHTML = '<div class="newtab"><h2>Browser</h2><div class="quicklinks"><div class="quicklink" onclick="brGo(' + win.id + ',\'https://docs.python.org/3/\')"><span class="ic">🐍</span><span class="nm">Python</span></div><div class="quicklink" onclick="brGo(' + win.id + ',\'https://news.ycombinator.com/\')"><span class="ic">📰</span><span class="nm">HN</span></div><div class="quicklink" onclick="brGo(' + win.id + ',\'https://github.com/trending\')"><span class="ic">🐙</span><span class="nm">GitHub</span></div><div class="quicklink" onclick="brGo(' + win.id + ',\'https://en.wikipedia.org/wiki/Main_Page\')"><span class="ic">📚</span><span class="nm">Wiki</span></div></div></div>'; document.getElementById('bra-' + win.id).value = ''; }
function brRenderTab(win) { const tab = brTab(win); if (!tab) return; if (tab.pageData && tab.pageData.ok) { const vp = document.getElementById('brv-' + win.id); vp.innerHTML = '<div id="pr-' + win.id + '" style="width:100%;height:100%;overflow-y:auto"></div>'; const root = document.getElementById('pr-' + win.id); const shadow = root.attachShadow({ mode: 'open' }); shadow.innerHTML = tab.pageData.html; document.getElementById('bra-' + win.id).value = tab.url; } else if (tab.url) { brLoad(win, tab, tab.url); } else { brShowNew(win); } }
// Terminal App
function renderTerminalApp(c, win) {
    c.innerHTML = '<div class="terminal-app" id="term-' + win.id + '"></div>';
    win.termHist = []; win.termIdx = -1;
    termPrint(win, 'HyperFlow OS Terminal v2.0', 'system');
    termPrint(win, 'Connected to YTL-MCP Research Lab', 'system');
    termPrint(win, 'Type "help" for commands.', 'system');
    termPrint(win, '');
    termInput(win);
}
function termPrint(win, text, type) { const term = document.getElementById('term-' + win.id); if (!term) return; const div = document.createElement('div'); div.className = 'line'; if (type === 'system') div.style.color = '#8b949e'; else if (type === 'error') div.style.color = '#f85149'; else if (type === 'ok') div.style.color = '#3fb950'; div.textContent = text; term.appendChild(div); term.scrollTop = term.scrollHeight; }
function termInput(win) { const term = document.getElementById('term-' + win.id); const line = document.createElement('div'); line.className = 'input-line'; line.innerHTML = '<span class="prompt">ytl@hyperflow:~$ </span><input type="text" autofocus onkeydown="termKey(' + win.id + ',event)">'; term.appendChild(line); line.querySelector('input').focus(); term.scrollTop = term.scrollHeight; }
function termKey(winId, e) { const win = wm.windows.find(w => w.id === winId); if (!win) return; const input = e.target; if (e.key === 'Enter') { const cmd = input.value; input.disabled = true; input.parentElement.removeChild(input); const term = document.getElementById('term-' + win.id); if (term.lastChild) term.lastChild.innerHTML = '<span class="prompt">ytl@hyperflow:~$ </span>' + escapeHtml(cmd); win.termHist.push(cmd); win.termIdx = win.termHist.length; termExec(win, cmd); } else if (e.key === 'ArrowUp') { e.preventDefault(); if (win.termIdx > 0) { win.termIdx--; input.value = win.termHist[win.termIdx]; } } else if (e.key === 'ArrowDown') { e.preventDefault(); if (win.termIdx < win.termHist.length - 1) { win.termIdx++; input.value = win.termHist[win.termIdx]; } else input.value = ''; } }
async function termExec(win, cmd) {
    const args = cmd.trim().split(/\s+/); const command = args[0];
    if (!command) { termInput(win); return; }
    if (command === 'help') { termPrint(win, 'Commands:', 'system'); termPrint(win, '  help          Show this help'); termPrint(win, '  status        Lab status'); termPrint(win, '  discover <n>  Find competitors'); termPrint(win, '  browse <url>  Open URL in browser'); termPrint(win, '  video <url>   Create video from URL'); termPrint(win, '  receipts      Show recent receipts'); termPrint(win, '  clear         Clear terminal'); termPrint(win, '  open <app>    Open app'); }
    else if (command === 'status') { try { const r = await (await fetch('/api/status')).json(); termPrint(win, 'Experiments: ' + r.summary.total_experiments, 'ok'); termPrint(win, 'Receipts: ' + r.summary.receipts, 'ok'); termPrint(win, 'Approved: ' + r.summary.approved, 'ok'); termPrint(win, 'Avg Score: ' + r.summary.average_transcript_score.toFixed(3), 'ok'); } catch (e) { termPrint(win, 'Error: ' + e.message, 'error'); } }
    else if (command === 'discover' && args[1]) { const niche = args.slice(1).join(' '); termPrint(win, 'Searching "' + niche + '"...', 'system'); try { const r = await (await fetch('/api/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ niche, max_results: 4 }) })).json(); if (r.ok) { termPrint(win, 'Found ' + r.total_found + ' competitors (' + r.with_apis_count + ' with APIs)', 'ok'); r.competitors.forEach(c => termPrint(win, '  ' + c.score + ' | ' + c.title.slice(0,40) + ' | APIs: ' + c.api_endpoints.length + ' | ' + c.url)); } else termPrint(win, 'Error: ' + (r.detail || 'failed'), 'error'); } catch (e) { termPrint(win, 'Error: ' + e.message, 'error'); } }
    else if (command === 'browse' && args[1]) { let url = args[1]; if (!/^https?:/.test(url)) url = 'https://' + url; termPrint(win, 'Opening ' + url + '...', 'ok'); openApp('browser'); const bw = wm.windows.find(w => w.app === 'browser'); if (bw) brGo(bw.id, url); }
    else if (command === 'video' && args[1]) { let url = args[1]; if (!/^https?:/.test(url)) url = 'https://' + url; termPrint(win, 'Creating video from ' + url + '...', 'system'); try { const r = await (await fetch('/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: 'TERM-' + Date.now(), intent: 'Terminal: ' + url, video_url: url }) })).json(); if (r.experiment_id) { const expId = r.experiment_id; termPrint(win, 'Ingested: ' + expId, 'ok'); await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); await fetch('/api/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); await fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); await fetch('/api/shotlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); const p = await (await fetch('/api/policy-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) })).json(); await fetch('/api/prepare-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); termPrint(win, 'Video created: ' + expId + ' | Policy: ' + p.policy_status, 'ok'); } } catch (e) { termPrint(win, 'Error: ' + e.message, 'error'); } }
    else if (command === 'receipts') { try { const r = await (await fetch('/api/status')).json(); (r.recent_receipts || []).forEach(rc => termPrint(win, '  ' + rc.step + ' | ' + rc.status + ' | ' + rc.experiment_id + ' | ' + rc.hash.slice(0,16) + '...')); if (!r.recent_receipts || !r.recent_receipts.length) termPrint(win, '  No receipts', 'system'); } catch (e) { termPrint(win, 'Error: ' + e.message, 'error'); } }
    else if (command === 'clear') { document.getElementById('term-' + win.id).innerHTML = ''; }
    else if (command === 'open' && args[1]) { openApp(args[1]); termPrint(win, 'Opened ' + args[1], 'ok'); }
    else { termPrint(win, 'Command not found: ' + command + '. Type "help".', 'error'); }
    termInput(win);
}
// LLM App
function renderLLMApp(c, win) {
    c.innerHTML = '<div class="llm-app"><div class="model-bar"><span>Mode:</span><select id="llmm-' + win.id + '"><option value="lab">YTL-MCP Lab</option><option value="discover">Discover Mode</option><option value="video">Video Generator</option></select><span style="flex:1"></span><span id="llms-' + win.id + '">Ready</span></div><div class="chat" id="llmc-' + win.id + '"><div class="msg system">LLM Studio — inference via YTL-MCP Lab API</div></div><div class="input-bar"><textarea id="llmi-' + win.id + '" placeholder="Type a message..." rows="2" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();llmSend(' + win.id + ')}"></textarea><button onclick="llmSend(' + win.id + ')" id="llmb-' + win.id + '">Send</button></div></div>';
}
async function llmSend(winId) {
    const win = wm.windows.find(w => w.id === winId); if (!win) return;
    const input = document.getElementById('llmi-' + winId); const text = input.value.trim(); if (!text) return; input.value = '';
    const chat = document.getElementById('llmc-' + winId); const model = document.getElementById('llmm-' + winId).value;
    chat.innerHTML += '<div class="msg user">' + escapeHtml(text) + '</div>';
    const pid = 'resp-' + Date.now(); chat.innerHTML += '<div class="msg assistant" id="' + pid + '">...</div>'; chat.scrollTop = chat.scrollHeight;
    document.getElementById('llms-' + winId).textContent = 'Thinking...'; document.getElementById('llmb-' + winId).disabled = true;
    try {
        let response = '';
        if (model === 'discover') { const r = await (await fetch('/api/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ niche: text, max_results: 4 }) })).json(); if (r.ok) { response = 'Found ' + r.total_found + ' competitors for "' + text + '":\n\n'; r.competitors.forEach((c, i) => { response += (i+1) + '. ' + c.title + ' (score: ' + c.score + ')\n   ' + c.url + '\n   APIs: ' + c.api_endpoints.length + ' | Tech: ' + c.tech_stack.slice(0,4).join(', ') + '\n\n'; }); } else response = 'Discovery failed'; }
        else if (model === 'video') { const r = await (await fetch('/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: 'LLM-' + Date.now(), intent: text, video_url: 'https://youtu.be/dQw4w9WgXcQ' }) })).json(); if (r.experiment_id) { const expId = r.experiment_id; await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); const sc = await (await fetch('/api/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) })).json(); await fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); await fetch('/api/shotlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); const p = await (await fetch('/api/policy-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) })).json(); response = 'Video experiment: ' + expId + '\nPolicy: ' + p.policy_status + '\n\nScript:\n' + (sc.script || '').slice(0, 500) + '...'; } else response = 'Video creation failed'; }
        else { const r = await (await fetch('/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: 'LLM-' + Date.now(), intent: text, video_url: 'https://youtu.be/dQw4w9WgXcQ' }) })).json(); if (r.experiment_id) { const expId = r.experiment_id; const sc = await (await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) })).json(); response = 'Experiment: ' + expId + '\nScore: ' + sc.score + ' (' + sc.dominant_signal + ')\nReceipt: ' + r.receipt.receipt_id + '\nHash: ' + r.receipt.hash.slice(0,20) + '...'; } else response = 'Inference failed'; }
        document.getElementById(pid).textContent = response; chat.scrollTop = chat.scrollHeight; document.getElementById('llms-' + winId).textContent = 'Ready';
    } catch (e) { document.getElementById(pid).textContent = 'Error: ' + e.message; document.getElementById('llms-' + winId).textContent = 'Error'; }
    document.getElementById('llmb-' + winId).disabled = false;
}
// Discover App
function renderDiscoverApp(c, win) {
    c.innerHTML = '<div class="discover-app"><input type="text" id="dn-' + win.id + '" placeholder="Niche (e.g. AI image generation)" onkeydown="if(event.key===\'Enter\')discSearch(' + win.id + ')"><button onclick="discSearch(' + win.id + ')" id="db-' + win.id + '">Find Competitors</button><div id="dr-' + win.id + '" style="flex:1;overflow-y:auto"></div></div>';
    win.discComps = [];
}
async function discSearch(winId) {
    const win = wm.windows.find(w => w.id === winId); if (!win) return;
    const niche = document.getElementById('dn-' + winId).value.trim(); if (!niche) return;
    const btn = document.getElementById('db-' + winId); btn.disabled = true; btn.textContent = 'Searching...';
    const results = document.getElementById('dr-' + winId); results.innerHTML = '<div style="color:#8b949e;padding:20px">Crawling...</div>';
    try {
        const r = await (await fetch('/api/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ niche, max_results: 6 }) })).json();
        if (r.ok) { win.discComps = r.competitors; win.discNiche = niche; results.innerHTML = r.competitors.map((c, i) => '<div class="result"><span class="score">' + c.score + '</span><div class="title">' + escapeHtml(c.title) + '</div><div class="url"><a href="' + escapeHtml(c.url) + '" target="_blank">' + escapeHtml(c.url) + '</a></div>' + (c.api_endpoints.length ? '<div class="apis">' + c.api_endpoints.slice(0,3).map(e => escapeHtml(e)).join('<br>') + '</div>' : '') + (c.tech_stack.length ? '<div class="tech">' + c.tech_stack.map(t => '<span>' + escapeHtml(t) + '</span>').join('') + '</div>' : '') + '<div class="actions"><button class="video-btn" onclick="discVideo(' + winId + ',' + i + ')">Create Video</button><button onclick="discBrowse(' + winId + ',' + i + ')">Browse</button></div></div>').join(''); }
        else results.innerHTML = '<div style="color:#f85149">' + escapeHtml(r.detail || 'Error') + '</div>';
    } catch (e) { results.innerHTML = '<div style="color:#f85149">' + escapeHtml(e.message) + '</div>'; }
    btn.disabled = false; btn.textContent = 'Find Competitors';
}
async function discVideo(winId, i) { const win = wm.windows.find(w => w.id === winId); if (!win) return; const comp = win.discComps[i]; if (!comp) return; const intent = 'Competitor: ' + comp.title + ' (' + comp.url + ') in ' + win.discNiche + '. APIs: ' + comp.api_endpoints.length + '. Tech: ' + comp.tech_stack.join(', ') + '.'; try { const r = await (await fetch('/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: 'DISC-' + Date.now(), intent, video_url: comp.url }) })).json(); if (r.experiment_id) { const expId = r.experiment_id; await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); await fetch('/api/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); await fetch('/api/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); await fetch('/api/shotlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); const p = await (await fetch('/api/policy-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) })).json(); await fetch('/api/prepare-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ experiment_id: expId }) }); alert('Video created: ' + expId + '\nPolicy: ' + p.policy_status); } } catch (e) { alert('Error: ' + e.message); } }
function discBrowse(winId, i) { const win = wm.windows.find(w => w.id === winId); if (!win) return; const comp = win.discComps[i]; if (!comp) return; openApp('browser'); const bw = wm.windows.find(w => w.app === 'browser'); if (bw) brGo(bw.id, comp.url); }
// Lab App
function renderLabApp(c, win) { c.innerHTML = '<div class="lab-app"><h2>Lab Status</h2><div class="stat-grid" id="ls-' + win.id + '"></div><h3 style="color:#8b949e;font-size:13px;text-transform:uppercase;margin-bottom:8px">Recent Receipts</h3><div id="lr-' + win.id + '"></div></div>'; labRefresh(win.id); win.labInt = setInterval(() => labRefresh(win.id), 10000); }
async function labRefresh(winId) { const win = wm.windows.find(w => w.id === winId); if (!win) return; try { const r = await (await fetch('/api/status')).json(); const s = r.summary; const stats = document.getElementById('ls-' + winId); if (stats) stats.innerHTML = '<div class="stat"><div class="val">' + s.total_experiments + '</div><div class="lbl">Experiments</div></div><div class="stat"><div class="val">' + s.receipts + '</div><div class="lbl">Receipts</div></div><div class="stat"><div class="val">' + s.approved + '</div><div class="lbl">Approved</div></div><div class="stat"><div class="val">' + s.pending_policy + '</div><div class="lbl">Pending</div></div><div class="stat"><div class="val">' + s.projects + '</div><div class="lbl">Projects</div></div><div class="stat"><div class="val">' + s.average_transcript_score.toFixed(2) + '</div><div class="lbl">Avg Score</div></div>'; const rec = document.getElementById('lr-' + winId); if (rec) { const receipts = r.recent_receipts || []; rec.innerHTML = receipts.length ? receipts.map(rc => '<div class="receipt"><span class="step">' + rc.step + '</span> | <span style="color:#3fb950">' + rc.status + '</span> | ' + rc.experiment_id + '<br><span style="color:#8b949e">' + rc.hash.slice(0,32) + '...</span></div>').join('') : '<div style="color:#8b949e">No receipts</div>'; } const st = document.getElementById('lab-status'); if (st) st.innerHTML = '<span class="dot green"></span>Lab Online'; } catch (e) { const st = document.getElementById('lab-status'); if (st) st.innerHTML = '<span class="dot red"></span>Lab Offline'; } }
// Utils
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Clock
function updateClock() { const now = new Date(); const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; document.getElementById('clock').textContent = days[now.getDay()] + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
setInterval(updateClock, 1000); updateClock();
// Boot
setTimeout(() => openApp('browser'), 300);
</script>
</body>
</html>"""


_SCREENSHOT_WEB_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Screenshot Web — 2MB not 300MB</title>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/webtorrent@2.2.1/webtorrent.min.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, sans-serif; }
#app { display: flex; flex-direction: column; height: 100vh; }

/* Top bar */
#topbar { background: #111; border-bottom: 1px solid #222; padding: 8px 16px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
#topbar .logo { font-weight: 700; color: #58a6ff; font-size: 14px; white-space: nowrap; }
#topbar .url-bar { flex: 1; display: flex; gap: 8px; }
#topbar input { flex: 1; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 8px 12px; color: #e0e0e0; font-size: 13px; outline: none; }
#topbar input:focus { border-color: #58a6ff; }
#topbar button { background: #238636; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 600; }
#topbar button:disabled { background: #333; color: #666; cursor: not-allowed; }
#topbar button.secondary { background: #333; }

/* Status bar */
#statusbar { background: #111; border-bottom: 1px solid #222; padding: 6px 16px; display: flex; gap: 20px; font-size: 11px; color: #888; flex-shrink: 0; }
#statusbar .stat { display: flex; align-items: center; gap: 4px; }
#statusbar .stat .val { color: #58a6ff; font-weight: 600; }
#statusbar .stat .dot { width: 6px; height: 6px; border-radius: 50%; }
#statusbar .stat .dot.green { background: #3fb950; }
#statusbar .stat .dot.yellow { background: #d29922; }
#statusbar .stat .dot.red { background: #f85149; }

/* Main viewport */
#viewport { flex: 1; overflow: hidden; position: relative; background: #1a1a1a; }
#viewport-scroll { width: 100%; height: 100%; overflow: auto; position: relative; }

/* Screenshot display */
.screenshot-page { position: relative; display: inline-block; margin: 0 auto; }
.screenshot-page img { display: block; max-width: 100%; }
.link-overlay { position: absolute; cursor: pointer; border: 1px solid transparent; }
.link-overlay:hover { border-color: rgba(88,166,255,0.5); background: rgba(88,166,255,0.1); }

/* Loading */
#loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #0a0a0a; z-index: 100; }
#loading .spinner { width: 36px; height: 36px; border: 3px solid #333; border-top-color: #58a6ff; border-radius: 50%; animation: spin 0.8s linear infinite; }
#loading .text { font-size: 13px; color: #888; }
#loading .ram-bar { width: 300px; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
#loading .ram-bar .fill { height: 100%; background: linear-gradient(90deg, #f85149, #d29922, #3fb950); transition: width 0.3s; }
@keyframes spin { to { transform: rotate(360deg); } }

/* New tab */
#newtab { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; background: #0a0a0a; }
#newtab h1 { font-size: 28px; color: #f0f6fc; }
#newtab p { color: #888; font-size: 14px; max-width: 500px; text-align: center; line-height: 1.6; }
#newtab .links { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
#newtab .link-card { padding: 20px; background: #111; border: 1px solid #222; border-radius: 12px; cursor: pointer; text-align: center; transition: all 0.2s; }
#newtab .link-card:hover { border-color: #58a6ff; background: #1a1a2e; }
#newtab .link-card .icon { font-size: 28px; }
#newtab .link-card .name { font-size: 11px; color: #888; margin-top: 6px; }

/* Cache panel */
#cache-panel { position: absolute; right: 0; top: 0; bottom: 0; width: 320px; background: #111; border-left: 1px solid #222; z-index: 50; transform: translateX(100%); transition: transform 0.2s; overflow-y: auto; }
#cache-panel.open { transform: translateX(0); }
#cache-panel h3 { padding: 14px 16px; font-size: 12px; color: #888; text-transform: uppercase; border-bottom: 1px solid #222; }
.cache-item { padding: 10px 16px; border-bottom: 1px solid #1a1a1a; cursor: pointer; }
.cache-item:hover { background: #1a1a1a; }
.cache-item .ci-title { font-size: 12px; color: #e0e0e0; }
.cache-item .ci-url { font-size: 10px; color: #666; }
.cache-item .ci-size { font-size: 10px; color: #3fb950; float: right; }

/* P2P panel */
#p2p-panel { position: absolute; left: 0; top: 0; bottom: 0; width: 320px; background: #111; border-right: 1px solid #222; z-index: 50; transform: translateX(-100%); transition: transform 0.2s; overflow-y: auto; }
#p2p-panel.open { transform: translateX(0); }
#p2p-panel h3 { padding: 14px 16px; font-size: 12px; color: #888; text-transform: uppercase; border-bottom: 1px solid #222; }
.peer-item { padding: 10px 16px; border-bottom: 1px solid #1a1a1a; font-size: 12px; }
.peer-item .peer-id { color: #58a6ff; font-family: monospace; }
.peer-item .peer-status { color: #3fb950; float: right; }
.shard-item { padding: 8px 16px; border-bottom: 1px solid #1a1a1a; font-size: 11px; color: #888; }
.shard-item .shard-hash { color: #bc8cff; font-family: monospace; }

/* Error */
#error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #0a0a0a; color: #f85149; }
#error .code { font-size: 48px; opacity: 0.3; }
#error .msg { font-size: 14px; }
#error button { background: #333; color: #e0e0e0; border: 1px solid #444; padding: 8px 20px; border-radius: 6px; cursor: pointer; }

/* Hidden render container */
#render-container { position: absolute; left: -9999px; top: 0; width: 1280px; min-height: 800px; overflow: hidden; visibility: hidden; }
</style>
</head>
<body>
<div id="app">
<div id="topbar">
<span class="logo">ScreenshotWeb</span>
<div class="url-bar">
<input type="text" id="url-input" placeholder="Enter URL — pages become 2MB images, not 300MB live DOM" onkeydown="if(event.key==='Enter')navigate()">
<button id="go-btn" onclick="navigate()">Capture</button>
<button class="secondary" onclick="toggleCache()">Cache</button>
<button class="secondary" onclick="toggleP2P()">P2P</button>
</div>
</div>
<div id="statusbar">
<div class="stat"><span class="dot green" id="status-dot"></span><span id="status-text">Ready</span></div>
<div class="stat">RAM: <span class="val" id="ram-stat">0 MB</span></div>
<div class="stat">Pages cached: <span class="val" id="cache-count">0</span></div>
<div class="stat">Shards seeded: <span class="val" id="seed-count">0</span></div>
<div class="stat">Peers: <span class="val" id="peer-count">0</span></div>
<div class="stat">Saved: <span class="val" id="ram-saved">0 MB</span></div>
</div>
<div id="viewport">
<div id="viewport-scroll"></div>
<div id="loading" style="display:none;">
<div class="spinner"></div>
<div class="text" id="loading-text">Fetching page...</div>
<div class="ram-bar"><div class="fill" id="ram-fill" style="width:0%"></div></div>
</div>
<div id="newtab">
<h1>Screenshot Web</h1>
<p>Pages are rendered once, captured as images, then the DOM is destroyed. 300MB live page becomes 2MB image. Links are extracted as clickable overlays. Cached pages are seeded to other visitors via WebTorrent — each visitor hosts one shard.</p>
<div class="links">
<div class="link-card" onclick="navigateTo('https://news.ycombinator.com/')"><div class="icon">📰</div><div class="name">Hacker News</div></div>
<div class="link-card" onclick="navigateTo('https://docs.python.org/3/')"><div class="icon">🐍</div><div class="name">Python Docs</div></div>
<div class="link-card" onclick="navigateTo('https://en.wikipedia.org/wiki/Main_Page')"><div class="icon">📚</div><div class="name">Wikipedia</div></div>
<div class="link-card" onclick="navigateTo('https://example.com')"><div class="icon">🌐</div><div class="name">Example</div></div>
</div>
</div>
<div id="error" style="display:none;">
<div class="code">!</div>
<div class="msg" id="error-msg"></div>
<button onclick="hideError()">Dismiss</button>
</div>
<div id="render-container"></div>
</div>
</div>

<!-- Cache panel -->
<div id="cache-panel">
<h3>Cached Screenshots (IndexedDB)</h3>
<div id="cache-list"></div>
</div>

<!-- P2P panel -->
<div id="p2p-panel">
<h3>P2P Network (WebTorrent)</h3>
<div id="p2p-status" style="padding:14px 16px;font-size:12px;color:#888;">Initializing...</div>
<h3>Connected Peers</h3>
<div id="peer-list"><div style="padding:10px 16px;color:#666;font-size:11px;">No peers yet</div></div>
<h3>Seeded Shards</h3>
<div id="shard-list"><div style="padding:10px 16px;color:#666;font-size:11px;">No shards seeded yet</div></div>
</div>

<script>
// ═══════════════════════════════════════════════════════════
// Screenshot Web — Real Implementation
// 
// Flow: proxy fetch → render hidden → html2canvas → extract
// link rects → destroy DOM → display 2MB image + link overlays
// → cache in IndexedDB → seed via WebTorrent
// ═══════════════════════════════════════════════════════════

const state = {
    currentPage: null,
    ramBefore: 0,
    ramAfter: 0,
    totalSaved: 0,
    cache: new Map(),
    torrent: null,
    client: null,
    seededShards: [],
    peers: [],
};

// ─── IndexedDB ───
const DB_NAME = 'screenshot-web';
const DB_VERSION = 1;
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains('screenshots')) {
                d.createObjectStore('screenshots', { keyPath: 'url' });
            }
            if (!d.objectStoreNames.contains('shards')) {
                d.createObjectStore('shards', { keyPath: 'hash' });
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbPut(store, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function dbGet(store, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbGetAll(store) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbCount(store) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ─── RAM measurement ───
function measureRAM() {
    if (performance.memory) {
        return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
    }
    // Estimate from DOM nodes
    return Math.round(document.querySelectorAll('*').length * 0.05);
}

// ─── Navigation ───
function navigate() {
    const input = document.getElementById('url-input').value.trim();
    if (!input) return;
    let url = input;
    if (!/^https?:\/\//.test(url)) {
        if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url;
        else url = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(url);
    }
    navigateTo(url);
}

async function navigateTo(url) {
    document.getElementById('url-input').value = url;
    state.currentPage = url;
    
    // Check cache first
    const cached = await dbGet('screenshots', url);
    if (cached && cached.screenshot) {
        displayScreenshot(cached.screenshot, cached.links, cached.width, cached.height, url, true);
        updateStatus('Loaded from cache (0 MB render)');
        return;
    }
    
    // Not cached — render and capture
    showLoading('Fetching page via proxy...');
    state.ramBefore = measureRAM();
    updateRAMBar(10);
    
    try {
        // Step 1: Fetch HTML via proxy
        showLoading('Fetching HTML...');
        updateRAMBar(20);
        const res = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Failed to fetch');
        updateRAMBar(40);
        
        // Step 2: Render in hidden container
        showLoading('Rendering page (temporary RAM spike)...');
        updateRAMBar(60);
        const screenshotData = await captureScreenshot(data.html, url);
        updateRAMBar(80);
        
        // Step 3: Destroy render container — RAM freed
        showLoading('Destroying DOM, freeing RAM...');
        document.getElementById('render-container').innerHTML = '';
        state.ramAfter = measureRAM();
        const saved = Math.max(0, state.ramBefore - state.ramAfter + screenshotData.renderRAM);
        state.totalSaved += saved;
        updateRAMBar(100);
        
        // Step 4: Display screenshot + link overlays
        displayScreenshot(screenshotData.blob, screenshotData.links, screenshotData.width, screenshotData.height, url, false);
        
        // Step 5: Cache in IndexedDB
        const cacheEntry = {
            url,
            screenshot: screenshotData.blob,
            links: screenshotData.links,
            width: screenshotData.width,
            height: screenshotData.height,
            title: data.title,
            timestamp: Date.now(),
            size: screenshotData.size,
        };
        await dbPut('screenshots', cacheEntry);
        state.cache.set(url, cacheEntry);
        
        // Step 6: Seed via WebTorrent
        await seedShard(url, screenshotData.blob);
        
        updateStatus(`Rendered: ${screenshotData.renderRAM}MB → ${screenshotData.size}MB image (saved ${saved}MB)`);
        updateStats();
        hideLoading();
    } catch (e) {
        showError(e.message);
        hideLoading();
    }
}

// ─── Screenshot capture ───
async function captureScreenshot(html, url) {
    const container = document.getElementById('render-container');
    
    // Render HTML in a shadow DOM for style isolation
    container.innerHTML = '';
    const host = document.createElement('div');
    host.style.width = '1280px';
    host.style.minHeight = '800px';
    container.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = html;
    
    // Wait for render
    await new Promise(r => setTimeout(r, 500));
    
    // Extract all link positions before screenshot
    const links = [];
    const anchorEls = shadow.querySelectorAll('a[href]');
    const hostRect = host.getBoundingClientRect();
    
    anchorEls.forEach(a => {
        const rect = a.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.top < 2000) {
            let href = a.getAttribute('href') || '';
            // Skip javascript: and anchor links
            if (href.startsWith('javascript:') || href.startsWith('#')) return;
            // Make absolute
            if (href.startsWith('/')) {
                try { const u = new URL(url); href = u.origin + href; } catch(e) {}
            } else if (!href.startsWith('http')) {
                try { href = new URL(href, url).href; } catch(e) {}
            }
            links.push({
                x: rect.left - hostRect.left,
                y: rect.top - hostRect.top,
                width: rect.width,
                height: rect.height,
                href: href,
                text: a.textContent.trim().slice(0, 80),
            });
        }
    });
    
    // Capture screenshot using html2canvas
    const renderRAM = measureRAM();
    const canvas = await html2canvas(host, {
        width: 1280,
        height: Math.min(host.scrollHeight, 3000),
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        allowTaint: true,
        scale: 1,
    });
    
    // Convert canvas to blob
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    const sizeMB = Math.round(blob.size / 1024 / 1024 * 10) / 10;
    
    return {
        blob: blob,
        links: links,
        width: canvas.width,
        height: canvas.height,
        size: sizeMB,
        renderRAM: renderRAM,
    };
}

// ─── Display screenshot with link overlays ───
function displayScreenshot(blob, links, width, height, url, fromCache) {
    const scroll = document.getElementById('viewport-scroll');
    const imgUrl = URL.createObjectURL(blob);
    
    let html = `<div class="screenshot-page" style="width:${width}px;">
        <img src="${imgUrl}" width="${width}" height="${height}" alt="${escapeHtml(url)}">`;
    
    // Add invisible link overlays
    links.forEach((link, i) => {
        html += `<a class="link-overlay" 
            style="left:${link.x}px;top:${link.y}px;width:${link.width}px;height:${link.height}px;" 
            href="javascript:void(0)" 
            onclick="navigateTo('${escapeHtml(link.href)}')" 
            title="${escapeHtml(link.text)}"></a>`;
    });
    
    html += `</div>`;
    scroll.innerHTML = html;
    
    // Hide new tab page
    document.getElementById('newtab').style.display = 'none';
    document.getElementById('error').style.display = 'none';
    
    if (fromCache) {
        updateStatus(`Cache hit — 0 MB render, ${Math.round(blob.size/1024/1024*10)/10} MB image`);
    }
}

// ─── WebTorrent P2P ───
async function initTorrent() {
    try {
        if (typeof WebTorrent === 'undefined') {
            document.getElementById('p2p-status').textContent = 'WebTorrent not loaded (CDN blocked)';
            return;
        }
        state.client = new WebTorrent();
        document.getElementById('p2p-status').innerHTML = '<span style="color:#3fb950">WebTorrent client running</span><br><span style="font-size:11px;color:#666">Each cached page is seeded as a shard. Other visitors can download shards from you.</span>';
        
        // Try to join a shared torrent for the site itself
        // The infoHash is deterministic based on "screenshot-web" namespace
        // All visitors join the same swarm and share cached screenshots
    } catch (e) {
        document.getElementById('p2p-status').textContent = 'WebTorrent error: ' + e.message;
    }
}

async function seedShard(url, blob) {
    if (!state.client) return;
    try {
        // Create a File from the blob
        const file = new File([blob], url.replace(/[^a-z0-9]/gi, '_').slice(0, 60) + '.webp', { type: 'image/webp' });
        
        // Seed the file
        state.client.seed(file, (torrent) => {
            state.seededShards.push({
                url: url,
                hash: torrent.infoHash,
                size: Math.round(blob.size / 1024 / 1024 * 10) / 10,
                peers: 0,
            });
            
            torrent.on('peer', (peerId) => {
                state.peers.push({ id: peerId, shard: torrent.infoHash });
                updateP2PPanel();
                updateStats();
            });
            
            updateP2PPanel();
            updateStats();
            
            // Store shard info in IndexedDB
            dbPut('shards', { hash: torrent.infoHash, url, size: blob.size, timestamp: Date.now() });
        });
    } catch (e) {
        console.error('Seed error:', e);
    }
}

function updateP2PPanel() {
    const peerList = document.getElementById('peer-list');
    if (state.peers.length === 0) {
        peerList.innerHTML = '<div style="padding:10px 16px;color:#666;font-size:11px;">No peers connected</div>';
    } else {
        peerList.innerHTML = state.peers.map(p => 
            `<div class="peer-item"><span class="peer-id">${p.id.slice(0,16)}...</span><span class="peer-status">connected</span></div>`
        ).join('');
    }
    
    const shardList = document.getElementById('shard-list');
    if (state.seededShards.length === 0) {
        shardList.innerHTML = '<div style="padding:10px 16px;color:#666;font-size:11px;">No shards seeded yet</div>';
    } else {
        shardList.innerHTML = state.seededShards.map(s =>
            `<div class="shard-item"><span class="shard-hash">${s.hash.slice(0,20)}...</span><br>${s.size} MB — ${escapeHtml(s.url.slice(0, 40))}</div>`
        ).join('');
    }
}

// ─── UI helpers ───
function showLoading(text) {
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('loading-text').textContent = text;
    document.getElementById('newtab').style.display = 'none';
    document.getElementById('error').style.display = 'none';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

function updateRAMBar(pct) {
    document.getElementById('ram-fill').style.width = pct + '%';
}

function showError(msg) {
    document.getElementById('error').style.display = 'flex';
    document.getElementById('error-msg').textContent = msg;
    hideLoading();
}

function hideError() {
    document.getElementById('error').style.display = 'none';
}

function updateStatus(text) {
    document.getElementById('status-text').textContent = text;
}

function updateStats() {
    document.getElementById('ram-saved').textContent = state.totalSaved + ' MB';
    document.getElementById('cache-count').textContent = state.cache.size;
    document.getElementById('seed-count').textContent = state.seededShards.length;
    document.getElementById('peer-count').textContent = state.peers.length;
    document.getElementById('ram-stat').textContent = measureRAM() + ' MB';
}

function toggleCache() {
    document.getElementById('cache-panel').classList.toggle('open');
    if (document.getElementById('cache-panel').classList.contains('open')) refreshCacheList();
}

function toggleP2P() {
    document.getElementById('p2p-panel').classList.toggle('open');
}

async function refreshCacheList() {
    const all = await dbGetAll('screenshots');
    const list = document.getElementById('cache-list');
    if (all.length === 0) {
        list.innerHTML = '<div style="padding:14px 16px;color:#666;font-size:11px;">No cached pages yet</div>';
        return;
    }
    list.innerHTML = all.sort((a,b) => b.timestamp - a.timestamp).map(entry =>
        `<div class="cache-item" onclick="navigateTo('${escapeHtml(entry.url)}')">
            <div class="ci-title">${escapeHtml(entry.title || entry.url)}</div>
            <div class="ci-url">${escapeHtml(entry.url.slice(0, 50))}</div>
            <div class="ci-size">${entry.size || Math.round(entry.screenshot.size/1024/1024*10)/10} MB</div>
        </div>`
    ).join('');
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── Init ───
async function init() {
    await openDB();
    
    // Load cache count
    const count = await dbCount('screenshots');
    document.getElementById('cache-count').textContent = count;
    
    // Load all cached entries into memory map
    const all = await dbGetAll('screenshots');
    all.forEach(entry => state.cache.set(entry.url, entry));
    
    // Init WebTorrent
    initTorrent();
    
    // Update stats periodically
    setInterval(updateStats, 2000);
    updateStats();
}

init();
</script>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════
# Real Browser Compute Node
# - WebLLM: actual LLM inference via WebGPU (model runs in browser)
# - OPFS: persistent filesystem (survives refresh)
# - WebRTC: P2P networking (each visitor is a node)
# - Real terminal with real commands
# ═══════════════════════════════════════════════════════════

_NODE_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Compute Node — Browser VPS</title>
<!-- WebLLM: real LLM inference in browser via WebGPU -->
<script type="module">
import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.78";
window.CreateMLCEngine = CreateMLCEngine;
window._webllmLoaded = true;
window.dispatchEvent(new Event('webllm-ready'));
</script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; background: #0a0a0a; color: #e0e0e0; font-family: 'SF Mono', 'Monaco', monospace; font-size: 13px; }
#app { display: flex; flex-direction: column; height: 100vh; }

/* Header */
#header { background: #111; border-bottom: 1px solid #222; padding: 10px 16px; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
#header .title { font-weight: 700; color: #58a6ff; font-size: 14px; }
#header .spacer { flex: 1; }
#header .indicator { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #888; }
#header .indicator .dot { width: 8px; height: 8px; border-radius: 50%; }
#header .indicator .dot.on { background: #3fb950; box-shadow: 0 0 6px #3fb950; }
#header .indicator .dot.off { background: #f85149; }
#header .indicator .dot.loading { background: #d29922; animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }

/* Main layout */
#main { flex: 1; display: flex; overflow: hidden; }

/* Terminal */
#terminal { flex: 1; display: flex; flex-direction: column; background: #0a0a0a; overflow: hidden; }
#term-output { flex: 1; overflow-y: auto; padding: 12px 16px; line-height: 1.6; }
#term-output .line { white-space: pre-wrap; word-break: break-all; }
#term-output .prompt { color: #58a6ff; }
#term-output .cmd { color: #e0e0e0; }
#term-output .info { color: #8b949e; }
#term-output .ok { color: #3fb950; }
#term-output .err { color: #f85149; }
#term-output .warn { color: #d29922; }
#term-output .llm { color: #bc8cff; }
#term-output .llm-header { color: #bc8cff; font-weight: bold; border-top: 1px solid #333; padding-top: 4px; margin-top: 4px; }
#term-output .file-content { color: #e0e0e0; background: #111; padding: 8px; border-radius: 4px; border: 1px solid #222; margin: 4px 0; }
#term-input-line { display: flex; align-items: center; padding: 8px 16px; background: #111; border-top: 1px solid #222; }
#term-input-line .prompt { color: #58a6ff; margin-right: 8px; }
#term-input { flex: 1; background: none; border: none; color: #e0e0e0; font-family: inherit; font-size: inherit; outline: none; }
#term-input.multi { height: 60px; }

/* Sidebar */
#sidebar { width: 300px; background: #111; border-left: 1px solid #222; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }
#sidebar .section { border-bottom: 1px solid #222; }
#sidebar .section-header { padding: 10px 14px; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; display: flex; justify-content: space-between; }
#sidebar .section-header:hover { color: #e0e0e0; }
#sidebar .section-body { padding: 8px 14px; max-height: 300px; overflow-y: auto; }
#sidebar .section-body.collapsed { display: none; }

/* LLM panel */
#llm-status { font-size: 12px; color: #888; }
#llm-status .model-name { color: #58a6ff; }
#llm-status .progress { width: 100%; height: 4px; background: #222; border-radius: 2px; margin-top: 6px; overflow: hidden; }
#llm-status .progress .fill { height: 100%; background: #58a6ff; transition: width 0.3s; width: 0%; }
#llm-models { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
#llm-models button { background: #1a1a1a; border: 1px solid #222; color: #e0e0e0; padding: 6px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; text-align: left; font-family: inherit; }
#llm-models button:hover { border-color: #58a6ff; }
#llm-models button.active { border-color: #58a6ff; background: #1a1a2e; }
#llm-models button .size { color: #888; float: right; }

/* Files panel */
#file-list { font-size: 12px; }
#file-list .file { padding: 4px 0; cursor: pointer; color: #e0e0e0; }
#file-list .file:hover { color: #58a6ff; }
#file-list .file .size { color: #666; font-size: 10px; float: right; }
#file-list .dir { color: #58a6ff; }

/* Peers panel */
#peer-list { font-size: 12px; }
#peer-list .peer { padding: 4px 0; color: #e0e0e0; }
#peer-list .peer .id { color: #bc8cff; font-size: 11px; }
#peer-list .peer .status { color: #3fb950; float: right; font-size: 10px; }
#peer-list .empty { color: #666; font-size: 11px; }

/* Stats panel */
#stats { font-size: 11px; color: #888; }
#stats .stat { display: flex; justify-content: space-between; padding: 2px 0; }
#stats .stat .val { color: #58a6ff; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #0a0a0a; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #444; }
</style>
</head>
<body>
<div id="app">
<div id="header">
<span class="title">Browser Compute Node</span>
<span class="indicator"><span class="dot off" id="gpu-dot"></span><span id="gpu-text">WebGPU: checking</span></span>
<span class="indicator"><span class="dot off" id="llm-dot"></span><span id="llm-text">LLM: not loaded</span></span>
<span class="indicator"><span class="dot off" id="p2p-dot"></span><span id="p2p-text">P2P: offline</span></span>
<span class="spacer"></span>
<span style="font-size:11px;color:#666">visitor = node = VPS</span>
</div>
<div id="main">
<div id="terminal">
<div id="term-output"></div>
<div id="term-input-line">
<span class="prompt">node@browser:~$</span>
<input type="text" id="term-input" autofocus autocomplete="off" spellcheck="false">
</div>
</div>
<div id="sidebar">
<div class="section">
<div class="section-header">LLM Engine</div>
<div class="section-body" id="llm-panel">
<div id="llm-status">Checking WebGPU support...</div>
<div id="llm-models"></div>
</div>
</div>
<div class="section">
<div class="section-header">Filesystem (OPFS)</div>
<div class="section-body" id="file-list"><div style="color:#666;font-size:11px">No files yet</div></div>
</div>
<div class="section">
<div class="section-header">P2P Peers</div>
<div class="section-body" id="peer-list"><div class="empty">No peers connected</div></div>
</div>
<div class="section">
<div class="section-header">Node Stats</div>
<div class="section-body" id="stats"></div>
</div>
</div>
</div>
</div>

<script type="module">
// ═══════════════════════════════════════════════════════════
// Real Browser Compute Node
// ═══════════════════════════════════════════════════════════

const MODELS = [
    { id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", name: "Llama 3.2 1B", size: "1.1 GB" },
    { id: "Llama-3.2-3B-Instruct-q4f32_1-MLC", name: "Llama 3.2 3B", size: "3.4 GB" },
    { id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", name: "Qwen 2.5 1.5B", size: "1.6 GB" },
    { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", name: "Phi 3.5 mini", size: "3.3 GB" },
    { id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", name: "TinyLlama 1.1B", size: "0.7 GB" },
    { id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", name: "SmolLM2 1.7B", size: "1.8 GB" },
];

const state = {
    engine: null,
    modelLoaded: false,
    currentModel: null,
    gpuSupported: false,
    files: new Map(),
    peers: [],
    chatHistory: [],
    termHistory: [],
    termIdx: -1,
    generating: false,
};

// ─── Terminal output ───
function termPrint(text, cls = '') {
    const output = document.getElementById('term-output');
    const div = document.createElement('div');
    div.className = 'line ' + cls;
    div.textContent = text;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
}

function termPrintHTML(html, cls = '') {
    const output = document.getElementById('term-output');
    const div = document.createElement('div');
    div.className = 'line ' + cls;
    div.innerHTML = html;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
}

// ─── OPFS Filesystem ───
async function fsInit() {
    if (!navigator.storage || !navigator.storage.getDirectory) {
        termPrint('OPFS not supported — using in-memory filesystem', 'warn');
        return false;
    }
    return true;
}

async function fsWrite(path, content) {
    try {
        if (navigator.storage?.getDirectory) {
            const root = await navigator.storage.getDirectory();
            const parts = path.split('/').filter(Boolean);
            let dir = root;
            for (let i = 0; i < parts.length - 1; i++) {
                dir = await dir.getDirectoryHandle(parts[i], { create: true });
            }
            const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        }
        state.files.set(path, { content, size: content.length, modified: Date.now() });
        await fsList();
        return true;
    } catch (e) {
        termPrint('Write error: ' + e.message, 'err');
        return false;
    }
}

async function fsRead(path) {
    if (state.files.has(path)) {
        return state.files.get(path).content;
    }
    try {
        if (navigator.storage?.getDirectory) {
            const root = await navigator.storage.getDirectory();
            const parts = path.split('/').filter(Boolean);
            let dir = root;
            for (let i = 0; i < parts.length - 1; i++) {
                dir = await dir.getDirectoryHandle(parts[i]);
            }
            const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
            const file = await fileHandle.getFile();
            const text = await file.text();
            state.files.set(path, { content: text, size: text.length, modified: Date.now() });
            return text;
        }
    } catch (e) {
        return null;
    }
    return null;
}

async function fsList() {
    const fileList = document.getElementById('file-list');
    if (state.files.size === 0) {
        fileList.innerHTML = '<div style="color:#666;font-size:11px">No files yet. Try: write hello.txt "Hello World"</div>';
        return;
    }
    let html = '';
    for (const [path, info] of state.files) {
        const sizeStr = info.size < 1024 ? info.size + 'B' : Math.round(info.size / 1024 * 10) / 10 + 'KB';
        html += `<div class="file" onclick="termRun('cat ${path}')"><span>${escapeHtml(path)}</span><span class="size">${sizeStr}</span></div>`;
    }
    fileList.innerHTML = html;
}

async function fsDelete(path) {
    try {
        if (navigator.storage?.getDirectory) {
            const root = await navigator.storage.getDirectory();
            const parts = path.split('/').filter(Boolean);
            let dir = root;
            for (let i = 0; i < parts.length - 1; i++) {
                dir = await dir.getDirectoryHandle(parts[i]);
            }
            await dir.removeEntry(parts[parts.length - 1]);
        }
        state.files.delete(path);
        await fsList();
        return true;
    } catch (e) {
        return false;
    }
}

// ─── WebLLM Engine ───
async function checkGPU() {
    try {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter) {
            state.gpuSupported = true;
            document.getElementById('gpu-dot').className = 'dot on';
            document.getElementById('gpu-text').textContent = 'WebGPU: ready';
            return true;
        }
    } catch (e) {}
    state.gpuSupported = false;
    document.getElementById('gpu-dot').className = 'dot off';
    document.getElementById('gpu-text').textContent = 'WebGPU: not available';
    return false;
}

async function loadModel(modelId, modelName) {
    if (state.generating) {
        termPrint('LLM is busy generating. Wait for completion.', 'warn');
        return;
    }
    if (!state.gpuSupported) {
        termPrint('WebGPU not available. LLM inference requires WebGPU.', 'err');
        termPrint('Use Chrome 113+ or Edge 113+ with GPU acceleration enabled.', 'info');
        return;
    }

    if (!window.CreateMLCEngine) {
        termPrint('WebLLM library still loading, please wait...', 'warn');
        // Wait for it
        await new Promise(resolve => {
            if (window._webllmLoaded) resolve();
            else window.addEventListener('webllm-ready', resolve, { once: true });
        });
    }

    state.currentModel = modelId;
    document.getElementById('llm-dot').className = 'dot loading';
    document.getElementById('llm-text').textContent = 'LLM: loading ' + modelName + '...';
    document.getElementById('llm-status').innerHTML = `Loading <span class="model-name">${modelName}</span>...<div class="progress"><div class="fill" id="llm-progress"></div></div>`;
    termPrint(`Loading ${modelName} (${modelId})...`, 'info');
    termPrint('This downloads the model on first run (~1-4GB). Cached after.', 'info');

    try {
        state.engine = await window.CreateMLCEngine(modelId, {
            initProgressCallback: (progress) => {
                const pct = Math.round(progress.progress * 100);
                const fill = document.getElementById('llm-progress');
                if (fill) fill.style.width = pct + '%';
                document.getElementById('llm-text').textContent = `LLM: loading ${pct}%`;
            },
        });
        state.modelLoaded = true;
        document.getElementById('llm-dot').className = 'dot on';
        document.getElementById('llm-text').textContent = 'LLM: ' + modelName;
        document.getElementById('llm-status').innerHTML = `<span class="model-name">${modelName}</span> loaded and ready<br><span style="color:#3fb950">●</span> Inference active`;
        termPrint(`Model loaded: ${modelName}`, 'ok');
        termPrint('Type "chat <message>" to talk to the LLM. It runs entirely in your browser.', 'info');
        termPrint('No API calls. No server. The model is in your GPU memory.', 'info');
        termPrint('You are now an inference node. Peers without a model will route to you.', 'ok');
        // Re-register with updated capabilities so peers know we have inference
        await signalUpdateCapabilities();
        // Announce to connected peers via data channels
        for (const [peerId, dc] of dataChannels) {
            if (dc.readyState === 'open') {
                dc.send(JSON.stringify({ type: 'caps', gpu: true, model: state.currentModel, inference: true }));
            }
        }
        updateStats();
    } catch (e) {
        state.modelLoaded = false;
        document.getElementById('llm-dot').className = 'dot off';
        document.getElementById('llm-text').textContent = 'LLM: load failed';
        document.getElementById('llm-status').innerHTML = `<span style="color:#f85149">Load failed: ${escapeHtml(e.message)}</span>`;
        termPrint('Model load failed: ' + e.message, 'err');
    }
}

async function llmChat(message) {
    if (!state.modelLoaded || !state.engine) {
        termPrint('No model loaded. Use: model <number>', 'err');
        return;
    }
    if (state.generating) {
        termPrint('Already generating. Wait for completion.', 'warn');
        return;
    }

    state.generating = true;
    state.chatHistory.push({ role: 'user', content: message });

    termPrintHTML('<span class="llm-header">LLM Output:</span>', 'llm');
    const outputLine = document.createElement('div');
    outputLine.className = 'line llm';
    document.getElementById('term-output').appendChild(outputLine);

    try {
        const completion = await state.engine.chat.completions.create({
            messages: state.chatHistory,
            stream: true,
        });

        let fullText = '';
        for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content || '';
            fullText += delta;
            outputLine.textContent = fullText + '▌';
            document.getElementById('term-output').scrollTop = document.getElementById('term-output').scrollHeight;
        }
        outputLine.textContent = fullText;
        state.chatHistory.push({ role: 'assistant', content: fullText });
        termPrint('', '');
        updateStats();
    } catch (e) {
        outputLine.textContent = 'Error: ' + e.message;
        termPrint('Inference error: ' + e.message, 'err');
    }
    state.generating = false;
}

// ─── P2P via WebRTC + Signaling Relay ───
// Cross-device peer discovery via /api/signal relay
// Inference sharing: node with loaded model serves inference to peers

const nodeId = Math.random().toString(36).slice(2, 12);
const SIGNAL_URL = '/api/signal';
const POLL_INTERVAL = 3000; // 3 seconds
let pollTimer = null;
let signalRegistered = false;

async function signalRegister() {
    const caps = {
        gpu: state.gpuSupported,
        model: state.modelLoaded ? state.currentModel : null,
        modelName: state.modelLoaded ? state.currentModel : null,
        inference: state.modelLoaded, // can this node serve inference?
    };
    try {
        const res = await fetch(SIGNAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: nodeId, type: 'register', capabilities: caps })
        });
        const data = await res.json();
        if (data.ok) {
            signalRegistered = true;
            document.getElementById('p2p-dot').className = 'dot on';
            document.getElementById('p2p-text').textContent = `P2P: registered (${data.peers.length} peers seen)`;
            // Try to connect to peers that have inference capability
            for (const peer of data.peers) {
                if (peer.capabilities?.inference && !state.peers.find(p => p.id === peer.node_id)) {
                    termPrint(`Found inference node: ${peer.node_id.slice(0,8)} (${peer.capabilities.modelName})`, 'info');
                    await webrtcConnect(peer.node_id, true);
                }
            }
            // Also connect to peers without inference (they might want ours)
            for (const peer of data.peers) {
                if (!peer.capabilities?.inference && !state.peers.find(p => p.id === peer.node_id)) {
                    await webrtcConnect(peer.node_id, true);
                }
            }
            startPolling();
        }
    } catch (e) {
        document.getElementById('p2p-text').textContent = 'P2P: signal failed';
        termPrint('Signal registration failed: ' + e.message, 'err');
    }
}

async function signalUpdateCapabilities() {
    if (!signalRegistered) return;
    const caps = {
        gpu: state.gpuSupported,
        model: state.modelLoaded ? state.currentModel : null,
        modelName: state.modelLoaded ? state.currentModel : null,
        inference: state.modelLoaded,
    };
    try {
        await fetch(SIGNAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: nodeId, type: 'register', capabilities: caps })
        });
    } catch (e) {}
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        try {
            const res = await fetch(SIGNAL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: nodeId, type: 'poll' })
            });
            const data = await res.json();
            if (!data.ok) return;

            // Process incoming offers
            for (const offer of data.offers) {
                await webrtcHandleOffer(offer.from, offer.sdp);
            }
            // Process incoming answers
            for (const answer of data.answers) {
                await webrtcHandleAnswer(answer.from, answer.sdp);
            }
            // Process ICE candidates
            for (const ice of data.ice_candidates) {
                await webrtcHandleIce(ice.from, ice.ice);
            }
            // Check for new peers
            for (const peer of data.peers) {
                if (!state.peers.find(p => p.id === peer.node_id) && peer.node_id !== nodeId) {
                    // New peer discovered — initiate connection
                    termPrint(`New peer discovered: ${peer.node_id.slice(0,8)}`, 'info');
                    if (peer.capabilities?.inference) {
                        termPrint(`  → has inference: ${peer.capabilities.modelName}`, 'info');
                    }
                    await webrtcConnect(peer.node_id, true);
                }
            }
        } catch (e) {}
    }, POLL_INTERVAL);
}

// ─── WebRTC connection management ───
const peerConnections = new Map(); // nodeId -> RTCPeerConnection
const dataChannels = new Map(); // nodeId -> RTCDataChannel

async function webrtcConnect(targetId, isInitiator) {
    if (peerConnections.has(targetId)) return;
    if (targetId === nodeId) return;

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ]
    });
    peerConnections.set(targetId, pc);

    let dc;
    if (isInitiator) {
        dc = pc.createDataChannel('compute', { ordered: true });
        setupDataChannel(dc, targetId);
    }

    pc.onicecandidate = async (e) => {
        if (e.candidate) {
            await fetch(SIGNAL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: nodeId, type: 'ice', target: targetId, ice: JSON.stringify(e.candidate) })
            });
        }
    };

    pc.ondatachannel = (e) => {
        dc = e.channel;
        setupDataChannel(dc, targetId);
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            addPeer(targetId, 'webrtc');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            termPrint(`Peer disconnected: ${targetId.slice(0,8)}`, 'warn');
            state.peers = state.peers.filter(p => p.id !== targetId);
            peerConnections.delete(targetId);
            dataChannels.delete(targetId);
            updatePeerList();
        }
    };

    if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await fetch(SIGNAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: nodeId, type: 'offer', target: targetId, sdp: JSON.stringify(offer) })
        });
    }
}

async function webrtcHandleOffer(fromId, sdpStr) {
    if (peerConnections.has(fromId)) return; // already connected or connecting
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ]
    });
    peerConnections.set(fromId, pc);

    pc.onicecandidate = async (e) => {
        if (e.candidate) {
            await fetch(SIGNAL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ node_id: nodeId, type: 'ice', target: fromId, ice: JSON.stringify(e.candidate) })
            });
        }
    };

    pc.ondatachannel = (e) => {
        setupDataChannel(e.channel, fromId);
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            addPeer(fromId, 'webrtc');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            state.peers = state.peers.filter(p => p.id !== fromId);
            peerConnections.delete(fromId);
            dataChannels.delete(fromId);
            updatePeerList();
        }
    };

    const offer = JSON.parse(sdpStr);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await fetch(SIGNAL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, type: 'answer', target: fromId, sdp: JSON.stringify(answer) })
    });
}

async function webrtcHandleAnswer(fromId, sdpStr) {
    const pc = peerConnections.get(fromId);
    if (!pc) return;
    const answer = JSON.parse(sdpStr);
    if (pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(answer);
    }
}

async function webrtcHandleIce(fromId, iceStr) {
    const pc = peerConnections.get(fromId);
    if (!pc) return;
    try {
        const candidate = JSON.parse(iceStr);
        await pc.addIceCandidate(candidate);
    } catch (e) {}
}

// ─── Data channel: inference sharing + messaging ───
function setupDataChannel(dc, peerId) {
    dataChannels.set(peerId, dc);

    dc.onopen = () => {
        addPeer(peerId, 'webrtc');
        // Announce our capabilities
        dc.send(JSON.stringify({
            type: 'caps',
            gpu: state.gpuSupported,
            model: state.modelLoaded ? state.currentModel : null,
            inference: state.modelLoaded,
        }));
    };

    dc.onmessage = async (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'caps') {
            // Peer announced capabilities
            const peer = state.peers.find(p => p.id === peerId);
            if (peer) {
                peer.capabilities = msg;
                if (msg.inference) {
                    termPrint(`Peer ${peerId.slice(0,8)} has inference: ${msg.model}`, 'ok');
                }
            }
            updatePeerList();
        } else if (msg.type === 'chat-request') {
            // Peer is asking us to run inference
            if (state.modelLoaded && state.engine) {
                termPrint(`[peer:${peerId.slice(0,8)}] inference request: "${msg.message.slice(0,40)}..."`, 'info');
                try {
                    const completion = await state.engine.chat.completions.create({
                        messages: msg.history || [{ role: 'user', content: msg.message }],
                        stream: false,
                    });
                    const response = completion.choices[0]?.message?.content || '';
                    dc.send(JSON.stringify({ type: 'chat-response', response, requestId: msg.requestId }));
                    termPrint(`[peer:${peerId.slice(0,8)}] inference served (${response.length} chars)`, 'ok');
                    updateStats();
                } catch (err) {
                    dc.send(JSON.stringify({ type: 'chat-error', error: err.message, requestId: msg.requestId }));
                }
            } else {
                dc.send(JSON.stringify({ type: 'chat-error', error: 'no model loaded', requestId: msg.requestId }));
            }
        } else if (msg.type === 'chat-response') {
            // Response from peer's inference
            const callback = inferenceCallbacks.get(msg.requestId);
            if (callback) {
                callback.resolve(msg.response);
                inferenceCallbacks.delete(msg.requestId);
            }
        } else if (msg.type === 'chat-error') {
            const callback = inferenceCallbacks.get(msg.requestId);
            if (callback) {
                callback.reject(new Error(msg.error));
                inferenceCallbacks.delete(msg.requestId);
            }
        } else if (msg.type === 'msg') {
            termPrint(`[peer:${peerId.slice(0,8)}] ${msg.text}`, 'info');
        } else if (msg.type === 'file-share') {
            termPrint(`[peer:${peerId.slice(0,8)}] shared file: ${msg.path} (${msg.content.length} bytes)`, 'info');
            await fsWrite(msg.path, msg.content);
            termPrint(`  saved to filesystem`, 'ok');
        }
    };

    dc.onclose = () => {
        dataChannels.delete(peerId);
        state.peers = state.peers.filter(p => p.id !== peerId);
        updatePeerList();
    };
}

// ─── Inference routing: local model OR peer with model ───
const inferenceCallbacks = new Map();
let requestCounter = 0;

function findInferencePeer() {
    for (const [peerId, dc] of dataChannels) {
        if (dc.readyState === 'open') {
            const peer = state.peers.find(p => p.id === peerId);
            if (peer?.capabilities?.inference) return peerId;
        }
    }
    return null;
}

async function llmChatRouted(message) {
    // If we have a local model, use it
    if (state.modelLoaded && state.engine) {
        return await llmChatLocal(message);
    }
    // Otherwise, find a peer with inference capability
    const peerId = findInferencePeer();
    if (peerId) {
        const dc = dataChannels.get(peerId);
        if (dc && dc.readyState === 'open') {
            termPrint(`Routing inference to peer ${peerId.slice(0,8)} (no local model)`, 'info');
            const requestId = 'req-' + (++requestCounter);
            const promise = new Promise((resolve, reject) => {
                inferenceCallbacks.set(requestId, { resolve, reject });
                // Timeout after 30 seconds
                setTimeout(() => {
                    if (inferenceCallbacks.has(requestId)) {
                        inferenceCallbacks.delete(requestId);
                        reject(new Error('inference request timed out'));
                    }
                }, 30000);
            });
            dc.send(JSON.stringify({
                type: 'chat-request',
                message,
                history: state.chatHistory,
                requestId,
            }));
            const response = await promise;
            state.chatHistory.push({ role: 'user', content: message });
            state.chatHistory.push({ role: 'assistant', content: response });
            return response;
        }
    }
    throw new Error('No inference available. Load a model with "model <n>" or connect to a peer with a model.');
}

async function llmChatLocal(message) {
    if (!state.modelLoaded || !state.engine) throw new Error('no local model');
    state.chatHistory.push({ role: 'user', content: message });
    termPrintHTML('<span class="llm-header">LLM Output (local):</span>', 'llm');
    const outputLine = document.createElement('div');
    outputLine.className = 'line llm';
    document.getElementById('term-output').appendChild(outputLine);
    const completion = await state.engine.chat.completions.create({
        messages: state.chatHistory, stream: true,
    });
    let fullText = '';
    for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta?.content || '';
        fullText += delta;
        outputLine.textContent = fullText + '▌';
        document.getElementById('term-output').scrollTop = document.getElementById('term-output').scrollHeight;
    }
    outputLine.textContent = fullText;
    state.chatHistory.push({ role: 'assistant', content: fullText });
    return fullText;
}

function addPeer(id, type) {
    if (!state.peers.find(p => p.id === id)) {
        state.peers.push({ id, type, connected: true, capabilities: {} });
        updatePeerList();
        termPrint(`Peer connected: ${id.slice(0,8)} (${type})`, 'ok');
    }
}

function updatePeerList() {
    const list = document.getElementById('peer-list');
    if (state.peers.length === 0) {
        list.innerHTML = '<div class="empty">No peers connected</div>';
    } else {
        list.innerHTML = state.peers.map(p => {
            const caps = [];
            if (p.capabilities?.inference) caps.push('inference');
            if (p.capabilities?.gpu) caps.push('gpu');
            const capStr = caps.length ? ` [${caps.join(',')}]` : '';
            return `<div class="peer"><span class="id">${p.id.slice(0,16)}...${capStr}</span><span class="status">${p.type}</span></div>`;
        }).join('');
    }
    document.getElementById('p2p-text').textContent = `P2P: ${state.peers.length} peer(s)`;
}

function broadcastMsg(text) {
    for (const [peerId, dc] of dataChannels) {
        if (dc.readyState === 'open') {
            dc.send(JSON.stringify({ type: 'msg', text, from: nodeId }));
        }
    }
}

async function initP2P() {
    // Register with signaling server
    termPrint('Registering with signaling relay...', 'info');
    await signalRegister();
    if (signalRegistered) {
        termPrint('Registered. Polling for peers every 3s...', 'info');
        termPrint('Other devices can connect via the same URL.', 'info');
    }
    // Also keep BroadcastChannel for instant same-origin tab discovery
    if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel('compute-node-p2p');
        bc.onmessage = (e) => {
            if (e.data.type === 'hello' && e.data.id !== nodeId) {
                addPeer(e.data.id, 'same-origin');
                bc.postMessage({ type: 'ack', id: nodeId, inference: state.modelLoaded, model: state.currentModel });
            } else if (e.data.type === 'ack' && e.data.id !== nodeId) {
                const peer = addPeer(e.data.id, 'same-origin');
                if (e.data.inference) {
                    const p = state.peers.find(pp => pp.id === e.data.id);
                    if (p) p.capabilities = { inference: true, model: e.data.model };
                }
            }
        };
        bc.postMessage({ type: 'hello', id: nodeId });
        window._bc = bc;
    }
}

// ─── Stats ───
function updateStats() {
    const stats = document.getElementById('stats');
    let ram = 'N/A';
    if (performance.memory) {
        ram = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB';
    }
    const gpuInfo = state.gpuSupported ? 'available' : 'N/A';
    const modelInfo = state.modelLoaded ? state.currentModel : 'none';
    stats.innerHTML = `
        <div class="stat"><span>Node ID</span><span class="val">${nodeId}</span></div>
        <div class="stat"><span>RAM (JS heap)</span><span class="val">${ram}</span></div>
        <div class="stat"><span>WebGPU</span><span class="val">${gpuInfo}</span></div>
        <div class="stat"><span>Model</span><span class="val" style="font-size:10px">${modelInfo || 'none'}</span></div>
        <div class="stat"><span>Files</span><span class="val">${state.files.size}</span></div>
        <div class="stat"><span>Peers</span><span class="val">${state.peers.length}</span></div>
        <div class="stat"><span>Chat msgs</span><span class="val">${state.chatHistory.length}</span></div>
    `;
}

// ─── Terminal commands ───
const commands = {
    help: () => {
        termPrint('Available commands:', 'info');
        termPrint('  help              Show this help');
        termPrint('  model [n]         List models / load model by number');
        termPrint('  chat <msg>        Talk to LLM — local model OR routed to peer');
        termPrint('  clear-chat        Clear LLM conversation history');
        termPrint('  write <f> <text>  Write file to OPFS filesystem');
        termPrint('  cat <f>           Read file from filesystem');
        termPrint('  ls                List files');
        termPrint('  rm <f>            Delete file');
        termPrint('  run <f>           Execute JS file in browser sandbox');
        termPrint('  eval <code>       Execute JavaScript code');
        termPrint('  peers             List connected peers + capabilities');
        termPrint('  say <msg>         Broadcast message to peers');
        termPrint('  share <f>         Share file to all connected peers');
        termPrint('  stats             Show node statistics');
        termPrint('  gpu               Check WebGPU status');
        termPrint('  clear             Clear terminal');
        termPrint('', '');
        termPrint('This is a real compute node. The LLM runs in your browser via WebGPU.', 'info');
        termPrint('Files persist in OPFS. Peers connect via BroadcastChannel.', 'info');
    },

    model: async (args) => {
        if (!args[0]) {
            termPrint('Available models (all run locally in your GPU):', 'info');
            MODELS.forEach((m, i) => termPrint(`  ${i + 1}. ${m.name} (${m.size}) — ${m.id}`, 'info'));
            termPrint('', '');
            termPrint('Use: model <number> to load', 'info');
            // Render model buttons in sidebar
            const modelsDiv = document.getElementById('llm-models');
            modelsDiv.innerHTML = MODELS.map((m, i) =>
                `<button onclick="termRun('model ${i + 1}')" ${state.currentModel === m.id ? 'class="active"' : ''}>${m.name}<span class="size">${m.size}</span></button>`
            ).join('');
            return;
        }
        const idx = parseInt(args[0]) - 1;
        if (idx < 0 || idx >= MODELS.length) {
            termPrint('Invalid model number. Use: model (without args) to list', 'err');
            return;
        }
        await loadModel(MODELS[idx].id, MODELS[idx].name);
    },

    chat: async (args) => {
        const msg = args.join(' ');
        if (!msg) { termPrint('Usage: chat <message>', 'err'); return; }
        try {
            await llmChatRouted(msg);
        } catch (e) {
            termPrint('Chat error: ' + e.message, 'err');
        }
    },

    'clear-chat': () => {
        state.chatHistory = [];
        termPrint('Chat history cleared', 'ok');
    },

    write: async (args) => {
        const path = args[0];
        if (!path) { termPrint('Usage: write <filename> <content>', 'err'); return; }
        const content = args.slice(1).join(' ');
        await fsWrite(path, content);
        termPrint(`Written ${content.length} bytes to ${path}`, 'ok');
    },

    cat: async (args) => {
        const path = args[0];
        if (!path) { termPrint('Usage: cat <filename>', 'err'); return; }
        const content = await fsRead(path);
        if (content === null) { termPrint(`File not found: ${path}`, 'err'); return; }
        termPrintHTML(`<div class="file-content">${escapeHtml(content)}</div>`);
    },

    ls: async () => {
        if (state.files.size === 0) {
            termPrint('No files. Use: write <filename> <content>', 'info');
            return;
        }
        for (const [path, info] of state.files) {
            const sizeStr = info.size < 1024 ? info.size + 'B' : Math.round(info.size / 1024 * 10) / 10 + 'KB';
            termPrint(`  ${path.padEnd(30)} ${sizeStr}`, 'info');
        }
    },

    rm: async (args) => {
        const path = args[0];
        if (!path) { termPrint('Usage: rm <filename>', 'err'); return; }
        const ok = await fsDelete(path);
        if (ok) termPrint(`Deleted: ${path}`, 'ok');
        else termPrint(`Delete failed: ${path}`, 'err');
    },

    run: async (args) => {
        const path = args[0];
        if (!path) { termPrint('Usage: run <filename.js>', 'err'); return; }
        const code = await fsRead(path);
        if (code === null) { termPrint(`File not found: ${path}`, 'err'); return; }
        termPrint(`Executing ${path}...`, 'info');
        try {
            const result = await eval(code);
            if (result !== undefined) termPrint(String(result), 'ok');
        } catch (e) {
            termPrint('Execution error: ' + e.message, 'err');
        }
    },

    eval: async (args) => {
        const code = args.join(' ');
        if (!code) { termPrint('Usage: eval <javascript>', 'err'); return; }
        try {
            const result = await eval(code);
            termPrint(String(result), 'ok');
        } catch (e) {
            termPrint('Error: ' + e.message, 'err');
        }
    },

    peers: () => {
        if (state.peers.length === 0) {
            termPrint('No peers connected. Open this URL on another device.', 'info');
            termPrint('Cross-device peers connect via signaling relay (/api/signal).', 'info');
        } else {
            state.peers.forEach(p => {
                const caps = [];
                if (p.capabilities?.inference) caps.push('inference: ' + (p.capabilities.model || 'unknown'));
                if (p.capabilities?.gpu) caps.push('gpu');
                const capStr = caps.length ? ' [' + caps.join(', ') + ']' : '';
                termPrint(`  ${p.id} (${p.type})${capStr}`, 'info');
            });
        }
    },

    say: (args) => {
        const msg = args.join(' ');
        if (!msg) { termPrint('Usage: say <message>', 'err'); return; }
        broadcastMsg(msg);
        termPrint(`Broadcast to ${state.peers.length} peer(s): ${msg}`, 'ok');
    },

    share: async (args) => {
        const path = args[0];
        if (!path) { termPrint('Usage: share <filename>', 'err'); return; }
        const content = await fsRead(path);
        if (content === null) { termPrint(`File not found: ${path}`, 'err'); return; }
        let shared = 0;
        for (const [peerId, dc] of dataChannels) {
            if (dc.readyState === 'open') {
                dc.send(JSON.stringify({ type: 'file-share', path, content }));
                shared++;
            }
        }
        termPrint(`Shared ${path} to ${shared} peer(s)`, 'ok');
    },

    stats: () => {
        updateStats();
        const ram = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB' : 'N/A';
        termPrint(`Node ID:     ${nodeId}`, 'info');
        termPrint(`RAM:         ${ram}`, 'info');
        termPrint(`WebGPU:      ${state.gpuSupported ? 'available' : 'not available'}`, 'info');
        termPrint(`Model:       ${state.currentModel || 'none'}`, 'info');
        termPrint(`Inference:   ${state.modelLoaded ? 'local (serving peers)' : findInferencePeer() ? 'via peer' : 'none'}`, 'info');
        termPrint(`Files:       ${state.files.size}`, 'info');
        termPrint(`Peers:       ${state.peers.length}`, 'info');
        termPrint(`Chat msgs:   ${state.chatHistory.length}`, 'info');
    },

    gpu: async () => {
        const ok = await checkGPU();
        if (ok) {
            const adapter = await navigator.gpu.requestAdapter();
            const info = await adapter.requestAdapterInfo();
            termPrint(`WebGPU available`, 'ok');
            termPrint(`  Vendor: ${info.vendor || 'unknown'}`, 'info');
            termPrint(`  Architecture: ${info.architecture || 'unknown'}`, 'info');
            termPrint(`  Device: ${info.device || 'unknown'}`, 'info');
        } else {
            termPrint('WebGPU not available. Requirements:', 'err');
            termPrint('  Chrome 113+ / Edge 113+ / Safari 18+', 'info');
            termPrint('  GPU hardware acceleration enabled', 'info');
            termPrint('  Not available in Firefox yet', 'info');
        }
    },

    clear: () => {
        document.getElementById('term-output').innerHTML = '';
    },
};

// ─── Terminal execution ───
window.termRun = async function(cmdStr) {
    const trimmed = cmdStr.trim();
    if (!trimmed) return;

    // Echo command
    termPrintHTML(`<span class="prompt">node@browser:~$</span> <span class="cmd">${escapeHtml(trimmed)}</span>`);

    const args = trimmed.split(/\s+/);
    const cmd = args[0];
    const rest = args.slice(1);

    if (commands[cmd]) {
        await commands[cmd](rest);
    } else {
        termPrint(`Command not found: ${cmd}. Type "help".`, 'err');
    }
};

// ─── Terminal input ───
const termInput = document.getElementById('term-input');
termInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const cmd = termInput.value;
        termInput.value = '';
        state.termHistory.push(cmd);
        state.termIdx = state.termHistory.length;
        await window.termRun(cmd);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (state.termIdx > 0) {
            state.termIdx--;
            termInput.value = state.termHistory[state.termIdx];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (state.termIdx < state.termHistory.length - 1) {
            state.termIdx++;
            termInput.value = state.termHistory[state.termIdx];
        } else {
            termInput.value = '';
            state.termIdx = state.termHistory.length;
        }
    }
});

// Keep focus on terminal
document.addEventListener('click', () => termInput.focus());

// ─── Utils ───
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── Init ───
async function init() {
    termPrint('═══════════════════════════════════════════════════', 'info');
    termPrint('  Browser Compute Node v1.0', 'ok');
    termPrint('  The browser IS the VPS. No server compute.', 'info');
    termPrint('═══════════════════════════════════════════════════', 'info');
    termPrint('', '');

    // Check WebGPU
    const gpuOk = await checkGPU();
    if (gpuOk) {
        termPrint('WebGPU detected — LLM inference available', 'ok');
    } else {
        termPrint('WebGPU not available — LLM inference disabled', 'warn');
        termPrint('Filesystem and code execution still work', 'info');
    }
    termPrint('');

    // Init filesystem
    const fsOk = await fsInit();
    if (fsOk) {
        termPrint('OPFS filesystem mounted at /', 'ok');
    }
    termPrint('');

    // Init P2P
    await initP2P();
    termPrint('');

    // Show available models
    termPrint('Available LLM models (run in your GPU, not a server):', 'info');
    MODELS.forEach((m, i) => termPrint(`  ${i + 1}. ${m.name} (${m.size})`, 'info'));
    termPrint('');
    termPrint('Type "model 1" to load the smallest model and start chatting.', 'info');
    termPrint('Type "help" for all commands.', 'info');
    termPrint('');

    // Render model buttons
    const modelsDiv = document.getElementById('llm-models');
    modelsDiv.innerHTML = MODELS.map((m, i) =>
        `<button onclick="termRun('model ${i + 1}')">${m.name}<span class="size">${m.size}</span></button>`
    ).join('');

    updateStats();
    setInterval(updateStats, 5000);
    termInput.focus();
}

init();
</script>
</body>
</html>"""

