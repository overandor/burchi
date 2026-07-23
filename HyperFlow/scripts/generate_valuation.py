#!/usr/bin/env python3
"""
Valuation packet generator for HyperFlow.

Generates financeable artifact packets from tasks and receipts.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict

BASE_DIR = Path(__file__).parent.parent
TASKS_FILE = BASE_DIR / "tasks.jsonl"
RECEIPTS_FILE = BASE_DIR / "receipts.jsonl"
VALUATION_DIR = BASE_DIR / "valuations"


def load_tasks() -> List[Dict]:
    """Load tasks from tasks.jsonl."""
    tasks = []
    if TASKS_FILE.exists():
        for line in TASKS_FILE.read_text().strip().split("\n"):
            if line.strip():
                tasks.append(json.loads(line))
    return tasks


def load_receipts() -> List[Dict]:
    """Load receipts from receipts.jsonl."""
    receipts = []
    if RECEIPTS_FILE.exists():
        for line in RECEIPTS_FILE.read_text().strip().split("\n"):
            if line.strip():
                receipts.append(json.loads(line))
    return receipts


def calculate_artifact_score(task: Dict, receipts: List[Dict]) -> int:
    """Calculate artifact score (0-10) based on task state and receipts."""
    base_score = 0
    
    # State-based scoring
    status = task.get("status", "RAW_IDEA")
    state_scores = {
        "RAW_IDEA": 0,
        "SPECIFIED": 1,
        "PLANNED": 2,
        "PATCHED": 3,
        "BUILT": 4,
        "TESTED": 5,
        "AUDITED": 6,
        "COMMITED": 7,
        "PACKAGED": 8,
        "VALUED": 9,
        "SOLD": 10
    }
    base_score = state_scores.get(status, 0)
    
    # Receipt bonus
    task_receipts = [r for r in receipts if r.get("task_id") == task.get("id")]
    if task_receipts:
        base_score += 1
    
    # Artifact class bonus
    artifact_class = task.get("artifact_class", "residue")
    class_bonus = {
        "residue": 0,
        "note": 0,
        "spec": 1,
        "patch": 2,
        "verified build": 3,
        "reusable module": 4,
        "product component": 5,
        "sellable asset": 6,
        "financeable artifact": 7,
        "protocol primitive": 8,
        "platform kernel": 9
    }
    base_score += class_bonus.get(artifact_class, 0)
    
    return min(base_score, 10)


def generate_valuation_packet(task: Dict, receipts: List[Dict]) -> Dict:
    """Generate a valuation packet for a single task."""
    task_id = task.get("id")
    score = calculate_artifact_score(task, receipts)
    
    # Find relevant receipts
    task_receipts = [r for r in receipts if r.get("task_id") == task_id]
    
    # Economic value estimation
    economic_value = task.get("economic_value", {})
    if not economic_value:
        # Default estimation based on score
        time_saved = score * 2  # hours
        economic_value = {
            "time_saved_hours": time_saved,
            "artifact_class": task.get("artifact_class", "residue"),
            "reusability": "medium" if score >= 4 else "low",
            "sellable": score >= 6,
            "financeable": score >= 8
        }
    
    packet = {
        "packet_id": f"VP-{task_id}",
        "task_id": task_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "artifact_score": score,
        "financeable": score >= 8,
        "task": {
            "id": task.get("id"),
            "request": task.get("request"),
            "status": task.get("status"),
            "agent": task.get("agent"),
            "artifact_class": task.get("artifact_class"),
            "target_files": task.get("target_files", []),
            "acceptance_tests": task.get("acceptance_tests", [])
        },
        "receipts": task_receipts,
        "economic_value": economic_value,
        "valuation": {
            "estimated_value_usd": score * 1000,  # $1k per score point
            "confidence": "high" if score >= 6 else "medium" if score >= 4 else "low",
            "finance_ready": score >= 8,
            "market_ready": score >= 6
        }
    }
    
    return packet


def generate_portfolio(tasks: List[Dict], receipts: List[Dict]) -> Dict:
    """Generate a portfolio valuation packet."""
    packets = []
    total_value = 0
    financeable_count = 0
    
    for task in tasks:
        packet = generate_valuation_packet(task, receipts)
        packets.append(packet)
        total_value += packet["valuation"]["estimated_value_usd"]
        if packet["financeable"]:
            financeable_count += 1
    
    portfolio = {
        "portfolio_id": f"VP-PORTFOLIO-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_tasks": len(tasks),
        "total_value_usd": total_value,
        "financeable_artifacts": financeable_count,
        "average_score": sum(p["artifact_score"] for p in packets) / max(len(packets), 1),
        "artifacts": packets
    }
    
    return portfolio


def main():
    parser = argparse.ArgumentParser(description="Generate valuation packets")
    parser.add_argument("--task", help="Generate packet for specific task ID")
    parser.add_argument("--portfolio", action="store_true", help="Generate portfolio packet")
    parser.add_argument("--output", help="Output file path")
    parser.add_argument("--min-score", type=int, default=0, help="Minimum artifact score to include")
    
    args = parser.parse_args()
    
    tasks = load_tasks()
    receipts = load_receipts()
    
    if not tasks:
        print("No tasks found")
        return 1
    
    # Filter by score
    if args.min_score > 0:
        tasks = [t for t in tasks if calculate_artifact_score(t, receipts) >= args.min_score]
        print(f"Filtered to {len(tasks)} tasks with score >= {args.min_score}")
    
    if args.task:
        # Single task packet
        task = next((t for t in tasks if t.get("id") == args.task), None)
        if not task:
            print(f"Task {args.task} not found")
            return 1
        
        packet = generate_valuation_packet(task, receipts)
        output = json.dumps(packet, indent=2)
        
        if args.output:
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_text(output)
            print(f"Valuation packet written to {args.output}")
        else:
            print(output)
    
    elif args.portfolio:
        # Portfolio packet
        portfolio = generate_portfolio(tasks, receipts)
        output = json.dumps(portfolio, indent=2)
        
        if args.output:
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_text(output)
            print(f"Portfolio valuation written to {args.output}")
        else:
            print(output)
    else:
        # Default: show summary
        print("=== Valuation Summary ===")
        print(f"Total tasks: {len(tasks)}")
        print(f"Total receipts: {len(receipts)}")
        
        scores = [calculate_artifact_score(t, receipts) for t in tasks]
        print(f"Average score: {sum(scores) / max(len(scores), 1):.1f}")
        print(f"Financeable (score >= 8): {sum(1 for s in scores if s >= 8)}")
        print(f"Market-ready (score >= 6): {sum(1 for s in scores if s >= 6)}")
        
        total_value = sum(calculate_artifact_score(t, receipts) * 1000 for t in tasks)
        print(f"Estimated portfolio value: ${total_value:,.0f}")
        
        print("\n=== Top Artifacts ===")
        scored_tasks = [(t, calculate_artifact_score(t, receipts)) for t in tasks]
        scored_tasks.sort(key=lambda x: x[1], reverse=True)
        
        for task, score in scored_tasks[:5]:
            print(f"  {task['id']}: score={score} | {task['request'][:50]}")
    
    return 0


if __name__ == "__main__":
    exit(main())
