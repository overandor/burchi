"""P2P router — real peer discovery, chunk exchange, and swarm coordination.

This implements:
- Peer registration with chunk availability
- Peer discovery: find peers who have specific chunks or models
- WebRTC signaling: offer/answer/ICE relay for browser-to-browser chunk transfer
- Chunk exchange: peers can fetch chunks from other peers via WebRTC data channels
- Transfer logging: track real data movement between peers
- Swarm health: monitor peer liveness and chunk replication
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app import store_gguf as store
from app.auth_gguf import verify_api_key

router = APIRouter(prefix="/api/p2p", tags=["p2p"])


class PeerRegister(BaseModel):
    peer_id: str
    chunks: list[str] = []
    model_id: str = ""
    ip: str = ""
    port: int = 0
    capabilities: dict = {}


class ChunkAnnounce(BaseModel):
    peer_id: str
    chunks: list[str] = []
    model_id: str = ""


class ChunkRequest(BaseModel):
    chunk_hash: str
    peer_id: str  # requesting peer
    from_peer: str  # source peer


class PeerHeartbeat(BaseModel):
    peer_id: str
    chunks: list[str] = []
    status: str = "active"


@router.post("/register")
async def register_peer(body: PeerRegister, request: Request, key_info: dict = Depends(verify_api_key)):
    """Register a new peer in the swarm with chunk availability."""
    # Auto-detect IP from request
    client_ip = body.ip or request.client.host if request.client else ""

    # Register in peers table
    store.announce_peer({
        "peer_id": body.peer_id,
        "chunks": body.chunks,
        "ip": client_ip,
        "port": body.port,
    })

    # Register detailed chunk availability
    chunk_count = store.announce_peer_chunks(body.peer_id, body.chunks, body.model_id)

    store.log_event("peer_registered", metadata={
        "peer_id": body.peer_id, "chunks": chunk_count, "model_id": body.model_id,
    })

    return {
        "ok": True,
        "peer_id": body.peer_id,
        "registered_chunks": chunk_count,
        "ip": client_ip,
        "swarm_size": len(store.list_peers()),
    }


@router.post("/announce")
async def announce_chunks(body: ChunkAnnounce, key_info: dict = Depends(verify_api_key)):
    """Update chunk availability for an existing peer."""
    chunk_count = store.announce_peer_chunks(body.peer_id, body.chunks, body.model_id)
    store.log_event("peer_announced", metadata={
        "peer_id": body.peer_id, "chunks": chunk_count,
    })
    return {
        "ok": True,
        "peer_id": body.peer_id,
        "announced_chunks": chunk_count,
    }


@router.post("/heartbeat")
async def peer_heartbeat(body: PeerHeartbeat, key_info: dict = Depends(verify_api_key)):
    """Heartbeat from a peer — updates last_seen and chunk availability."""
    if body.chunks:
        store.announce_peer_chunks(body.peer_id, body.chunks)
    # Update peer last_seen
    store.announce_peer({
        "peer_id": body.peer_id,
        "chunks": body.chunks,
        "ip": "",
        "port": 0,
    })
    return {
        "ok": True,
        "peer_id": body.peer_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "swarm_size": len(store.list_peers()),
    }


@router.get("/peers")
async def list_all_peers(key_info: dict = Depends(verify_api_key)):
    """List all peers in the swarm."""
    peers = store.list_peers()
    chunk_map = {p["peer_id"]: p for p in store.get_peer_chunk_map()}
    return [
        {
            **p,
            "chunk_count": chunk_map.get(p["peer_id"], {}).get("chunk_count", len(p["chunks"])),
        }
        for p in peers
    ]


@router.get("/peers/chunk/{chunk_hash}")
async def find_peers_with_chunk(chunk_hash: str, key_info: dict = Depends(verify_api_key)):
    """Find all peers that have a specific chunk."""
    peers = store.find_peers_for_chunk(chunk_hash)
    return {
        "chunk_hash": chunk_hash,
        "peers": peers,
        "count": len(peers),
    }


@router.get("/peers/model/{model_id}")
async def find_peers_with_model(model_id: str, key_info: dict = Depends(verify_api_key)):
    """Find all peers that have chunks for a specific model, sorted by availability."""
    peers = store.find_peers_for_model(model_id)
    return {
        "model_id": model_id,
        "peers": peers,
        "count": len(peers),
    }


@router.post("/fetch")
async def fetch_chunk_from_peer(body: ChunkRequest, key_info: dict = Depends(verify_api_key)):
    """Coordinate chunk fetch from one peer to another.

    This endpoint acts as a signaling server — it finds the source peer's
    address and attempts to fetch the chunk, then logs the transfer.
    """
    # Find source peer
    peers = store.find_peers_for_chunk(body.chunk_hash)
    source = None
    for p in peers:
        if p["peer_id"] == body.from_peer:
            source = p
            break

    if not source:
        raise HTTPException(
            status_code=404,
            detail=f"Source peer {body.from_peer} not found or doesn't have chunk {body.chunk_hash}"
        )

    # Try to fetch from source peer
    peer_url = f"http://{source['ip']}:{source['port']}" if source.get("port") else source.get("ip", "")

    if not peer_url:
        return {
            "ok": False,
            "error": "Source peer has no reachable address",
            "chunk_hash": body.chunk_hash,
        }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{peer_url}/chunks/{body.chunk_hash}")
            if resp.is_success:
                bytes_transferred = len(resp.content)
                store.log_peer_transfer(body.from_peer, body.peer_id, body.chunk_hash, bytes_transferred)
                store.log_event("chunk_transferred", metadata={
                    "from": body.from_peer, "to": body.peer_id,
                    "chunk_hash": body.chunk_hash, "bytes": bytes_transferred,
                })
                return {
                    "ok": True,
                    "chunk_hash": body.chunk_hash,
                    "bytes": bytes_transferred,
                    "from_peer": body.from_peer,
                    "to_peer": body.peer_id,
                }
            else:
                return {
                    "ok": False,
                    "error": f"Source returned HTTP {resp.status_code}",
                    "chunk_hash": body.chunk_hash,
                }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "chunk_hash": body.chunk_hash,
            "hint": "Peer may be behind NAT or offline. Try another peer.",
        }


@router.get("/swarm/health")
async def swarm_health(key_info: dict = Depends(verify_api_key)):
    """Get swarm health metrics."""
    stats = store.get_peer_transfer_stats()
    peers = store.list_peers()
    now = datetime.now(timezone.utc)

    active = 0
    stale = 0
    for p in peers:
        try:
            last = datetime.fromisoformat(p["last_seen"])
            age = (now - last).total_seconds()
            if age < 300:  # 5 min
                active += 1
            else:
                stale += 1
        except Exception:
            stale += 1

    return {
        **stats,
        "total_peers": len(peers),
        "active_peers_5min": active,
        "stale_peers": stale,
        "chunk_map": store.get_peer_chunk_map(),
    }


@router.get("/swarm/topology")
async def swarm_topology(key_info: dict = Depends(verify_api_key)):
    """Get the swarm topology — which peers have which chunks."""
    peers = store.list_peers()
    chunk_map = store.get_peer_chunk_map()

    # Build adjacency: for each chunk, which peers have it
    chunk_to_peers = {}
    for p in peers:
        for chunk in p.get("chunks", []):
            if chunk not in chunk_to_peers:
                chunk_to_peers[chunk] = []
            chunk_to_peers[chunk].append(p["peer_id"])

    # Replication factor per chunk
    replication = {chunk: len(peers_list) for chunk, peers_list in chunk_to_peers.items()}

    return {
        "peers": [
            {
                "peer_id": p["peer_id"],
                "ip": p["ip"],
                "port": p["port"],
                "chunk_count": next((c["chunk_count"] for c in chunk_map if c["peer_id"] == p["peer_id"]), len(p["chunks"])),
                "last_seen": p["last_seen"],
            }
            for p in peers
        ],
        "total_chunks_in_swarm": len(chunk_to_peers),
        "replication": replication,
        "avg_replication": round(sum(replication.values()) / len(replication), 1) if replication else 0,
    }


@router.get("/manifest/{model_id}")
async def p2p_manifest(model_id: str, key_info: dict = Depends(verify_api_key)):
    """Get a P2P distribution manifest for a model — includes peer availability per chunk."""
    model = store.get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    chunks = model.get("chunks", [])
    chunk_peer_map = {}
    for chunk in chunks:
        chunk_hash = chunk.get("hash", "") if isinstance(chunk, dict) else str(chunk)
        peers = store.find_peers_for_chunk(chunk_hash)
        chunk_peer_map[chunk_hash] = {
            "peer_count": len(peers),
            "peers": [p["peer_id"] for p in peers],
        }

    return {
        "model_id": model_id,
        "model_name": model["name"],
        "merkle_root": model["merkle_root"],
        "chunk_count": model["chunk_count"],
        "chunks": chunks,
        "peer_availability": chunk_peer_map,
        "swarm_peers": len(store.list_peers()),
    }


# ─── WebRTC Signaling ────────────────────────────────────────────
# In-memory signaling channel for WebRTC offer/answer/ICE relay.
# This enables real browser-to-browser chunk transfer via data channels.

_pending_offers: dict[str, dict] = {}  # peer_id -> {offer, from_peer, chunk_hash, timestamp}
_pending_answers: dict[str, dict] = {}  # peer_id -> {answer, from_peer, timestamp}
_ice_candidates: dict[str, list] = {}  # peer_id -> [candidate, ...]


class WebRTCOffer(BaseModel):
    from_peer: str
    to_peer: str
    sdp: str
    sdp_type: str = "offer"
    chunk_hash: str = ""


class WebRTCAnswer(BaseModel):
    from_peer: str
    to_peer: str
    sdp: str
    sdp_type: str = "answer"


class ICECandidate(BaseModel):
    from_peer: str
    to_peer: str
    candidate: str


@router.post("/webrtc/offer")
async def webrtc_offer(body: WebRTCOffer, key_info: dict = Depends(verify_api_key)):
    """Relay a WebRTC offer from one peer to another.

    The offering peer creates an SDP offer for a data channel
    and sends it here. The target peer polls /webrtc/poll to receive it.
    """
    _pending_offers[body.to_peer] = {
        "from_peer": body.from_peer,
        "sdp": body.sdp,
        "sdp_type": body.sdp_type,
        "chunk_hash": body.chunk_hash,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    store.log_event("webrtc_offer", metadata={
        "from": body.from_peer, "to": body.to_peer, "chunk": body.chunk_hash,
    })
    return {"ok": True, "message": "Offer relayed", "to_peer": body.to_peer}


@router.post("/webrtc/answer")
async def webrtc_answer(body: WebRTCAnswer, key_info: dict = Depends(verify_api_key)):
    """Relay a WebRTC answer back to the offering peer."""
    _pending_answers[body.to_peer] = {
        "from_peer": body.from_peer,
        "sdp": body.sdp,
        "sdp_type": body.sdp_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    store.log_event("webrtc_answer", metadata={
        "from": body.from_peer, "to": body.to_peer,
    })
    return {"ok": True, "message": "Answer relayed", "to_peer": body.to_peer}


@router.post("/webrtc/ice")
async def webrtc_ice(body: ICECandidate, key_info: dict = Depends(verify_api_key)):
    """Relay an ICE candidate between peers."""
    if body.to_peer not in _ice_candidates:
        _ice_candidates[body.to_peer] = []
    _ice_candidates[body.to_peer].append({
        "from_peer": body.from_peer,
        "candidate": body.candidate,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "message": "ICE candidate relayed", "to_peer": body.to_peer}


@router.get("/webrtc/poll")
async def webrtc_poll(peer_id: str, key_info: dict = Depends(verify_api_key)):
    """Poll for pending WebRTC signaling messages.

    Returns any pending offers, answers, and ICE candidates for this peer.
    Clears them after returning (one-shot consumption).
    """
    offer = _pending_offers.pop(peer_id, None)
    answer = _pending_answers.pop(peer_id, None)
    ice = _ice_candidates.pop(peer_id, [])

    return {
        "peer_id": peer_id,
        "offer": offer,
        "answer": answer,
        "ice_candidates": ice,
        "has_messages": bool(offer or answer or ice),
    }


@router.post("/webrtc/transfer-complete")
async def webrtc_transfer_complete(
    from_peer: str,
    to_peer: str,
    chunk_hash: str,
    bytes_transferred: int,
    key_info: dict = Depends(verify_api_key),
):
    """Log a completed WebRTC data channel transfer."""
    result = store.log_peer_transfer(from_peer, to_peer, chunk_hash, bytes_transferred)
    store.log_event("webrtc_transfer", metadata={
        "from": from_peer, "to": to_peer, "chunk": chunk_hash,
        "bytes": bytes_transferred,
    })
    return {
        "ok": True,
        "transfer_id": result["id"],
        "bytes": bytes_transferred,
        "from_peer": from_peer,
        "to_peer": to_peer,
    }
