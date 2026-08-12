"""FastAPI + MCP server for YTL-MCP Research Lab."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException
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
