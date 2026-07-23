#!/usr/bin/env python3
"""
MCP Bridge for HyperFlow — exposes HyperFlow CLI as MCP tools.

This implementation provides a complete bridge between MCP clients and
the HyperFlow Ledger OS CLI. It can be integrated with Windsurf Cascade
or other MCP server implementations.
"""

import json
import subprocess
from pathlib import Path
from typing import Dict, Any, List

BASE_DIR = Path(__file__).parent.parent
HYPERFLOW_CLI = BASE_DIR / "hyperflow_cli.py"


def run_hyperflow_command(args: list) -> Dict[str, Any]:
    """Run a hyperflow CLI command and return JSON output."""
    try:
        result = subprocess.run(
            ["python3", str(HYPERFLOW_CLI)] + args,
            capture_output=True,
            text=True,
            cwd=str(BASE_DIR),
            timeout=60
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "stdout": "",
            "stderr": "Command timed out after 60s",
            "exit_code": -1
        }
    except Exception as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": str(e),
            "exit_code": -1
        }


# MCP Tool Definitions
MCP_TOOLS = {
    "hyperflow.task_add": {
        "description": "Add a new task to the HyperFlow ledger",
        "input_schema": {
            "type": "object",
            "properties": {
                "request": {"type": "string", "description": "Task description"}
            },
            "required": ["request"]
        }
    },
    "hyperflow.list": {
        "description": "List all tasks in the ledger",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    "hyperflow.status": {
        "description": "Show overall HyperFlow system status",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    "hyperflow.verify": {
        "description": "Run verification checks on the ledger",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    "hyperflow.receipt": {
        "description": "Show receipts for a task or all receipts",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Optional task ID"}
            }
        }
    },
    "hyperflow.assign": {
        "description": "Assign a task to an agent",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Task ID"},
                "agent": {"type": "string", "description": "Agent name"}
            },
            "required": ["task_id", "agent"]
        }
    },
    "hyperflow.state": {
        "description": "Update task state",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Task ID"},
                "state": {"type": "string", "description": "New state"}
            },
            "required": ["task_id", "state"]
        }
    },
    "hyperflow.next": {
        "description": "Show next actions from next.md",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    "hyperflow.value": {
        "description": "Generate valuation packet for tasks",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    "hydra.sentinel_check": {
        "description": "Run Hydra Sentinel anomaly check",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    "hydra.capture_state": {
        "description": "Capture full system state with Hydra Archivist",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Optional task ID"}
            }
        }
    },
    "hydra.resume": {
        "description": "Generate resume packet for a task",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Task ID"}
            },
            "required": ["task_id"]
        }
    }
}


def call_tool(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Call an MCP tool by name with arguments."""
    if tool_name == "hyperflow.task_add":
        result = run_hyperflow_command(["new", arguments["request"]])
        return result
    elif tool_name == "hyperflow.list":
        result = run_hyperflow_command(["list"])
        return result
    elif tool_name == "hyperflow.status":
        result = run_hyperflow_command(["status"])
        return result
    elif tool_name == "hyperflow.verify":
        result = run_hyperflow_command(["verify"])
        return result
    elif tool_name == "hyperflow.receipt":
        task_id = arguments.get("task_id")
        if task_id:
            result = run_hyperflow_command(["receipt", task_id])
        else:
            result = run_hyperflow_command(["receipt"])
        return result
    elif tool_name == "hyperflow.assign":
        result = run_hyperflow_command(["assign", arguments["task_id"], arguments["agent"]])
        return result
    elif tool_name == "hyperflow.state":
        result = run_hyperflow_command(["state", arguments["task_id"], arguments["state"]])
        return result
    elif tool_name == "hyperflow.next":
        result = run_hyperflow_command(["next"])
        return result
    elif tool_name == "hyperflow.value":
        result = run_hyperflow_command(["value"])
        return result
    elif tool_name == "hydra.sentinel_check":
        result = run_hyperflow_command(["python3", "scripts/hydra_sentinel.py", "--check"])
        return result
    elif tool_name == "hydra.capture_state":
        task_id = arguments.get("task_id")
        if task_id:
            result = run_hyperflow_command(["python3", "scripts/hydra_archivist.py", "--capture", "--task", task_id])
        else:
            result = run_hyperflow_command(["python3", "scripts/hydra_archivist.py", "--capture"])
        return result
    elif tool_name == "hydra.resume":
        result = run_hyperflow_command(["python3", "scripts/hydra_executor.py", "--resume", arguments["task_id"]])
        return result
    else:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Unknown tool: {tool_name}",
            "exit_code": -1
        }


def list_tools() -> List[str]:
    """Return list of available MCP tools."""
    return list(MCP_TOOLS.keys())


def get_tool_schema(tool_name: str) -> Dict[str, Any]:
    """Return schema for a specific tool."""
    return MCP_TOOLS.get(tool_name, {})


if __name__ == "__main__":
    # Test the bridge
    print("=== MCP Bridge Test ===")
    print(f"Available tools: {list_tools()}")
    print(f"Total tools: {len(MCP_TOOLS)}")
    
    # Test status
    print("\nTesting hyperflow.status:")
    result = call_tool("hyperflow.status", {})
    print(f"Success: {result['success']}")
    print(f"Output: {result['stdout'][:200]}")
    
    # Test list
    print("\nTesting hyperflow.list:")
    result = call_tool("hyperflow.list", {})
    print(f"Success: {result['success']}")
    print(f"Output: {result['stdout'][:200]}")
    
    print("\n=== MCP Bridge Ready ===")
