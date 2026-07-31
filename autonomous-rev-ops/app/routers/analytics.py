"""Analytics router — metrics, download tracking, inference stats."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app import store_gguf as store
from app.schemas_gguf import AnalyticsEvent, AnalyticsResponse
from app.auth_gguf import verify_api_key

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("", response_model=AnalyticsResponse)
async def get_analytics(key_info: dict = Depends(verify_api_key)):
    """Get aggregate analytics: downloads, inferences, top models, node uptime."""
    return store.get_analytics()


@router.post("/events")
async def log_event(body: AnalyticsEvent, key_info: dict = Depends(verify_api_key)):
    """Log a custom analytics event."""
    store.log_event(body.event_type, model_id=body.model_id, node_id=body.node_id, metadata=body.metadata)
    return {"status": "ok"}


@router.get("/events")
async def get_events(limit: int = 50, key_info: dict = Depends(verify_api_key)):
    """Get recent analytics events."""
    import sqlite3
    conn = store._get_conn()
    rows = conn.execute(
        "SELECT * FROM analytics ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    return [
        {
            "id": r["id"],
            "event_type": r["event_type"],
            "model_id": r["model_id"],
            "node_id": r["node_id"],
            "metadata": __import__("json").loads(r["metadata"]),
            "timestamp": r["timestamp"],
        }
        for r in rows
    ]


@router.get("/inferences")
async def get_inference_stats(key_info: dict = Depends(verify_api_key)):
    """Get inference statistics."""
    import sqlite3
    conn = store._get_conn()

    total = conn.execute("SELECT COUNT(*) FROM inference_logs").fetchone()[0]
    successful = conn.execute("SELECT COUNT(*) FROM inference_logs WHERE success = 1").fetchone()[0]
    avg_latency = conn.execute("SELECT AVG(elapsed_ms) FROM inference_logs WHERE success = 1").fetchone()[0] or 0
    avg_speed = conn.execute("SELECT AVG(gen_tok_per_sec) FROM inference_logs WHERE success = 1").fetchone()[0] or 0
    total_tokens = conn.execute("SELECT COALESCE(SUM(tokens_completion), 0) FROM inference_logs").fetchone()[0]

    # By model
    by_model = conn.execute(
        """SELECT model_id, COUNT(*) as count, AVG(gen_tok_per_sec) as avg_speed,
                  AVG(elapsed_ms) as avg_latency
           FROM inference_logs WHERE success = 1 GROUP BY model_id ORDER BY count DESC"""
    ).fetchall()

    return {
        "total_inferences": total,
        "successful_inferences": successful,
        "success_rate": round(successful / total * 100, 1) if total > 0 else 0,
        "avg_latency_ms": round(avg_latency, 1),
        "avg_gen_tok_per_sec": round(avg_speed, 1),
        "total_tokens_generated": total_tokens,
        "by_model": [
            {
                "model_id": r["model_id"],
                "count": r["count"],
                "avg_speed": round(r["avg_speed"] or 0, 1),
                "avg_latency": round(r["avg_latency"] or 0, 1),
            }
            for r in by_model
        ],
    }
