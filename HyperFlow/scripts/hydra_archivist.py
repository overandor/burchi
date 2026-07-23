#!/usr/bin/env python3
"""
Hydra Archivist — state capture for HyperFlow continuity.

Captures state at every transition:
- Current task ID and status
- Files modified (with hashes)
- Git diff (uncommitted changes)
- TODOs and blockers
- Receipts produced
- Current branch and commit hash
- Artifact paths
- Next planned action
- Agent that was active
- Timestamp of last activity
"""

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

BASE_DIR = Path(__file__).parent.parent
HYDRA_STATE_FILE = BASE_DIR / "HYDRA_STATE.json"
ARCHIVE_FILE = BASE_DIR / "hydra_archive.jsonl"
TASKS_FILE = BASE_DIR / "tasks.jsonl"
RECEIPTS_FILE = BASE_DIR / "receipts.jsonl"


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


def file_hash(filepath: Path) -> str:
    """Calculate SHA256 hash of a file."""
    if not filepath.exists():
        return "missing"
    try:
        with open(filepath, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()[:16]
    except:
        return "error"


def capture_file_state(files: List[str]) -> List[Dict]:
    """Capture state of specified files."""
    file_states = []
    for file_path in files:
        path = BASE_DIR / file_path
        file_states.append({
            "path": file_path,
            "exists": path.exists(),
            "hash": file_hash(path),
            "size": path.stat().st_size if path.exists() else 0
        })
    return file_states


def get_git_diff() -> str:
    """Get git diff of uncommitted changes."""
    try:
        result = subprocess.run(
            ["git", "diff"],
            capture_output=True,
            text=True,
            cwd=str(BASE_DIR)
        )
        return result.stdout
    except:
        return ""


def get_git_diff_hash() -> str:
    """Get hash of git diff."""
    diff = get_git_diff()
    if not diff:
        return "clean"
    return hashlib.sha256(diff.encode()).hexdigest()[:16]


def capture_full_state(task_id: Optional[str] = None) -> Dict:
    """Capture full system state."""
    # Get git status
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
    
    # Get modified files
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
    except:
        modified_files = []
    
    # Load current task if specified
    task_info = {}
    if task_id and TASKS_FILE.exists():
        for line in TASKS_FILE.read_text().strip().split("\n"):
            if line.strip():
                task = json.loads(line)
                if task.get("id") == task_id:
                    task_info = task
                    break
    
    # Count receipts
    receipt_count = 0
    if RECEIPTS_FILE.exists():
        receipt_count = len(RECEIPTS_FILE.read_text().strip().split("\n"))
    
    state = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hydra_version": 1,
        "git": {
            "branch": branch,
            "commit_hash": commit_hash,
            "modified_files": modified_files,
            "modified_count": len(modified_files),
            "diff_hash": get_git_diff_hash()
        },
        "task": {
            "id": task_id,
            "info": task_info
        } if task_id else None,
        "receipts": {
            "total_count": receipt_count
        },
        "archive_entries": load_hydra_state().get("archive_entries", 0)
    }
    
    return state


def archive_state_transition(event_type: str, details: Dict):
    """Archive a state transition event."""
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event_type,
        **details
    }
    append_archive(event)
    print(f"Archived: {event_type}")


def restore_from_archive(entry_index: int = -1) -> Dict:
    """Restore state from archive entry (-1 = latest)."""
    if not ARCHIVE_FILE.exists():
        print("No archive file found")
        return {}
    
    entries = []
    for line in ARCHIVE_FILE.read_text().strip().split("\n"):
        if line.strip():
            entries.append(json.loads(line))
    
    if not entries:
        print("No archive entries found")
        return {}
    
    if entry_index == -1:
        entry = entries[-1]
        print(f"Restoring from latest entry ({len(entries)} total)")
    else:
        if entry_index >= len(entries):
            print(f"Invalid entry index: {entry_index} (max: {len(entries)-1})")
            return {}
        entry = entries[entry_index]
        print(f"Restoring from entry {entry_index}")
    
    return entry


def generate_resume_packet(task_id: str) -> Dict:
    """Generate a resume packet for a task."""
    # Load task info
    task_info = None
    if TASKS_FILE.exists():
        for line in TASKS_FILE.read_text().strip().split("\n"):
            if line.strip():
                task = json.loads(line)
                if task.get("id") == task_id:
                    task_info = task
                    break
    
    if not task_info:
        print(f"Task {task_id} not found")
        return {}
    
    # Get current state
    state = load_hydra_state()
    git_status = capture_full_state(task_id)
    
    # Generate resume packet
    packet = {
        "resume_for": task_id,
        "task_title": task_info.get("request", "Unknown"),
        "task_status": task_info.get("status", "unknown"),
        "agent": task_info.get("agent", "unassigned"),
        "target_files": task_info.get("target_files", []),
        "acceptance_tests": task_info.get("acceptance_tests", []),
        "current_state": {
            "branch": git_status["git"]["branch"],
            "commit_hash": git_status["git"]["commit_hash"],
            "modified_files": git_status["git"]["modified_files"],
            "has_uncommitted": git_status["git"]["modified_count"] > 0
        },
        "next_action": state.get("next_action", "Review task and continue"),
        "last_heartbeat": state.get("last_heartbeat"),
        "blockers": state.get("blockers", []),
        "generated_at": datetime.now(timezone.utc).isoformat()
    }
    
    return packet


def main():
    parser = argparse.ArgumentParser(description="Hydra Archivist state capture")
    parser.add_argument("--capture", action="store_true", help="Capture full state")
    parser.add_argument("--task", help="Task ID to capture")
    parser.add_argument("--archive", help="Archive a state transition event")
    parser.add_argument("--restore", type=int, help="Restore from archive entry (-1 = latest)")
    parser.add_argument("--resume", help="Generate resume packet for task")
    parser.add_argument("--state", action="store_true", help="Show current HYDRA_STATE.json")
    
    args = parser.parse_args()
    
    if args.capture:
        state = capture_full_state(args.task)
        print(json.dumps(state, indent=2))
        return 0
    
    if args.archive:
        # Parse details as JSON
        try:
            details = json.loads(args.archive)
        except:
            details = {"message": args.archive}
        archive_state_transition("manual", details)
        return 0
    
    if args.restore is not None:
        entry = restore_from_archive(args.restore)
        print(json.dumps(entry, indent=2))
        return 0
    
    if args.resume:
        packet = generate_resume_packet(args.resume)
        print(json.dumps(packet, indent=2))
        return 0
    
    if args.state:
        state = load_hydra_state()
        print(json.dumps(state, indent=2))
        return 0
    
    parser.print_help()
    return 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
