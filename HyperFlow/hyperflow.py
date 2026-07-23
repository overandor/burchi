#!/usr/bin/env python3
"""
HyperFlow CLI — task ledger, receipt, diff, and verify commands.

Usage:
    python3 hyperflow.py task add --title "..." --agent windsurf --files a.py b.py
    python3 hyperflow.py task list
    python3 hyperflow.py task update HF-001 --status completed
    python3 hyperflow.py receipt add --task HF-001 --type build --status pass --evidence "pytest -v"
    python3 hyperflow.py receipt list
    python3 hyperflow.py diff
    python3 hyperflow.py verify
    python3 hyperflow.py status
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).parent
TASKS_FILE = BASE_DIR / "tasks.jsonl"
RECEIPTS_FILE = BASE_DIR / "receipts.jsonl"
HYDRA_STATE_FILE = BASE_DIR / "HYDRA_STATE.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_jsonl(path: Path) -> List[Dict]:
    if not path.exists():
        return []
    rows = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _append_jsonl(path: Path, row: Dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _write_jsonl(path: Path, rows: List[Dict]):
    with open(path, "w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _next_id(rows: List[Dict], prefix: str) -> str:
    max_num = 0
    for r in rows:
        rid = r.get("receipt_id") or r.get("task_id") or ""
        if rid.startswith(prefix + "-"):
            try:
                num = int(rid.split("-")[1])
                max_num = max(max_num, num)
            except (ValueError, IndexError):
                pass
    return f"{prefix}-{max_num + 1:03d}"


def _git_hash() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=BASE_DIR, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "no-git"


def _git_diff_summary() -> str:
    try:
        return subprocess.check_output(
            ["git", "diff", "--stat"], cwd=BASE_DIR, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "no-git"


# ─── Task commands ───
def cmd_task_add(args):
    tasks = _load_jsonl(TASKS_FILE)
    task_id = _next_id(tasks, "HF")
    task = {
        "task_id": task_id,
        "title": args.title,
        "agent": args.agent,
        "status": "pending",
        "files_affected": args.files or [],
        "risks": args.risks or [],
        "verification": args.verification or "",
        "created_at": _now(),
        "updated_at": _now(),
        "receipt_id": None,
    }
    _append_jsonl(TASKS_FILE, task)
    print(json.dumps(task, indent=2))


def cmd_task_list(args):
    tasks = _load_jsonl(TASKS_FILE)
    if args.status:
        tasks = [t for t in tasks if t.get("status") == args.status]
    for t in tasks:
        print(f"{t['task_id']:8s} | {t['status']:12s} | {t['agent']:10s} | {t['title']}")


def cmd_task_update(args):
    tasks = _load_jsonl(TASKS_FILE)
    updated = False
    for t in tasks:
        if t["task_id"] == args.task_id:
            if args.status:
                t["status"] = args.status
            if args.agent:
                t["agent"] = args.agent
            if args.receipt:
                t["receipt_id"] = args.receipt
            t["updated_at"] = _now()
            updated = True
            break
    if updated:
        _write_jsonl(TASKS_FILE, tasks)
        print(f"Updated {args.task_id}")
    else:
        print(f"Task {args.task_id} not found", file=sys.stderr)
        sys.exit(1)


# ─── Receipt commands ───
def cmd_receipt_add(args):
    receipts = _load_jsonl(RECEIPTS_FILE)
    receipt_id = _next_id(receipts, "R")
    evidence = {}
    if args.evidence:
        parts = args.evidence.split(":", 1)
        evidence["command"] = parts[0]
        if len(parts) > 1:
            evidence["exit_code"] = int(parts[1]) if parts[1].isdigit() else parts[1]

    receipt = {
        "receipt_id": receipt_id,
        "task_id": args.task,
        "agent": args.agent,
        "type": args.type,
        "status": args.status,
        "evidence": evidence,
        "artifacts": args.artifacts or [],
        "commit_hash": _git_hash(),
        "timestamp": _now(),
    }
    _append_jsonl(RECEIPTS_FILE, receipt)
    print(json.dumps(receipt, indent=2))


def cmd_receipt_list(args):
    receipts = _load_jsonl(RECEIPTS_FILE)
    for r in receipts:
        print(f"{r['receipt_id']:8s} | {r['task_id']:8s} | {r['type']:10s} | {r['status']:8s} | {r.get('agent','')}")


# ─── Diff command ───
def cmd_diff(args):
    diff = _git_diff_summary()
    if diff:
        print(diff)
    else:
        print("No uncommitted changes (or not a git repo)")


# ─── Verify command ───
def cmd_verify(args):
    tasks = _load_jsonl(TASKS_FILE)
    receipts = _load_jsonl(RECEIPTS_FILE)

    print(f"Tasks: {len(tasks)}")
    print(f"Receipts: {len(receipts)}")

    completed = [t for t in tasks if t["status"] == "completed"]
    with_receipt = [t for t in completed if t.get("receipt_id")]
    without_receipt = [t for t in completed if not t.get("receipt_id")]

    print(f"Completed: {len(completed)}")
    print(f"  With receipt: {len(with_receipt)}")
    print(f"  Without receipt: {len(without_receipt)}")

    if without_receipt:
        print("\nWARNING: Completed tasks without receipts:")
        for t in without_receipt:
            print(f"  {t['task_id']}: {t.get('objective', t.get('title', 'unknown'))}")

    # Check verification commands
    for t in tasks:
        if t["status"] == "completed" and t.get("verification"):
            print(f"\n  {t['task_id']} verification: {t['verification']}")

    # File checks
    required_files = ["AGENTS.md", "HYPERFLOW.md", "HYDRA.md", "TASK_LEDGER.md"]
    for f in required_files:
        path = BASE_DIR / f
        exists = path.exists()
        print(f"  {f}: {'OK' if exists else 'MISSING'}")


# ─── Status command ───
def cmd_status(args):
    tasks = _load_jsonl(TASKS_FILE)
    receipts = _load_jsonl(RECEIPTS_FILE)

    status_counts = {}
    for t in tasks:
        s = t.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1

    print("=== HyperFlow Status ===")
    print(f"Git: {_git_hash()}")
    print(f"Tasks: {len(tasks)} ({json.dumps(status_counts)})")
    print(f"Receipts: {len(receipts)}")

    if HYDRA_STATE_FILE.exists():
        with open(HYDRA_STATE_FILE) as f:
            state = json.load(f)
        print(f"\nHydra: agent={state.get('active_agent','?')} task={state.get('active_task','?')} status={state.get('task_status','?')}")
    else:
        print("\nHydra: no state file")


# ─── Main ───
def main():
    parser = argparse.ArgumentParser(description="HyperFlow Ledger CLI")
    sub = parser.add_subparsers(dest="command")

    # Task
    p_task = sub.add_parser("task", help="Task ledger operations")
    task_sub = p_task.add_subparsers(dest="task_command")

    p_add = task_sub.add_parser("add", help="Add a task")
    p_add.add_argument("--title", required=True)
    p_add.add_argument("--agent", default="windsurf")
    p_add.add_argument("--files", nargs="*")
    p_add.add_argument("--risks", nargs="*")
    p_add.add_argument("--verification", type=str)
    p_add.set_defaults(func=cmd_task_add)

    p_list = task_sub.add_parser("list", help="List tasks")
    p_list.add_argument("--status", type=str)
    p_list.set_defaults(func=cmd_task_list)

    p_update = task_sub.add_parser("update", help="Update a task")
    p_update.add_argument("task_id", type=str)
    p_update.add_argument("--status", type=str)
    p_update.add_argument("--agent", type=str)
    p_update.add_argument("--receipt", type=str)
    p_update.set_defaults(func=cmd_task_update)

    # Receipt
    p_receipt = sub.add_parser("receipt", help="Receipt operations")
    receipt_sub = p_receipt.add_subparsers(dest="receipt_command")

    p_radd = receipt_sub.add_parser("add", help="Add a receipt")
    p_radd.add_argument("--task", required=True)
    p_radd.add_argument("--agent", default="windsurf")
    p_radd.add_argument("--type", required=True, choices=["build", "test", "lint", "benchmark", "artifact", "commit", "runtime", "receipt"])
    p_radd.add_argument("--status", required=True, choices=["pass", "fail", "pending"])
    p_radd.add_argument("--evidence", type=str, help="command:exit_code")
    p_radd.add_argument("--artifacts", nargs="*")
    p_radd.set_defaults(func=cmd_receipt_add)

    p_rlist = receipt_sub.add_parser("list", help="List receipts")
    p_rlist.set_defaults(func=cmd_receipt_list)

    # Diff
    sub.add_parser("diff", help="Show git diff").set_defaults(func=cmd_diff)

    # Verify
    sub.add_parser("verify", help="Verify task/receipt consistency").set_defaults(func=cmd_verify)

    # Status
    sub.add_parser("status", help="Show system status").set_defaults(func=cmd_status)

    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
