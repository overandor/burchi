"""Open API platform — public API, webhooks, and SDKs.

Features:
  1. Public API documentation and OpenAPI spec
  2. Webhook management — register, test, deliver events
  3. SDK generation info — Python, JavaScript, Go
  4. Rate limiting and API key management (uses tenant system)
"""

from __future__ import annotations

import json
import time
import hashlib
import hmac
import urllib.request
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store, tenant


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


WEBHOOK_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT DEFAULT 'default',
    url TEXT NOT NULL,
    events TEXT DEFAULT '[]',
    secret TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TEXT,
    last_triggered TEXT DEFAULT '',
    total_delivered INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    response_status INTEGER DEFAULT 0,
    response_body TEXT DEFAULT '',
    delivered_at TEXT,
    success INTEGER DEFAULT 0
);
"""

_webhook_initialized = False


def _init_webhook_tables():
    global _webhook_initialized
    if _webhook_initialized:
        return
    conn = store._get_conn()
    conn.executescript(WEBHOOK_TABLES_SQL)
    conn.commit()
    _webhook_initialized = True


# ─── Webhook Management ────────────────────────────────────────────

def register_webhook(url: str, events: list[str] = None, tenant_id: str = "default", secret: str = "") -> dict:
    """Register a new webhook endpoint."""
    _init_webhook_tables()
    conn = store._get_conn()
    wid = str(uuid4())
    now = _utc_now()

    if not secret:
        secret = hashlib.sha256(str(uuid4()).encode()).hexdigest()[:32]

    conn.execute(
        """INSERT INTO webhooks (id, tenant_id, url, events, secret, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (wid, tenant_id, url, json.dumps(events or ["*"]), secret, "active", now)
    )
    conn.commit()

    return {"id": wid, "url": url, "events": events or ["*"], "secret": secret, "status": "active"}


def list_webhooks(tenant_id: str = "default") -> list[dict]:
    """List webhooks for a tenant."""
    _init_webhook_tables()
    conn = store._get_conn()
    rows = conn.execute("SELECT * FROM webhooks WHERE tenant_id = ? ORDER BY created_at DESC", (tenant_id,)).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["events"] = json.loads(d["events"]) if d["events"] else []
        d.pop("secret", None)  # Don't expose secret
        result.append(d)
    return result


def delete_webhook(wid: str) -> bool:
    """Delete a webhook."""
    _init_webhook_tables()
    conn = store._get_conn()
    cur = conn.execute("DELETE FROM webhooks WHERE id = ?", (wid,))
    conn.commit()
    return cur.rowcount > 0


def deliver_webhook(webhook_id: str, event_type: str, payload: dict) -> dict:
    """Deliver an event to a webhook endpoint."""
    _init_webhook_tables()
    conn = store._get_conn()

    webhook = conn.execute("SELECT * FROM webhooks WHERE id = ?", (webhook_id,)).fetchone()
    if not webhook:
        return {"error": "Webhook not found"}

    events = json.loads(webhook["events"]) if webhook["events"] else []
    if "*" not in events and event_type not in events:
        return {"skipped": True, "reason": "Event not subscribed"}

    # Create delivery record
    did = str(uuid4())
    payload_json = json.dumps({"event": event_type, "data": payload, "timestamp": _utc_now()})

    # Sign the payload
    signature = hmac.new(webhook["secret"].encode(), payload_json.encode(), hashlib.sha256).hexdigest()

    # Attempt real HTTP delivery to the webhook URL
    success = False
    response_status = 0
    response_body = ""

    try:
        req = urllib.request.Request(
            webhook["url"],
            data=payload_json.encode(),
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Signature": signature,
                "X-Webhook-Event": event_type,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            response_status = resp.status
            response_body = resp.read().decode("utf-8", errors="replace")[:500]
            success = 200 <= response_status < 300
    except urllib.error.HTTPError as e:
        response_status = e.code
        try:
            response_body = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            response_body = str(e)
        success = False
    except Exception as e:
        response_status = 0
        response_body = str(e)
        success = False

    # Record delivery
    conn.execute(
        """INSERT INTO webhook_deliveries
           (id, webhook_id, event_type, payload, response_status, response_body, delivered_at, success)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (did, webhook_id, event_type, payload_json, response_status, response_body, _utc_now(), 1 if success else 0)
    )

    # Update webhook stats
    if success:
        conn.execute("UPDATE webhooks SET total_delivered = total_delivered + 1, last_triggered = ? WHERE id = ?", (_utc_now(), webhook_id))
    else:
        conn.execute("UPDATE webhooks SET total_failed = total_failed + 1, last_triggered = ? WHERE id = ?", (_utc_now(), webhook_id))

    conn.commit()

    return {
        "id": did,
        "webhook_id": webhook_id,
        "event_type": event_type,
        "success": success,
        "response_status": response_status,
    }


def trigger_event(event_type: str, payload: dict, tenant_id: str = "default") -> dict:
    """Trigger an event to all subscribed webhooks for a tenant."""
    _init_webhook_tables()
    conn = store._get_conn()

    webhooks = conn.execute("SELECT * FROM webhooks WHERE tenant_id = ? AND status = 'active'", (tenant_id,)).fetchall()

    deliveries = []
    for wh in webhooks:
        events = json.loads(wh["events"]) if wh["events"] else []
        if "*" in events or event_type in events:
            result = deliver_webhook(wh["id"], event_type, payload)
            deliveries.append(result)

    return {
        "event_type": event_type,
        "webhooks_triggered": len(deliveries),
        "deliveries": deliveries,
    }


# ─── OpenAPI Spec ──────────────────────────────────────────────────

def get_openapi_spec(base_url: str = "https://autonomous-rev-ops.vercel.app") -> dict:
    """Generate OpenAPI 3.0 spec for the public API."""
    return {
        "openapi": "3.0.0",
        "info": {
            "title": "Unified Revenue Operations Platform API",
            "version": "1.0.0",
            "description": "Autonomous revenue operations platform with AI-powered optimization",
        },
        "servers": [{"url": base_url}],
        "components": {
            "securitySchemes": {
                "ApiKeyAuth": {
                    "type": "apiKey",
                    "in": "header",
                    "name": "Authorization",
                    "description": "Bearer token: 'Bearer aro_xxx'",
                }
            }
        },
        "paths": {
            "/v1/chat/completions": {
                "post": {"summary": "Chat completion via HF Compiler", "tags": ["Inference"]},
            },
            "/api/tenants": {
                "get": {"summary": "List tenants", "tags": ["Multi-Tenant"]},
                "post": {"summary": "Create tenant", "tags": ["Multi-Tenant"]},
            },
            "/api/marketplace/overview": {
                "get": {"summary": "Marketplace overview", "tags": ["Marketplace"]},
            },
            "/api/intent/score-all": {
                "get": {"summary": "Score all visitors", "tags": ["Intent"]},
            },
            "/api/autonomous/cycle": {
                "post": {"summary": "Run autonomous cycle", "tags": ["Autonomous"]},
            },
            "/api/competitor/analyze-all": {
                "get": {"summary": "Analyze all competitors", "tags": ["Competitor AI"]},
            },
            "/api/multimodal/campaign": {
                "get": {"summary": "Generate multi-modal campaign", "tags": ["Multi-Modal"]},
            },
            "/api/federated/status": {
                "get": {"summary": "Federated learning status", "tags": ["Federated"]},
            },
        },
    }


# ─── SDK Information ───────────────────────────────────────────────

def get_sdk_info() -> dict:
    """Get SDK installation and usage information."""
    return {
        "sdks": {
            "python": {
                "install": "pip install autonomous-rev-ops",
                "usage": "from aro import Client\nclient = Client(api_key='aro_xxx')\nresult = client.chat.completions.create(model='qwen2-0.5b-q3k', messages=[...])",
            },
            "javascript": {
                "install": "npm install @autonomous-rev-ops/client",
                "usage": "import { Client } from '@autonomous-rev-ops/client'\nconst client = new Client({ apiKey: 'aro_xxx' })\nconst result = await client.chat.completions.create({...})",
            },
            "go": {
                "install": "go get github.com/autonomous-rev-ops/go-client",
                "usage": "client := aro.NewClient('aro_xxx')\nresult, err := client.Chat.Completions.Create(...)",
            },
        },
        "webhooks": {
            "events": [
                "visitor.high_intent", "experiment.completed", "decision.auto_approved",
                "competitor.change_detected", "deployment.completed", "federated.round_completed",
            ],
            "signature_header": "X-Webhook-Signature",
            "signature_algorithm": "HMAC-SHA256",
        },
        "rate_limits": {
            "free": "100 requests/hour",
            "pro": "10,000 requests/hour",
            "enterprise": "Unlimited",
        },
    }
