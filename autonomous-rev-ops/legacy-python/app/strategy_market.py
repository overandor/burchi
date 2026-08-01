"""Strategy marketplace — share and sell optimization strategies with leaderboards.

Features:
  1. Strategy sharing — tenants can publish their successful strategies
  2. Strategy marketplace — browse, install, and rate strategies
  3. Leaderboards — top-performing strategies by ROI, adoption, rating
  4. Strategy templates — reusable optimization patterns
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


STRATEGY_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS strategies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    strategy_type TEXT DEFAULT 'bio_optimization',
    config TEXT DEFAULT '{}',
    author_tenant_id TEXT DEFAULT 'default',
    author_name TEXT DEFAULT 'Anonymous',
    price REAL DEFAULT 0,
    is_public TEXT DEFAULT 'true',
    rating REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    install_count INTEGER DEFAULT 0,
    total_roi REAL DEFAULT 0,
    tags TEXT DEFAULT '[]',
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS strategy_installs (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    status TEXT DEFAULT 'installed',
    roi_achieved REAL DEFAULT 0,
    installed_at TEXT
);

CREATE TABLE IF NOT EXISTS strategy_ratings (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    rating INTEGER DEFAULT 5,
    review TEXT DEFAULT '',
    created_at TEXT
);
"""

_strategy_initialized = False


def _init_strategy_tables():
    global _strategy_initialized
    if _strategy_initialized:
        return
    conn = store._get_conn()
    conn.executescript(STRATEGY_TABLES_SQL)

    # Seed some example strategies
    existing = conn.execute("SELECT COUNT(*) as count FROM strategies").fetchone()
    if existing["count"] == 0:
        examples = [
            ("Bio A/B Testing Pro", "Automated bio variant testing with RL optimization", "bio", "bio_optimization",
             {"mutation_rate": 0.15, "min_impressions": 50, "reward_metric": "ctr"}, 0),
            ("High-Intent Outreach", "Auto-message high-intent visitors with personalized content", "outreach", "visitor_engagement",
             {"intent_threshold": 0.75, "message_template": "personalized"}, 9.99),
            ("Competitor Price Match", "Monitor competitor pricing and auto-adjust", "pricing", "price_optimization",
             {"check_interval": "daily", "adjustment_factor": 0.95}, 19.99),
            ("Content Calendar Auto", "Generate and schedule multi-modal content automatically", "content", "content_generation",
             {"frequency": "weekly", "platforms": ["instagram", "website"]}, 14.99),
        ]
        for name, desc, cat, stype, config, price in examples:
            sid = str(uuid4())
            conn.execute(
                """INSERT INTO strategies (id, name, description, category, strategy_type, config, price, rating, rating_count, install_count, tags, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (sid, name, desc, cat, stype, json.dumps(config), price, 4.5, 10, 50, json.dumps([cat, stype]), _utc_now(), _utc_now())
            )

    conn.commit()
    _strategy_initialized = True


def publish_strategy(
    name: str, description: str, category: str, strategy_type: str,
    config: dict, author_tenant_id: str = "default", author_name: str = "Anonymous",
    price: float = 0, tags: list[str] = None,
) -> dict:
    """Publish a new strategy to the marketplace."""
    _init_strategy_tables()
    conn = store._get_conn()
    sid = str(uuid4())
    now = _utc_now()

    conn.execute(
        """INSERT INTO strategies
           (id, name, description, category, strategy_type, config, author_tenant_id, author_name, price, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (sid, name, description, category, strategy_type, json.dumps(config),
         author_tenant_id, author_name, price, json.dumps(tags or []), now, now)
    )
    conn.commit()

    return get_strategy(sid)


def get_strategy(sid: str) -> dict | None:
    """Get a strategy by ID."""
    _init_strategy_tables()
    conn = store._get_conn()
    row = conn.execute("SELECT * FROM strategies WHERE id = ?", (sid,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["config"] = json.loads(d["config"]) if d["config"] else {}
    d["tags"] = json.loads(d["tags"]) if d["tags"] else []
    return d


def list_strategies(category: str = "", limit: int = 50) -> list[dict]:
    """List strategies, optionally filtered by category."""
    _init_strategy_tables()
    conn = store._get_conn()
    if category:
        rows = conn.execute("SELECT * FROM strategies WHERE category = ? AND is_public = 'true' ORDER BY install_count DESC LIMIT ?", (category, limit)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM strategies WHERE is_public = 'true' ORDER BY install_count DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def install_strategy(strategy_id: str, tenant_id: str = "default") -> dict:
    """Install a strategy for a tenant."""
    _init_strategy_tables()
    conn = store._get_conn()
    strategy = get_strategy(strategy_id)
    if not strategy:
        return {"error": "Strategy not found"}

    iid = str(uuid4())
    conn.execute(
        "INSERT INTO strategy_installs (id, strategy_id, tenant_id, status, installed_at) VALUES (?, ?, ?, ?, ?)",
        (iid, strategy_id, tenant_id, "installed", _utc_now())
    )
    conn.execute("UPDATE strategies SET install_count = install_count + 1 WHERE id = ?", (strategy_id,))
    conn.commit()

    return {"id": iid, "strategy_id": strategy_id, "strategy_name": strategy["name"], "status": "installed"}


def rate_strategy(strategy_id: str, tenant_id: str, rating: int, review: str = "") -> dict:
    """Rate a strategy."""
    _init_strategy_tables()
    conn = store._get_conn()

    if rating < 1 or rating > 5:
        return {"error": "Rating must be 1-5"}

    rid = str(uuid4())
    conn.execute(
        "INSERT INTO strategy_ratings (id, strategy_id, tenant_id, rating, review, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (rid, strategy_id, tenant_id, rating, review, _utc_now())
    )

    # Update strategy's average rating
    rows = conn.execute("SELECT rating FROM strategy_ratings WHERE strategy_id = ?", (strategy_id,)).fetchall()
    avg_rating = sum(r["rating"] for r in rows) / len(rows)
    conn.execute("UPDATE strategies SET rating = ?, rating_count = ? WHERE id = ?", (round(avg_rating, 2), len(rows), strategy_id))
    conn.commit()

    return {"strategy_id": strategy_id, "new_rating": round(avg_rating, 2), "total_ratings": len(rows)}


def get_leaderboard(sort_by: str = "install_count") -> list[dict]:
    """Get the strategy leaderboard."""
    _init_strategy_tables()
    conn = store._get_conn()

    valid_sorts = {"install_count", "rating", "total_roi", "price"}
    sort_field = sort_by if sort_by in valid_sorts else "install_count"

    rows = conn.execute(
        f"SELECT * FROM strategies WHERE is_public = 'true' ORDER BY {sort_field} DESC LIMIT 20"
    ).fetchall()
    return [dict(r) for r in rows]


def get_marketplace_stats() -> dict:
    """Get marketplace statistics."""
    _init_strategy_tables()
    conn = store._get_conn()

    total = conn.execute("SELECT COUNT(*) as count FROM strategies WHERE is_public = 'true'").fetchone()["count"]
    total_installs = conn.execute("SELECT COUNT(*) as count FROM strategy_installs").fetchone()["count"]
    total_ratings = conn.execute("SELECT COUNT(*) as count FROM strategy_ratings").fetchone()["count"]
    avg_rating = conn.execute("SELECT AVG(rating) as avg FROM strategies WHERE rating_count > 0").fetchone()["avg"] or 0

    # By category
    rows = conn.execute("SELECT category, COUNT(*) as count, SUM(install_count) as installs FROM strategies WHERE is_public = 'true' GROUP BY category").fetchall()
    by_category = {r["category"]: {"count": r["count"], "installs": r["installs"]} for r in rows}

    return {
        "total_strategies": total,
        "total_installs": total_installs,
        "total_ratings": total_ratings,
        "avg_rating": round(avg_rating, 2),
        "by_category": by_category,
    }
