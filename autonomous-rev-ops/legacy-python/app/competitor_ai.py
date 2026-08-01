"""Competitor strategy AI — automatic analysis and counter-strategies.

Features:
  1. Auto-analyze competitor profiles, pricing, and reviews
  2. Generate counter-strategies based on competitor weaknesses
  3. Estimate competitor ad spend based on visibility signals
  4. Track competitor movements over time
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store, hfdata, market_intel


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def analyze_competitor(username: str) -> dict:
    """Deep analysis of a single competitor."""
    # Get competitor data
    competitors = hfdata.get_competitors(limit=100)
    competitor = next((c for c in competitors if c.get("username") == username), None)

    if not competitor:
        return {"error": f"Competitor {username} not found"}

    # Get their bio content
    bio = competitor.get("bio", "")
    rating = competitor.get("rating", 0)
    reviews = competitor.get("reviews", 0)
    rank = competitor.get("rank", 0)

    # Analyze strengths
    strengths = []
    if rating >= 4.5:
        strengths.append("High customer satisfaction")
    if reviews > 50:
        strengths.append("Strong review volume")
    if rank <= 10:
        strengths.append("High visibility ranking")
    if len(bio) > 200:
        strengths.append("Detailed professional bio")

    # Analyze weaknesses
    weaknesses = []
    if rating < 4.0:
        weaknesses.append("Low customer satisfaction — opportunity to differentiate on quality")
    if reviews < 10:
        weaknesses.append("Few reviews — opportunity to build social proof faster")
    if rank > 20:
        weaknesses.append("Low visibility — opportunity to outrank with SEO")
    if len(bio) < 100:
        weaknesses.append("Sparse bio — opportunity to create more compelling content")
    if "incall" not in bio.lower() and "outcall" not in bio.lower():
        weaknesses.append("No service type specified — opportunity to be clearer")

    # Estimate ad spend (based on visibility signals)
    estimated_ad_spend = max(0, (100 - rank) * 5 + reviews * 2)

    # Generate counter-strategies
    counter_strategies = []
    for weakness in weaknesses:
        if "satisfaction" in weakness.lower():
            counter_strategies.append({
                "target_weakness": weakness,
                "strategy": "Emphasize quality and client satisfaction in bio. Collect and showcase testimonials.",
                "expected_impact": "high",
            })
        elif "review" in weakness.lower():
            counter_strategies.append({
                "target_weakness": weakness,
                "strategy": "Implement post-session follow-up to request reviews. Offer incentive for honest feedback.",
                "expected_impact": "medium",
            })
        elif "visibility" in weakness.lower():
            counter_strategies.append({
                "target_weakness": weakness,
                "strategy": "Invest in SEO and cross-platform presence. Optimize bio with keywords.",
                "expected_impact": "high",
            })
        elif "bio" in weakness.lower():
            counter_strategies.append({
                "target_weakness": weakness,
                "strategy": "Create a detailed, compelling bio using AI content generation. A/B test variants.",
                "expected_impact": "medium",
            })
        else:
            counter_strategies.append({
                "target_weakness": weakness,
                "strategy": "Capitalize on this gap in the competitor's offering.",
                "expected_impact": "low",
            })

    return {
        "username": username,
        "rank": rank,
        "rating": rating,
        "reviews": reviews,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "estimated_ad_spend": estimated_ad_spend,
        "counter_strategies": counter_strategies,
        "analysis_timestamp": _utc_now(),
    }


def analyze_all_competitors() -> dict:
    """Analyze all competitors and generate a competitive landscape report."""
    competitors = hfdata.get_competitors(limit=50)
    analyses = []

    for c in competitors:
        analysis = analyze_competitor(c.get("username", ""))
        if "error" not in analysis:
            analyses.append(analysis)

    # Aggregate stats
    avg_rating = sum(a["rating"] for a in analyses) / max(1, len(analyses))
    avg_ad_spend = sum(a["estimated_ad_spend"] for a in analyses) / max(1, len(analyses))
    total_ad_spend = sum(a["estimated_ad_spend"] for a in analyses)

    # Find top opportunities (competitors with most weaknesses)
    top_opportunities = sorted(
        analyses,
        key=lambda x: len(x["weaknesses"]),
        reverse=True
    )[:5]

    return {
        "total_competitors_analyzed": len(analyses),
        "avg_rating": round(avg_rating, 2),
        "avg_estimated_ad_spend": round(avg_ad_spend, 2),
        "total_market_ad_spend": round(total_ad_spend, 2),
        "top_opportunities": [
            {
                "username": a["username"],
                "weaknesses_count": len(a["weaknesses"]),
                "top_weakness": a["weaknesses"][0] if a["weaknesses"] else "",
                "best_counter_strategy": a["counter_strategies"][0]["strategy"] if a["counter_strategies"] else "",
            }
            for a in top_opportunities
        ],
        "analyses": analyses,
        "timestamp": _utc_now(),
    }


def estimate_ad_spend(username: str) -> dict:
    """Estimate a competitor's ad spend based on visibility signals."""
    analysis = analyze_competitor(username)
    if "error" in analysis:
        return analysis

    # Break down the estimate
    base_spend = max(0, (100 - analysis["rank"]) * 3)
    review_investment = analysis["reviews"] * 1.5
    rating_premium = analysis["rating"] * 20 if analysis["rating"] > 4 else 0

    return {
        "username": username,
        "estimated_monthly_spend": analysis["estimated_ad_spend"],
        "breakdown": {
            "base_visibility": base_spend,
            "review_acquisition": review_investment,
            "rating_premium": rating_premium,
        },
        "confidence": "medium",
        "method": "visibility_signal_estimation",
        "timestamp": _utc_now(),
    }
