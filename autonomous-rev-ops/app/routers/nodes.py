"""Nodes router — node registration, heartbeat, and management."""

from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException

from app import store_gguf as store
from app.schemas_gguf import NodeRegister, NodeHeartbeat, NodeResponse
from app.auth_gguf import verify_api_key

router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@router.get("", response_model=list[NodeResponse])
async def list_nodes(key_info: dict = Depends(verify_api_key)):
    """List all registered nodes."""
    return store.list_nodes()


@router.get("/{node_id}", response_model=NodeResponse)
async def get_node(node_id: str, key_info: dict = Depends(verify_api_key)):
    """Get a specific node by ID."""
    node = store.get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.post("", response_model=NodeResponse, status_code=201)
async def register_node(body: NodeRegister, key_info: dict = Depends(verify_api_key)):
    """Register a new inference node."""
    node = store.register_node(body.model_dump())
    store.log_event("node_registered", node_id=node["node_id"])
    return node


@router.post("/{node_id}/heartbeat", response_model=NodeResponse)
async def heartbeat(node_id: str, body: NodeHeartbeat, key_info: dict = Depends(verify_api_key)):
    """Send a heartbeat to keep node alive."""
    node = store.heartbeat(node_id, body.model_dump())
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@router.delete("/{node_id}", status_code=204)
async def deregister_node(node_id: str, key_info: dict = Depends(verify_api_key)):
    """Deregister a node."""
    if not store.deregister_node(node_id):
        raise HTTPException(status_code=404, detail="Node not found")
    store.log_event("node_deregistered", node_id=node_id)


@router.get("/{node_id}/health")
async def node_health(node_id: str, key_info: dict = Depends(verify_api_key)):
    """Check node health by pinging its inference endpoint."""
    node = store.get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    import httpx
    inference_url = node.get("inference_url", "")
    if not inference_url:
        return {"ok": False, "error": "No inference URL configured"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            t0 = datetime.now(timezone.utc)
            resp = await client.get(f"{inference_url.rstrip('/')}/health")
            elapsed = (datetime.now(timezone.utc) - t0).total_seconds() * 1000
            return {
                "ok": resp.is_success,
                "status_code": resp.status_code,
                "latency_ms": round(elapsed, 1),
                "url": inference_url,
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}
