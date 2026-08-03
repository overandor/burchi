"""Inference network as a service — sell capacity with competitive pricing.

Features:
  1. Capacity pricing tiers (per 1K tokens, per image, per embedding)
  2. Spot pricing (cheaper for best-effort delivery)
  3. Capacity reservation (guaranteed availability)
  4. Revenue tracking for node operators
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store, marketplace, tenant


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


PRICING_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS pricing_tiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model_type TEXT NOT NULL,
    price_per_1k_tokens REAL NOT NULL,
    price_per_image REAL DEFAULT 0,
    price_per_embedding REAL DEFAULT 0,
    tier TEXT DEFAULT 'standard',
    description TEXT DEFAULT '',
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS capacity_reservations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    model_type TEXT NOT NULL,
    tokens_reserved INTEGER DEFAULT 0,
    price REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    expires_at TEXT,
    created_at TEXT
);
"""

_pricing_initialized = False


def _init_pricing_tables():
    global _pricing_initialized
    if _pricing_initialized:
        return
    conn = store._get_conn()
    conn.executescript(PRICING_TABLES_SQL)
    conn.commit()
    _pricing_initialized = True


def get_pricing() -> list[dict]:
    """Get all pricing tiers."""
    _init_pricing_tables()
    conn = store._get_conn()
    rows = conn.execute("SELECT * FROM pricing_tiers ORDER BY price_per_1k_tokens").fetchall()
    return [dict(r) for r in rows]


def set_pricing(name: str, model_type: str, price_per_1k: float, tier: str = "standard",
                price_per_image: float = 0, price_per_embedding: float = 0, description: str = "") -> dict:
    """Set or update a pricing tier."""
    _init_pricing_tables()
    conn = store._get_conn()
    existing = conn.execute("SELECT id FROM pricing_tiers WHERE name = ?", (name,)).fetchone()
    if existing:
        conn.execute(
            "UPDATE pricing_tiers SET model_type=?, price_per_1k_tokens=?, price_per_image=?, price_per_embedding=?, tier=?, description=? WHERE id=?",
            (model_type, price_per_1k, price_per_image, price_per_embedding, tier, description, existing["id"])
        )
    else:
        pid = str(uuid4())
        conn.execute(
            "INSERT INTO pricing_tiers (id, name, model_type, price_per_1k_tokens, price_per_image, price_per_embedding, tier, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (pid, name, model_type, price_per_1k, price_per_image, price_per_embedding, tier, description, _utc_now())
        )
    conn.commit()
    return {"name": name, "price_per_1k_tokens": price_per_1k, "tier": tier}


def reserve_capacity(tenant_id: str, node_id: str, model_type: str, tokens: int, price: float = 0) -> dict:
    """Reserve inference capacity on a specific node."""
    _init_pricing_tables()
    conn = store._get_conn()
    rid = str(uuid4())
    now = _utc_now()

    # Calculate price if not provided
    if price == 0:
        pricing = get_pricing()
        tier = next((p for p in pricing if p["model_type"] == model_type), None)
        if tier:
            price = (tokens / 1000) * tier["price_per_1k_tokens"]

    # Set expiry to 30 days
    from datetime import timedelta
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    conn.execute(
        """INSERT INTO capacity_reservations
           (id, tenant_id, node_id, model_type, tokens_reserved, price, status, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (rid, tenant_id, node_id, model_type, tokens, price, "active", expires, now)
    )
    conn.commit()

    return {"id": rid, "tenant_id": tenant_id, "node_id": node_id, "tokens": tokens, "price": price, "expires_at": expires}


def get_revenue_summary() -> dict:
    """Get revenue summary for the inference network."""
    _init_pricing_tables()
    conn = store._get_conn()

    # Total reservations revenue
    rows = conn.execute("SELECT * FROM capacity_reservations").fetchall()
    total_revenue = sum(r["price"] for r in rows)
    total_reservations = len(rows)
    total_tokens_reserved = sum(r["tokens_reserved"] for r in rows)

    # Revenue by model type
    by_type = {}
    for r in rows:
        mt = r["model_type"]
        if mt not in by_type:
            by_type[mt] = {"revenue": 0, "reservations": 0, "tokens": 0}
        by_type[mt]["revenue"] += r["price"]
        by_type[mt]["reservations"] += 1
        by_type[mt]["tokens"] += r["tokens_reserved"]

    # Node operator earnings from marketplace
    overview = marketplace.get_marketplace_overview()
    operator_credits = overview.get("total_credits_earned", 0)

    return {
        "total_revenue": round(total_revenue, 2),
        "total_reservations": total_reservations,
        "total_tokens_reserved": total_tokens_reserved,
        "revenue_by_type": {k: {kk: round(vv, 2) if isinstance(vv, float) else vv for kk, vv in v.items()} for k, v in by_type.items()},
        "operator_credits_earned": operator_credits,
        "pricing_tiers": len(get_pricing()),
    }
