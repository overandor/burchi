#!/usr/bin/env python3
"""
Generate an attestation manifest for ASR hallucination-evaluation artifacts.

This fingerprints the canonical report, source code, and key dependency versions,
records git provenance, runner info, and the exact command used to regenerate the
report. The manifest is itself reproducible: every field is deterministic except
timestamp and environment.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=10).stdout.strip()
    except Exception:
        return ""


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git_info() -> dict[str, str]:
    return {
        "commit": _run(["git", "rev-parse", "HEAD"]),
        "short": _run(["git", "rev-parse", "--short", "HEAD"]),
        "branch": _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        "status": _run(["git", "status", "--short"]),
        "describe": _run(["git", "describe", "--tags", "--always"]),
    }


def _source_files() -> dict[str, dict[str, Any]]:
    files = {
        "experiments/replay_hc_report.py": "report_rebuilder",
        "experiments/hallucination_aware_pretraining.py": "ha_pretraining_experiment",
        "experiments/hallucination_coefficient.py": "hallucination_coefficient_module",
        "evaluation/compute_metrics.py": "metrics_module",
        "docs/hallucination_aware_pretraining_protocol.md": "protocol_document",
        "tests/test_hallucination_aware_pretraining.py": "mechanical_tests",
    }
    return {
        name: {
            "role": role,
            "sha256": _sha256_file(PROJECT_ROOT / name),
            "size": (PROJECT_ROOT / name).stat().st_size,
        }
        for name, role in files.items()
        if (PROJECT_ROOT / name).exists()
    }


def _dependency_versions() -> dict[str, str]:
    versions = {}
    for pkg in ["numpy", "torch", "whisper"]:
        try:
            mod = __import__(pkg)
            versions[pkg] = getattr(mod, "__version__", "unknown")
        except Exception:
            versions[pkg] = "not_installed"
    return versions


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate ASR eval attestation manifest")
    parser.add_argument("--results-dir", default="results/hc_experiment", help="Directory containing the canonical report")
    parser.add_argument("--extra", action="append", default=[], help="Extra files to fingerprint")
    parser.add_argument("--out", default="results/hc_experiment/attestation.json", help="Output attestation JSON path")
    parser.add_argument("--notes", default="", help="Free-form notes")
    args = parser.parse_args()

    results_dir = (PROJECT_ROOT / args.results_dir).resolve()
    if not results_dir.exists():
        print(f"FATAL: results directory not found: {results_dir}", file=sys.stderr)
        return 1

    evidence = []
    for p in sorted(results_dir.rglob("*")):
        if p.is_file() and p.name != "attestation.json":
            evidence.append({
                "relative_path": p.relative_to(results_dir).as_posix(),
                "sha256": _sha256_file(p),
                "size": p.stat().st_size,
            })

    extra_files = []
    for extra in args.extra:
        extra_path = Path(extra)
        if extra_path.exists():
            extra_files.append({
                "path": str(extra_path.resolve().relative_to(PROJECT_ROOT)),
                "sha256": _sha256_file(extra_path),
                "size": extra_path.stat().st_size,
            })

    attestation = {
        "schema": "asr.eval-attestation/v1.0",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "project_root": str(PROJECT_ROOT),
        "notes": args.notes,
        "runner": {
            "os": platform.platform(),
            "hostname": platform.node(),
            "python": platform.python_version(),
        },
        "git": _git_info(),
        "dependencies": _dependency_versions(),
        "source_files": _source_files(),
        "evidence_files": evidence,
        "extra_files": extra_files,
        "github_run_id": os.environ.get("GITHUB_RUN_ID", ""),
        "github_run_number": os.environ.get("GITHUB_RUN_NUMBER", ""),
        "github_sha": os.environ.get("GITHUB_SHA", ""),
        "github_ref": os.environ.get("GITHUB_REF", ""),
        "github_actor": os.environ.get("GITHUB_ACTOR", ""),
        "github_workflow": os.environ.get("GITHUB_WORKFLOW", ""),
        "canonical_report": {
            "relative_path": args.results_dir + "/hc_report.json",
            "regenerate_command": "python3 experiments/replay_hc_report.py",
        },
    }

    # Self-fingerprint: hash of attestation content without generated_utc
    attestation_for_hash = {k: v for k, v in attestation.items() if k != "generated_utc"}
    attestation["content_sha256"] = hashlib.sha256(
        json.dumps(attestation_for_hash, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    ).hexdigest()

    out_path = PROJECT_ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(attestation, indent=2) + "\n")
    print(f"Attestation: {len(evidence)} evidence files + {len(extra_files)} extra files -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
