#!/usr/bin/env python3
"""
Artifact scoring automation for HyperFlow.

Automatically scores artifacts based on task state, receipts, and quality metrics.
Updates task ledger with calculated scores.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict

BASE_DIR = Path(__file__).parent.parent
TASKS_FILE = BASE_DIR / "tasks.jsonl"
RECEIPTS_FILE = BASE_DIR / "receipts.jsonl"


def load_tasks() -> List[Dict]:
    """Load tasks from tasks.jsonl."""
    tasks = []
    if TASKS_FILE.exists():
        for line in TASKS_FILE.read_text().strip().split("\n"):
            if line.strip():
                tasks.append(json.loads(line))
    return tasks


def save_tasks(tasks: List[Dict]):
    """Save tasks to tasks.jsonl."""
    with open(TASKS_FILE, "w") as f:
        for t in tasks:
            f.write(json.dumps(t) + "\n")


def load_receipts() -> List[Dict]:
    """Load receipts from receipts.jsonl."""
    receipts = []
    if RECEIPTS_FILE.exists():
        for line in RECEIPTS_FILE.read_text().strip().split("\n"):
            if line.strip():
                receipts.append(json.loads(line))
    return receipts


def calculate_artifact_score(task: Dict, receipts: List[Dict]) -> int:
    """Calculate artifact score (0-10) based on multiple factors."""
    score = 0
    
    # 1. State-based scoring (0-5 points)
    status = task.get("status", "RAW_IDEA")
    state_scores = {
        "RAW_IDEA": 0,
        "SPECIFIED": 1,
        "PLANNED": 2,
        "PATCHED": 3,
        "BUILT": 4,
        "TESTED": 5,
        "AUDITED": 5,
        "COMMITED": 5,
        "PACKAGED": 5,
        "VALUED": 5,
        "SOLD": 5
    }
    score += state_scores.get(status, 0)
    
    # 2. Receipt presence (0-2 points)
    task_id = task.get("id")
    task_receipts = [r for r in receipts if r.get("task_id") == task_id]
    if task_receipts:
        score += 1
        # Bonus for multiple receipts
        if len(task_receipts) >= 2:
            score += 1
    
    # 3. Artifact class (0-2 points)
    artifact_class = task.get("artifact_class", "residue")
    class_scores = {
        "residue": 0,
        "note": 0,
        "spec": 1,
        "patch": 1,
        "verified build": 2,
        "reusable module": 2,
        "product component": 2,
        "sellable asset": 2,
        "financeable artifact": 2,
        "protocol primitive": 2,
        "platform kernel": 2
    }
    score += class_scores.get(artifact_class, 0)
    
    # 4. Test coverage (0-1 point)
    acceptance_tests = task.get("acceptance_tests", [])
    if acceptance_tests:
        score += 1
    
    return min(score, 10)


def score_all_tasks(tasks: List[Dict], receipts: List[Dict]) -> List[Dict]:
    """Score all tasks and return updated task list."""
    scored_tasks = []
    for task in tasks:
        old_score = task.get("artifact_score", 0)
        new_score = calculate_artifact_score(task, receipts)
        
        task["artifact_score"] = new_score
        task["score_updated_at"] = datetime.now(timezone.utc).isoformat()
        
        scored_tasks.append({
            "task_id": task.get("id"),
            "old_score": old_score,
            "new_score": new_score,
            "change": new_score - old_score
        })
    
    return scored_tasks


def generate_score_report(tasks: List[Dict]) -> Dict:
    """Generate a scoring report."""
    scores = [t.get("artifact_score", 0) for t in tasks]
    
    score_distribution = {
        "0-2": sum(1 for s in scores if 0 <= s <= 2),
        "3-5": sum(1 for s in scores if 3 <= s <= 5),
        "6-7": sum(1 for s in scores if 6 <= s <= 7),
        "8-10": sum(1 for s in scores if 8 <= s <= 10)
    }
    
    financeable = sum(1 for s in scores if s >= 8)
    market_ready = sum(1 for s in scores if 6 <= s <= 7)
    
    return {
        "total_tasks": len(tasks),
        "average_score": sum(scores) / max(len(scores), 1),
        "score_distribution": score_distribution,
        "financeable_artifacts": financeable,
        "market_ready_artifacts": market_ready,
        "total_value_estimate": sum(scores) * 1000  # $1k per score point
    }


def main():
    parser = argparse.ArgumentParser(description="Automated artifact scoring")
    parser.add_argument("--update", action="store_true", help="Update task ledger with new scores")
    parser.add_argument("--report", action="store_true", help="Generate scoring report")
    parser.add_argument("--task", help="Score specific task by ID")
    
    args = parser.parse_args()
    
    tasks = load_tasks()
    receipts = load_receipts()
    
    if not tasks:
        print("No tasks found")
        return 1
    
    if args.task:
        # Score single task
        task = next((t for t in tasks if t.get("id") == args.task), None)
        if not task:
            print(f"Task {args.task} not found")
            return 1
        
        score = calculate_artifact_score(task, receipts)
        print(f"Task {args.task}: score = {score}")
        print(f"  Status: {task.get('status')}")
        print(f"  Artifact class: {task.get('artifact_class')}")
        print(f"  Receipts: {len([r for r in receipts if r.get('task_id') == args.task])}")
        
        if args.update:
            task["artifact_score"] = score
            task["score_updated_at"] = datetime.now(timezone.utc).isoformat()
            save_tasks(tasks)
            print(f"Updated task {args.task} with score {score}")
    
    else:
        # Score all tasks
        score_changes = score_all_tasks(tasks, receipts)
        
        print("=== Artifact Scoring ===")
        for change in score_changes:
            if change["change"] != 0:
                print(f"{change['task_id']}: {change['old_score']} → {change['new_score']} ({change['change']:+d})")
        
        if args.update:
            save_tasks(tasks)
            print(f"\nUpdated {len(tasks)} tasks in ledger")
        
        if args.report:
            report = generate_score_report(tasks)
            print("\n=== Scoring Report ===")
            print(json.dumps(report, indent=2))
    
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
