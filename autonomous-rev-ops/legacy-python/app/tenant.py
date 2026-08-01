"""Multi-tenant architecture — per-tenant data isolation and billing.

Adds tenant isolation to the RevOps backend:
  1. Tenants table — each tenant represents a separate business/user
  2. tenant_id column on all data tables — scopes all queries
  3. Tenant management API — create, list, update tenants
  4. Billing integration — track inference usage and platform access per tenant
  5. API key → tenant mapping — each API key belongs to a tenant

All existing endpoints work in single-tenant mode (tenant_id = 'default')
for backward compatibility.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from . import store


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Tenant Management ─────────────────────────────────────────────

def init_tenant_tables() -> None:
    """Create tenant-related tables if they don't exist."""
    conn = store._get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        plan TEXT DEFAULT 'free',
        status TEXT DEFAULT 'active',
        stripe_customer_id TEXT DEFAULT '',
        stripe_subscription_id TEXT DEFAULT '',
        inference_quota INTEGER DEFAULT 1000,
        inference_used INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tenant_usage (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        amount INTEGER DEFAULT 1,
        cost_cents INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        label TEXT DEFAULT '',
        scopes TEXT DEFAULT '[]',
        status TEXT DEFAULT 'active',
        created_at TEXT,
        last_used TEXT
    );
    """)

    # Add tenant_id column to existing tables (if not exists)
    tables_to_migrate = [
        "telemetry", "visitors", "experiments", "variants", "content_items",
        "decisions", "receipts", "kpi_snapshots", "actions", "control_state", "live_events"
    ]
    for table in tables_to_migrate:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN tenant_id TEXT DEFAULT 'default'")
        except Exception:
            pass  # Column already exists

    # Create default tenant if not exists
    existing = conn.execute("SELECT id FROM tenants WHERE id = 'default'").fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO tenants (id, name, slug, plan, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("default", "Default Tenant", "default", "free", "active", _utc_now(), _utc_now())
        )

    conn.commit()


def create_tenant(name: str, slug: str, plan: str = "free") -> dict:
    """Create a new tenant."""
    init_tenant_tables()
    conn = store._get_conn()
    tid = str(uuid4())
    now = _utc_now()

    # Check slug uniqueness
    existing = conn.execute("SELECT id FROM tenants WHERE slug = ?", (slug,)).fetchone()
    if existing:
        raise ValueError(f"Tenant slug '{slug}' already exists")

    conn.execute(
        "INSERT INTO tenants (id, name, slug, plan, status, inference_quota, inference_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (tid, name, slug, plan, "active", 1000 if plan == "free" else 100000, 0, now, now)
    )
    conn.commit()

    return get_tenant(tid)


def get_tenant(tid: str) -> Optional[dict]:
    """Get a tenant by ID."""
    init_tenant_tables()
    conn = store._get_conn()
    row = conn.execute("SELECT * FROM tenants WHERE id = ?", (tid,)).fetchone()
    return dict(row) if row else None


def get_tenant_by_slug(slug: str) -> Optional[dict]:
    """Get a tenant by slug."""
    init_tenant_tables()
    conn = store._get_conn()
    row = conn.execute("SELECT * FROM tenants WHERE slug = ?", (slug,)).fetchone()
    return dict(row) if row else None


def list_tenants() -> list[dict]:
    """List all tenants."""
    init_tenant_tables()
    conn = store._get_conn()
    rows = conn.execute("SELECT * FROM tenants ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def update_tenant(tid: str, data: dict) -> Optional[dict]:
    """Update tenant fields."""
    init_tenant_tables()
    conn = store._get_conn()
    fields = []
    values = []
    for k in ["name", "plan", "status", "stripe_customer_id", "stripe_subscription_id", "inference_quota"]:
        if k in data:
            fields.append(f"{k} = ?")
            values.append(data[k])
    if fields:
        fields.append("updated_at = ?")
        values.append(_utc_now())
        values.append(tid)
        conn.execute(f"UPDATE tenants SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    return get_tenant(tid)


def delete_tenant(tid: str) -> bool:
    """Delete a tenant (cannot delete default tenant)."""
    if tid == "default":
        raise ValueError("Cannot delete the default tenant")
    init_tenant_tables()
    conn = store._get_conn()
    conn.execute("DELETE FROM tenants WHERE id = ?", (tid,))
    conn.execute("DELETE FROM api_keys WHERE tenant_id = ?", (tid,))
    conn.commit()
    return True


# ─── Usage Tracking & Billing ──────────────────────────────────────

def record_usage(tenant_id: str, resource_type: str, amount: int = 1, cost_cents: int = 0, metadata: dict = None) -> dict:
    """Record resource usage for a tenant."""
    init_tenant_tables()
    conn = store._get_conn()
    uid = str(uuid4())
    now = _utc_now()

    conn.execute(
        "INSERT INTO tenant_usage (id, tenant_id, resource_type, amount, cost_cents, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (uid, tenant_id, resource_type, amount, cost_cents, json.dumps(metadata or {}), now)
    )

    # Increment inference usage counter
    if resource_type == "inference":
        conn.execute(
            "UPDATE tenants SET inference_used = inference_used + ? WHERE id = ?",
            (amount, tenant_id)
        )

    conn.commit()
    return {"id": uid, "tenant_id": tenant_id, "resource_type": resource_type, "amount": amount, "cost_cents": cost_cents}


def get_tenant_usage(tenant_id: str, limit: int = 100) -> list[dict]:
    """Get usage records for a tenant."""
    init_tenant_tables()
    conn = store._get_conn()
    rows = conn.execute(
        "SELECT * FROM tenant_usage WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT ?",
        (tenant_id, limit)
    ).fetchall()
    return [dict(r) for r in rows]


def get_tenant_usage_summary(tenant_id: str) -> dict:
    """Get usage summary for a tenant."""
    init_tenant_tables()
    conn = store._get_conn()
    tenant = get_tenant(tenant_id)
    if not tenant:
        return {"error": "Tenant not found"}

    # Aggregate usage by resource type
    rows = conn.execute(
        "SELECT resource_type, SUM(amount) as total_amount, SUM(cost_cents) as total_cost FROM tenant_usage WHERE tenant_id = ? GROUP BY resource_type",
        (tenant_id,)
    ).fetchall()

    usage_by_type = {r["resource_type"]: {"amount": r["total_amount"], "cost_cents": r["total_cost"]} for r in rows}

    return {
        "tenant_id": tenant_id,
        "tenant_name": tenant["name"],
        "plan": tenant["plan"],
        "inference_quota": tenant["inference_quota"],
        "inference_used": tenant["inference_used"],
        "inference_remaining": max(0, tenant["inference_quota"] - tenant["inference_used"]),
        "usage_by_type": usage_by_type,
        "usage_percentage": round((tenant["inference_used"] / max(1, tenant["inference_quota"])) * 100, 2),
    }


# ─── API Key Management ────────────────────────────────────────────

def create_api_key(tenant_id: str, label: str = "", scopes: list = None) -> dict:
    """Create a new API key for a tenant."""
    import hashlib
    init_tenant_tables()
    conn = store._get_conn()
    kid = str(uuid4())
    raw_key = f"aro_{kid.replace('-', '')}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    now = _utc_now()

    conn.execute(
        "INSERT INTO api_keys (id, tenant_id, key_hash, label, scopes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (kid, tenant_id, key_hash, label, json.dumps(scopes or ["read", "write"]), "active", now)
    )
    conn.commit()

    return {
        "id": kid,
        "tenant_id": tenant_id,
        "key": raw_key,  # Only returned once at creation
        "label": label,
        "scopes": scopes or ["read", "write"],
        "status": "active",
        "created_at": now,
    }


def verify_api_key(raw_key: str) -> Optional[dict]:
    """Verify an API key and return the associated tenant."""
    import hashlib
    if not raw_key or not raw_key.startswith("aro_"):
        return None

    init_tenant_tables()
    conn = store._get_conn()
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    row = conn.execute("SELECT * FROM api_keys WHERE key_hash = ? AND status = 'active'", (key_hash,)).fetchone()
    if not row:
        return None

    # Update last_used
    conn.execute("UPDATE api_keys SET last_used = ? WHERE id = ?", (_utc_now(), row["id"]))
    conn.commit()

    tenant = get_tenant(row["tenant_id"])
    if not tenant or tenant["status"] != "active":
        return None

    return {
        "key_id": row["id"],
        "tenant_id": row["tenant_id"],
        "tenant": tenant,
        "scopes": json.loads(row["scopes"]),
    }


def list_api_keys(tenant_id: str) -> list[dict]:
    """List API keys for a tenant (without the key hashes)."""
    init_tenant_tables()
    conn = store._get_conn()
    rows = conn.execute(
        "SELECT id, tenant_id, label, scopes, status, created_at, last_used FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC",
        (tenant_id,)
    ).fetchall()
    return [dict(r) for r in rows]


# ─── Tenant Context ────────────────────────────────────────────────

_DEFAULT_TENANT = "default"

def get_tenant_id_from_request(request) -> str:
    """Extract tenant ID from request headers or query params.

    Priority:
    1. X-Tenant-ID header
    2. tenant_id query parameter
    3. Authorization Bearer token → API key → tenant
    4. 'default' (backward compatibility)
    """
    # Check header
    tenant_id = request.headers.get("x-tenant-id", "")
    if tenant_id:
        return tenant_id

    # Check query param
    tenant_id = request.query_params.get("tenant_id", "")
    if tenant_id:
        return tenant_id

    # Check API key
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        key = auth[7:]
        key_info = verify_api_key(key)
        if key_info:
            return key_info["tenant_id"]

    return _DEFAULT_TENANT
