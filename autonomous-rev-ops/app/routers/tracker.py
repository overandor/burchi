"""Tracker router — manifest serving, chunk info, peer management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app import store_gguf as store
from app.schemas_gguf import PeerAnnounce, PeerResponse
from app.auth_gguf import verify_api_key

router = APIRouter(prefix="/api/tracker", tags=["tracker"])


@router.get("/manifest/{model_id}")
async def get_manifest(model_id: str, key_info: dict = Depends(verify_api_key)):
    """Get the distribution manifest for a model."""
    model = store.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return {
        "model_name": model["name"],
        "model_hash": model["merkle_root"],
        "model_size": model["model_size"],
        "architecture": model["architecture"],
        "quantization": model["quantization"],
        "parameter_count": model["parameter_count"],
        "chunk_count": model["chunk_count"],
        "chunk_size": model["chunk_size"],
        "chunks": model["chunks"],
        "tracker_url": model["tracker_url"],
    }


@router.get("/peers", response_model=list[PeerResponse])
async def list_peers(key_info: dict = Depends(verify_api_key)):
    """List all known peers."""
    return store.list_peers()


@router.post("/announce", response_model=PeerResponse)
async def announce_peer(body: PeerAnnounce, key_info: dict = Depends(verify_api_key)):
    """Announce chunks that a peer has available."""
    return store.announce_peer(body.model_dump())


@router.get("/peers/{chunk_hash}")
async def get_peers_for_chunk(chunk_hash: str, key_info: dict = Depends(verify_api_key)):
    """Find peers that have a specific chunk."""
    peers = store.get_peers_for_chunk(chunk_hash)
    return {"chunk_hash": chunk_hash, "peers": peers, "count": len(peers)}


@router.get("/health")
async def tracker_health(key_info: dict = Depends(verify_api_key)):
    """Tracker health check."""
    models = store.list_models()
    total_chunks = sum(m["chunk_count"] for m in models)
    return {
        "status": "ok",
        "models": len(models),
        "total_chunks": total_chunks,
        "total_size_mb": round(sum(m["model_size"] for m in models) / (1024 * 1024), 1),
    }
