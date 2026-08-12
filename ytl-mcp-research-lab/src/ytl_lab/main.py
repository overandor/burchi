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


@app.get("/browse", response_class=HTMLResponse)
def browse_page(url: str = "") -> str:
    """Browser-in-browser — full navigation, tabs, history. No iframe."""
    return _BROWSER_HTML


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

