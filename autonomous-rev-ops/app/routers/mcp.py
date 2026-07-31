"""MCP router — Model Context Protocol over HTTP with SSE."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app import store_gguf as store
from app.schemas_gguf import MCPRequest
from app.auth_gguf import verify_api_key

router = APIRouter(prefix="/api/mcp", tags=["mcp"])

TOOLS = [
    {
        "name": "list_models",
        "description": "List all registered GGUF models with their status, size, and chunk count.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_model_info",
        "description": "Get detailed metadata for a specific model including Merkle root and chunk hashes.",
        "inputSchema": {
            "type": "object",
            "properties": {"model_id": {"type": "string", "description": "Model ID"}},
            "required": ["model_id"],
        },
    },
    {
        "name": "register_model",
        "description": "Register a new GGUF model in the distribution registry.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "architecture": {"type": "string"},
                "quantization": {"type": "string"},
                "model_size": {"type": "integer"},
                "chunk_count": {"type": "integer"},
                "merkle_root": {"type": "string"},
                "tracker_url": {"type": "string"},
                "inference_url": {"type": "string"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "list_nodes",
        "description": "List all inference nodes with their status and loaded models.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "register_node",
        "description": "Register a new inference node.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_id": {"type": "string"},
                "name": {"type": "string"},
                "inference_url": {"type": "string"},
                "models": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["node_id", "name"],
        },
    },
    {
        "name": "inference",
        "description": "Run inference on a model. Returns the generated text and performance metrics.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "model_id": {"type": "string"},
                "max_tokens": {"type": "integer", "default": 100},
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "get_network_status",
        "description": "Check health and latency of all tracker and inference nodes.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_analytics",
        "description": "Get download counts, inference stats, and top models.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


@router.post("/jsonrpc")
async def mcp_jsonrpc(body: MCPRequest, key_info: dict = Depends(verify_api_key)):
    """Handle MCP JSON-RPC 2.0 requests over HTTP."""
    method = body.method
    params = body.params
    req_id = body.id

    if method == "initialize":
        return {
            "jsonrpc": "2.0", "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "torrent-gguf-backend", "version": "0.1.0"},
            },
        }

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}

    if method == "tools/call":
        tool_name = params.get("name", "")
        args = params.get("arguments", {})
        result = await _call_tool(tool_name, args)
        return {
            "jsonrpc": "2.0", "id": req_id,
            "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2, default=str)}]},
        }

    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


@router.get("/sse")
async def mcp_sse(key_info: dict = Depends(verify_api_key)):
    """MCP SSE endpoint for streaming tool results."""
    async def generate():
        # Initial connection event
        yield f"event: connected\ndata: {json.dumps({'server': 'torrent-gguf', 'tools': len(TOOLS)})}\n\n"

        # Keep alive
        while True:
            yield f"event: ping\ndata: {json.dumps({'ts': int(time.time())})}\n\n"
            import asyncio
            await asyncio.sleep(15)

    return StreamingResponse(generate(), media_type="text/event-stream")


async def _call_tool(name: str, args: dict) -> Any:
    """Execute an MCP tool."""
    if name == "list_models":
        models = store.list_models()
        return {"models": [{"id": m["id"], "name": m["name"], "chunks": m["chunk_count"],
                            "size_mb": round(m["model_size"] / (1024 * 1024), 1),
                            "status": m["status"]} for m in models]}

    elif name == "get_model_info":
        model = store.get_model(args.get("model_id", ""))
        if not model:
            return {"error": "Model not found"}
        return model

    elif name == "register_model":
        model = store.create_model(args)
        store.log_event("model_registered", model_id=model["id"])
        return {"status": "ok", "model_id": model["id"]}

    elif name == "list_nodes":
        return {"nodes": store.list_nodes()}

    elif name == "register_node":
        node = store.register_node(args)
        return {"status": "ok", "node_id": node["node_id"]}

    elif name == "inference":
        url = args.get("inference_url", "https://gguf-p2p-deploy.vercel.app")
        prompt = args.get("prompt", "")
        max_tokens = args.get("max_tokens", 100)
        t0 = time.time()
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{url.rstrip('/')}/v1/chat/completions",
                    json={"model": "gguf-model",
                          "messages": [{"role": "user", "content": prompt}],
                          "max_tokens": max_tokens},
                )
                elapsed = int((time.time() - t0) * 1000)
                if resp.is_success:
                    data = resp.json()
                    text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    store.log_inference({
                        "model_id": args.get("model_id", ""),
                        "prompt": prompt[:200], "response": text[:200],
                        "success": True, "elapsed_ms": elapsed,
                    })
                    return {"ok": True, "response": text, "elapsed_ms": elapsed}
                else:
                    return {"ok": False, "error": f"Server returned {resp.status_code}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    elif name == "get_network_status":
        nodes = store.list_nodes()
        models = store.list_models()
        return {
            "nodes": len(nodes),
            "active_nodes": sum(1 for n in nodes if n["status"] == "active"),
            "models": len(models),
            "total_chunks": sum(m["chunk_count"] for m in models),
        }

    elif name == "get_analytics":
        return store.get_analytics()

    return {"error": f"Unknown tool: {name}"}
