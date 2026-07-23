#!/usr/bin/env python3
"""
Hydra Sentinel — watchdog process for HyperFlow continuity.

Watches liveness and detects anomalies:
- File changes
- Git diff accumulation
- Terminal output patterns
- Task state transitions
- Agent heartbeat timeout
"""

import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

BASE_DIR = Path(__file__).parent.parent
HYDRA_STATE_FILE = BASE_DIR / "HYDRA_STATE.json"
ARCHIVE_FILE = BASE_DIR / "hydra_archive.jsonl"
TASKS_FILE = BASE_DIR / "tasks.jsonl"
HEARTBEAT_TIMEOUT_SECONDS = 300  # 5 minutes


def load_hydra_state() -> Dict:
    """Load HYDRA_STATE.json or return default."""
    if HYDRA_STATE_FILE.exists():
        with open(HYDRA_STATE_FILE) as f:
            return json.load(f)
    return {
        "hydra_version": 1,
        "last_heartbeat": None,
        "active_agent": None,
        "active_task": None,
        "task_status": None,
        "branch": None,
        "commit_hash": None,
        "uncommitted_files": [],
        "uncommitted_diff_hash": None,
        "artifacts_produced": [],
        "receipts_produced": [],
        "blockers": [],
        "next_action": None,
        "next_agent": None,
        "archive_entries": 0
    }


def save_hydra_state(state: Dict):
    """Save HYDRA_STATE.json."""
    with open(HYDRA_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def append_archive(event: Dict):
    """Append event to hydra_archive.jsonl."""
    ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ARCHIVE_FILE, "a") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
    
    # Update archive entry count
    state = load_hydra_state()
    state["archive_entries"] = state.get("archive_entries", 0) + 1
    save_hydra_state(state)


def record_heartbeat(agent: str, task: str, status: str):
    """Record a heartbeat event."""
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": "heartbeat",
        "agent": agent,
        "task": task,
        "status": status
    }
    append_archive(event)
    
    state = load_hydra_state()
    state["last_heartbeat"] = event["timestamp"]
    state["active_agent"] = agent
    state["active_task"] = task
    state["task_status"] = status
    save_hydra_state(state)


def check_heartbeat_timeout() -> bool:
    """Check if heartbeat has timed out."""
    state = load_hydra_state()
    last_heartbeat = state.get("last_heartbeat")
    
    if not last_heartbeat:
        return False  # No heartbeat recorded yet
    
    last_time = datetime.fromisoformat(last_heartbeat)
    elapsed = (datetime.now(timezone.utc) - last_time).total_seconds()
    
    return elapsed > HEARTBEAT_TIMEOUT_SECONDS


def get_git_status() -> Dict:
    """Get git status information."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
            cwd=str(BASE_DIR)
        )
        
        modified_files = []
        for line in result.stdout.strip().split("\n"):
            if line:
                status, file = line[:2], line[3:]
                if status.strip():
                    modified_files.append(file)
        
        try:
            commit_hash = subprocess.check_output(
                ["git", "rev-parse", "HEAD"],
                cwd=str(BASE_DIR),
                stderr=subprocess.DEVNULL
            ).decode().strip()
        except:
            commit_hash = "no-git"
        
        try:
            branch = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=str(BASE_DIR),
                stderr=subprocess.DEVNULL
            ).decode().strip()
        except:
            branch = "unknown"
        
        return {
            "modified_files": modified_files,
            "commit_hash": commit_hash,
            "branch": branch,
            "has_uncommitted": len(modified_files) > 0
        }
    except Exception as e:
        return {
            "modified_files": [],
            "commit_hash": "error",
            "branch": "error",
            "has_uncommitted": False,
            "error": str(e)
        }


def detect_anomalies() -> List[Dict]:
    """Detect system anomalies."""
    anomalies = []
    
    # Check heartbeat timeout
    if check_heartbeat_timeout():
        state = load_hydra_state()
        anomalies.append({
            "type": "heartbeat_timeout",
            "severity": "high",
            "message": f"No heartbeat for {HEARTBEAT_TIMEOUT_SECONDS}s",
            "active_agent": state.get("active_agent"),
            "active_task": state.get("active_task")
        })
    
    # Check for excessive uncommitted changes
    git_status = get_git_status()
    if len(git_status["modified_files"]) > 20:
        anomalies.append({
            "type": "excessive_uncommitted",
            "severity": "medium",
            "message": f"{len(git_status['modified_files'])} uncommitted files",
            "files": git_status["modified_files"][:10]
        })
    
    # Check for stuck tasks
    tasks = []
    if TASKS_FILE.exists():
        for line in TASKS_FILE.read_text().strip().split("\n"):
            if line.strip():
                tasks.append(json.loads(line))
    
    stuck_tasks = [t for t in tasks if t.get("status") in ["in_progress", "PATCHED"]]
    if len(stuck_tasks) > 5:
        anomalies.append({
            "type": "stuck_tasks",
            "severity": "medium",
            "message": f"{len(stuck_tasks)} tasks in progress state",
            "tasks": [t.get("id") for t in stuck_tasks[:5]]
        })
    
    return anomalies


def sentinel_watch(interval_seconds: int = 60, max_iterations: int = 0):
    """Run sentinel watch loop."""
    print(f"=== Hydra Sentinel Started ===")
    print(f"Watching directory: {BASE_DIR}")
    print(f"Heartbeat timeout: {HEARTBEAT_TIMEOUT_SECONDS}s")
    print(f"Check interval: {interval_seconds}s")
    
    iteration = 0
    while max_iterations == 0 or iteration < max_iterations:
        iteration += 1
        timestamp = datetime.now(timezone.utc).isoformat()
        
        # Check for anomalies
        anomalies = detect_anomalies()
        
        if anomalies:
            print(f"\n[{timestamp}] Anomalies detected:")
            for anomaly in anomalies:
                print(f"  [{anomaly['severity'].upper()}] {anomaly['type']}: {anomaly['message']}")
                append_archive({
                    "timestamp": timestamp,
                    "event": "anomaly",
                    "anomaly_type": anomaly["type"],
                    "severity": anomaly["severity"],
                    "details": anomaly
                })
        else:
            print(f"[{timestamp}] No anomalies detected")
        
        # Update git status in state
        git_status = get_git_status()
        state = load_hydra_state()
        state["branch"] = git_status["branch"]
        state["commit_hash"] = git_status["commit_hash"]
        state["uncommitted_files"] = git_status["modified_files"]
        save_hydra_state(state)
        
        # Sleep until next check
        time.sleep(interval_seconds)
    
    print(f"\n=== Hydra Sentinel Stopped after {iteration} iterations ===")


def main():
    parser = argparse.ArgumentParser(description="Hydra Sentinel watchdog")
    parser.add_argument("--heartbeat", action="store_true", help="Record a heartbeat")
    parser.add_argument("--agent", help="Agent name for heartbeat")
    parser.add_argument("--task", help="Task ID for heartbeat")
    parser.add_argument("--status", help="Task status for heartbeat")
    parser.add_argument("--watch", action="store_true", help="Run sentinel watch loop")
    parser.add_argument("--interval", type=int, default=60, help="Watch interval in seconds")
    parser.add_argument("--max-iterations", type=int, default=0, help="Max watch iterations (0 = infinite)")
    parser.add_argument("--check", action="store_true", help="Check for anomalies once")
    
    args = parser.parse_args()
    
    if args.heartbeat:
        if not args.agent or not args.task or not args.status:
            print("Error: --heartbeat requires --agent, --task, and --status")
            return 1
        record_heartbeat(args.agent, args.task, args.status)
        print(f"Heartbeat recorded: {args.agent} on {args.task} ({args.status})")
        return 0
    
    if args.watch:
        sentinel_watch(args.interval, args.max_iterations)
        return 0
    
    if args.check:
        anomalies = detect_anomalies()
        print(f"=== Anomaly Check ===")
        if anomalies:
            print(f"Found {len(anomalies)} anomalies:")
            for anomaly in anomalies:
                print(f"  [{anomaly['severity'].upper()}] {anomaly['type']}: {anomaly['message']}")
            return 1
        else:
            print("No anomalies detected")
            return 0
    
    parser.print_help()
    return 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
