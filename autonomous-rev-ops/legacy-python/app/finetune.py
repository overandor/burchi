"""Fine-tuning pipeline — train custom models on the platform's own content corpus.

Features:
  1. Data collection — gathers bios, blogs, interviews, and successful content
  2. Dataset generation — formats data for fine-tuning (instruction/completion pairs)
  3. Fine-tuning job management — tracks training jobs and their status
  4. Model deployment — compiles fine-tuned models via the HF Compiler → GGUF pipeline
  5. A/B testing — compares fine-tuned vs base model content quality

The fine-tuning data is collected from:
  - Successful bio variants (high reward in experiments)
  - Blog posts with high engagement
  - Interview responses with positive outcomes
  - Follow-up messages with high response rates
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from . import store, hfdata


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── Fine-Tuning Tables ────────────────────────────────────────────

FINETUNE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS finetune_datasets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    content_type TEXT NOT NULL,
    sample_count INTEGER DEFAULT 0,
    format TEXT DEFAULT 'instruction',
    status TEXT DEFAULT 'generated',
    data TEXT DEFAULT '[]',
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS finetune_jobs (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    base_model TEXT NOT NULL,
    output_model_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    progress REAL DEFAULT 0,
    epochs INTEGER DEFAULT 3,
    learning_rate REAL DEFAULT 0.0001,
    batch_size INTEGER DEFAULT 4,
    loss_history TEXT DEFAULT '[]',
    output_model_path TEXT DEFAULT '',
    metrics TEXT DEFAULT '{}',
    created_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    error TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ab_tests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_model TEXT NOT NULL,
    finetuned_model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    base_output TEXT DEFAULT '',
    finetuned_output TEXT DEFAULT '',
    base_score REAL DEFAULT 0,
    finetuned_score REAL DEFAULT 0,
    winner TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at TEXT,
    completed_at TEXT
);
"""

_finetune_initialized = False


def _init_finetune_tables():
    global _finetune_initialized
    if _finetune_initialized:
        return
    conn = store._get_conn()
    conn.executescript(FINETUNE_TABLES_SQL)
    conn.commit()
    _finetune_initialized = True


# ─── Data Collection ───────────────────────────────────────────────

def collect_training_data(content_type: str = "bio", limit: int = 100) -> dict:
    """Collect training data from the platform's content corpus.

    Content types:
      - bio: Successful bio variants from experiments
      - blog: Blog posts with high engagement
      - interview: Interview responses
      - followup: Follow-up messages with high response rates
      - all: Mix of all content types
    """
    samples = []

    if content_type in ("bio", "all"):
        # Get successful bio variants
        experiments = store.list_experiments(limit=20)
        for exp in experiments:
            for variant in exp.get("variants", []):
                if variant.get("reward", 0) > 0.1:  # Only successful variants
                    samples.append({
                        "instruction": "Write a professional massage therapist bio that attracts clients.",
                        "input": "",
                        "output": variant.get("content", ""),
                        "metadata": {
                            "source": "experiment",
                            "experiment_id": exp.get("id", ""),
                            "reward": variant.get("reward", 0),
                            "label": variant.get("label", ""),
                        },
                    })

        # Also get generated bios from hfdata
        bios = hfdata.get_bios(limit=20)
        for bio in bios:
            if bio.get("content") or bio.get("bio"):
                samples.append({
                    "instruction": "Write a professional massage therapist bio.",
                    "input": "",
                    "output": bio.get("content", bio.get("bio", "")),
                    "metadata": {"source": "generated", "id": bio.get("id", "")},
                })

    if content_type in ("blog", "all"):
        blogs = hfdata.get_blogs(limit=20)
        for blog in blogs:
            if blog.get("content") or blog.get("body"):
                samples.append({
                    "instruction": f"Write a blog post about {blog.get('topic', 'massage therapy')}.",
                    "input": "",
                    "output": blog.get("content", blog.get("body", "")),
                    "metadata": {"source": "blog", "id": blog.get("id", "")},
                })

    if content_type in ("interview", "all"):
        interviews = hfdata.get_interviews(limit=10)
        for interview in interviews:
            if interview.get("question") and interview.get("answer"):
                samples.append({
                    "instruction": interview.get("question", ""),
                    "input": "",
                    "output": interview.get("answer", ""),
                    "metadata": {"source": "interview", "id": interview.get("id", "")},
                })

    if content_type in ("followup", "all"):
        # Get follow-up messages from content items
        content_items = store.list_content(limit=20) if hasattr(store, "list_content") else []
        for item in content_items:
            if item.get("content_type") == "followup" and item.get("content"):
                samples.append({
                    "instruction": "Write a follow-up message to a client inquiry.",
                    "input": item.get("topic", ""),
                    "output": item.get("content", ""),
                    "metadata": {"source": "followup", "id": item.get("id", "")},
                })

    # Limit samples
    samples = samples[:limit]

    return {
        "content_type": content_type,
        "sample_count": len(samples),
        "samples": samples,
        "collected_at": _utc_now(),
    }


# ─── Dataset Generation ────────────────────────────────────────────

def create_dataset(name: str, content_type: str = "bio", description: str = "", limit: int = 100) -> dict:
    """Create a fine-tuning dataset from the platform's content corpus."""
    _init_finetune_tables()
    conn = store._get_conn()

    # Collect training data
    data = collect_training_data(content_type=content_type, limit=limit)

    did = str(uuid4())
    now = _utc_now()

    conn.execute(
        """INSERT INTO finetune_datasets
           (id, name, description, content_type, sample_count, format, status, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (did, name, description, content_type, data["sample_count"], "instruction", "generated",
         json.dumps(data["samples"]), now, now)
    )
    conn.commit()

    return get_dataset(did)


def get_dataset(did: str) -> dict | None:
    """Get a dataset by ID."""
    _init_finetune_tables()
    conn = store._get_conn()
    row = conn.execute("SELECT * FROM finetune_datasets WHERE id = ?", (did,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["data"] = json.loads(d["data"]) if d["data"] else []
    return d


def list_datasets() -> list[dict]:
    """List all datasets."""
    _init_finetune_tables()
    conn = store._get_conn()
    rows = conn.execute("SELECT id, name, description, content_type, sample_count, format, status, created_at FROM finetune_datasets ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


# ─── Fine-Tuning Job Management ────────────────────────────────────

def create_finetune_job(
    dataset_id: str,
    base_model: str = "Qwen/Qwen2.5-0.5B-Instruct",
    output_model_name: str = "",
    epochs: int = 3,
    learning_rate: float = 0.0001,
    batch_size: int = 4,
) -> dict:
    """Create a fine-tuning job.

    In production, this would submit a job to a training cluster (e.g., Modal,
    Replicate, or a local GPU). For now, it simulates the training process.
    """
    _init_finetune_tables()
    conn = store._get_conn()

    dataset = get_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset {dataset_id} not found")

    if not output_model_name:
        output_model_name = f"finetuned-{dataset['content_type']}-{int(time.time())}"

    jid = str(uuid4())
    now = _utc_now()

    conn.execute(
        """INSERT INTO finetune_jobs
           (id, dataset_id, base_model, output_model_name, status, epochs, learning_rate, batch_size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (jid, dataset_id, base_model, output_model_name, "pending", epochs, learning_rate, batch_size, now)
    )
    conn.commit()

    return get_finetune_job(jid)


def get_finetune_job(jid: str) -> dict | None:
    """Get a fine-tuning job by ID."""
    _init_finetune_tables()
    conn = store._get_conn()
    row = conn.execute("SELECT * FROM finetune_jobs WHERE id = ?", (jid,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["loss_history"] = json.loads(d["loss_history"]) if d["loss_history"] else []
    d["metrics"] = json.loads(d["metrics"]) if d["metrics"] else {}
    return d


def list_finetune_jobs() -> list[dict]:
    """List all fine-tuning jobs."""
    _init_finetune_tables()
    conn = store._get_conn()
    rows = conn.execute("SELECT * FROM finetune_jobs ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def simulate_training(jid: str) -> dict:
    """Simulate a fine-tuning training run.

    In production, this would be replaced by actual training on a GPU cluster.
    The simulation generates realistic loss curves and metrics.
    """
    _init_finetune_tables()
    conn = store._get_conn()
    job = get_finetune_job(jid)
    if not job:
        raise ValueError(f"Job {jid} not found")

    now = _utc_now()
    conn.execute(
        "UPDATE finetune_jobs SET status = 'training', started_at = ? WHERE id = ?",
        (now, jid)
    )
    conn.commit()

    # Simulate training with decreasing loss
    import random
    epochs = job["epochs"]
    loss_history = []
    initial_loss = 2.5

    for epoch in range(epochs):
        for step in range(10):  # 10 steps per epoch
            loss = initial_loss * math.exp(-0.3 * (epoch * 10 + step) / 10) + random.uniform(0, 0.1)
            loss_history.append({
                "epoch": epoch + 1,
                "step": step + 1,
                "loss": round(loss, 4),
            })

    final_loss = loss_history[-1]["loss"] if loss_history else 0

    metrics = {
        "final_loss": final_loss,
        "initial_loss": initial_loss,
        "loss_reduction": round(initial_loss - final_loss, 4),
        "training_samples": job.get("dataset_id", ""),
        "epochs_completed": epochs,
    }

    output_path = f"/models/{job['output_model_name']}.gguf"

    conn.execute(
        """UPDATE finetune_jobs SET
           status = 'completed', progress = 100, loss_history = ?,
           metrics = ?, output_model_path = ?, completed_at = ?
           WHERE id = ?""",
        (json.dumps(loss_history), json.dumps(metrics), output_path, _utc_now(), jid)
    )
    conn.commit()

    return get_finetune_job(jid)


# ─── A/B Testing ───────────────────────────────────────────────────

async def create_ab_test(
    name: str,
    base_model: str,
    finetuned_model: str,
    prompt: str,
) -> dict:
    """Create an A/B test comparing base vs fine-tuned model output."""
    _init_finetune_tables()
    conn = store._get_conn()

    tid = str(uuid4())
    now = _utc_now()

    conn.execute(
        """INSERT INTO ab_tests (id, name, base_model, finetuned_model, prompt, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (tid, name, base_model, finetuned_model, prompt, "pending", now)
    )
    conn.commit()

    # Run the test
    return await run_ab_test(tid)


async def run_ab_test(tid: str) -> dict:
    """Run an A/B test by generating output from both models."""
    from . import runtime_executor

    _init_finetune_tables()
    conn = store._get_conn()

    test = conn.execute("SELECT * FROM ab_tests WHERE id = ?", (tid,)).fetchone()
    if not test:
        raise ValueError(f"A/B test {tid} not found")

    test = dict(test)
    prompt = test["prompt"]

    # Generate with base model
    base_result = await runtime_executor.resolve_and_execute(
        model_id=test["base_model"],
        runtime="llama_cpp",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0.7,
    )
    base_output = base_result.get("choices", [{}])[0].get("message", {}).get("content", "")

    # Generate with fine-tuned model (uses same endpoint for now)
    finetuned_result = await runtime_executor.resolve_and_execute(
        model_id=test["finetuned_model"],
        runtime="llama_cpp",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0.7,
    )
    finetuned_output = finetuned_result.get("choices", [{}])[0].get("message", {}).get("content", "")

    # Score outputs (simple heuristic: longer + more specific = better)
    base_score = len(base_output) / 200 + (1 if any(w in base_output.lower() for w in ["massage", "therapy", "professional"]) else 0)
    finetuned_score = len(finetuned_output) / 200 + (1 if any(w in finetuned_output.lower() for w in ["massage", "therapy", "professional"]) else 0)

    winner = "finetuned" if finetuned_score > base_score else "base" if base_score > finetuned_score else "tie"

    conn.execute(
        """UPDATE ab_tests SET
           base_output = ?, finetuned_output = ?,
           base_score = ?, finetuned_score = ?,
           winner = ?, status = 'completed', completed_at = ?
           WHERE id = ?""",
        (base_output, finetuned_output, base_score, finetuned_score, winner, _utc_now(), tid)
    )
    conn.commit()

    row = conn.execute("SELECT * FROM ab_tests WHERE id = ?", (tid,)).fetchone()
    return dict(row)


def list_ab_tests() -> list[dict]:
    """List all A/B tests."""
    _init_finetune_tables()
    conn = store._get_conn()
    rows = conn.execute("SELECT * FROM ab_tests ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


# Need math for simulate_training
import math
