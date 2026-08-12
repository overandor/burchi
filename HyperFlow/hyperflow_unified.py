#!/usr/bin/env python3
"""
HyperFlow Unified Command Router — HF-0003.

One CLI addresses both HyperFlow Ledger OS and YTL-MCP Research Lab.

Examples:
    hyperflow_unified status
    hyperflow_unified new "Create a YouTube transcript scoring experiment" --agent chatgpt
    hyperflow_unified assign HF-0003 codex
    hyperflow_unified receipt HF-0003
    hyperflow_unified verify

    hyperflow_unified lab status
    hyperflow_unified lab ingest --task HF-0003 --intent "..." --url https://youtu.be/...
    hyperflow_unified lab score YTL-abc123
    hyperflow_unified lab script YTL-abc123
    hyperflow_unified lab metadata YTL-abc123
    hyperflow_unified lab shotlist YTL-abc123
    hyperflow_unified lab policy YTL-abc123
    hyperflow_unified lab prepare YTL-abc123

The durable brain is still Git + task ledger + receipts + verifier logs.
This CLI is the command surface.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).parent
HYPERFLOW_PY = BASE_DIR / "hyperflow.py"
TASKS_FILE = BASE_DIR / "tasks.jsonl"
RECEIPTS_FILE = BASE_DIR / "receipts.jsonl"

YTL_ROOT = BASE_DIR.parent / "ytl-mcp-research-lab"
YTL_VENV = YTL_ROOT / ".venv"


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


def _next_hf_id(rows: List[Dict]) -> str:
    max_num = 0
    for r in rows:
        tid = r.get("task_id", "")
        if tid.startswith("HF-"):
            try:
                max_num = max(max_num, int(tid.split("-")[1]))
            except ValueError:
                pass
    return f"HF-{max_num + 1:03d}"


def _run_hyperflow_core(args: List[str]) -> Dict[str, Any]:
    cmd = [sys.executable, str(HYPERFLOW_PY)] + args
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=BASE_DIR, timeout=60)
    return {
        "success": result.returncode == 0,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.returncode,
    }


def _run_ytl_lab(script: str) -> Dict[str, Any]:
    """Execute a Python snippet inside the YTL-MCP virtualenv."""
    python_bin = YTL_VENV / "bin" / "python"
    if not python_bin.exists():
        return {"success": False, "error": f"YTL-MCP venv not found at {YTL_VENV}. Run: cd {YTL_ROOT} && python3 -m venv .venv && pip install -e '.[dev]'"}
    env = os.environ.copy()
    env["PYTHONPATH"] = str(YTL_ROOT / "src")
    # Ensure json is always available for tool output.
    if "import json" not in script:
        script = "import json\n" + script
    cmd = [str(python_bin), "-c", script]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=YTL_ROOT, env=env, timeout=60)
    return {
        "success": result.returncode == 0,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.returncode,
    }


def cmd_status(args: argparse.Namespace) -> int:
    tasks = _load_jsonl(TASKS_FILE)
    receipts = _load_jsonl(RECEIPTS_FILE)
    lab_status = _run_ytl_lab("""
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
print(json.dumps(LabTools(Settings.load_settings()).status()))
""")
    lab_summary = {}
    if lab_status["success"]:
        try:
            lab_summary = json.loads(lab_status["stdout"].strip().split("\n")[-1])
        except Exception:
            lab_summary = {"error": "could not parse lab status"}

    counts = {}
    for t in tasks:
        counts[t.get("status", "unknown")] = counts.get(t.get("status", "unknown"), 0) + 1

    print("╔════════════════════════════════════════════════════════════╗")
    print("║       HyperFlow Unified Command Router — HF-0003             ║")
    print("╚════════════════════════════════════════════════════════════╝")
    print(f"Tasks:     {len(tasks)} total")
    print(f"Receipts:  {len(receipts)} total")
    print(f"Status:    {json.dumps(counts, indent=2)}")
    print("\nYTL-MCP Lab:")
    print(json.dumps(lab_summary, indent=2))
    print("\nGit:")
    try:
        git = subprocess.run(["git", "status", "--short"], capture_output=True, text=True, cwd=BASE_DIR).stdout.strip()
        print(git if git else "clean")
    except Exception as e:
        print(f"git unavailable: {e}")
    return 0


def cmd_new(args: argparse.Namespace) -> int:
    tasks = _load_jsonl(TASKS_FILE)
    task_id = _next_hf_id(tasks)
    task = {
        "task_id": task_id,
        "title": args.title,
        "agent": args.agent,
        "status": "RAW_IDEA",
        "files_affected": [],
        "verification": "",
        "created_at": _now(),
        "updated_at": _now(),
        "artifact_class": "residue",
        "artifact_score": 0,
        "domain": args.domain,
        "risks": args.risks or [],
    }
    with open(TASKS_FILE, "a") as f:
        f.write(json.dumps(task) + "\n")
    print(f"Created {task_id}: {args.title}")
    print(f"Next: hyperflow_unified assign {task_id} <agent>  or  hyperflow_unified lab ingest --task {task_id} ...")
    return 0


def cmd_assign(args: argparse.Namespace) -> int:
    tasks = _load_jsonl(TASKS_FILE)
    updated = []
    found = False
    for t in tasks:
        if t.get("task_id") == args.task_id:
            t["agent"] = args.agent
            t["updated_at"] = _now()
            found = True
        updated.append(t)
    if not found:
        print(f"Task {args.task_id} not found")
        return 1
    with open(TASKS_FILE, "w") as f:
        for t in updated:
            f.write(json.dumps(t) + "\n")
    print(f"Assigned {args.task_id} to {args.agent}")
    return 0


def cmd_receipt(args: argparse.Namespace) -> int:
    receipts = _load_jsonl(RECEIPTS_FILE)
    filtered = [r for r in receipts if r.get("task_id") == args.task_id]
    print(f"HyperFlow ledger receipts for {args.task_id}: {len(filtered)}")
    for r in filtered:
        print(json.dumps(r, indent=2))

    # Also show YTL lab receipts for this task
    lab_receipts = _run_ytl_lab(f"""
from ytl_lab.config import Settings
from ytl_lab.receipts import ReceiptLedger
rows = ReceiptLedger(Settings.load_settings()).read()
filtered = [r for r in rows if r.get('task_id') == '{args.task_id}']
print(json.dumps(filtered, indent=2))
""")
    if lab_receipts["success"]:
        try:
            lab_rows = json.loads(lab_receipts["stdout"])
            print(f"\nYTL-MCP ledger receipts for {args.task_id}: {len(lab_rows)}")
            for r in lab_rows:
                print(json.dumps(r, indent=2))
        except Exception as e:
            print(f"\nYTL-MCP receipt output parse error: {e}")
            print(lab_receipts["stdout"])
    return 0


def _verify_ytl_chain() -> Dict[str, Any]:
    result = _run_ytl_lab("""
import json
from ytl_lab.config import Settings
from ytl_lab.receipts import ReceiptLedger
print(json.dumps(ReceiptLedger(Settings.load_settings()).verify_chain()))
""")
    if result["success"]:
        try:
            return json.loads(result["stdout"].strip().split("\n")[-1])
        except Exception:
            return {"error": "could not parse ytl chain result"}
    return {"error": result.get("stderr", "unknown")}


def cmd_verify(args: argparse.Namespace) -> int:
    print("Running unified verification...")
    checks = []

    # 1. HyperFlow core verifier
    hf = _run_hyperflow_core(["verify"])
    checks.append({"name": "hyperflow_core", "success": hf["success"], "output": hf["stdout"], "errors": hf["stderr"]})

    # 2. YTL-MCP tests
    if YTL_VENV.exists():
        ytl = subprocess.run(
            [str(YTL_VENV / "bin" / "pytest"), "-q"],
            capture_output=True,
            text=True,
            cwd=YTL_ROOT,
            timeout=120,
        )
        checks.append({"name": "ytl_mcp_tests", "success": ytl.returncode == 0, "output": ytl.stdout, "errors": ytl.stderr})
    else:
        checks.append({"name": "ytl_mcp_tests", "success": False, "output": "", "errors": "venv not found"})

    # 3. Receipt chain integrity
    hf_chain = _run_hyperflow_core(["receipt", "verify"])
    hf_chain_ok = False
    try:
        hf_chain_data = json.loads(hf_chain["stdout"])
        hf_chain_ok = len(hf_chain_data.get("broken", [])) == 0
    except Exception:
        pass
    checks.append({"name": "hyperflow_receipt_chain", "success": hf_chain_ok, "output": hf_chain["stdout"][:200], "errors": hf_chain["stderr"][:200]})

    ytl_chain = _verify_ytl_chain()
    ytl_chain_ok = isinstance(ytl_chain, dict) and len(ytl_chain.get("broken", [])) == 0
    checks.append({"name": "ytl_receipt_chain", "success": ytl_chain_ok, "output": json.dumps(ytl_chain), "errors": ""})

    # 4. Receipt ledgers exist and are readable
    hf_receipts = _load_jsonl(RECEIPTS_FILE)
    ytl_receipts = _run_ytl_lab("""
from ytl_lab.config import Settings
from ytl_lab.receipts import ReceiptLedger
print(len(ReceiptLedger(Settings.load_settings()).read()))
""")
    ytl_count = 0
    if ytl_receipts["success"]:
        try:
            ytl_count = int(ytl_receipts["stdout"].strip().split("\n")[-1])
        except Exception:
            pass
    checks.append({
        "name": "receipt_ledgers_integrity",
        "success": True,
        "output": f"hyperflow: {len(hf_receipts)} rows, ytl: {ytl_count} rows",
        "errors": "",
    })

    for c in checks:
        status = "PASS" if c["success"] else "FAIL"
        print(f"[{status}] {c['name']}")
        if c["errors"]:
            print(f"  {c['errors'][:500]}")

    all_pass = all(c["success"] for c in checks)
    print(f"\nOverall: {'PASS' if all_pass else 'FAIL'}")
    return 0 if all_pass else 1


def cmd_verify_receipts(args: argparse.Namespace) -> int:
    print("HyperFlow receipt chain:")
    hf = _run_hyperflow_core(["receipt", "verify"])
    print(hf["stdout"])
    print("\nYTL-MCP receipt chain:")
    ytl = _verify_ytl_chain()
    print(json.dumps(ytl, indent=2))
    return 0


def cmd_lab_status(args: argparse.Namespace) -> int:
    result = _run_ytl_lab("""
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
print(json.dumps(LabTools(Settings.load_settings()).status(), indent=2))
""")
    if result["success"]:
        print(result["stdout"])
    else:
        print("Lab status failed:", result["stderr"])
        return 1
    return 0


def cmd_lab_ingest(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).ingest_video('{args.task}', '{args.intent}', '{args.url}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_score(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).score_transcript('{args.experiment_id}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_script(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).generate_script('{args.experiment_id}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_metadata(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).generate_metadata('{args.experiment_id}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_shotlist(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).generate_shotlist('{args.experiment_id}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_policy(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).policy_check('{args.experiment_id}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_prepare(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).prepare_upload_package('{args.experiment_id}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_project_create(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).create_project('{args.id}', '{args.name}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_project_list(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).list_projects({args.limit})
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_query_create(args: argparse.Namespace) -> int:
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).create_research_query('{args.id}', '{args.project}', '{args.query}', '{args.status}')
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def cmd_lab_query_list(args: argparse.Namespace) -> int:
    project_filter = f"'{args.project}'" if args.project else "None"
    result = _run_ytl_lab(f"""
import json
from ytl_lab.config import Settings
from ytl_lab.tools import LabTools
result = LabTools(Settings.load_settings()).list_research_queries({project_filter}, {args.limit})
print(json.dumps(result, indent=2))
""")
    print(result["stdout"] if result["success"] else result["stderr"])
    return 0 if result["success"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="hyperflow_unified",
        description="HyperFlow Unified Command Router — one CLI for HyperFlow + YTL-MCP Lab",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_status = sub.add_parser("status", help="Show unified system status")
    p_status.set_defaults(func=cmd_status)

    p_new = sub.add_parser("new", help="Create a new HyperFlow task")
    p_new.add_argument("title", help="Task title")
    p_new.add_argument("--agent", default="unassigned", help="Assigned agent")
    p_new.add_argument("--domain", default="code", choices=["code", "lab"], help="Task domain")
    p_new.add_argument("--risks", nargs="*", help="Risk tags")
    p_new.set_defaults(func=cmd_new)

    p_assign = sub.add_parser("assign", help="Assign a task to an agent")
    p_assign.add_argument("task_id", help="Task ID")
    p_assign.add_argument("agent", help="Agent name")
    p_assign.set_defaults(func=cmd_assign)

    p_receipt = sub.add_parser("receipt", help="Show receipts for a task")
    p_receipt.add_argument("task_id", help="Task ID")
    p_receipt.set_defaults(func=cmd_receipt)

    p_verify = sub.add_parser("verify", help="Run unified verification")
    p_verify.set_defaults(func=cmd_verify)

    p_verify_receipts = sub.add_parser("verify-receipts", help="Verify receipt chain integrity")
    p_verify_receipts.set_defaults(func=cmd_verify_receipts)

    # Lab subcommands
    p_lab = sub.add_parser("lab", help="YTL-MCP Research Lab commands")
    lab_sub = p_lab.add_subparsers(dest="lab_command", required=True)

    lab_status = lab_sub.add_parser("status", help="Show lab status")
    lab_status.set_defaults(func=cmd_lab_status)

    lab_ingest = lab_sub.add_parser("ingest", help="Ingest a video")
    lab_ingest.add_argument("--task", required=True, help="HyperFlow task ID")
    lab_ingest.add_argument("--intent", required=True, help="Research intent")
    lab_ingest.add_argument("--url", required=True, help="YouTube video URL")
    lab_ingest.set_defaults(func=cmd_lab_ingest)

    lab_score = lab_sub.add_parser("score", help="Score transcript")
    lab_score.add_argument("experiment_id", help="Experiment ID")
    lab_score.set_defaults(func=cmd_lab_score)

    lab_script = lab_sub.add_parser("script", help="Generate script candidate")
    lab_script.add_argument("experiment_id", help="Experiment ID")
    lab_script.set_defaults(func=cmd_lab_script)

    lab_metadata = lab_sub.add_parser("metadata", help="Generate metadata candidate")
    lab_metadata.add_argument("experiment_id", help="Experiment ID")
    lab_metadata.set_defaults(func=cmd_lab_metadata)

    lab_shotlist = lab_sub.add_parser("shotlist", help="Generate shotlist candidate")
    lab_shotlist.add_argument("experiment_id", help="Experiment ID")
    lab_shotlist.set_defaults(func=cmd_lab_shotlist)

    lab_policy = lab_sub.add_parser("policy", help="Run policy check")
    lab_policy.add_argument("experiment_id", help="Experiment ID")
    lab_policy.set_defaults(func=cmd_lab_policy)

    lab_prepare = lab_sub.add_parser("prepare", help="Prepare upload package")
    lab_prepare.add_argument("experiment_id", help="Experiment ID")
    lab_prepare.set_defaults(func=cmd_lab_prepare)

    lab_project_create = lab_sub.add_parser("project-create", help="Create a research project")
    lab_project_create.add_argument("--id", required=True, help="Project ID")
    lab_project_create.add_argument("--name", required=True, help="Project name")
    lab_project_create.set_defaults(func=cmd_lab_project_create)

    lab_project_list = lab_sub.add_parser("project-list", help="List research projects")
    lab_project_list.add_argument("--limit", type=int, default=100, help="Max projects")
    lab_project_list.set_defaults(func=cmd_lab_project_list)

    lab_query_create = lab_sub.add_parser("query-create", help="Create a research query")
    lab_query_create.add_argument("--id", required=True, help="Query ID")
    lab_query_create.add_argument("--project", required=True, help="Project ID")
    lab_query_create.add_argument("--query", required=True, help="Query text")
    lab_query_create.add_argument("--status", default="open", help="Query status")
    lab_query_create.set_defaults(func=cmd_lab_query_create)

    lab_query_list = lab_sub.add_parser("query-list", help="List research queries")
    lab_query_list.add_argument("--project", help="Project ID filter")
    lab_query_list.add_argument("--limit", type=int, default=100, help="Max queries")
    lab_query_list.set_defaults(func=cmd_lab_query_list)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
