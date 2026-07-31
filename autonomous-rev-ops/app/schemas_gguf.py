"""Schemas — Pydantic models for all API requests/responses."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Models ──────────────────────────────────────────────────────

class ChunkInfo(BaseModel):
    index: int
    hash: str
    size: int
    filename: str = ""
    offset: int = 0


class ModelCreate(BaseModel):
    name: str
    architecture: str = "unknown"
    quantization: str = "unknown"
    parameter_count: str = "unknown"
    model_size: int = 0
    chunk_count: int = 0
    chunk_size: int = 16 * 1024 * 1024
    merkle_root: str = ""
    tracker_url: str = ""
    inference_url: str = ""
    chunks: list[ChunkInfo] = []
    metadata: dict[str, Any] = {}


class ModelUpdate(BaseModel):
    name: Optional[str] = None
    architecture: Optional[str] = None
    quantization: Optional[str] = None
    inference_url: Optional[str] = None
    tracker_url: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class ModelResponse(BaseModel):
    id: str
    name: str
    architecture: str
    quantization: str
    parameter_count: str
    model_size: int
    chunk_count: int
    chunk_size: int
    merkle_root: str
    tracker_url: str
    inference_url: str
    chunks: list[ChunkInfo] = []
    metadata: dict[str, Any] = {}
    created_at: str
    updated_at: str
    status: str = "registered"


# ─── Nodes ────────────────────────────────────────────────────────

class NodeRegister(BaseModel):
    node_id: str
    name: str
    models: list[str] = []  # model IDs this node can serve
    inference_url: str = ""
    tracker_url: str = ""
    capabilities: dict[str, Any] = {}
    region: str = "unknown"


class NodeHeartbeat(BaseModel):
    status: str = "active"  # active, idle, draining, offline
    metrics: dict[str, Any] = {}
    models_loaded: list[str] = []


class NodeResponse(BaseModel):
    node_id: str
    name: str
    models: list[str]
    inference_url: str
    tracker_url: str
    capabilities: dict[str, Any]
    region: str
    status: str
    last_heartbeat: str
    registered_at: str
    metrics: dict[str, Any] = {}


# ─── Inference ────────────────────────────────────────────────────

class InferenceRequest(BaseModel):
    prompt: str
    model_id: Optional[str] = None
    node_id: Optional[str] = None
    max_tokens: int = 100
    temperature: float = 0.7
    stream: bool = False
    system_prompt: Optional[str] = None


class InferenceResponse(BaseModel):
    ok: bool
    response: str = ""
    model_id: str = ""
    node_id: str = ""
    elapsed_ms: int = 0
    tokens: dict[str, int] = {}
    performance: dict[str, float] = {}
    error: Optional[str] = None


# ─── Tracker ──────────────────────────────────────────────────────

class PeerAnnounce(BaseModel):
    peer_id: str
    chunks: list[str] = []  # chunk hashes the peer has
    port: int = 0
    ip: str = ""


class PeerResponse(BaseModel):
    peer_id: str
    chunks: list[str]
    ip: str
    port: int
    last_seen: str


# ─── Analytics ────────────────────────────────────────────────────

class AnalyticsEvent(BaseModel):
    event_type: str  # download_start, download_complete, inference_request, etc.
    model_id: Optional[str] = None
    node_id: Optional[str] = None
    metadata: dict[str, Any] = {}


class AnalyticsResponse(BaseModel):
    total_downloads: int = 0
    total_inferences: int = 0
    active_nodes: int = 0
    total_models: int = 0
    total_chunks: int = 0
    total_size_mb: float = 0
    events: list[dict[str, Any]] = []
    top_models: list[dict[str, Any]] = []
    node_uptime: dict[str, float] = {}


# ─── Auth ─────────────────────────────────────────────────────────

class APIKeyCreate(BaseModel):
    name: str
    scopes: list[str] = ["read"]  # read, write, inference, admin


class APIKeyResponse(BaseModel):
    key: str
    name: str
    scopes: list[str]
    user_id: Optional[str] = None
    created_at: str
    last_used: Optional[str] = None


# ─── Users ────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    email: str
    username: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    role: str
    created_at: str
    updated_at: str


class LoginResponse(BaseModel):
    token: str
    user: UserResponse
    expires_at: str


class UserAPIKeyCreate(BaseModel):
    name: str
    scopes: list[str] = ["read"]


# ─── MCP ──────────────────────────────────────────────────────────

class MCPToolCall(BaseModel):
    name: str
    arguments: dict[str, Any] = {}


class MCPRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: int | str
    method: str
    params: dict[str, Any] = {}
