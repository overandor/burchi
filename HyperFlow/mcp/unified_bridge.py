#!/usr/bin/env python3
"""
Unified MCP Bridge — HF-0003.

Exposes safe, narrow tools for the HyperFlow Unified Command Router.
No raw shell execution. Every tool writes receipts.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

BASE_DIR = Path(__file__).parent.parent
UNIFIED_CLI = BASE_DIR / "hyperflow_unified.py"


def _run_cli(args: List[str]) -> Dict[str, Any]:
    cmd = [sys.executable, str(UNIFIED_CLI)] + args
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=BASE_DIR, timeout=120)
    return {
        "success": result.returncode == 0,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.returncode,
    }


TOOLS = {
    "hyperflow.status": {
        "description": "Get unified HyperFlow + YTL-MCP status",
        "input_schema": {"type": "object", "properties": {}},
    },
    "hyperflow.new_task": {
        "description": "Create a new HyperFlow task",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "agent": {"type": "string"},
                "domain": {"type": "string", "enum": ["code", "lab"]},
                "risks": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title"],
        },
    },
    "hyperflow.assign": {
        "description": "Assign a task to an agent",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "agent": {"type": "string"},
            },
            "required": ["task_id", "agent"],
        },
    },
    "hyperflow.receipt": {
        "description": "Get receipts for a task",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
        },
    },
    "hyperflow.verify": {
        "description": "Run unified verification",
        "input_schema": {"type": "object", "properties": {}},
    },
    "hyperflow.snapshot_repo": {
        "description": "Capture git status and diff summary",
        "input_schema": {"type": "object", "properties": {}},
    },
    "hyperflow.lab.status": {
        "description": "Get YTL-MCP lab status",
        "input_schema": {"type": "object", "properties": {}},
    },
    "hyperflow.lab.ingest": {
        "description": "Ingest a video and create an experiment",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "intent": {"type": "string"},
                "video_url": {"type": "string"},
            },
            "required": ["task_id", "intent", "video_url"],
        },
    },
    "hyperflow.lab.score": {
        "description": "Score a transcript",
        "input_schema": {
            "type": "object",
            "properties": {"experiment_id": {"type": "string"}},
            "required": ["experiment_id"],
        },
    },
    "hyperflow.lab.policy": {
        "description": "Run policy check on an experiment",
        "input_schema": {
            "type": "object",
            "properties": {"experiment_id": {"type": "string"}},
            "required": ["experiment_id"],
        },
    },
    "hyperflow.lab.prepare_upload": {
        "description": "Prepare upload package for an approved experiment",
        "input_schema": {
            "type": "object",
            "properties": {"experiment_id": {"type": "string"}},
            "required": ["experiment_id"],
        },
    },
}


def _handle_tool(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    if name not in TOOLS:
        return {"error": f"Tool {name} not found"}

    if name == "hyperflow.status":
        return _run_cli(["status"])
    if name == "hyperflow.new_task":
        cmd = ["new", arguments["title"], "--agent", arguments.get("agent", "unassigned")]
        if "domain" in arguments:
            cmd += ["--domain", arguments["domain"]]
        if "risks" in arguments:
            for risk in arguments["risks"]:
                cmd += ["--risks", risk]
        return _run_cli(cmd)
    if name == "hyperflow.assign":
        return _run_cli(["assign", arguments["task_id"], arguments["agent"]])
    if name == "hyperflow.receipt":
        return _run_cli(["receipt", arguments["task_id"]])
    if name == "hyperflow.verify":
        return _run_cli(["verify"])
    if name == "hyperflow.snapshot_repo":
        return {
            "success": True,
            "stdout": subprocess.run(
                ["git", "status", "--short"],
                capture_output=True,
                text=True,
                cwd=BASE_DIR,
                timeout=30,
            ).stdout,
        }
    if name == "hyperflow.lab.status":
        return _run_cli(["lab", "status"])
    if name == "hyperflow.lab.ingest":
        return _run_cli(["lab", "ingest", "--task", arguments["task_id"], "--intent", arguments["intent"], "--url", arguments["video_url"]])
    if name == "hyperflow.lab.score":
        return _run_cli(["lab", "score", arguments["experiment_id"]])
    if name == "hyperflow.lab.policy":
        return _run_cli(["lab", "policy", arguments["experiment_id"]])
    if name == "hyperflow.lab.prepare_upload":
        return _run_cli(["lab", "prepare", arguments["experiment_id"]])

    return {"error": f"Unhandled tool {name}"}


def handle(request: Dict[str, Any]) -> Dict[str, Any]:
    method = request.get("method")
    req_id = request.get("id")
    params = request.get("params") or {}

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "serverInfo": {"name": "hyperflow-unified-mcp", "version": "0.1.0"},
            },
        }

    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": [
                    {
                        "name": name,
                        "description": spec["description"],
                        "inputSchema": spec["input_schema"],
                    }
                    for name, spec in TOOLS.items()
                ]
            },
        }

    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments", {})
        result = _handle_tool(name, arguments)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result, indent=2)}]
            },
        }

    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Method {method} not found"},
    }


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = handle(request)
            print(json.dumps(response), flush=True)
        except Exception as e:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(e)}}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
