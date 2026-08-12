"""Append-only receipt ledger for YTL-MCP Research Lab."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from ytl_lab.config import Settings


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_record(record: Dict[str, Any]) -> str:
    canonical = json.dumps(record, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ReceiptLedger:
    def __init__(self, settings: Settings) -> None:
        self.path = settings.receipt_ledger_path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(
        self,
        task_id: str,
        step: str,
        status: str,
        evidence: Dict[str, Any],
        experiment_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        receipt = {
            "receipt_id": f"R-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')}",
            "task_id": task_id,
            "experiment_id": experiment_id,
            "timestamp": _now(),
            "step": step,
            "status": status,
            "evidence": evidence,
        }
        receipt["hash"] = _hash_record(receipt)
        with open(self.path, "a") as f:
            f.write(json.dumps(receipt, ensure_ascii=False) + "\n")
        return receipt

    def read(self) -> List[Dict[str, Any]]:
        if not self.path.exists():
            return []
        rows = []
        with open(self.path, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        return rows

    def for_task(self, task_id: str) -> List[Dict[str, Any]]:
        return [r for r in self.read() if r.get("task_id") == task_id]

    def for_experiment(self, experiment_id: str) -> List[Dict[str, Any]]:
        return [r for r in self.read() if r.get("experiment_id") == experiment_id]

    def last_for_experiment(self, experiment_id: str) -> Optional[Dict[str, Any]]:
        rows = self.for_experiment(experiment_id)
        return rows[-1] if rows else None
