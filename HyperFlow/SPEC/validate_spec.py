#!/usr/bin/env python3
"""
SPEC/ acceptance test validation script for HyperFlow.

Reads SPEC/*.md files, extracts acceptance tests, runs them, and generates receipts.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Tuple

SPEC_DIR = Path(__file__).parent
RECEIPTS_FILE = SPEC_DIR.parent / "receipts.jsonl"


def extract_acceptance_tests(spec_file: Path) -> List[Tuple[str, str]]:
    """Extract acceptance tests from a SPEC markdown file.
    
    Returns list of (test_name, command) tuples.
    """
    if not spec_file.exists():
        return []
    
    content = spec_file.read_text()
    tests = []
    
    # Pattern: - `command` or - command
    pattern = r'-\s+`?([^\n`]+)`?'
    matches = re.findall(pattern, content)
    
    for i, match in enumerate(matches):
        test_name = f"{spec_file.stem}_test_{i+1}"
        tests.append((test_name, match.strip()))
    
    return tests


def run_test(command: str, cwd: Path) -> Tuple[bool, str, str, int]:
    """Run a single test command.
    
    Returns (success, stdout, stderr, exit_code).
    """
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=60
        )
        success = result.returncode == 0
        return success, result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return False, "", "Test timed out after 60s", -1
    except Exception as e:
        return False, "", str(e), -1


def generate_receipt(spec_file: Path, test_results: List[Dict]) -> Dict:
    """Generate a receipt for spec validation."""
    receipt = {
        "task_id": f"SPEC-{spec_file.stem}",
        "date": datetime.now(timezone.utc).isoformat(),
        "agent": "validate_spec.py",
        "files_changed": [str(spec_file)],
        "commands_run": [t["command"] for t in test_results],
        "build_result": "N/A",
        "test_result": "PASS" if all(t["success"] for t in test_results) else "FAIL",
        "errors": [t["stderr"] for t in test_results if not t["success"]],
        "artifact_output": f"Validated {len(test_results)} tests from {spec_file.name}",
        "economic_value": {
            "time_saved_hours": 0.5,
            "artifact_class": "verified spec",
            "reusability": "high",
            "sellable": False,
            "financeable": False
        },
        "confidence": "high" if all(t["success"] for t in test_results) else "low",
        "next_action": "Fix failing tests" if not all(t["success"] for t in test_results) else "Spec validated"
    }
    return receipt


def validate_spec(spec_file: Path, dry_run: bool = False) -> bool:
    """Validate a single SPEC file."""
    print(f"\n=== Validating {spec_file.name} ===")
    
    tests = extract_acceptance_tests(spec_file)
    if not tests:
        print(f"  No acceptance tests found in {spec_file.name}")
        return True
    
    print(f"  Found {len(tests)} acceptance tests")
    
    test_results = []
    all_passed = True
    
    for test_name, command in tests:
        print(f"\n  Running: {command}")
        
        if dry_run:
            print(f"    [DRY RUN] Would execute: {command}")
            test_results.append({
                "name": test_name,
                "command": command,
                "success": None,
                "stdout": "",
                "stderr": "",
                "exit_code": None
            })
            continue
        
        success, stdout, stderr, exit_code = run_test(command, SPEC_DIR.parent)
        
        status = "PASS" if success else "FAIL"
        print(f"    {status} (exit code: {exit_code})")
        
        if stderr and not success:
            print(f"    stderr: {stderr[:200]}")
        
        test_results.append({
            "name": test_name,
            "command": command,
            "success": success,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": exit_code
        })
        
        if not success:
            all_passed = False
    
    # Generate and append receipt
    if not dry_run:
        receipt = generate_receipt(spec_file, test_results)
        with open(RECEIPTS_FILE, "a") as f:
            f.write(json.dumps(receipt, ensure_ascii=False) + "\n")
        print(f"\n  Receipt written to {RECEIPTS_FILE}")
    
    return all_passed


def main():
    parser = argparse.ArgumentParser(description="Validate SPEC acceptance tests")
    parser.add_argument("spec", nargs="?", help="Specific SPEC file to validate (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="Show tests without executing")
    parser.add_argument("--list", action="store_true", help="List all SPEC files and their tests")
    
    args = parser.parse_args()
    
    # List mode
    if args.list:
        spec_files = list(SPEC_DIR.glob("*.md"))
        if not spec_files:
            print("No SPEC files found")
            return 0
        
        print("=== SPEC Files and Tests ===")
        for spec_file in sorted(spec_files):
            tests = extract_acceptance_tests(spec_file)
            print(f"\n{spec_file.name}:")
            if tests:
                for test_name, command in tests:
                    print(f"  - {command}")
            else:
                print("  (no acceptance tests found)")
        return 0
    
    # Validation mode
    if args.spec:
        spec_files = [SPEC_DIR / args.spec]
        if not spec_files[0].exists():
            print(f"SPEC file not found: {args.spec}", file=sys.stderr)
            return 1
    else:
        spec_files = sorted(SPEC_DIR.glob("*.md"))
        if not spec_files:
            print("No SPEC files found in SPEC/")
            return 0
    
    print(f"=== SPEC Validation ===")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'EXECUTE'}")
    
    all_passed = True
    for spec_file in spec_files:
        if not validate_spec(spec_file, dry_run=args.dry_run):
            all_passed = False
    
    print(f"\n=== Summary ===")
    if all_passed:
        print("All specs validated successfully")
        return 0
    else:
        print("Some specs failed validation")
        return 1


if __name__ == "__main__":
    sys.exit(main())
