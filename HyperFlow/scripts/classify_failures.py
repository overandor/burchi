#!/usr/bin/env python3
"""
Automated failure classification from build logs.

Analyzes build logs to classify failure types and suggest fixes.
"""

import argparse
import re
from pathlib import Path
from typing import List, Dict, Tuple
from collections import Counter

BUILD_LOGS_DIR = Path(__file__).parent.parent / "build_logs"


FAILURE_PATTERNS = {
    "syntax_error": {
        "patterns": [r"SyntaxError", r"syntax error", r"unexpected token"],
        "severity": "high",
        "suggestion": "Check for typos, missing brackets, or incorrect syntax"
    },
    "import_error": {
        "patterns": [r"ImportError", r"ModuleNotFoundError", r"No module named"],
        "severity": "high",
        "suggestion": "Install missing dependencies or fix import paths"
    },
    "type_error": {
        "patterns": [r"TypeError", r"unsupported operand", r"not supported between"],
        "severity": "medium",
        "suggestion": "Check data types and type conversions"
    },
    "attribute_error": {
        "patterns": [r"AttributeError", r"has no attribute", r"object has no attribute"],
        "severity": "medium",
        "suggestion": "Verify object has the expected attribute/method"
    },
    "file_not_found": {
        "patterns": [r"FileNotFoundError", r"No such file", r"cannot open"],
        "severity": "high",
        "suggestion": "Check file paths and ensure files exist"
    },
    "permission_error": {
        "patterns": [r"PermissionError", r"Permission denied", r"access denied"],
        "severity": "high",
        "suggestion": "Check file permissions and user access rights"
    },
    "test_failure": {
        "patterns": [r"FAILED", r"AssertionError", r"assert"],
        "severity": "medium",
        "suggestion": "Review test expectations and implementation"
    },
    "timeout": {
        "patterns": [r"TimeoutError", r"timed out", r"timeout"],
        "severity": "medium",
        "suggestion": "Increase timeout or optimize slow operations"
    },
    "memory_error": {
        "patterns": [r"MemoryError", r"out of memory", r"OOM"],
        "severity": "high",
        "suggestion": "Reduce memory usage or increase available memory"
    },
    "network_error": {
        "patterns": [r"ConnectionError", r"Network error", r"timeout", r"refused"],
        "severity": "medium",
        "suggestion": "Check network connectivity and service availability"
    }
}


def classify_log(log_content: str) -> List[Dict]:
    """Classify failures in a build log."""
    failures = []
    
    for failure_type, config in FAILURE_PATTERNS.items():
        for pattern in config["patterns"]:
            matches = re.findall(pattern, log_content, re.IGNORECASE)
            if matches:
                failures.append({
                    "type": failure_type,
                    "count": len(matches),
                    "severity": config["severity"],
                    "suggestion": config["suggestion"]
                })
                break  # Only count each failure type once
    
    return failures


def analyze_log_file(log_file: Path) -> Dict:
    """Analyze a single build log file."""
    if not log_file.exists():
        return {"error": f"Log file not found: {log_file}"}
    
    content = log_file.read_text()
    failures = classify_log(content)
    
    # Count errors and warnings
    error_count = len(re.findall(r"error:", content, re.IGNORECASE))
    warning_count = len(re.findall(r"warning:", content, re.IGNORECASE))
    
    return {
        "file": str(log_file),
        "failures": failures,
        "error_count": error_count,
        "warning_count": warning_count,
        "total_failures": len(failures)
    }


def generate_report(log_files: List[Path]) -> Dict:
    """Generate a failure classification report."""
    all_failures = []
    total_errors = 0
    total_warnings = 0
    
    for log_file in log_files:
        result = analyze_log_file(log_file)
        if "error" not in result:
            all_failures.extend(result["failures"])
            total_errors += result["error_count"]
            total_warnings += result["warning_count"]
    
    # Aggregate by failure type
    failure_counts = Counter()
    for f in all_failures:
        failure_counts[f["type"]] += 1
    
    # Sort by severity and count
    sorted_failures = sorted(
        failure_counts.items(),
        key=lambda x: (x[1], x[0]),
        reverse=True
    )
    
    return {
        "total_logs_analyzed": len(log_files),
        "total_errors": total_errors,
        "total_warnings": total_warnings,
        "failure_types": dict(sorted_failures),
        "top_failures": sorted_failures[:5],
        "suggestions": [
            {
                "type": ftype,
                "count": count,
                "suggestion": FAILURE_PATTERNS[ftype]["suggestion"],
                "severity": FAILURE_PATTERNS[ftype]["severity"]
            }
            for ftype, count in sorted_failures
        ]
    }


def main():
    parser = argparse.ArgumentParser(description="Classify build log failures")
    parser.add_argument("log", nargs="?", help="Specific log file to analyze")
    parser.add_argument("--all", action="store_true", help="Analyze all build logs")
    parser.add_argument("--dir", help="Directory containing build logs")
    
    args = parser.parse_args()
    
    if args.log:
        # Analyze single log
        log_file = Path(args.log)
        result = analyze_log_file(log_file)
        print(json.dumps(result, indent=2))
    elif args.all:
        # Analyze all logs in build_logs directory
        if not BUILD_LOGS_DIR.exists():
            print(f"Build logs directory not found: {BUILD_LOGS_DIR}")
            return 1
        
        log_files = list(BUILD_LOGS_DIR.glob("*.log"))
        if not log_files:
            print("No log files found")
            return 0
        
        report = generate_report(log_files)
        print(json.dumps(report, indent=2))
    elif args.dir:
        # Analyze logs in specific directory
        log_dir = Path(args.dir)
        if not log_dir.exists():
            print(f"Directory not found: {log_dir}")
            return 1
        
        log_files = list(log_dir.glob("*.log"))
        if not log_files:
            print("No log files found")
            return 0
        
        report = generate_report(log_files)
        print(json.dumps(report, indent=2))
    else:
        parser.print_help()
        return 1
    
    return 0


if __name__ == "__main__":
    import json
    import sys
    sys.exit(main())
