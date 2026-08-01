"""Distributed inference marketplace — open the P2P network to third-party operators.

Features:
  1. Third-party node registration with capabilities and pricing
  2. Load balancing across available nodes (latency-weighted round-robin)
  3. Reputation scoring based on inference success rate, latency, and uptime
  4. Credits/earnings tracking for node operators
  5. Automatic node health checks and circuit breaker

Node operators register their nodes, serve inference requests, and earn
credits based on successful completions. Low-reputation nodes are
automatically deprioritized.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from . import store_gguf


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Reputation System ─────────────────────────────────────────────

REPUTATION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS node_reputation (
    node_id TEXT PRIMARY KEY,
    total_requests INTEGER DEFAULT 0,
    successful_requests INTEGER DEFAULT 0,
    failed_requests INTEGER DEFAULT 0,
    avg_latency_ms REAL DEFAULT 0,
    reputation_score REAL DEFAULT 0.5,
    credits_earned REAL DEFAULT 0,
    credits_spent REAL DEFAULT 0,
    uptime_percentage REAL DEFAULT 100.0,
    last_failure TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS node_credits (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    description TEXT DEFAULT '',
    timestamp TEXT
);
"""

_reputation_initialized = False


def _init_reputation_tables():
    global _reputation_initialized
    if _reputation_initialized:
        return
    conn = store_gguf._get_conn()
    conn.executescript(REPUTATION_TABLE_SQL)
    conn.commit()
    _reputation_initialized = True


def update_reputation(
    node_id: str,
    success: bool,
    latency_ms: float = 0,
    credits: float = 0,
) -> dict:
    """Update a node's reputation after an inference request.

    Reputation score is calculated as:
      score = (success_rate * 0.5) + (latency_factor * 0.3) + (uptime_factor * 0.2)

    Where:
      - success_rate = successful_requests / total_requests
      - latency_factor = max(0, 1 - (avg_latency_ms / 5000))  # 5s = 0 score
      - uptime_factor = uptime_percentage / 100
    """
    _init_reputation_tables()
    conn = store_gguf._get_conn()
    now = _utc_now()

    # Get current stats
    row = conn.execute(
        "SELECT * FROM node_reputation WHERE node_id = ?", (node_id,)
    ).fetchone()

    if row:
        total = row["total_requests"] + 1
        successful = row["successful_requests"] + (1 if success else 0)
        failed = row["failed_requests"] + (0 if success else 1)
        # Rolling average latency
        prev_avg = row["avg_latency_ms"]
        avg_latency = ((prev_avg * row["total_requests"]) + latency_ms) / total if total > 0 else latency_ms
        credits_earned = row["credits_earned"] + (credits if success else 0)

        # Calculate reputation score
        success_rate = successful / total if total > 0 else 0
        latency_factor = max(0, 1 - (avg_latency / 5000))
        uptime_factor = row["uptime_percentage"] / 100
        reputation = (success_rate * 0.5) + (latency_factor * 0.3) + (uptime_factor * 0.2)

        conn.execute(
            """UPDATE node_reputation SET
               total_requests = ?, successful_requests = ?, failed_requests = ?,
               avg_latency_ms = ?, reputation_score = ?, credits_earned = ?,
               last_failure = ?, updated_at = ?
               WHERE node_id = ?""",
            (total, successful, failed, avg_latency, reputation, credits_earned,
             "" if success else now, now, node_id)
        )
    else:
        # First request for this node
        total = 1
        successful = 1 if success else 0
        failed = 0 if success else 1
        avg_latency = latency_ms
        credits_earned = credits if success else 0
        success_rate = successful / total
        latency_factor = max(0, 1 - (avg_latency / 5000))
        reputation = (success_rate * 0.5) + (latency_factor * 0.3) + (1.0 * 0.2)

        conn.execute(
            """INSERT INTO node_reputation
               (node_id, total_requests, successful_requests, failed_requests,
                avg_latency_ms, reputation_score, credits_earned, credits_spent,
                uptime_percentage, last_failure, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (node_id, total, successful, failed, avg_latency, reputation,
             credits_earned, 0, 100.0, "" if success else now, now, now)
        )

    # Record credit transaction
    if success and credits > 0:
        cid = str(uuid4())
        conn.execute(
            "INSERT INTO node_credits (id, node_id, amount, type, description, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (cid, node_id, credits, "earned", "Inference completion", now)
        )

    conn.commit()

    return get_reputation(node_id)


def get_reputation(node_id: str) -> dict:
    """Get a node's reputation score and stats."""
    _init_reputation_tables()
    conn = store_gguf._get_conn()
    row = conn.execute(
        "SELECT * FROM node_reputation WHERE node_id = ?", (node_id,)
    ).fetchone()
    if not row:
        return {
            "node_id": node_id,
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "avg_latency_ms": 0,
            "reputation_score": 0.5,
            "credits_earned": 0,
            "credits_spent": 0,
            "uptime_percentage": 100.0,
        }
    return dict(row)


def get_all_reputations() -> list[dict]:
    """Get reputation stats for all nodes."""
    _init_reputation_tables()
    conn = store_gguf._get_conn()
    rows = conn.execute(
        "SELECT * FROM node_reputation ORDER BY reputation_score DESC"
    ).fetchall()
    return [dict(r) for r in rows]


# ─── Load Balancer ─────────────────────────────────────────────────

def select_best_node(model_id: str = "", preferred_region: str = "") -> Optional[dict]:
    """Select the best node for inference using reputation-weighted load balancing.

    Algorithm:
    1. Filter nodes that are active and serve the requested model (if specified)
    2. Score each node: reputation * (1 / (1 + recent_load))
    3. Return the highest-scoring node

    Returns None if no suitable node is found.
    """
    nodes = store_gguf.list_nodes()
    active_nodes = [n for n in nodes if n.get("status") == "active" and n.get("inference_url")]

    if not active_nodes:
        return None

    # Filter by model if specified
    if model_id:
        model_serving = [n for n in active_nodes if model_id in n.get("models", [])]
        if model_serving:
            active_nodes = model_serving

    # Filter by region if specified
    if preferred_region:
        region_nodes = [n for n in active_nodes if n.get("region") == preferred_region]
        if region_nodes:
            active_nodes = region_nodes

    # Score each node
    _init_reputation_tables()
    conn = store_gguf._get_conn()

    scored = []
    for node in active_nodes:
        rep = get_reputation(node["node_id"])
        reputation = rep.get("reputation_score", 0.5)
        # Lower reputation = lower score
        # Also factor in recent load (total requests in reputation table)
        recent_load = rep.get("total_requests", 0)
        load_factor = 1 / (1 + (recent_load / 100))  # Diminishing returns after 100 requests
        score = reputation * load_factor
        scored.append({
            "node": node,
            "reputation": reputation,
            "load_factor": load_factor,
            "score": score,
        })

    # Sort by score descending
    scored.sort(key=lambda x: x["score"], reverse=True)

    if scored:
        best = scored[0]
        return {
            **best["node"],
            "_selection_score": best["score"],
            "_reputation": best["reputation"],
            "_load_factor": best["load_factor"],
        }

    return None


# ─── Node Operator Marketplace ─────────────────────────────────────

class NodeOperatorRegistration:
    """Data for registering a third-party node operator."""

    def __init__(
        self,
        node_id: str,
        name: str,
        inference_url: str,
        models: list[str] = None,
        region: str = "unknown",
        capabilities: dict = None,
        pricing_per_1k_tokens: float = 0.001,
    ):
        self.node_id = node_id
        self.name = name
        self.inference_url = inference_url
        self.models = models or []
        self.region = region
        self.capabilities = capabilities or {}
        self.pricing_per_1k_tokens = pricing_per_1k_tokens


def register_operator_node(
    node_id: str,
    name: str,
    inference_url: str,
    models: list[str] = None,
    region: str = "unknown",
    capabilities: dict = None,
    pricing_per_1k_tokens: float = 0.001,
) -> dict:
    """Register a third-party node operator in the marketplace."""
    # Register the node in the existing node table
    node = store_gguf.register_node({
        "node_id": node_id,
        "name": name,
        "models": models or [],
        "inference_url": inference_url,
        "tracker_url": "",
        "capabilities": {
            **(capabilities or {}),
            "operator_type": "third_party",
            "pricing_per_1k_tokens": pricing_per_1k_tokens,
        },
        "region": region,
    })

    # Initialize reputation
    _init_reputation_tables()
    rep = get_reputation(node_id)
    if rep["total_requests"] == 0:
        # New node starts with neutral reputation
        conn = store_gguf._get_conn()
        conn.execute(
            """INSERT OR REPLACE INTO node_reputation
               (node_id, total_requests, successful_requests, failed_requests,
                avg_latency_ms, reputation_score, credits_earned, credits_spent,
                uptime_percentage, created_at, updated_at)
               VALUES (?, 0, 0, 0, 0, 0.5, 0, 0, 100.0, ?, ?)""",
            (node_id, _utc_now(), _utc_now())
        )
        conn.commit()

    return {
        "node": node,
        "reputation": get_reputation(node_id),
        "marketplace_status": "registered",
    }


def get_marketplace_overview() -> dict:
    """Get an overview of the inference marketplace."""
    nodes = store_gguf.list_nodes()
    reputations = get_all_reputations()

    # Separate first-party and third-party nodes
    first_party = []
    third_party = []
    for n in nodes:
        caps = n.get("capabilities", {})
        if caps.get("operator_type") == "third_party":
            third_party.append(n)
        else:
            first_party.append(n)

    # Aggregate stats
    total_requests = sum(r.get("total_requests", 0) for r in reputations)
    total_successful = sum(r.get("successful_requests", 0) for r in reputations)
    total_credits = sum(r.get("credits_earned", 0) for r in reputations)
    avg_reputation = sum(r.get("reputation_score", 0) for r in reputations) / max(1, len(reputations))

    return {
        "total_nodes": len(nodes),
        "first_party_nodes": len(first_party),
        "third_party_nodes": len(third_party),
        "active_nodes": len([n for n in nodes if n.get("status") == "active"]),
        "total_requests": total_requests,
        "total_successful": total_successful,
        "success_rate": total_successful / max(1, total_requests),
        "total_credits_earned": total_credits,
        "avg_reputation": round(avg_reputation, 3),
        "nodes": [
            {
                "node_id": n["node_id"],
                "name": n["name"],
                "region": n["region"],
                "status": n["status"],
                "inference_url": n["inference_url"],
                "models": n.get("models", []),
                "operator_type": n.get("capabilities", {}).get("operator_type", "first_party"),
                "pricing": n.get("capabilities", {}).get("pricing_per_1k_tokens", 0),
            }
            for n in nodes
        ],
        "reputation_leaderboard": sorted(
            reputations,
            key=lambda r: r.get("reputation_score", 0),
            reverse=True,
        )[:10],
    }


def spend_credits(node_id: str, amount: float, description: str = "") -> dict:
    """Spend credits from a node operator's account (e.g., for platform fees)."""
    _init_reputation_tables()
    conn = store_gguf._get_conn()
    now = _utc_now()

    conn.execute(
        "UPDATE node_reputation SET credits_spent = credits_spent + ?, updated_at = ? WHERE node_id = ?",
        (amount, now, node_id)
    )

    cid = str(uuid4())
    conn.execute(
        "INSERT INTO node_credits (id, node_id, amount, type, description, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        (cid, node_id, amount, "spent", description, now)
    )
    conn.commit()

    return get_reputation(node_id)


def get_credit_history(node_id: str, limit: int = 50) -> list[dict]:
    """Get credit transaction history for a node."""
    _init_reputation_tables()
    conn = store_gguf._get_conn()
    rows = conn.execute(
        "SELECT * FROM node_credits WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?",
        (node_id, limit)
    ).fetchall()
    return [dict(r) for r in rows]
