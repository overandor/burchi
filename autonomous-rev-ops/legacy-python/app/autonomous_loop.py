"""Fully autonomous decision loop — self-correcting experiment lifecycle.

Features:
  1. Auto-approve decisions in AUTO mode (no human approval needed)
  2. Self-correcting experiment lifecycle: create → test → promote → retire
  3. Budget-aware optimization: allocate spend across channels based on ROI
  4. Automatic experiment creation when opportunities are detected
  5. Continuous loop that runs without human intervention

The autonomous loop:
  1. Evaluates all running experiments
  2. Makes decisions (promote, eliminate, continue, mutate)
  3. Auto-approves decisions in AUTO mode
  4. Creates new experiments when current ones complete
  5. Adjusts strategy based on cumulative reward
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store, ai_engine


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Autonomous Decision Loop ──────────────────────────────────────

def run_autonomous_cycle() -> dict:
    """Run one cycle of the autonomous decision loop.

    This function:
    1. Gets the current control state
    2. Evaluates all running experiments
    3. Makes decisions based on RL signals
    4. Auto-approves decisions if mode is AUTO
    5. Creates new experiments if needed
    6. Returns a summary of actions taken
    """
    # Get control state
    mode = store.get_control_state("mode") or "OBSERVE"

    actions_taken = []
    experiments_evaluated = 0
    decisions_made = 0
    auto_approved = 0
    new_experiments = 0

    # Get all running experiments
    experiments = store.list_experiments(limit=20)
    running_experiments = [e for e in experiments if e.get("status") == "running"]

    for exp in running_experiments:
        experiments_evaluated += 1
        exp_id = exp["id"]
        variants = exp.get("variants", [])

        if not variants:
            continue

        # Evaluate each variant
        best_variant = None
        worst_variant = None
        best_reward = -float("inf")
        worst_reward = float("inf")

        for v in variants:
            reward = v.get("reward", 0)
            impressions = v.get("impressions", 0)

            # Need at least 50 impressions for statistical significance
            if impressions < 50:
                continue

            if reward > best_reward:
                best_reward = reward
                best_variant = v
            if reward < worst_reward:
                worst_reward = reward
                worst_variant = v

        # Make decisions based on rewards
        if best_variant and worst_variant and best_variant["id"] != worst_variant["id"]:
            # If best variant is significantly better, promote it
            if best_reward > 0.3 and best_reward - worst_reward > 0.2:
                # Promote the best variant
                decision = store.create_decision(
                    experiment_id=exp_id,
                    variant_id=best_variant["id"],
                    action_type="promote",
                    rationale=f"Variant {best_variant['label']} outperforming with reward {best_reward:.3f}. Auto-promoting in {mode} mode.",
                    confidence=min(0.99, 0.5 + (best_reward - worst_reward)),
                    mode=mode,
                )
                decisions_made += 1
                actions_taken.append({
                    "action": "promote",
                    "experiment": exp.get("name"),
                    "variant": best_variant.get("label"),
                    "reward": best_reward,
                    "confidence": decision["confidence"],
                })

                # Auto-approve if in AUTO mode
                if mode == "AUTO":
                    store.approve_decision(decision["id"])
                    auto_approved += 1

                    # Update variant status
                    store.update_variant(best_variant["id"], {"status": "promoted"})
                    store.update_variant(worst_variant["id"], {"status": "eliminated"})

            # If worst variant is very bad, eliminate it
            elif worst_reward < -0.2:
                decision = store.create_decision(
                    experiment_id=exp_id,
                    variant_id=worst_variant["id"],
                    action_type="eliminate",
                    rationale=f"Variant {worst_variant['label']} underperforming with reward {worst_reward:.3f}. Auto-eliminating in {mode} mode.",
                    confidence=min(0.99, 0.5 + abs(worst_reward)),
                    mode=mode,
                )
                decisions_made += 1
                actions_taken.append({
                    "action": "eliminate",
                    "experiment": exp.get("name"),
                    "variant": worst_variant.get("label"),
                    "reward": worst_reward,
                    "confidence": decision["confidence"],
                })

                if mode == "AUTO":
                    store.approve_decision(decision["id"])
                    auto_approved += 1
                    store.update_variant(worst_variant["id"], {"status": "eliminated"})

        # Check if experiment should complete
        active_variants = [v for v in variants if v.get("status") in ("candidate", "promoted", "running")]
        if len(active_variants) <= 1 and best_variant:
            # Complete the experiment with the winner
            store.complete_experiment(exp_id, best_variant["id"], 0.95)
            actions_taken.append({
                "action": "complete_experiment",
                "experiment": exp.get("name"),
                "winner": best_variant.get("label"),
            })

            # Create a new experiment to replace it
            if mode == "AUTO":
                new_exp = _create_followup_experiment(exp, best_variant)
                if new_exp:
                    new_experiments += 1
                    actions_taken.append({
                        "action": "create_experiment",
                        "experiment": new_exp.get("name"),
                    })

    # Log the autonomous cycle
    store.log_telemetry(
        "autonomous_cycle",
        visitor_id="",
        value=float(decisions_made),
        metadata=json.dumps({
            "mode": mode,
            "experiments_evaluated": experiments_evaluated,
            "decisions_made": decisions_made,
            "auto_approved": auto_approved,
            "new_experiments": new_experiments,
        }),
    )

    return {
        "ok": True,
        "mode": mode,
        "experiments_evaluated": experiments_evaluated,
        "decisions_made": decisions_made,
        "auto_approved": auto_approved,
        "new_experiments": new_experiments,
        "actions": actions_taken,
        "timestamp": _utc_now(),
    }


def _get_all_control_state() -> dict:
    """Get all control state as a dict."""
    keys = ["mode", "emergency_stop", "scheduler_active", "cap_bio_mutation",
            "cap_messaging", "cap_visitor_engagement", "cap_photo_rotation",
            "cap_price_changes", "cap_content_generation", "cap_ai_optimization"]
    return {k: store.get_control_state(k) for k in keys}


def _create_followup_experiment(parent_exp: dict, winner_variant: dict) -> dict | None:
    """Create a follow-up experiment based on a completed one.

    Generates new bio candidates that mutate the winning variant.
    """
    try:
        # Generate mutated variants from the winner
        winner_content = winner_variant.get("content", "")
        new_variants = []

        # Create 3 mutated versions
        mutations = [
            {"label": f"{winner_variant.get('label', 'A')}+", "content": winner_content + " Available for both incall and outcall."},
            {"label": f"{winner_variant.get('label', 'A')}v2", "content": winner_content.replace(".", "!", 1) if "." in winner_content else winner_content},
            {"label": f"{winner_variant.get('label', 'A')}v3", "content": f"Premium service. {winner_content}"},
        ]

        new_exp = store.create_experiment(
            name=f"{parent_exp.get('name', 'Experiment')} v2",
            type=parent_exp.get("type", "bio"),
            variants=mutations,
        )
        return new_exp
    except Exception:
        return None


# ─── Budget-Aware Optimization ─────────────────────────────────────

def optimize_budget_allocation(total_budget: float = 1000.0) -> dict:
    """Optimize budget allocation across channels based on ROI.

    Uses the reward signals from experiments to allocate budget
    proportionally to the best-performing channels.
    """
    experiments = store.list_experiments(limit=20)

    # Calculate ROI per experiment type
    type_rewards: dict[str, list[float]] = {}
    for exp in experiments:
        exp_type = exp.get("type", "bio")
        for v in exp.get("variants", []):
            reward = v.get("reward", 0)
            type_rewards.setdefault(exp_type, []).append(reward)

    # Calculate average reward per type
    type_avg_reward = {}
    for exp_type, rewards in type_rewards.items():
        avg = sum(rewards) / len(rewards) if rewards else 0
        type_avg_reward[exp_type] = max(0, avg)  # Only positive rewards get budget

    # Normalize to get allocation percentages
    total_reward = sum(type_avg_reward.values())
    allocations = {}
    if total_reward > 0:
        for exp_type, reward in type_avg_reward.items():
            allocations[exp_type] = {
                "budget": round(total_budget * (reward / total_reward), 2),
                "percentage": round((reward / total_reward) * 100, 1),
                "avg_reward": round(reward, 4),
            }
    else:
        # Equal allocation if no positive rewards
        equal = total_budget / max(1, len(type_avg_reward))
        for exp_type in type_avg_reward:
            allocations[exp_type] = {
                "budget": round(equal, 2),
                "percentage": round(100 / max(1, len(type_avg_reward)), 1),
                "avg_reward": 0,
            }

    return {
        "total_budget": total_budget,
        "allocations": allocations,
        "experiment_types": list(type_avg_reward.keys()),
        "timestamp": _utc_now(),
    }


# ─── Continuous Loop Status ────────────────────────────────────────

def get_autonomous_status() -> dict:
    """Get the status of the autonomous decision loop."""
    control = _get_all_control_state()
    experiments = store.list_experiments(limit=20)
    running = [e for e in experiments if e.get("status") == "running"]
    completed = [e for e in experiments if e.get("status") == "completed"]

    # Get recent autonomous cycles from telemetry
    conn = store._get_conn()
    rows = conn.execute(
        "SELECT * FROM telemetry WHERE event_type = 'autonomous_cycle' ORDER BY timestamp DESC LIMIT 5"
    ).fetchall()

    recent_cycles = []
    for row in rows:
        try:
            meta = json.loads(row["metadata"]) if row["metadata"] else {}
            recent_cycles.append({
                "timestamp": row["timestamp"],
                "decisions_made": meta.get("decisions_made", 0),
                "auto_approved": meta.get("auto_approved", 0),
                "new_experiments": meta.get("new_experiments", 0),
            })
        except Exception:
            continue

    return {
        "mode": control.get("mode", "OBSERVE"),
        "emergency_stop": control.get("emergency_stop", "false"),
        "running_experiments": len(running),
        "completed_experiments": len(completed),
        "total_experiments": len(experiments),
        "recent_cycles": recent_cycles,
        "autonomous_enabled": control.get("mode") == "AUTO",
        "capabilities": {
            "bio_mutation": control.get("cap_bio_mutation", "false") == "true",
            "messaging": control.get("cap_messaging", "false") == "true",
            "content_generation": control.get("cap_content_generation", "false") == "true",
            "ai_optimization": control.get("cap_ai_optimization", "false") == "true",
        },
    }
