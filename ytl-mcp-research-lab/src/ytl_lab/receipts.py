"""Append-only receipt ledger for YTL-MCP Research Lab."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from ytl_lab.config import Settings

if TYPE_CHECKING:
    from ytl_lab.db import LabDB


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_record(record: Dict[str, Any]) -> str:
    canonical = json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ReceiptLedger:
    def __init__(self, settings: Settings, db: Optional["LabDB"] = None) -> None:
        self.path = settings.receipt_ledger_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = db

    def write(
        self,
        task_id: str,
        step: str,
        status: str,
        evidence: Dict[str, Any],
        experiment_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        receipt = {
            "schema": "ytl_lab.receipt.v1",
            "receipt_id": f"R-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')}",
            "task_id": task_id,
            "experiment_id": experiment_id,
            "timestamp": _now(),
            "step": step,
            "status": status,
            "evidence": evidence,
        }
        receipt["hash"] = _hash_record(receipt)
        self._append_line(json.dumps(receipt, ensure_ascii=False, separators=(",", ":")))
        if self.db is not None:
            self.db.insert_receipt(receipt)
        return receipt

    def _append_line(self, line: str) -> None:
        import fcntl

        with open(self.path, "a", encoding="utf-8") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                f.write(line)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)

    def read(self) -> List[Dict[str, Any]]:
        if not self.path.exists():
            return []
        rows = []
        with open(self.path, "r", encoding="utf-8") as f:
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

    def verify_chain(self) -> Dict[str, Any]:
        rows = self.read()
        broken = []
        verified = 0
        for i, row in enumerate(rows):
            if "hash" not in row:
                continue  # legacy entry, skip
            recompute = _hash_record({k: v for k, v in row.items() if k != "hash"})
            if recompute != row.get("hash"):
                broken.append({"index": i, "receipt_id": row.get("receipt_id"), "error": "hash_mismatch"})
                continue
            if i > 0:
                prev_row = rows[i - 1]
                expected_prev = prev_row.get("hash", "")
                actual_prev = row.get("prev_hash", "")
                # Empty prev_hash is allowed as a transition from pre-chain receipts.
                # Once set, it must match the previous hash.
                if actual_prev and actual_prev != expected_prev:
                    broken.append({"index": i, "receipt_id": row.get("receipt_id"), "error": "chain_break"})
                    continue
            verified += 1
        return {"total": len(rows), "verified": verified, "broken": broken}
