#!/usr/bin/env python3
"""
Hydra Executor Router — resume packet generator and work router.

Generates resume packets and routes work:
- Reads HYDRA_STATE.json
- Determines which agent should resume
- Generates a resume prompt with:
  - Last task ID
  - Files affected
  - What was done
  - What remains
  - Verification command
- Routes to: Devin, Codex, Claude, ChatGPT, Windsurf, Xcode, local terminal, GitHub issue/PR, or human checkpoint
"""

import argparse
import json
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


def load_task(task_id: str) -> Optional[Dict]:
    """Load a specific task from the ledger."""
    if not TASKS_FILE.exists():
        return None
    
    for line in TASKS_FILE.read_text().strip().split("\n"):
        if line.strip():
            task = json.loads(line)
            if task.get("id") == task_id:
                return task
    return None


def load_task_receipts(task_id: str) -> List[Dict]:
    """Load receipts for a specific task."""
    if not RECEIPTS_FILE.exists():
        return []
    
    receipts = []
    for line in RECEIPTS_FILE.read_text().strip().split("\n"):
        if line.strip():
            receipt = json.loads(line)
            if receipt.get("task_id") == task_id:
                receipts.append(receipt)
    return receipts


def determine_resume_agent(task: Dict, state: Dict) -> str:
    """Determine which agent should resume the task."""
    # If task has a designated agent, use that
    task_agent = task.get("agent")
    if task_agent and task_agent != "unassigned":
        return task_agent
    
    # If state has a next_agent preference, use that
    next_agent = state.get("next_agent")
    if next_agent:
        return next_agent
    
    # Default based on task status
    status = task.get("status", "RAW_IDEA")
    if status in ["RAW_IDEA", "SPECIFIED"]:
        return "chatgpt"  # Strategist
    elif status in ["PLANNED", "PATCHED"]:
        return "codex"  # Code worker
    elif status in ["BUILT", "TESTED"]:
        return "claude"  # Auditor
    else:
        return "windsurf"  # IDE operator


def generate_resume_prompt(task: Dict, state: Dict, receipts: List[Dict]) -> str:
    """Generate a resume prompt for an agent."""
    task_id = task.get("id")
    task_title = task.get("request", "Unknown task")
    task_status = task.get("status", "unknown")
    
    prompt = f"""# Resume Task: {task_id}

## Task
{task_title}

## Current Status
{task_status}

## What Was Done
"""
    
    # Add receipt information
    if receipts:
        prompt += f"\n{len(receipts)} receipts produced:\n"
        for receipt in receipts:
            prompt += f"- {receipt.get('date', 'unknown')}: {receipt.get('artifact_output', 'no output')}\n"
    else:
        prompt += "\nNo receipts yet.\n"
    
    # Add file information
    target_files = task.get("target_files", [])
    if target_files:
        prompt += f"\n## Target Files\n"
        for f in target_files:
            prompt += f"- {f}\n"
    
    # Add acceptance tests
    acceptance_tests = task.get("acceptance_tests", [])
    if acceptance_tests:
        prompt += f"\n## Acceptance Tests\n"
        for test in acceptance_tests:
            prompt += f"- {test}\n"
    
    # Add blockers
    blockers = state.get("blockers", [])
    if blockers:
        prompt += f"\n## Blockers\n"
        for blocker in blockers:
            prompt += f"- {blocker}\n"
    
    # Add next action
    next_action = state.get("next_action", "Review task and continue")
    prompt += f"\n## Next Action\n{next_action}\n"
    
    # Add git state
    prompt += f"\n## Git State\n"
    prompt += f"- Branch: {state.get('branch', 'unknown')}\n"
    prompt += f"- Commit: {state.get('commit_hash', 'unknown')}\n"
    prompt += f"- Uncommitted files: {len(state.get('uncommitted_files', []))}\n"
    
    return prompt


def route_work(task_id: str, target_agent: Optional[str] = None) -> Dict:
    """Route work to the appropriate agent."""
    state = load_hydra_state()
    task = load_task(task_id)
    
    if not task:
        return {"error": f"Task {task_id} not found"}
    
    receipts = load_task_receipts(task_id)
    
    # Determine target agent
    if not target_agent:
        target_agent = determine_resume_agent(task, state)
    
    # Generate resume prompt
    resume_prompt = generate_resume_prompt(task, state, receipts)
    
    # Generate routing decision
    routing = {
        "task_id": task_id,
        "target_agent": target_agent,
        "routing_reason": f"Task status {task.get('status')} routed to {target_agent}",
        "resume_prompt": resume_prompt,
        "current_state": {
            "status": task.get("status"),
            "files": task.get("target_files", []),
            "receipts_count": len(receipts)
        },
        "generated_at": datetime.now(timezone.utc).isoformat()
    }
    
    return routing


def list_stuck_tasks() -> List[Dict]:
    """List tasks that are stuck (in progress for too long)."""
    if not TASKS_FILE.exists():
        return []
    
    stuck_tasks = []
    for line in TASKS_FILE.read_text().strip().split("\n"):
        if line.strip():
            task = json.loads(line)
            status = task.get("status")
            if status in ["in_progress", "PATCHED", "BUILT"]:
                stuck_tasks.append(task)
    
    return stuck_tasks


def generate_checkpoint(task_id: str, reason: str) -> Dict:
    """Generate a human checkpoint packet."""
    task = load_task(task_id)
    state = load_hydra_state()
    
    if not task:
        return {"error": f"Task {task_id} not found"}
    
    checkpoint = {
        "checkpoint_type": "human_intervention",
        "task_id": task_id,
        "task_title": task.get("request", "Unknown"),
        "reason": reason,
        "current_status": task.get("status"),
        "requires_decision": True,
        "context": {
            "branch": state.get("branch"),
            "commit": state.get("commit_hash"),
            "uncommitted_files": state.get("uncommitted_files", [])
        },
        "generated_at": datetime.now(timezone.utc).isoformat()
    }
    
    return checkpoint


def main():
    parser = argparse.ArgumentParser(description="Hydra Executor Router")
    parser.add_argument("--route", help="Route work for task ID")
    parser.add_argument("--agent", help="Specify target agent")
    parser.add_argument("--stuck", action="store_true", help="List stuck tasks")
    parser.add_argument("--checkpoint", help="Generate human checkpoint for task")
    parser.add_argument("--reason", help="Reason for checkpoint")
    parser.add_argument("--prompt", help="Generate resume prompt for task")
    
    args = parser.parse_args()
    
    if args.route:
        routing = route_work(args.route, args.agent)
        print(json.dumps(routing, indent=2))
        return 0
    
    if args.stuck:
        stuck = list_stuck_tasks()
        print(f"=== Stuck Tasks ({len(stuck)}) ===")
        for task in stuck:
            print(f"{task['id']}: {task['status']} - {task['request'][:50]}")
        return 0
    
    if args.checkpoint:
        if not args.reason:
            print("Error: --checkpoint requires --reason")
            return 1
        checkpoint = generate_checkpoint(args.checkpoint, args.reason)
        print(json.dumps(checkpoint, indent=2))
        return 0
    
    if args.prompt:
        task = load_task(args.prompt)
        if not task:
            print(f"Task {args.prompt} not found")
            return 1
        state = load_hydra_state()
        receipts = load_task_receipts(args.prompt)
        prompt = generate_resume_prompt(task, state, receipts)
        print(prompt)
        return 0
    
    parser.print_help()
    return 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
