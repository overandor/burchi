"""Router & preference API — exposes the contextual router and preference loop.

Endpoints:
  /api/router/select      — Get worker selection for a prompt (debugging)
  /api/router/features    — Get feature vector for a prompt
  /api/router/stats       — Router statistics
  /api/router/reset       — Reset router weights (careful!)

  /api/preferences/pairs           — List preference pairs
  /api/preferences/stats           — Preference dataset stats
  /api/preferences/rank            — Rank two workers for a prompt
  /api/preferences/train           — Trigger ranker training
  /api/preferences/weights         — Get ranker weights
  /api/preferences/feedback        — Get full feedback pipeline status
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app import store_gguf as store
from app.auth_gguf import verify_api_key
from app.router import get_router, extract_features, features_to_vector, ALL_FEATURES
from app.preference_loop import (
    get_dataset, get_ranker, get_pipeline,
)

router = APIRouter(prefix="/api/router", tags=["router"])
pref_router = APIRouter(prefix="/api/preferences", tags=["preferences"])


# ─── Router endpoints ──────────────────────────────────────────────────────

class SelectRequest(BaseModel):
    prompt: str
    available_workers: list[dict] = []
    num_select: int = 2


@router.post("/select")
async def select_workers(body: SelectRequest, key_info: dict = Depends(verify_api_key)):
    """Get the router's worker selection for a prompt."""
    r = get_router()
    features = r.get_features(body.prompt)
    selected = r.select_workers(body.prompt, body.available_workers, body.num_select)
    return {
        "prompt": body.prompt[:200],
        "features": features,
        "selected_workers": selected,
        "num_available": len(body.available_workers),
    }


@router.get("/features")
async def get_features(prompt: str, key_info: dict = Depends(verify_api_key)):
    """Get the feature vector for a prompt."""
    features = extract_features(prompt)
    return {
        "prompt": prompt[:200],
        "features": features,
        "active_features": [k for k, v in features.items() if v > 0],
        "dimension": len(ALL_FEATURES),
    }


@router.get("/stats")
async def router_stats(key_info: dict = Depends(verify_api_key)):
    """Get contextual router statistics."""
    return get_router().get_stats()


@router.post("/reset")
async def reset_router(key_info: dict = Depends(verify_api_key)):
    """Reset all router weights (destructive)."""
    conn = store._get_conn()
    conn.execute("DELETE FROM router_weights")
    conn.execute("DELETE FROM router_arm_stats")
    conn.execute("DELETE FROM router_predictions")
    conn.commit()
    return {"ok": True, "message": "Router weights reset"}


# ─── Preference endpoints ──────────────────────────────────────────────────

@pref_router.get("/pairs")
async def list_pairs(limit: int = 50, offset: int = 0, key_info: dict = Depends(verify_api_key)):
    """List preference pairs."""
    return get_dataset().get_pairs(limit, offset)


@pref_router.get("/stats")
async def pref_stats(key_info: dict = Depends(verify_api_key)):
    """Get preference dataset statistics."""
    return get_dataset().stats()


class RankRequest(BaseModel):
    prompt: str
    worker_a: str
    worker_b: str


@pref_router.post("/rank")
async def rank_workers(body: RankRequest, key_info: dict = Depends(verify_api_key)):
    """Rank two workers for a given prompt using the trained ranker."""
    ranker = get_ranker()
    return ranker.predict_preference(body.prompt, body.worker_a, body.worker_b)


@pref_router.post("/train")
async def train_ranker(max_pairs: int = 1000, key_info: dict = Depends(verify_api_key)):
    """Trigger ranker training on all available preference pairs."""
    ranker = get_ranker()
    return ranker.train_on_dataset(max_pairs)


@pref_router.get("/weights")
async def get_weights(key_info: dict = Depends(verify_api_key)):
    """Get current ranker weights (top 20 by magnitude)."""
    return get_ranker().get_weights()


@pref_router.get("/feedback")
async def feedback_status(key_info: dict = Depends(verify_api_key)):
    """Get full feedback pipeline status."""
    return get_pipeline().get_status()
