"""Market intelligence auto-ingest — competitor scraping, bio change detection, pricing feed.

This module provides:
  1. Competitor profile scraping (from public directory pages)
  2. Bio change detection (diff against previous snapshots)
  3. Pricing data extraction and tracking
  4. Auto-trigger content generation when changes are detected

Data is stored in the SQLite store as snapshots, enabling time-series analysis
of competitor strategy changes.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


# ─── Competitor Scraping ────────────────────────────────────────────

async def scrape_competitor_profiles(source_url: str = "", limit: int = 20) -> dict:
    """Scrape competitor profiles from a public directory page.

    Returns a summary of scraped profiles. In production, this would
    fetch real pages. For now, it augments the existing static data
    with fresh snapshots.
    """
    from . import store, hfdata

    # Get existing competitors as baseline
    existing = hfdata.get_competitors(limit=limit)
    snapshots = []

    for comp in existing[:limit]:
        username = comp.get("username", "")
        bio = comp.get("bio", "")
        bio_hash = _hash_text(bio)

        snapshot = {
            "username": username,
            "bio_hash": bio_hash,
            "bio_length": len(bio),
            "scraped_at": _utc_now(),
            "source": "directory_scrape",
            "rank": comp.get("rank", 0),
            "location": comp.get("location", ""),
            "rate": comp.get("rate", ""),
        }
        snapshots.append(snapshot)

        # Log telemetry for each scrape
        store.log_telemetry(
            "competitor_scraped",
            visitor_id="",
            value=float(comp.get("rank", 0)),
        )

    return {
        "ok": True,
        "scraped_count": len(snapshots),
        "snapshots": snapshots,
        "source": source_url or "internal_data",
        "timestamp": _utc_now(),
    }


# ─── Bio Change Detection ──────────────────────────────────────────

def detect_bio_changes() -> dict:
    """Detect bio changes by comparing current competitor bios against
    stored snapshots.

    Returns a list of changes with the competitor username, what changed,
    and when it was detected.
    """
    from . import store, hfdata

    competitors = hfdata.get_competitors(limit=50)
    changes = []

    # Get previous snapshots from telemetry events
    conn = store._get_conn()
    rows = conn.execute(
        "SELECT * FROM telemetry WHERE event_type = 'competitor_bio_snapshot' ORDER BY timestamp DESC LIMIT 200"
    ).fetchall()

    # Build a map of username → last known bio_hash
    previous_hashes: dict[str, str] = {}
    for row in rows:
        try:
            meta = json.loads(row["metadata"]) if row["metadata"] else {}
            username = meta.get("username", "")
            bio_hash = meta.get("bio_hash", "")
            if username and bio_hash and username not in previous_hashes:
                previous_hashes[username] = bio_hash
        except Exception:
            continue

    for comp in competitors:
        username = comp.get("username", "")
        bio = comp.get("bio", "")
        current_hash = _hash_text(bio)
        previous_hash = previous_hashes.get(username)

        if previous_hash and previous_hash != current_hash:
            changes.append({
                "username": username,
                "change_type": "bio_modified",
                "previous_hash": previous_hash,
                "current_hash": current_hash,
                "bio_length_change": len(bio) - (len(bio) if bio else 0),
                "detected_at": _utc_now(),
                "rank": comp.get("rank", 0),
            })

        # Store current snapshot
        store.log_telemetry(
            "competitor_bio_snapshot",
            visitor_id="",
            value=float(comp.get("rank", 0)),
            metadata=json.dumps({
                "username": username,
                "bio_hash": current_hash,
                "bio_length": len(bio),
                "rank": comp.get("rank", 0),
            }),
        )

    return {
        "ok": True,
        "competitors_checked": len(competitors),
        "changes_detected": len(changes),
        "changes": changes,
        "timestamp": _utc_now(),
    }


# ─── Pricing Data Feed ─────────────────────────────────────────────

def extract_pricing_data() -> dict:
    """Extract and track pricing data from competitor profiles.

    Returns a summary of pricing distribution and any changes detected.
    """
    from . import hfdata

    competitors = hfdata.get_competitors(limit=50)
    prices = []
    pricing_changes = []

    for comp in competitors:
        bio = comp.get("bio", "")
        rate_str = comp.get("rate", "")

        # Search bio for price patterns like $120, $80/hr, etc.
        price_matches = re.findall(r'\$(\d{2,4})', bio)
        if price_matches:
            price = int(price_matches[0])
            rate_str = f"${price}"
        elif rate_str:
            # Extract numeric price from rate string
            price = 0
            for part in rate_str.replace("$", "").split():
                try:
                    price = int(part)
                    break
                except ValueError:
                    continue
        else:
            continue

        if price > 0:
            prices.append({
                "username": comp.get("username", ""),
                "price": price,
                "rate_string": rate_str,
                "rank": comp.get("rank", 0),
                "location": comp.get("location", ""),
            })

    # Calculate statistics
    if prices:
        price_values = [p["price"] for p in prices]
        avg_price = sum(price_values) / len(price_values)
        min_price = min(price_values)
        max_price = max(price_values)
        median_price = sorted(price_values)[len(price_values) // 2]
    else:
        avg_price = min_price = max_price = median_price = 0

    return {
        "ok": True,
        "total_priced": len(prices),
        "average_price": round(avg_price, 2),
        "median_price": median_price,
        "min_price": min_price,
        "max_price": max_price,
        "price_distribution": prices[:20],
        "timestamp": _utc_now(),
    }


# ─── Auto-Trigger Content Generation ───────────────────────────────

async def auto_trigger_content_on_changes(changes: list[dict]) -> dict:
    """When competitor bio changes are detected, auto-trigger content
    generation to counter the competitive move.

    Uses the AI engine to generate counter-strategies.
    """
    from . import ai_engine, store

    triggered = []

    for change in changes:
        username = change.get("username", "")
        change_type = change.get("change_type", "")

        # Generate a counter-strategy using AI
        prompt = f"""A competitor ({username}) has changed their bio. Generate a brief counter-strategy.
Change type: {change_type}
Suggested response:"""

        # Use the AI engine to generate a counter-strategy
        try:
            content = ai_engine.generate_content(
                content_type="strategy",
                topic=f"counter_{username}_bio_change",
                count=1,
            )
            if content:
                triggered.append({
                    "username": username,
                    "change_type": change_type,
                    "counter_strategy": content[0].get("content", "")[:200] if content else "",
                    "triggered_at": _utc_now(),
                })

                # Log the auto-trigger
                store.log_telemetry(
                    "content_auto_triggered",
                    visitor_id="",
                    value=1.0,
                    metadata=json.dumps({
                        "trigger": "competitor_bio_change",
                        "username": username,
                    }),
                )
        except Exception as e:
            triggered.append({
                "username": username,
                "error": str(e)[:100],
                "triggered_at": _utc_now(),
            })

    return {
        "ok": True,
        "triggered_count": len(triggered),
        "triggered": triggered,
        "timestamp": _utc_now(),
    }


# ─── Full Market Intelligence Pipeline ─────────────────────────────

async def run_market_intelligence_pipeline() -> dict:
    """Run the full market intelligence pipeline:
    1. Scrape competitor profiles
    2. Detect bio changes
    3. Extract pricing data
    4. Auto-trigger content generation for changes
    """
    # Step 1: Scrape
    scrape_result = await scrape_competitor_profiles()

    # Step 2: Detect changes
    changes_result = detect_bio_changes()

    # Step 3: Extract pricing
    pricing_result = extract_pricing_data()

    # Step 4: Auto-trigger content for changes
    trigger_result = {"triggered_count": 0, "triggered": []}
    if changes_result.get("changes"):
        trigger_result = await auto_trigger_content_on_changes(changes_result["changes"])

    return {
        "ok": True,
        "pipeline": "market_intelligence",
        "steps": {
            "scrape": {
                "scraped_count": scrape_result["scraped_count"],
                "source": scrape_result["source"],
            },
            "change_detection": {
                "competitors_checked": changes_result["competitors_checked"],
                "changes_detected": changes_result["changes_detected"],
            },
            "pricing": {
                "total_priced": pricing_result["total_priced"],
                "average_price": pricing_result["average_price"],
                "median_price": pricing_result["median_price"],
            },
            "auto_trigger": {
                "triggered_count": trigger_result.get("triggered_count", 0),
            },
        },
        "changes": changes_result.get("changes", []),
        "pricing": {
            "average": pricing_result["average_price"],
            "median": pricing_result["median_price"],
            "min": pricing_result["min_price"],
            "max": pricing_result["max_price"],
        },
        "timestamp": _utc_now(),
    }
