"""Lab tools for YouTube automation research."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from ytl_lab.config import Settings
from ytl_lab.db import LabDB
from ytl_lab.receipts import ReceiptLedger


def _extract_id(url: str) -> str:
    """Best-effort YouTube ID extraction. Returns empty string if unknown."""
    patterns = [
        r"(?:v=|/)([0-9A-Za-z_-]{11})",
        r"youtu\.be/([0-9A-Za-z_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return ""


def _score_transcript(text: str) -> Tuple[float, str]:
    """Score transcript utility for a research experiment."""
    if not text or len(text.strip()) < 20:
        return 0.0, "too_short"
    words = text.split()
    signals = {
        "how_to": len([w for w in words if w.lower() in {"how", "tutorial", "guide", "step"}]),
        "explainer": len([w for w in words if w.lower() in {"why", "because", "means", "explain"}]),
        "technical": len([w for w in words if w.lower() in {"api", "code", "build", "deploy", "model", "data"}]),
        "narrative": len([w for w in words if w.lower() in {"story", "we", "our", "i", "my"}]),
    }
    total = sum(signals.values())
    density = total / max(len(words), 1)
    score = min(1.0, density * 3 + 0.2)
    dominant = max(signals, key=lambda k: signals[k])
    return round(score, 3), dominant


class LabTools:
    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or Settings.load_settings()
        self.db = LabDB(self.settings)
        self.ledger = ReceiptLedger(self.settings, db=self.db)

    def ingest_video(self, task_id: str, intent: str, video_url: str) -> Dict[str, Any]:
        experiment_id = f"YTL-{uuid.uuid4().hex[:8]}"
        self.db.create_experiment(experiment_id, task_id, intent, video_url)

        # Simulated transcript (in production, fetch from captions API)
        video_id = _extract_id(video_url)
        transcript = (
            f"This is a simulated transcript for video {video_id}. "
            "We will walk through how to build an API, deploy a model, and explain the code step by step."
        )
        self.db.update_experiment(experiment_id, transcript=transcript)

        receipt = self.ledger.write(
            task_id=task_id,
            experiment_id=experiment_id,
            step="ingest_video",
            status="success",
            evidence={"video_url": video_url, "video_id": video_id, "transcript_length": len(transcript)},
        )
        return {
            "experiment_id": experiment_id,
            "task_id": task_id,
            "transcript": transcript,
            "receipt": receipt,
        }

    def score_transcript(self, experiment_id: str) -> Dict[str, Any]:
        exp = self.db.get_experiment(experiment_id)
        if not exp:
            raise ValueError(f"Experiment {experiment_id} not found")
        score, dominant = _score_transcript(exp.get("transcript", ""))
        self.db.update_experiment(experiment_id, transcript_score=score)

        receipt = self.ledger.write(
            task_id=exp["task_id"],
            experiment_id=experiment_id,
            step="score_transcript",
            status="success",
            evidence={"score": score, "dominant_signal": dominant},
        )
        return {
            "experiment_id": experiment_id,
            "score": score,
            "dominant_signal": dominant,
            "receipt": receipt,
        }

    def generate_script(self, experiment_id: str) -> Dict[str, Any]:
        exp = self.db.get_experiment(experiment_id)
        if not exp:
            raise ValueError(f"Experiment {experiment_id} not found")
        script = (
            f"# Script Candidate for {experiment_id}\n\n"
            f"Intent: {exp['intent']}\n\n"
            f"Hook: Start with the problem the original video addresses.\n"
            f"Body: Explain the core mechanism using the transcript below.\n"
            f"Transcript excerpt: {exp['transcript'][:200]}...\n\n"
            f"CTA: Encourage the viewer to run the experiment and check the receipt."
        )
        self.db.update_experiment(experiment_id, script_candidate=script)
        receipt = self.ledger.write(
            task_id=exp["task_id"],
            experiment_id=experiment_id,
            step="generate_script",
            status="success",
            evidence={"script_length": len(script)},
        )
        return {"experiment_id": experiment_id, "script": script, "receipt": receipt}

    def generate_metadata(self, experiment_id: str) -> Dict[str, Any]:
        exp = self.db.get_experiment(experiment_id)
        if not exp:
            raise ValueError(f"Experiment {experiment_id} not found")
        title = f"Research Replay: {exp['intent'][:60]}"
        description = (
            f"A receipt-backed research experiment derived from {exp['video_url']}.\n"
            f"Transcript score: {exp['transcript_score']}.\n"
            "Status: pending human policy approval."
        )
        tags = ["research", "ai", "experiment", "receipt-backed"]
        metadata = {"title": title, "description": description, "tags": tags, "privacy": "private"}
        self.db.update_experiment(experiment_id, metadata_candidate=json.dumps(metadata))
        receipt = self.ledger.write(
            task_id=exp["task_id"],
            experiment_id=experiment_id,
            step="generate_metadata",
            status="success",
            evidence=metadata,
        )
        return {"experiment_id": experiment_id, "metadata": metadata, "receipt": receipt}

    def generate_shotlist(self, experiment_id: str) -> Dict[str, Any]:
        exp = self.db.get_experiment(experiment_id)
        if not exp:
            raise ValueError(f"Experiment {experiment_id} not found")
        shotlist = [
            {"shot": 1, "type": "title", "content": "Title card with intent"},
            {"shot": 2, "type": "clip", "content": "Original video excerpt (fair use / licensed)"},
            {"shot": 3, "type": "diagram", "content": "System architecture diagram"},
            {"shot": 4, "type": "terminal", "content": "CLI demonstration"},
            {"shot": 5, "type": "outro", "content": "Receipt hash and CTA"},
        ]
        self.db.update_experiment(experiment_id, shotlist_candidate=json.dumps(shotlist))
        receipt = self.ledger.write(
            task_id=exp["task_id"],
            experiment_id=experiment_id,
            step="generate_shotlist",
            status="success",
            evidence={"shot_count": len(shotlist)},
        )
        return {"experiment_id": experiment_id, "shotlist": shotlist, "receipt": receipt}

    def policy_check(self, experiment_id: str) -> Dict[str, Any]:
        exp = self.db.get_experiment(experiment_id)
        if not exp:
            raise ValueError(f"Experiment {experiment_id} not found")

        violations = []
        if not exp["transcript"] or len(exp["transcript"]) < 20:
            violations.append("transcript_too_short")
        if exp["transcript_score"] < 0.15:
            violations.append("low_signal")
        if "spam" in exp["intent"].lower() or "fake" in exp["intent"].lower():
            violations.append("suspicious_intent")

        status = "approved" if not violations else "rejected"
        approval_receipt = self.ledger.write(
            task_id=exp["task_id"],
            experiment_id=experiment_id,
            step="policy_check",
            status=status,
            evidence={"violations": violations, "score": exp["transcript_score"]},
        )
        self.db.update_experiment(
            experiment_id,
            policy_status=status,
            approval_receipt_id=approval_receipt["receipt_id"],
        )
        return {
            "experiment_id": experiment_id,
            "policy_status": status,
            "violations": violations,
            "receipt": approval_receipt,
        }

    def prepare_upload_package(self, experiment_id: str) -> Dict[str, Any]:
        exp = self.db.get_experiment(experiment_id)
        if not exp:
            raise ValueError(f"Experiment {experiment_id} not found")
        if exp["policy_status"] != "approved":
            raise ValueError(f"Experiment {experiment_id} not approved. Run policy-check first.")

        package = {
            "experiment_id": experiment_id,
            "metadata": exp.get("metadata_candidate", {}),
            "script": exp.get("script_candidate", ""),
            "shotlist": exp.get("shotlist_candidate", []),
            "privacy_status": "private",
            "receipts": [r["receipt_id"] for r in self.ledger.for_experiment(experiment_id)],
        }
        self.db.update_experiment(experiment_id, upload_status="package_ready")
        receipt = self.ledger.write(
            task_id=exp["task_id"],
            experiment_id=experiment_id,
            step="prepare_upload_package",
            status="success",
            evidence={"package_fields": list(package.keys())},
        )
        return {"experiment_id": experiment_id, "package": package, "receipt": receipt}

    def create_project(self, project_id: str, name: str) -> Dict[str, Any]:
        self.db.create_project(project_id, name)
        return {"project_id": project_id, "name": name, "status": "created"}

    def list_projects(self, limit: int = 100) -> Dict[str, Any]:
        return {"projects": self.db.list_projects(limit)}

    def create_research_query(
        self,
        query_id: str,
        project_id: str,
        query: str,
        status: str = "open",
    ) -> Dict[str, Any]:
        self.db.create_research_query(query_id, project_id, query, status)
        return {"query_id": query_id, "project_id": project_id, "query": query, "status": status}

    def list_research_queries(
        self,
        project_id: Optional[str] = None,
        limit: int = 100,
    ) -> Dict[str, Any]:
        return {"queries": self.db.list_research_queries(project_id=project_id, limit=limit)}

    def status(self) -> Dict[str, Any]:
        return {
            "db_path": str(self.settings.db_path),
            "receipt_ledger_path": str(self.settings.receipt_ledger_path),
            "summary": self.db.summary(),
            "recent_receipts": self.ledger.read()[-5:],
        }
