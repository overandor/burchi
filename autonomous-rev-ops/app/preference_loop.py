"""Preference loop — collects (prompt, candidates, chosen) pairs and trains a ranker.

This is the data flywheel: every race produces candidates, user selection
produces preference pairs, and a small ranker learns from them to improve
future routing and scoring.

Components:
  1. PreferenceDataset — stores (prompt, winner, loser, features) pairs in SQLite
  2. PreferenceRanker — a small logistic ranker that scores (prompt, response) pairs
  3. FeedbackPipeline — feeds preferences back into the contextual router

The ranker is intentionally tiny (logistic regression over handcrafted features)
so it trains in milliseconds and needs no GPU. In production this would be
replaced with a small transformer-based reward model, but the interface stays
the same.

Storage: SQLite tables (preference_pairs, ranker_weights)
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import sqlite3
import threading
from collections import defaultdict
from typing import Optional

from app import store_gguf as store
from app.router import extract_features, features_to_vector, ALL_FEATURES, FEATURE_DIM


# ─── Preference dataset ────────────────────────────────────────────────────

class PreferenceDataset:
    """Stores preference pairs from races.

    A preference pair is: (prompt, winner_text, loser_text, winner_id, loser_id, features)
    This is the DPO-style training data.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._ensure_table()

    def _ensure_table(self):
        conn = store._get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS preference_pairs (
                id TEXT PRIMARY KEY,
                race_id TEXT,
                prompt TEXT NOT NULL,
                prompt_hash TEXT NOT NULL,
                winner_worker_id TEXT NOT NULL,
                loser_worker_id TEXT NOT NULL,
                winner_text TEXT DEFAULT '',
                loser_text TEXT DEFAULT '',
                winner_score REAL DEFAULT 0,
                loser_score REAL DEFAULT 0,
                features TEXT DEFAULT '{}',
                source TEXT DEFAULT 'race',
                created_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_pref_prompt_hash ON preference_pairs(prompt_hash);
            CREATE INDEX IF NOT EXISTS idx_pref_winner ON preference_pairs(winner_worker_id);

            CREATE TABLE IF NOT EXISTS ranker_weights (
                id TEXT PRIMARY KEY,
                feature_name TEXT NOT NULL,
                weight REAL DEFAULT 0,
                gradient_sum REAL DEFAULT 0,
                update_count INTEGER DEFAULT 0,
                updated_at TEXT,
                UNIQUE(feature_name)
            );

            CREATE TABLE IF NOT EXISTS ranker_stats (
                id INTEGER PRIMARY KEY DEFAULT 1,
                total_pairs INTEGER DEFAULT 0,
                training_steps INTEGER DEFAULT 0,
                loss_history TEXT DEFAULT '[]',
                accuracy REAL DEFAULT 0,
                updated_at TEXT
            );
        """)
        conn.commit()

    def add_pair(
        self,
        race_id: str,
        prompt: str,
        winner_worker_id: str,
        loser_worker_id: str,
        winner_text: str = "",
        loser_text: str = "",
        winner_score: float = 0.0,
        loser_score: float = 0.0,
        source: str = "race",
    ) -> dict:
        """Add a preference pair from a race outcome."""
        features = extract_features(prompt)
        prompt_hash = hashlib.md5(prompt.encode()).hexdigest()[:16]
        pair_id = f"pref_{hashlib.md5(f'{race_id}_{winner_worker_id}_{loser_worker_id}'.encode()).hexdigest()[:12]}"

        with self._lock:
            conn = store._get_conn()
            conn.execute(
                """INSERT OR REPLACE INTO preference_pairs
                   (id, race_id, prompt, prompt_hash, winner_worker_id, loser_worker_id,
                    winner_text, loser_text, winner_score, loser_score, features, source, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (pair_id, race_id, prompt[:1000], prompt_hash,
                 winner_worker_id, loser_worker_id,
                 winner_text[:2000], loser_text[:2000],
                 winner_score, loser_score,
                 json.dumps(features), source, store.utc_now())
            )
            conn.execute(
                "UPDATE ranker_stats SET total_pairs = total_pairs + 1, updated_at = ? WHERE id = 1",
                (store.utc_now(),)
            )
            conn.commit()

        return {"pair_id": pair_id, "status": "added"}

    def add_user_preference(
        self,
        race_id: str,
        prompt: str,
        chosen_worker_id: str,
        other_workers: list[dict],
    ) -> list[dict]:
        """When a user explicitly picks a worker, create preference pairs
        against all other workers in that race."""
        pairs = []
        for other in other_workers:
            if other["worker_id"] == chosen_worker_id:
                continue
            pair = self.add_pair(
                race_id=race_id,
                prompt=prompt,
                winner_worker_id=chosen_worker_id,
                loser_worker_id=other["worker_id"],
                winner_text=other.get("winner_text", ""),
                loser_text=other.get("loser_text", ""),
                winner_score=other.get("winner_score", 1.0),
                loser_score=other.get("loser_score", 0.0),
                source="user_preference",
            )
            pairs.append(pair)
        return pairs

    def get_pairs(self, limit: int = 100, offset: int = 0) -> list[dict]:
        conn = store._get_conn()
        rows = conn.execute(
            "SELECT * FROM preference_pairs ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset)
        ).fetchall()
        return [
            {
                "id": r["id"],
                "race_id": r["race_id"],
                "prompt": r["prompt"][:200],
                "winner": r["winner_worker_id"],
                "loser": r["loser_worker_id"],
                "winner_score": r["winner_score"],
                "loser_score": r["loser_score"],
                "source": r["source"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]

    def get_training_data(self) -> list[dict]:
        """Get all pairs for training the ranker."""
        conn = store._get_conn()
        rows = conn.execute(
            "SELECT * FROM preference_pairs ORDER BY created_at ASC"
        ).fetchall()
        data = []
        for r in rows:
            features = json.loads(r["features"])
            data.append({
                "prompt": r["prompt"],
                "winner_worker_id": r["winner_worker_id"],
                "loser_worker_id": r["loser_worker_id"],
                "winner_score": r["winner_score"],
                "loser_score": r["loser_score"],
                "features": features,
                "source": r["source"],
            })
        return data

    def stats(self) -> dict:
        conn = store._get_conn()
        total = conn.execute("SELECT COUNT(*) FROM preference_pairs").fetchone()[0]
        by_source = conn.execute(
            "SELECT source, COUNT(*) as count FROM preference_pairs GROUP BY source"
        ).fetchall()
        by_winner = conn.execute(
            "SELECT winner_worker_id, COUNT(*) as wins FROM preference_pairs GROUP BY winner_worker_id ORDER BY wins DESC"
        ).fetchall()
        ranker = conn.execute("SELECT * FROM ranker_stats WHERE id = 1").fetchone()
        return {
            "total_pairs": total,
            "by_source": {r["source"]: r["count"] for r in by_source},
            "by_winner": {r["winner_worker_id"]: r["wins"] for r in by_winner},
            "ranker_trained_steps": ranker["training_steps"] if ranker else 0,
            "ranker_accuracy": ranker["accuracy"] if ranker else 0,
        }


# ─── Preference ranker (small logistic model) ──────────────────────────────

class PreferenceRanker:
    """Small logistic ranker that learns to predict which response is preferred.

    Features: prompt features × worker interaction terms.
    Model: logistic regression (winner probability = sigmoid(w · x))
    Training: online SGD on preference pairs.

    This is deliberately tiny — it trains in milliseconds and needs no GPU.
    The point is to have a learned scoring function that improves with data,
    not to build a state-of-the-art reward model.
    """

    def __init__(self, lr: float = 0.01, l2: float = 0.001):
        self.lr = lr
        self.l2 = l2
        self._lock = threading.Lock()
        self._ensure_table()
        self._load_weights()

    def _ensure_table(self):
        # Tables created by PreferenceDataset._ensure_table
        pass

    def _load_weights(self):
        conn = store._get_conn()
        rows = conn.execute("SELECT feature_name, weight FROM ranker_weights").fetchall()
        self.weights = {r["feature_name"]: r["weight"] for r in rows}
        # Initialize missing features to 0
        for f in ALL_FEATURES:
            if f not in self.weights:
                self.weights[f] = 0.0

    def _save_weights(self):
        conn = store._get_conn()
        now = store.utc_now()
        for fname, w in self.weights.items():
            conn.execute(
                """INSERT OR REPLACE INTO ranker_weights (id, feature_name, weight, updated_at)
                   VALUES (?,?,?,?)""",
                (f"rw_{fname}", fname, w, now)
            )
        conn.commit()

    def _score(self, features: dict, worker_id: str) -> float:
        """Score a (prompt_features, worker) pair — higher = more likely preferred."""
        score = 0.0
        for fname, val in features.items():
            if val == 0.0:
                continue
            # Feature weight + worker-specific bias
            key = f"{fname}"
            score += self.weights.get(key, 0.0) * val
            # Worker interaction term
            worker_key = f"{worker_id}:{fname}"
            score += self.weights.get(worker_key, 0.0) * val
        # Worker bias
        score += self.weights.get(f"bias:{worker_id}", 0.0)
        return score

    def _sigmoid(self, x: float) -> float:
        if x > 30:
            return 1.0
        if x < -30:
            return 0.0
        return 1.0 / (1.0 + math.exp(-x))

    def predict_preference(
        self, prompt: str, worker_a_id: str, worker_b_id: str
    ) -> dict:
        """Predict which worker is preferred for this prompt.

        Returns: {preferred: worker_id, prob_a: float, prob_b: float, confidence: float}
        """
        features = extract_features(prompt)
        score_a = self._score(features, worker_a_id)
        score_b = self._score(features, worker_b_id)
        # P(A preferred) = sigmoid(score_a - score_b)
        diff = score_a - score_b
        prob_a = self._sigmoid(diff)
        prob_b = 1.0 - prob_a
        preferred = worker_a_id if prob_a > prob_b else worker_b_id
        return {
            "preferred": preferred,
            "prob_a": round(prob_a, 4),
            "prob_b": round(prob_b, 4),
            "confidence": round(abs(prob_a - prob_b), 4),
            "score_a": round(score_a, 4),
            "score_b": round(score_b, 4),
        }

    def train_step(self, pairs: list[dict]) -> dict:
        """Train the ranker on preference pairs using online SGD.

        For each pair (winner, loser):
          loss = -log(sigmoid(score(winner) - score(loser)))
          gradient updates weights via SGD
        """
        if not pairs:
            return {"trained": 0, "loss": 0, "accuracy": 0}

        total_loss = 0.0
        correct = 0

        with self._lock:
            for pair in pairs:
                features = pair["features"]
                if isinstance(features, str):
                    features = json.loads(features)

                winner_id = pair["winner_worker_id"]
                loser_id = pair["loser_worker_id"]

                score_w = self._score(features, winner_id)
                score_l = self._score(features, loser_id)
                diff = score_w - score_l

                # Loss and gradient
                prob = self._sigmoid(diff)
                loss = -math.log(max(prob, 1e-7))
                total_loss += loss

                if prob > 0.5:
                    correct += 1

                # Gradient: d(loss)/d(diff) = -(1 - prob)
                grad_diff = -(1 - prob)

                # Update weights for winner (increase) and loser (decrease)
                for fname, val in features.items():
                    if val == 0.0:
                        continue
                    # Feature weight
                    key = fname
                    self.weights[key] -= self.lr * (grad_diff * val + self.l2 * self.weights.get(key, 0))
                    # Worker interaction terms
                    wkey_w = f"{winner_id}:{fname}"
                    self.weights[wkey_w] = self.weights.get(wkey_w, 0) - self.lr * (grad_diff * val + self.l2 * self.weights.get(wkey_w, 0))
                    wkey_l = f"{loser_id}:{fname}"
                    self.weights[wkey_l] = self.weights.get(wkey_l, 0) + self.lr * (grad_diff * val + self.l2 * self.weights.get(wkey_l, 0))

                # Worker bias
                bias_w = f"bias:{winner_id}"
                self.weights[bias_w] = self.weights.get(bias_w, 0) - self.lr * (grad_diff + self.l2 * self.weights.get(bias_w, 0))
                bias_l = f"bias:{loser_id}"
                self.weights[bias_l] = self.weights.get(bias_l, 0) + self.lr * (grad_diff + self.l2 * self.weights.get(bias_l, 0))

            self._save_weights()

            # Update stats
            n = len(pairs)
            avg_loss = total_loss / n
            accuracy = correct / n

            conn = store._get_conn()
            row = conn.execute("SELECT * FROM ranker_stats WHERE id = 1").fetchone()
            steps = (row["training_steps"] if row else 0) + 1
            loss_hist = json.loads(row["loss_history"] if row and row["loss_history"] else "[]")
            loss_hist.append(round(avg_loss, 4))
            loss_hist = loss_hist[-50:]  # Keep last 50

            conn.execute(
                """INSERT OR REPLACE INTO ranker_stats (id, total_pairs, training_steps, loss_history, accuracy, updated_at)
                   VALUES (1, ?, ?, ?, ?, ?)""",
                (conn.execute("SELECT COUNT(*) FROM preference_pairs").fetchone()[0],
                 steps, json.dumps(loss_hist), round(accuracy, 4), store.utc_now())
            )
            conn.commit()

            return {
                "trained": n,
                "loss": round(avg_loss, 4),
                "accuracy": round(accuracy, 4),
                "training_steps": steps,
            }

    def train_on_dataset(self, max_pairs: int = 1000) -> dict:
        """Train on all available preference pairs."""
        ds = PreferenceDataset()
        pairs = ds.get_training_data()[:max_pairs]
        return self.train_step(pairs)

    def get_weights(self) -> dict:
        """Get top weights by magnitude."""
        sorted_weights = sorted(
            self.weights.items(),
            key=lambda x: abs(x[1]),
            reverse=True,
        )[:20]
        return {k: round(v, 4) for k, v in sorted_weights}


# ─── Feedback pipeline ─────────────────────────────────────────────────────

class FeedbackPipeline:
    """Connects the preference loop back to the contextual router.

    When a user expresses a preference:
      1. Store the preference pair
      2. Train the ranker on it
      3. Feed the preference back into the contextual router as a reward signal
      4. The router's future worker selection is now influenced by this preference
    """

    def __init__(self):
        self.dataset = PreferenceDataset()
        self.ranker = PreferenceRanker()
        self._lock = threading.Lock()

    def record_race_outcome(
        self,
        race_id: str,
        prompt: str,
        workers: list[dict],
        winner_id: str,
        scores: dict[str, float],
        texts: dict[str, str],
    ) -> dict:
        """Record a race outcome as preference pairs.

        Creates pairs: (winner, each_loser) for all non-winner workers.
        """
        pairs_created = []
        for w in workers:
            wid = w["worker_id"]
            if wid == winner_id:
                continue
            pair = self.dataset.add_pair(
                race_id=race_id,
                prompt=prompt,
                winner_worker_id=winner_id,
                loser_worker_id=wid,
                winner_text=texts.get(winner_id, ""),
                loser_text=texts.get(wid, ""),
                winner_score=scores.get(winner_id, 0),
                loser_score=scores.get(wid, 0),
                source="race",
            )
            pairs_created.append(pair)

        # Train ranker on new pairs
        if pairs_created:
            train_result = self.ranker.train_on_dataset(max_pairs=200)

            # Feed back into contextual router
            from app.router import get_router
            router = get_router()
            for w in workers:
                wid = w["worker_id"]
                reward = scores.get(wid, 0)
                router.record_outcome(prompt, wid, reward, won=(wid == winner_id))

            return {
                "pairs_created": len(pairs_created),
                "ranker": train_result,
                "router_updated": True,
            }

        return {"pairs_created": 0, "ranker": None, "router_updated": False}

    def record_user_preference(
        self,
        race_id: str,
        prompt: str,
        chosen_worker_id: str,
        all_workers: list[dict],
        texts: dict[str, str] = None,
    ) -> dict:
        """Record an explicit user preference and feed it back.

        User preferences are weighted more heavily than race outcomes.
        """
        texts = texts or {}
        pairs = self.dataset.add_user_preference(
            race_id=race_id,
            prompt=prompt,
            chosen_worker_id=chosen_worker_id,
            other_workers=[
                {"worker_id": w["worker_id"],
                 "winner_text": texts.get(chosen_worker_id, ""),
                 "loser_text": texts.get(w["worker_id"], ""),
                 "winner_score": 1.0,
                 "loser_score": 0.0}
                for w in all_workers
            ],
        )

        # Train ranker with higher weight on user preferences
        train_result = self.ranker.train_on_dataset(max_pairs=200)

        # Feed back into router with bonus
        from app.router import get_router
        router = get_router()
        router.record_preference(prompt, chosen_worker_id, preference_bonus=0.15)
        for w in all_workers:
            if w["worker_id"] != chosen_worker_id:
                # Slight penalty for unchosen workers
                router.record_outcome(prompt, w["worker_id"], 0.0, won=False)

        return {
            "pairs_created": len(pairs),
            "ranker": train_result,
            "router_updated": True,
            "chosen_worker": chosen_worker_id,
        }

    def get_status(self) -> dict:
        return {
            "dataset": self.dataset.stats(),
            "ranker_weights": self.ranker.get_weights(),
        }


# ─── Singletons ────────────────────────────────────────────────────────────

_dataset: Optional[PreferenceDataset] = None
_ranker: Optional[PreferenceRanker] = None
_pipeline: Optional[FeedbackPipeline] = None
_singleton_lock = threading.Lock()


def get_dataset() -> PreferenceDataset:
    global _dataset
    if _dataset is None:
        with _singleton_lock:
            if _dataset is None:
                _dataset = PreferenceDataset()
    return _dataset


def get_ranker() -> PreferenceRanker:
    global _ranker
    if _ranker is None:
        with _singleton_lock:
            if _ranker is None:
                _ranker = PreferenceRanker()
    return _ranker


def get_pipeline() -> FeedbackPipeline:
    global _pipeline
    if _pipeline is None:
        with _singleton_lock:
            if _pipeline is None:
                _pipeline = FeedbackPipeline()
    return _pipeline
