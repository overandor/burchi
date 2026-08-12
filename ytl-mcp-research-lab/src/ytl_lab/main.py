"""FastAPI + MCP server for YTL-MCP Research Lab."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ytl_lab.config import Settings
from ytl_lab.db import LabDB
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


@app.get("/", response_class=HTMLResponse)
def dashboard() -> str:
    return _DASHBOARD_HTML


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "ytl-mcp-research-lab"}


@app.get("/api/status")
def api_status() -> Dict[str, Any]:
    return tools.status()


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

loadStatus();
setInterval(loadStatus, 10000);
</script>
</body>
</html>"""

