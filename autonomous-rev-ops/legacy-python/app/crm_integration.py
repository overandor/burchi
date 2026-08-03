"""Consent platform → CRM integration.

Syncs consent-verified contacts to HubSpot, Salesforce, and Pipedrive.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


CRM_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS crm_connections (
    id TEXT PRIMARY KEY,
    crm_type TEXT NOT NULL,
    name TEXT NOT NULL,
    api_key TEXT DEFAULT '',
    api_url TEXT DEFAULT '',
    sync_enabled TEXT DEFAULT 'true',
    last_sync TEXT DEFAULT '',
    total_synced INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS crm_sync_log (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    record_type TEXT NOT NULL,
    external_id TEXT DEFAULT '',
    action TEXT DEFAULT 'create',
    status TEXT DEFAULT 'success',
    data TEXT DEFAULT '{}',
    synced_at TEXT
);
"""

_crm_initialized = False


def _init_crm_tables():
    global _crm_initialized
    if _crm_initialized:
        return
    conn = store._get_conn()
    conn.executescript(CRM_TABLES_SQL)
    conn.commit()
    _crm_initialized = True


def add_crm_connection(crm_type: str, name: str, api_key: str = "", api_url: str = "") -> dict:
    """Add a CRM connection."""
    _init_crm_tables()
    conn = store._get_conn()
    cid = str(uuid4())
    now = _utc_now()
    conn.execute(
        "INSERT INTO crm_connections (id, crm_type, name, api_key, api_url, sync_enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (cid, crm_type, name, api_key, api_url, "true", now, now)
    )
    conn.commit()
    return get_crm_connection(cid)


def get_crm_connection(cid: str) -> dict | None:
    _init_crm_tables()
    conn = store._get_conn()
    row = conn.execute("SELECT * FROM crm_connections WHERE id = ?", (cid,)).fetchone()
    return dict(row) if row else None


def list_crm_connections() -> list[dict]:
    _init_crm_tables()
    conn = store._get_conn()
    rows = conn.execute("SELECT * FROM crm_connections ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def _get_consent_contacts(limit: int = 50) -> list[dict]:
    """Get consent-verified contacts, handling missing table gracefully."""
    _init_crm_tables()
    conn = store._get_conn()
    try:
        rows = conn.execute("SELECT * FROM consent_contacts WHERE consent_status = 'verified' LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        # Table doesn't exist — return empty list
        return []


def _http_request(url: str, headers: dict = None, method: str = "GET", body: bytes = None, timeout: int = 15) -> dict:
    """Make a real HTTP request to a CRM API."""
    import urllib.request
    import urllib.error
    req = urllib.request.Request(url, headers=headers or {}, method=method)
    if body:
        req.data = body
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"ok": True, "status": resp.status, "data": json.loads(resp.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8")[:500]
        except Exception:
            pass
        return {"ok": False, "status": e.code, "error": err_body or str(e)}
    except Exception as e:
        return {"ok": False, "status": 0, "error": str(e)}


def sync_to_hubspot(connection_id: str, contacts: list[dict] = None) -> dict:
    """Sync contacts to HubSpot CRM via the real HubSpot API.

    Requires the connection's api_key to be a valid HubSpot access token.
    """
    _init_crm_tables()
    conn = store._get_conn()

    connection = get_crm_connection(connection_id)
    if not connection:
        return {"ok": False, "error": "Connection not found"}

    api_key = connection.get("api_key", "")
    if not api_key:
        return {"ok": False, "error": "No HubSpot API key configured for this connection"}

    if not contacts:
        contacts = _get_consent_contacts()

    if not contacts:
        return {"ok": True, "crm": "hubspot", "synced": 0, "total_contacts": 0, "message": "No consent-verified contacts to sync"}

    synced = 0
    errors = 0
    for contact in contacts:
        hubspot_contact = {
            "properties": {
                "email": contact.get("email", ""),
                "firstname": contact.get("name", "").split()[0] if contact.get("name") else "",
                "lastname": " ".join(contact.get("name", "").split()[1:]) if contact.get("name") else "",
                "phone": contact.get("phone", ""),
                "lifecyclestage": "lead",
            }
        }

        # Real HubSpot API call
        result = _http_request(
            "https://api.hubapi.com/crm/v3/objects/contacts",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
            body=json.dumps(hubspot_contact).encode("utf-8"),
        )

        status = "success" if result["ok"] else "failed"
        external_id = result["data"].get("id", "") if result["ok"] else ""
        log_data = hubspot_contact if result["ok"] else {"error": result.get("error", ""), "payload": hubspot_contact}

        log_id = str(uuid4())
        conn.execute(
            "INSERT INTO crm_sync_log (id, connection_id, record_type, external_id, action, status, data, synced_at) VALUES (?,?,?,?,?,?,?,?)",
            (log_id, connection_id, "contact", external_id or contact.get("email", ""), "create", status, json.dumps(log_data), _utc_now())
        )
        if result["ok"]:
            synced += 1
        else:
            errors += 1

    conn.execute("UPDATE crm_connections SET last_sync = ?, total_synced = total_synced + ? WHERE id = ?", (_utc_now(), synced, connection_id))
    conn.commit()

    return {"ok": True, "crm": "hubspot", "synced": synced, "errors": errors, "total_contacts": len(contacts)}


def sync_to_salesforce(connection_id: str, contacts: list[dict] = None) -> dict:
    """Sync contacts to Salesforce CRM via the real Salesforce REST API.

    Requires the connection's api_key to be a valid Salesforce session token
    and api_url to be the Salesforce instance URL.
    """
    _init_crm_tables()
    conn = store._get_conn()

    connection = get_crm_connection(connection_id)
    if not connection:
        return {"ok": False, "error": "Connection not found"}

    api_key = connection.get("api_key", "")
    api_url = connection.get("api_url", "")
    if not api_key or not api_url:
        return {"ok": False, "error": "No Salesforce API key or instance URL configured"}

    if not contacts:
        contacts = _get_consent_contacts()

    if not contacts:
        return {"ok": True, "crm": "salesforce", "synced": 0, "total_contacts": 0, "message": "No consent-verified contacts to sync"}

    synced = 0
    errors = 0
    for contact in contacts:
        salesforce_contact = {
            "FirstName": contact.get("name", "").split()[0] if contact.get("name") else "",
            "LastName": " ".join(contact.get("name", "").split()[1:]) if contact.get("name") else "",
            "Email": contact.get("email", ""),
            "Phone": contact.get("phone", ""),
            "LeadSource": "Consent Platform",
        }

        # Real Salesforce API call
        result = _http_request(
            f"{api_url}/services/data/v58.0/sobjects/Contact",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
            body=json.dumps(salesforce_contact).encode("utf-8"),
        )

        status = "success" if result["ok"] else "failed"
        external_id = result["data"].get("id", "") if result["ok"] else ""
        log_data = salesforce_contact if result["ok"] else {"error": result.get("error", ""), "payload": salesforce_contact}

        log_id = str(uuid4())
        conn.execute(
            "INSERT INTO crm_sync_log (id, connection_id, record_type, external_id, action, status, data, synced_at) VALUES (?,?,?,?,?,?,?,?)",
            (log_id, connection_id, "contact", external_id or contact.get("email", ""), "create", status, json.dumps(log_data), _utc_now())
        )
        if result["ok"]:
            synced += 1
        else:
            errors += 1

    conn.execute("UPDATE crm_connections SET last_sync = ?, total_synced = total_synced + ? WHERE id = ?", (_utc_now(), synced, connection_id))
    conn.commit()

    return {"ok": True, "crm": "salesforce", "synced": synced, "errors": errors, "total_contacts": len(contacts)}


def sync_to_pipedrive(connection_id: str, contacts: list[dict] = None) -> dict:
    """Sync contacts to Pipedrive CRM via the real Pipedrive API.

    Requires the connection's api_key to be a valid Pipedrive API token.
    """
    _init_crm_tables()
    conn = store._get_conn()

    connection = get_crm_connection(connection_id)
    if not connection:
        return {"ok": False, "error": "Connection not found"}

    api_key = connection.get("api_key", "")
    if not api_key:
        return {"ok": False, "error": "No Pipedrive API key configured for this connection"}

    if not contacts:
        contacts = _get_consent_contacts()

    if not contacts:
        return {"ok": True, "crm": "pipedrive", "synced": 0, "total_contacts": 0, "message": "No consent-verified contacts to sync"}

    synced = 0
    errors = 0
    for contact in contacts:
        pipedrive_person = {
            "name": contact.get("name", ""),
            "email": [{"value": contact.get("email", ""), "primary": True}],
            "phone": [{"value": contact.get("phone", ""), "primary": True}],
        }

        # Real Pipedrive API call
        result = _http_request(
            f"https://api.pipedrive.com/v1/persons?api_token={api_key}",
            headers={"Content-Type": "application/json"},
            method="POST",
            body=json.dumps(pipedrive_person).encode("utf-8"),
        )

        status = "success" if result["ok"] else "failed"
        external_id = str(result["data"].get("data", {}).get("id", "")) if result["ok"] else ""
        log_data = pipedrive_person if result["ok"] else {"error": result.get("error", ""), "payload": pipedrive_person}

        log_id = str(uuid4())
        conn.execute(
            "INSERT INTO crm_sync_log (id, connection_id, record_type, external_id, action, status, data, synced_at) VALUES (?,?,?,?,?,?,?,?)",
            (log_id, connection_id, "contact", external_id or contact.get("email", ""), "create", status, json.dumps(log_data), _utc_now())
        )
        if result["ok"]:
            synced += 1
        else:
            errors += 1

    conn.execute("UPDATE crm_connections SET last_sync = ?, total_synced = total_synced + ? WHERE id = ?", (_utc_now(), synced, connection_id))
    conn.commit()

    return {"ok": True, "crm": "pipedrive", "synced": synced, "errors": errors, "total_contacts": len(contacts)}


def sync_all() -> dict:
    """Sync to all enabled CRM connections."""
    connections = list_crm_connections()
    results = []

    for conn_data in connections:
        if conn_data["sync_enabled"] != "true":
            continue

        crm_type = conn_data["crm_type"]
        conn_id = conn_data["id"]

        if crm_type == "hubspot":
            result = sync_to_hubspot(conn_id)
        elif crm_type == "salesforce":
            result = sync_to_salesforce(conn_id)
        elif crm_type == "pipedrive":
            result = sync_to_pipedrive(conn_id)
        else:
            result = {"ok": False, "error": f"Unknown CRM type: {crm_type}"}

        results.append({"crm": crm_type, "result": result})

    return {"ok": True, "connections_synced": len(results), "results": results}


def get_sync_log(connection_id: str, limit: int = 50) -> list[dict]:
    """Get sync log for a CRM connection."""
    _init_crm_tables()
    conn = store._get_conn()
    rows = conn.execute(
        "SELECT * FROM crm_sync_log WHERE connection_id = ? ORDER BY synced_at DESC LIMIT ?",
        (connection_id, limit)
    ).fetchall()
    return [dict(r) for r in rows]
