"""Output writers: dossier entries + adas-ventures + orchestrator state.

This module writes the recommendation to three destinations:
  1. The Novel Market Narratives Dossier (append a structured entry).
  2. An adas-ventures project skeleton (ready for the orchestrator to build).
  3. The agent_orchestrator state (so the orchestrator picks it up).
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pipeline.disassembly import BusinessProcess
from pipeline.prior_art import PriorArtReport
from pipeline.recommendation import Recommendation

DEFAULT_DOSSIER = Path.home() / "CascadeProjects" / "Novel_Market_Narratives_Dossier.md"
DEFAULT_VENTURES_DIR = Path.home() / "CascadeProjects" / "adas-ventures"
DEFAULT_ORCHESTRATOR_STATE = Path.home() / ".adas2" / "state.json"
DEFAULT_PIPELINE_LEDGER = Path.home() / ".chatsync" / "pipeline_ledger.jsonl"


def _next_dossier_number(dossier_path: Path) -> int:
    """Find the next section number by scanning existing '# N. ' headers."""
    if not dossier_path.exists():
        return 91  # Dossier currently ends at section 90.
    highest = 90
    import re
    with open(dossier_path, "r", encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^# (\d+)\. ", line)
            if m:
                n = int(m.group(1))
                if n > highest:
                    highest = n
    return highest + 1


def write_dossier_entry(
    recommendation: Recommendation,
    processes: list[BusinessProcess],
    reports: list[PriorArtReport],
    dossier_path: Path = DEFAULT_DOSSIER,
) -> str:
    """Append a structured entry to the dossier. Returns the section title."""
    section_num = _next_dossier_number(dossier_path)
    r = recommendation
    rm = r.revenue_model

    # Build prior-art table.
    prior_lines = []
    for report in reports[:3]:
        for hit in (report.web_hits + report.patent_hits + report.academic_hits)[:3]:
            prior_lines.append(f"- [{hit.title}]({hit.url}) — _{hit.source}_ — {hit.snippet[:120]}")
    prior_block = "\n".join(prior_lines) if prior_lines else "_No direct prior art found._"

    # Build evidence block from source processes.
    evidence_lines = []
    for p in processes[:3]:
        evidence_lines.append(
            f"- **{p.name}** (from {p.source} chat: _{p.conversation_title}_)\n"
            f"  > {p.evidence_excerpt[:200]}"
        )
    evidence_block = "\n".join(evidence_lines) if evidence_lines else "_No evidence excerpts._"

    entry = f"""
---

# {section_num}. {r.product_name} — {r.new_category}

## Category
{r.new_category}

## Core Invention
{r.solution}

## Novelty
{r.novelty_claim}

## Category Rationale
{r.category_rationale}

## Differentiation
{r.differentiation}

## MVP Scope
"""
    for item in r.mvp_scope:
        entry += f"- {item}\n"

    entry += f"""
## Revenue Model
- **Pricing:** {rm.pricing}
- **Go-to-market:** {rm.gtm}
- **Customer:** {rm.customer}
- **Year 1 ARR target:** {rm.arr_year1}
- **Unit economics:** {rm.unit_economics}

## Prior Art
{prior_block}

## Prior-Art Summary
{r.prior_art_summary}

**Novelty assessment:** {r.novelty_assessment}

## Evidence
{evidence_block}

## Patent-Counsel Flag
{r.patent_counsel_flag}

## Source Conversations
"""
    for cid in r.source_conversations:
        entry += f"- `{cid}`\n"

    entry += f"""
## Pipeline Provenance
- Generated: {datetime.now(tz=timezone.utc).isoformat()}
- Pipeline: ChatSync disassembly → prior-art research → recommendation
- Recommendation ID: `{r.id}`
"""
    with open(dossier_path, "a", encoding="utf-8") as f:
        f.write(entry)

    return f"{section_num}. {r.product_name} — {r.new_category}"


def _slugify_venture(name: str) -> str:
    import re
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-").lower()
    return s[:50] or "untitled-venture"


def spawn_venture(
    recommendation: Recommendation,
    ventures_dir: Path = DEFAULT_VENTURES_DIR,
) -> Path:
    """Create an adas-ventures project skeleton from the recommendation."""
    slug = _slugify_venture(recommendation.product_name)
    vpath = ventures_dir / slug
    vpath.mkdir(parents=True, exist_ok=True)

    # Write a venture manifest that the ADAS orchestrator can ingest.
    manifest = {
        "name": slug,
        "display_name": recommendation.product_name,
        "description": recommendation.solution[:300],
        "type": "pypi",
        "revenue_potential": "high" if recommendation.novelty_assessment == "novel" else "medium",
        "new_category": recommendation.new_category,
        "mvp_scope": recommendation.mvp_scope,
        "revenue_model": asdict(recommendation.revenue_model),
        "novelty_claim": recommendation.novelty_claim,
        "patent_counsel_flag": recommendation.patent_counsel_flag,
        "source_conversations": recommendation.source_conversations,
        "recommendation_id": recommendation.id,
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    (vpath / "venture.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Write a starter README so the venture dir is not empty.
    (vpath / "README.md").write_text(
        f"# {recommendation.product_name}\n\n"
        f"**Category:** {recommendation.new_category}\n\n"
        f"**Tagline:** {recommendation.tagline}\n\n"
        f"## Problem\n{recommendation.problem}\n\n"
        f"## Solution\n{recommendation.solution}\n\n"
        f"## MVP Scope\n"
        + "".join(f"- {item}\n" for item in recommendation.mvp_scope)
        + f"\n## Revenue Model\n- Pricing: {recommendation.revenue_model.pricing}\n"
        f"- GTM: {recommendation.revenue_model.gtm}\n"
        f"- Customer: {recommendation.revenue_model.customer}\n\n"
        f"## Novelty\n{recommendation.novelty_claim}\n\n"
        f"## Patent-Counsel Flag\n{recommendation.patent_counsel_flag}\n",
        encoding="utf-8",
    )
    return vpath


def feed_orchestrator(
    recommendation: Recommendation,
    venture_path: Path,
    state_path: Path = DEFAULT_ORCHESTRATOR_STATE,
) -> bool:
    """Append the venture to the ADAS orchestrator state so it picks it up."""
    if not state_path.exists():
        return False
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False

    import hashlib
    vid = hashlib.sha256(f"{recommendation.product_name}{time.time()}".encode()).hexdigest()[:8]
    venture_entry = {
        "id": vid,
        "name": venture_path.name,
        "description": recommendation.solution[:200],
        "project_type": "pypi",
        "path": str(venture_path),
        "stage": "ideation",
        "tasks": [],
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
        "revenue_potential": "high" if recommendation.novelty_assessment == "novel" else "medium",
        "git_url": "",
        "learnings": [],
        "validation_results": {},
        "assigned_agent": "",
        "pipeline_origin": {
            "recommendation_id": recommendation.id,
            "new_category": recommendation.new_category,
            "novelty_assessment": recommendation.novelty_assessment,
        },
    }
    ventures = state.get("ventures", [])
    # Avoid duplicates by name.
    if not any(v.get("name") == venture_entry["name"] for v in ventures):
        ventures.append(venture_entry)
        state["ventures"] = ventures
        state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
        return True
    return False


def append_ledger(
    recommendation: Recommendation,
    processes: list[BusinessProcess],
    reports: list[PriorArtReport],
    dossier_section: str,
    venture_path: Path,
    ledger_path: Path = DEFAULT_PIPELINE_LEDGER,
) -> None:
    """Append a record to the pipeline ledger for auditability."""
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "recommendation_id": recommendation.id,
        "product_name": recommendation.product_name,
        "new_category": recommendation.new_category,
        "novelty_assessment": recommendation.novelty_assessment,
        "process_count": len(processes),
        "report_count": len(reports),
        "dossier_section": dossier_section,
        "venture_path": str(venture_path),
        "source_conversations": recommendation.source_conversations,
    }
    with open(ledger_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
