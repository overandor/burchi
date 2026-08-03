"""Contextual router — routes prompts to the best worker based on prompt features.

Replaces the non-contextual Thompson Sampling in competitive.py with a
contextual bandit that learns which worker wins for which *kind* of prompt.

Architecture:
  - Prompt → feature vector (TF-IDF over keywords + structural features)
  - Feature vector × worker → predicted score (linear bandit per worker)
  - Thompson Sampling over predicted scores for exploration
  - Updates: after each race, adjust weights via online ridge regression

This is the "small adaptive piece" — the base models stay frozen, only the
router learns. It's a few KB of weights, updates in microseconds.

Storage: SQLite table `router_weights` (worker_id, feature_hash, weight, count)
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import sqlite3
import threading
from collections import defaultdict
from typing import Optional

from app import store_gguf as store

# ─── Feature extraction ────────────────────────────────────────────────────

# Domain-specific keyword buckets — these are the features the router learns over.
# Each bucket maps to a feature dimension. The router learns which workers
# handle which kinds of prompts better.
FEATURE_BUCKETS = [
    # Code / technical
    "code", "function", "python", "javascript", "api", "bug", "error", "debug",
    "compile", "sql", "database", "algorithm", "class", "refactor", "test",
    # Writing / creative
    "write", "story", "essay", "blog", "article", "creative", "poem", "summary",
    "rewrite", "tone", "style", "headline", "copy",
    # Reasoning / analysis
    "explain", "analyze", "compare", "why", "how", "reason", "logic", "prove",
    "calculate", "math", "step", "solution",
    # Short / quick
    "list", "name", "what", "when", "who", "define", "translate", "format",
    # Conversation
    "hello", "help", "chat", "thanks", "question", "ask",
    # Domain: rev-ops
    "revenue", "sales", "customer", "pipeline", "forecast", "kpi", "metric",
    "experiment", "variant", "conversion", "outreach", "campaign",
]

# Structural features (appended to keyword features)
STRUCTURAL_FEATURES = ["short_prompt", "long_prompt", "has_code_block", "has_question_mark", "multi_sentence"]

ALL_FEATURES = FEATURE_BUCKETS + STRUCTURAL_FEATURES
FEATURE_DIM = len(ALL_FEATURES)
FEATURE_INDEX = {f: i for i, f in enumerate(ALL_FEATURES)}

# Hash for DB storage (feature name → stable hash)
def _feature_hash(name: str) -> int:
    return int(hashlib.md5(name.encode()).hexdigest()[:8], 16)


def extract_features(prompt: str) -> dict:
    """Extract feature vector from a prompt.

    Returns dict of {feature_name: value} where value is 0.0-1.0.
    """
    prompt_lower = prompt.lower()
    words = set(prompt_lower.split())
    features = {}

    # Keyword features: binary presence
    for kw in FEATURE_BUCKETS:
        features[kw] = 1.0 if kw in prompt_lower else 0.0

    # Structural features
    prompt_len = len(prompt)
    features["short_prompt"] = 1.0 if prompt_len < 100 else 0.0
    features["long_prompt"] = 1.0 if prompt_len > 500 else 0.0
    features["has_code_block"] = 1.0 if "```" in prompt or "    def " in prompt or "    function" in prompt else 0.0
    features["has_question_mark"] = 1.0 if "?" in prompt else 0.0
    sentences = prompt.count(".") + prompt.count("!") + prompt.count("?")
    features["multi_sentence"] = 1.0 if sentences > 2 else 0.0

    return features


def features_to_vector(features: dict) -> list[float]:
    """Convert feature dict to ordered vector."""
    return [features.get(f, 0.0) for f in ALL_FEATURES]


# ─── Contextual bandit (LinTS — Linear Thompson Sampling) ──────────────────

class LinearThompsonSampling:
    """Linear Thompson Sampling for contextual bandit.

    For each worker (arm), maintains:
      - A: d×d matrix (initialized to identity)
      - b: d×1 vector (initialized to zeros)

    On each round:
      1. For each arm, sample θ ~ N(A^{-1} b, A^{-1})
      2. Compute predicted score = θ^T x
      3. Select arm with highest sampled score

    After observing reward:
      A = A + x x^T
      b = b + r * x

    This is the classic LinTS algorithm (Agrawal & Goyal, 2013).
    We use a diagonal approximation for scalability (per-feature independent).
    """

    def __init__(self, n_arms: int, dim: int = FEATURE_DIM):
        self.n_arms = n_arms
        self.dim = dim
        # Per-arm, per-feature: (alpha_sum, beta_sum) for diagonal approximation
        # This avoids storing full d×d matrices
        self.arm_stats: dict[str, dict] = {}  # arm_id → {feature_idx: (count, reward_sum, reward_sq_sum)}

    def get_or_init_arm(self, arm_id: str) -> dict:
        if arm_id not in self.arm_stats:
            self.arm_stats[arm_id] = {
                "total_count": 0,
                "total_reward": 0.0,
                "features": defaultdict(lambda: {"count": 0, "reward_sum": 0.0, "reward_sq_sum": 0.0}),
            }
        return self.arm_stats[arm_id]

    def sample_score(self, arm_id: str, feature_vector: list[float]) -> float:
        """Sample a score from the posterior for this arm + context."""
        arm = self.get_or_init_arm(arm_id)
        score = 0.0
        for i, x in enumerate(feature_vector):
            if x == 0.0:
                continue
            feat = arm["features"][i]
            count = feat["count"]
            if count == 0:
                # No data — sample from prior (uniform-ish)
                sampled = random.gauss(0.5, 0.3)
            else:
                mean = feat["reward_sum"] / count
                variance = max(0.01, (feat["reward_sq_sum"] / count) - mean ** 2)
                std = math.sqrt(variance / max(1, count))
                # Thompson sample
                sampled = random.gauss(mean, std)
            score += x * sampled

        # Normalize by number of active features
        active = sum(1 for x in feature_vector if x > 0)
        if active > 0:
            score /= active

        # Add base rate (overall arm performance)
        if arm["total_count"] > 0:
            base_rate = arm["total_reward"] / arm["total_count"]
            score = 0.5 * score + 0.5 * base_rate

        return score

    def update(self, arm_id: str, feature_vector: list[float], reward: float) -> None:
        """Update the posterior for this arm given observed reward."""
        arm = self.get_or_init_arm(arm_id)
        arm["total_count"] += 1
        arm["total_reward"] += reward
        for i, x in enumerate(feature_vector):
            if x == 0.0:
                continue
            feat = arm["features"][i]
            feat["count"] += 1
            feat["reward_sum"] += reward
            feat["reward_sq_sum"] += reward * reward

    def arm_summary(self, arm_id: str) -> dict:
        arm = self.get_or_init_arm(arm_id)
        top_features = sorted(
            arm["features"].items(),
            key=lambda kv: kv[1]["reward_sum"] / max(1, kv[1]["count"]),
            reverse=True,
        )[:5]
        return {
            "arm_id": arm_id,
            "total_count": arm["total_count"],
            "avg_reward": round(arm["total_reward"] / max(1, arm["total_count"]), 4),
            "top_features": [
                {
                    "feature": ALL_FEATURES[idx],
                    "count": f["count"],
                    "avg_reward": round(f["reward_sum"] / max(1, f["count"]), 4),
                }
                for idx, f in top_features
            ],
        }


# ─── Persistent router (wraps LinTS with SQLite storage) ───────────────────

class ContextualRouter:
    """Persistent contextual router.

    Stores per-arm, per-feature statistics in SQLite so the router survives
    restarts and can be shared across processes.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._ensure_table()

    def _ensure_table(self):
        conn = store._get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS router_weights (
                id TEXT PRIMARY KEY,
                worker_id TEXT NOT NULL,
                feature_idx INTEGER NOT NULL,
                count INTEGER DEFAULT 0,
                reward_sum REAL DEFAULT 0,
                reward_sq_sum REAL DEFAULT 0,
                updated_at TEXT,
                UNIQUE(worker_id, feature_idx)
            );
            CREATE TABLE IF NOT EXISTS router_arm_stats (
                worker_id TEXT PRIMARY KEY,
                total_count INTEGER DEFAULT 0,
                total_reward REAL DEFAULT 0,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS router_predictions (
                id TEXT PRIMARY KEY,
                prompt_hash TEXT NOT NULL,
                worker_id TEXT NOT NULL,
                predicted_score REAL,
                actual_reward REAL,
                feature_vector TEXT,
                created_at TEXT,
                updated_at TEXT
            );
        """)
        conn.commit()

    def _load_arm(self, conn: sqlite3.Connection, worker_id: str) -> dict:
        row = conn.execute(
            "SELECT * FROM router_arm_stats WHERE worker_id = ?", (worker_id,)
        ).fetchone()
        total_count = row["total_count"] if row else 0
        total_reward = row["total_reward"] if row else 0.0

        feat_rows = conn.execute(
            "SELECT feature_idx, count, reward_sum, reward_sq_sum FROM router_weights WHERE worker_id = ?",
            (worker_id,)
        ).fetchall()
        features = {}
        for r in feat_rows:
            features[r["feature_idx"]] = {
                "count": r["count"],
                "reward_sum": r["reward_sum"],
                "reward_sq_sum": r["reward_sq_sum"],
            }
        return {
            "total_count": total_count,
            "total_reward": total_reward,
            "features": features,
        }

    def _sample_score(self, arm: dict, feature_vector: list[float]) -> float:
        """Sample score from posterior (same logic as LinTS)."""
        score = 0.0
        active = 0
        for i, x in enumerate(feature_vector):
            if x == 0.0:
                continue
            active += 1
            feat = arm["features"].get(i)
            if not feat or feat["count"] == 0:
                sampled = random.gauss(0.5, 0.3)
            else:
                mean = feat["reward_sum"] / feat["count"]
                variance = max(0.01, (feat["reward_sq_sum"] / feat["count"]) - mean ** 2)
                std = math.sqrt(variance / max(1, feat["count"]))
                sampled = random.gauss(mean, std)
            score += x * sampled

        if active > 0:
            score /= active

        if arm["total_count"] > 0:
            base_rate = arm["total_reward"] / arm["total_count"]
            score = 0.5 * score + 0.5 * base_rate

        return score

    def select_workers(
        self,
        prompt: str,
        available_workers: list[dict],
        num_select: int = 2,
    ) -> list[dict]:
        """Select which workers to race for this prompt.

        Args:
            prompt: The user's prompt
            available_workers: List of {worker_id, url} dicts
            num_select: How many workers to select

        Returns: Selected workers (best num_select by sampled score)
        """
        if not available_workers:
            return []
        if len(available_workers) <= num_select:
            return available_workers

        features = extract_features(prompt)
        feature_vector = features_to_vector(features)

        with self._lock:
            conn = store._get_conn()
            scored = []
            for w in available_workers:
                arm = self._load_arm(conn, w["worker_id"])
                score = self._sample_score(arm, feature_vector)
                scored.append((score, w))

            scored.sort(key=lambda x: x[0], reverse=True)
            selected = [w for _, w in scored[:num_select]]

            # Log prediction for later comparison
            prompt_hash = hashlib.md5(prompt.encode()).hexdigest()[:16]
            for score, w in scored:
                conn.execute(
                    """INSERT OR REPLACE INTO router_predictions
                       (id, prompt_hash, worker_id, predicted_score, feature_vector, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?)""",
                    (f"{prompt_hash}_{w['worker_id']}", prompt_hash, w["worker_id"],
                     round(score, 4), json.dumps(features), store.utc_now(), store.utc_now())
                )
            conn.commit()

        return selected

    def record_outcome(
        self,
        prompt: str,
        worker_id: str,
        reward: float,
        won: bool = False,
    ) -> None:
        """Record the outcome of a race for this worker.

        Args:
            prompt: The original prompt
            worker_id: The worker that was scored
            reward: The score (0.0-1.0)
            won: Whether this worker won the race
        """
        features = extract_features(prompt)
        feature_vector = features_to_vector(features)
        prompt_hash = hashlib.md5(prompt.encode()).hexdigest()[:16]

        with self._lock:
            conn = store._get_conn()
            now = store.utc_now()

            # Update arm-level stats
            row = conn.execute(
                "SELECT * FROM router_arm_stats WHERE worker_id = ?", (worker_id,)
            ).fetchone()
            if row:
                conn.execute(
                    "UPDATE router_arm_stats SET total_count = total_count + 1, total_reward = total_reward + ?, updated_at = ? WHERE worker_id = ?",
                    (reward, now, worker_id)
                )
            else:
                conn.execute(
                    "INSERT INTO router_arm_stats (worker_id, total_count, total_reward, updated_at) VALUES (?,?,?,?)",
                    (worker_id, 1, reward, now)
                )

            # Update per-feature stats
            for i, x in enumerate(feature_vector):
                if x == 0.0:
                    continue
                existing = conn.execute(
                    "SELECT * FROM router_weights WHERE worker_id = ? AND feature_idx = ?",
                    (worker_id, i)
                ).fetchone()
                if existing:
                    conn.execute(
                        """UPDATE router_weights SET count = count + 1, reward_sum = reward_sum + ?,
                           reward_sq_sum = reward_sq_sum + ?, updated_at = ?
                           WHERE worker_id = ? AND feature_idx = ?""",
                        (reward, reward * reward, now, worker_id, i)
                    )
                else:
                    conn.execute(
                        """INSERT INTO router_weights (id, worker_id, feature_idx, count, reward_sum, reward_sq_sum, updated_at)
                           VALUES (?,?,?,?,?,?,?)""",
                        (f"{worker_id}_{i}", worker_id, i, 1, reward, reward * reward, now)
                    )

            # Update prediction with actual reward
            conn.execute(
                "UPDATE router_predictions SET actual_reward = ?, updated_at = ? WHERE prompt_hash = ? AND worker_id = ?",
                (round(reward, 4), now, prompt_hash, worker_id)
            )

            conn.commit()

    def record_preference(self, prompt: str, worker_id: str, preference_bonus: float = 0.1) -> None:
        """Record a user preference — boosts the worker's reward.

        This is the preference loop: user selection acts as an additional
        reward signal that adjusts the router's future routing decisions.
        """
        # Record as a positive outcome with bonus
        self.record_outcome(prompt, worker_id, preference_bonus, won=True)

    def get_stats(self) -> dict:
        """Get router statistics."""
        conn = store._get_conn()
        arms = conn.execute("SELECT * FROM router_arm_stats ORDER BY total_count DESC").fetchall()
        total_predictions = conn.execute("SELECT COUNT(*) FROM router_predictions").fetchone()[0]
        predictions_with_reward = conn.execute(
            "SELECT COUNT(*) FROM router_predictions WHERE actual_reward IS NOT NULL"
        ).fetchone()[0]

        # Per-arm feature breakdown
        arm_details = []
        for a in arms:
            wid = a["worker_id"]
            feat_rows = conn.execute(
                """SELECT feature_idx, count, reward_sum FROM router_weights
                   WHERE worker_id = ? ORDER BY reward_sum / MAX(count, 1) DESC LIMIT 5""",
                (wid,)
            ).fetchall()
            top_features = [
                {
                    "feature": ALL_FEATURES[r["feature_idx"]] if r["feature_idx"] < len(ALL_FEATURES) else f"f{r['feature_idx']}",
                    "count": r["count"],
                    "avg_reward": round(r["reward_sum"] / max(1, r["count"]), 4),
                }
                for r in feat_rows
            ]
            arm_details.append({
                "worker_id": wid,
                "total_races": a["total_count"],
                "avg_reward": round(a["total_reward"] / max(1, a["total_count"]), 4),
                "top_features": top_features,
            })

        # Prediction accuracy (correlation between predicted and actual)
        pred_rows = conn.execute(
            "SELECT predicted_score, actual_reward FROM router_predictions WHERE actual_reward IS NOT NULL LIMIT 100"
        ).fetchall()
        if len(pred_rows) > 5:
            pred_scores = [r["predicted_score"] for r in pred_rows]
            actual_scores = [r["actual_reward"] for r in pred_rows]
            # Simple correlation
            n = len(pred_scores)
            mean_p = sum(pred_scores) / n
            mean_a = sum(actual_scores) / n
            cov = sum((p - mean_p) * (a - mean_a) for p, a in zip(pred_scores, actual_scores)) / n
            std_p = math.sqrt(sum((p - mean_p) ** 2 for p in pred_scores) / n)
            std_a = math.sqrt(sum((a - mean_a) ** 2 for a in actual_scores) / n)
            correlation = cov / (std_p * std_a) if std_p > 0 and std_a > 0 else 0
        else:
            correlation = 0

        return {
            "total_arms": len(arms),
            "total_predictions": total_predictions,
            "predictions_with_reward": predictions_with_reward,
            "prediction_correlation": round(correlation, 4),
            "arms": arm_details,
        }

    def get_features(self, prompt: str) -> dict:
        """Get the feature vector for a prompt (for debugging/UI)."""
        return extract_features(prompt)


# ─── Singleton ─────────────────────────────────────────────────────────────

_router: Optional[ContextualRouter] = None
_router_lock = threading.Lock()


def get_router() -> ContextualRouter:
    global _router
    if _router is None:
        with _router_lock:
            if _router is None:
                _router = ContextualRouter()
    return _router
