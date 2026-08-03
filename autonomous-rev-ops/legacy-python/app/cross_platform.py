"""Cross-platform ingestion — unified data pipeline from external sources.

Supports ingestion from:
  - Google Analytics (GA4 Data API)
  - Meta Ads (Facebook Marketing API)
  - Google Business Profile (Business Profile Performance API)
  - Yelp (Yelp Fusion API)
  - RubRatings (live scraping)

Each source has a real connector that calls the actual API using stored credentials.
No data is ever fabricated. If credentials are missing or the API call fails,
the ingestion returns an error.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from . import store


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── HTTP helper ───────────────────────────────────────────────────

def _http_request(url: str, headers: dict = None, method: str = "GET", body: bytes = None, timeout: int = 15) -> dict:
    """Make a real HTTP request and return the parsed response."""
    req = urllib.request.Request(url, headers=headers or {}, method=method)
    if body:
        req.data = body
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {
                "ok": True,
                "status": resp.status,
                "data": json.loads(resp.read().decode("utf-8")),
            }
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8")
        except Exception:
            pass
        return {"ok": False, "status": e.code, "error": err_body or str(e)}
    except Exception as e:
        return {"ok": False, "status": 0, "error": str(e)}


# ─── Ingestion Tables ──────────────────────────────────────────────

INGESTION_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS ingestion_sources (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    credentials TEXT DEFAULT '{}',
    status TEXT DEFAULT 'configured',
    last_ingested TEXT DEFAULT '',
    total_records INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_records (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    record_type TEXT NOT NULL,
    external_id TEXT DEFAULT '',
    data TEXT DEFAULT '{}',
    ingested_at TEXT
);
"""

_ingestion_initialized = False


def _init_ingestion_tables():
    global _ingestion_initialized
    if _ingestion_initialized:
        return
    conn = store._get_conn()
    conn.executescript(INGESTION_TABLES_SQL)
    conn.commit()
    _ingestion_initialized = True


# ─── Source Management ─────────────────────────────────────────────

def add_source(source_type: str, source_name: str, credentials: dict = None) -> dict:
    """Register a data source for ingestion with real credentials."""
    _init_ingestion_tables()
    conn = store._get_conn()
    sid = str(uuid4())
    now = _utc_now()
    conn.execute(
        "INSERT INTO ingestion_sources (id, source_type, source_name, credentials, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        (sid, source_type, source_name, json.dumps(credentials or {}), "configured", now, now)
    )
    conn.commit()
    return get_source(sid)


def get_source(sid: str) -> dict | None:
    _init_ingestion_tables()
    conn = store._get_conn()
    row = conn.execute("SELECT * FROM ingestion_sources WHERE id = ?", (sid,)).fetchone()
    return dict(row) if row else None


def list_sources() -> list[dict]:
    _init_ingestion_tables()
    conn = store._get_conn()
    rows = conn.execute("SELECT * FROM ingestion_sources ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def _get_credentials(source_id: str) -> dict:
    """Extract credentials from a source record."""
    source = get_source(source_id)
    if not source:
        return {}
    try:
        return json.loads(source.get("credentials", "{}"))
    except Exception:
        return {}


def _store_record(source_id: str, record_type: str, external_id: str, data: dict) -> str:
    """Store an ingestion record and update source stats."""
    conn = store._get_conn()
    rid = str(uuid4())
    conn.execute(
        "INSERT INTO ingestion_records (id, source_id, record_type, external_id, data, ingested_at) VALUES (?,?,?,?,?,?)",
        (rid, source_id, record_type, external_id, json.dumps(data), _utc_now())
    )
    conn.execute("UPDATE ingestion_sources SET last_ingested = ?, total_records = total_records + 1 WHERE id = ?", (_utc_now(), source_id))
    conn.commit()
    return rid


# ─── Google Analytics Connector (GA4 Data API) ─────────────────────

def ingest_google_analytics(source_id: str, data: dict = None) -> dict:
    """Ingest data from Google Analytics 4 via the Data API.

    Requires credentials: property_id, access_token (or service account JSON).
    If real data is passed directly (data param), it is stored as-is.
    """
    _init_ingestion_tables()

    # If data is provided directly (e.g., from a webhook or manual upload), store it
    if data:
        _store_record(source_id, "ga_metrics", data.get("dimensions", {}).get("date", ""), data)
        store.log_telemetry("ga_ingested", value=float(data.get("metrics", {}).get("sessions", 0)))
        return {"ok": True, "source": "google_analytics", "records": 1, "data": data}

    # Real GA4 Data API call
    creds = _get_credentials(source_id)
    property_id = creds.get("property_id", "")
    access_token = creds.get("access_token", "")

    if not property_id or not access_token:
        return {
            "ok": False,
            "source": "google_analytics",
            "error": "Missing credentials. Required: property_id, access_token. "
                     "Get an access token from Google OAuth2 with analytics.readonly scope.",
        }

    # GA4 Data API: run realtime report
    url = f"https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runRealtimeReport"
    body = json.dumps({
        "metrics": [
            {"name": "activeUsers"},
            {"name": "screenPageViews"},
            {"name": "conversions"},
        ],
    }).encode("utf-8")

    result = _http_request(
        url,
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        method="POST",
        body=body,
    )

    if not result["ok"]:
        return {"ok": False, "source": "google_analytics", "error": result.get("error", "GA4 API call failed"), "status": result.get("status")}

    ga_data = result["data"]
    rows = ga_data.get("rows", [])
    totals = ga_data.get("totals", [{}])
    metric_values = totals[0].get("values", []) if totals else []

    normalized = {
        "metrics": {
            "active_users": int(metric_values[0]) if len(metric_values) > 0 else 0,
            "pageviews": int(metric_values[1]) if len(metric_values) > 1 else 0,
            "conversions": int(metric_values[2]) if len(metric_values) > 2 else 0,
        },
        "dimensions": {"date": _utc_now()[:10]},
        "raw": ga_data,
    }

    _store_record(source_id, "ga_metrics", normalized["dimensions"]["date"], normalized)
    store.log_telemetry("ga_ingested", value=float(normalized["metrics"]["active_users"]))

    return {"ok": True, "source": "google_analytics", "records": 1, "data": normalized}


# ─── Meta Ads Connector (Facebook Marketing API) ───────────────────

def ingest_meta_ads(source_id: str, data: dict = None) -> dict:
    """Ingest data from Meta Ads via the Facebook Marketing API.

    Requires credentials: access_token, ad_account_id.
    """
    _init_ingestion_tables()

    if data:
        _store_record(source_id, "meta_ad_metrics", data.get("campaign_name", ""), data)
        store.log_telemetry("meta_ads_ingested", value=float(data.get("campaign_metrics", {}).get("spend", 0)))
        return {"ok": True, "source": "meta_ads", "records": 1, "data": data}

    creds = _get_credentials(source_id)
    access_token = creds.get("access_token", "")
    ad_account_id = creds.get("ad_account_id", "")

    if not access_token or not ad_account_id:
        return {
            "ok": False,
            "source": "meta_ads",
            "error": "Missing credentials. Required: access_token, ad_account_id.",
        }

    # Facebook Marketing API: get account insights
    url = f"https://graph.facebook.com/v19.0/{ad_account_id}/insights"
    params = (
        "?fields=spend,impressions,clicks,ctr,conversions,actions"
        "&level=account&date_preset=last_7d"
        f"&access_token={access_token}"
    )

    result = _http_request(url + params)

    if not result["ok"]:
        return {"ok": False, "source": "meta_ads", "error": result.get("error", "Meta API call failed"), "status": result.get("status")}

    fb_data = result["data"]
    insights = fb_data.get("data", [])

    if not insights:
        return {"ok": True, "source": "meta_ads", "records": 0, "data": {"message": "No ad data in the last 7 days"}}

    record = insights[0]
    normalized = {
        "campaign_metrics": {
            "spend": float(record.get("spend", 0)),
            "impressions": int(record.get("impressions", 0)),
            "clicks": int(record.get("clicks", 0)),
            "ctr": float(record.get("ctr", 0)),
            "conversions": int(record.get("conversions", 0)),
        },
        "campaign_name": record.get("campaign_name", ad_account_id),
        "raw": record,
    }

    _store_record(source_id, "meta_ad_metrics", normalized["campaign_name"], normalized)
    store.log_telemetry("meta_ads_ingested", value=normalized["campaign_metrics"]["spend"])

    return {"ok": True, "source": "meta_ads", "records": 1, "data": normalized}


# ─── Google Business Profile Connector ─────────────────────────────

def ingest_google_business(source_id: str, data: dict = None) -> dict:
    """Ingest data from Google Business Profile via the Performance API.

    Requires credentials: access_token, account_id, location_id.
    """
    _init_ingestion_tables()

    if data:
        _store_record(source_id, "gbp_metrics", "", data)
        store.log_telemetry("gbp_ingested", value=float(data.get("business_metrics", {}).get("views", 0)))
        return {"ok": True, "source": "google_business", "records": 1, "data": data}

    creds = _get_credentials(source_id)
    access_token = creds.get("access_token", "")
    account_id = creds.get("account_id", "")
    location_id = creds.get("location_id", "")

    if not access_token or not account_id or not location_id:
        return {
            "ok": False,
            "source": "google_business",
            "error": "Missing credentials. Required: access_token, account_id, location_id.",
        }

    # Google Business Profile Performance API
    url = f"https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{account_id}/locations/{location_id}/performance:report"
    body = json.dumps({
        "timeRange": {"startDate": (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d"),
                       "endDate": datetime.now(timezone.utc).strftime("%Y-%m-%d")},
    }).encode("utf-8")

    result = _http_request(
        url,
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        method="POST",
        body=body,
    )

    if not result["ok"]:
        return {"ok": False, "source": "google_business", "error": result.get("error", "GBP API call failed"), "status": result.get("status")}

    gbp_data = result["data"]
    normalized = {
        "business_metrics": {
            "views": gbp_data.get("metricValues", {}).get("QUERIES", {}).get("value", 0),
            "calls": gbp_data.get("metricValues", {}).get("CALL_CLICKS", {}).get("value", 0),
            "direction_requests": gbp_data.get("metricValues", {}).get("DRIVING_DIRECTIONS_REQUESTS", {}).get("value", 0),
            "website_clicks": gbp_data.get("metricValues", {}).get("WEBSITE_CLICKS", {}).get("value", 0),
        },
        "raw": gbp_data,
    }

    _store_record(source_id, "gbp_metrics", "", normalized)
    store.log_telemetry("gbp_ingested", value=float(normalized["business_metrics"]["views"]))

    return {"ok": True, "source": "google_business", "records": 1, "data": normalized}


# ─── Yelp Connector (Yelp Fusion API) ──────────────────────────────

def ingest_yelp(source_id: str, data: dict = None) -> dict:
    """Ingest data from Yelp via the Yelp Fusion API.

    Requires credentials: api_key, business_id.
    """
    _init_ingestion_tables()

    if data:
        _store_record(source_id, "yelp_data", "", data)
        store.log_telemetry("yelp_ingested", value=float(data.get("business_info", {}).get("rating", 0)))
        return {"ok": True, "source": "yelp", "records": 1, "data": data}

    creds = _get_credentials(source_id)
    api_key = creds.get("api_key", "")
    business_id = creds.get("business_id", "")

    if not api_key or not business_id:
        return {
            "ok": False,
            "source": "yelp",
            "error": "Missing credentials. Required: api_key, business_id. "
                     "Get an API key from https://www.yelp.com/developers",
        }

    # Yelp Fusion API: get business details
    url = f"https://api.yelp.com/v3/businesses/{business_id}"
    result = _http_request(url, headers={"Authorization": f"Bearer {api_key}"})

    if not result["ok"]:
        return {"ok": False, "source": "yelp", "error": result.get("error", "Yelp API call failed"), "status": result.get("status")}

    biz = result["data"]
    normalized = {
        "business_info": {
            "rating": biz.get("rating", 0),
            "review_count": biz.get("review_count", 0),
            "photos": len(biz.get("photos", [])),
            "name": biz.get("name", ""),
            "phone": biz.get("phone", ""),
            "url": biz.get("url", ""),
        },
        "raw": biz,
    }

    _store_record(source_id, "yelp_data", business_id, normalized)
    store.log_telemetry("yelp_ingested", value=float(normalized["business_info"]["rating"]))

    return {"ok": True, "source": "yelp", "records": 1, "data": normalized}


# ─── RubRatings Connector (live scraping) ──────────────────────────

def ingest_rubratings(source_id: str, data: dict = None) -> dict:
    """Ingest competitor data from RubRatings via live scraping.

    Uses the existing market_intel scraper for real competitor data.
    """
    _init_ingestion_tables()

    if data:
        _store_record(source_id, "rubratings_data", "", data)
        store.log_telemetry("rubratings_ingested", value=float(data.get("competitors_scraped", 0)))
        return {"ok": True, "source": "rubratings", "records": 1, "data": data}

    # Use the real market intelligence scraper
    from . import market_intel
    try:
        scraped = market_intel.scrape_competitors()
        competitors = scraped.get("competitors", [])
        normalized = {
            "competitors_scraped": len(competitors),
            "top_competitors": [
                {"username": c.get("username"), "rank": c.get("rank"), "rating": c.get("rating")}
                for c in competitors[:10]
            ],
            "scraped_at": _utc_now(),
        }

        _store_record(source_id, "rubratings_data", "", normalized)
        store.log_telemetry("rubratings_ingested", value=float(len(competitors)))

        return {"ok": True, "source": "rubratings", "records": 1, "data": normalized}
    except Exception as e:
        return {"ok": False, "source": "rubratings", "error": f"Scraping failed: {e}"}


# ─── Unified Attribution Model ─────────────────────────────────────

def get_unified_attribution() -> dict:
    """Get unified attribution across all ingested sources."""
    _init_ingestion_tables()
    conn = store._get_conn()

    rows = conn.execute("SELECT * FROM ingestion_records ORDER BY ingested_at DESC LIMIT 100").fetchall()

    attribution = {}
    for row in rows:
        source_type = row["record_type"]
        data = json.loads(row["data"]) if row["data"] else {}

        if source_type not in attribution:
            attribution[source_type] = {"records": 0, "metrics": {}}

        attribution[source_type]["records"] += 1

        for key, value in data.items():
            if isinstance(value, dict):
                for k, v in value.items():
                    if isinstance(v, (int, float)):
                        attribution[source_type]["metrics"][k] = attribution[source_type]["metrics"].get(k, 0) + v

    anomalies = []
    for source_type, data in attribution.items():
        metrics = data.get("metrics", {})
        if "sessions" in metrics and metrics["sessions"] < 50:
            anomalies.append({"source": source_type, "metric": "sessions", "value": metrics["sessions"], "type": "low_traffic"})
        if "ctr" in metrics and metrics["ctr"] < 1.0:
            anomalies.append({"source": source_type, "metric": "ctr", "value": metrics["ctr"], "type": "low_ctr"})

    return {
        "total_sources": len(attribution),
        "total_records": len(rows),
        "attribution": attribution,
        "anomalies": anomalies,
        "timestamp": _utc_now(),
    }


# ─── Ingest All Sources ────────────────────────────────────────────

def ingest_all() -> dict:
    """Ingest data from all configured sources using real API calls."""
    sources = list_sources()
    results = []

    for source in sources:
        source_type = source["source_type"]
        source_id = source["id"]

        if source_type == "google_analytics":
            result = ingest_google_analytics(source_id)
        elif source_type == "meta_ads":
            result = ingest_meta_ads(source_id)
        elif source_type == "google_business":
            result = ingest_google_business(source_id)
        elif source_type == "yelp":
            result = ingest_yelp(source_id)
        elif source_type == "rubratings":
            result = ingest_rubratings(source_id)
        else:
            result = {"ok": False, "error": f"Unknown source type: {source_type}"}

        results.append({"source": source_type, "result": result})

    return {
        "ok": True,
        "sources_ingested": len(results),
        "results": results,
        "timestamp": _utc_now(),
    }
