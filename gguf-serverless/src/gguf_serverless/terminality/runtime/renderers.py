"""
Renderers — projections of the ExecutionObject.

The terminal is just one renderer. The web dashboard is another.
A phone is another. An autonomous agent is another. A different LLM
is another. They are all looking at the same underlying execution graph.

  ExecutionObject (the thing)
    ├── TerminalRenderer (PTY projection)
    ├── JSONRenderer (API projection)
    └── AgentRenderer (autonomous agent projection)

Each renderer reads the same ExecutionObject but presents it differently.
None of them own the state. The runtime owns the state.
"""

from __future__ import annotations
import json
import os
import select
import time
from typing import Optional, Any

from .execution_object import (
    ExecutionObject, ExecutionState, ExecutionStatus,
    ExecutionGraph, Objective, Provenance,
)


class TerminalRenderer:
    """Render an ExecutionObject as terminal output.

    This is the tmux replacement view: the execution object's
    terminal_output field projected onto a PTY.

    But the terminal doesn't own the state — it just renders it.
    You can close the terminal, open a web dashboard, and see
    the same computation from a different angle.
    """

    @staticmethod
    def render(obj: ExecutionObject) -> str:
        """Render an execution object as terminal text."""
        lines = []

        # Header
        status_color = {
            ExecutionStatus.PENDING: "\033[33m",
            ExecutionStatus.RUNNING: "\033[32m",
            ExecutionStatus.COMPLETED: "\033[36m",
            ExecutionStatus.FAILED: "\033[31m",
            ExecutionStatus.FORKED: "\033[35m",
            ExecutionStatus.MERGED: "\033[34m",
        }.get(obj.status, "\033[0m")
        reset = "\033[0m"

        lines.append(f"{status_color}● {obj.status.value.upper()}{reset} "
                     f"[{obj.short_hash}] {obj.objective.description}")
        lines.append(f"  Created by: {obj.provenance.creator}")
        lines.append(f"  Causal depth: {len(obj.causal_links)}")
        lines.append("")

        # State summary
        if obj.state.variables:
            lines.append("  State:")
            for k, v in list(obj.state.variables.items())[:10]:
                val_str = str(v)[:80]
                lines.append(f"    {k} = {val_str}")

        # Verified facts
        if obj.state.verified_facts:
            lines.append(f"\n  Verified facts ({len(obj.state.verified_facts)}):")
            for f in obj.state.verified_facts[-5:]:
                lines.append(f"    ✓ {f}")

        # Reasoning chain
        if obj.state.reasoning_chain:
            lines.append(f"\n  Reasoning chain ({len(obj.state.reasoning_chain)} steps):")
            for i, step in enumerate(obj.state.reasoning_chain[-5:]):
                action = step.get("action", "?")[:60]
                result = step.get("result", "")[:60]
                lines.append(f"    [{i}] {action}")
                if result:
                    lines.append(f"        → {result}")

        # Terminal output (if any)
        if obj.state.terminal_output:
            lines.append(f"\n  Terminal output:")
            output = obj.state.terminal_output
            if len(output) > 500:
                lines.append(f"    {output[:250]}")
                lines.append(f"    ... ({len(output)} bytes total)")
                lines.append(f"    {output[-250:]}")
            else:
                lines.append(f"    {output}")

        # Cost
        if obj.state.tokens_consumed or obj.state.compute_seconds:
            lines.append(f"\n  Tokens: {obj.state.tokens_consumed}  "
                        f"Compute: {obj.state.compute_seconds:.1f}s  "
                        f"Cost: ${obj.state.cost_estimate:.4f}")

        return "\n".join(lines)

    @staticmethod
    def render_graph(graph: ExecutionGraph, head_hash: Optional[str] = None) -> str:
        """Render the execution graph as a tree (like git log --graph)."""
        lines = []
        if head_hash:
            chain = graph.get_causal_chain(head_hash)
        else:
            # Show all heads
            chain = []
            for h in graph.heads:
                chain.extend(graph.get_causal_chain(h))
            # Deduplicate
            seen = set()
            chain = [o for o in chain if o.hash not in seen and not seen.add(o.hash)]

        for obj in chain:
            prefix = "●" if obj.hash in graph.heads else "○"
            status = obj.status.value
            obj_line = f"{prefix} [{obj.short_hash}] {status} — {obj.objective.description[:50]}"
            lines.append(obj_line)
            for link in obj.causal_links:
                lines.append(f"  ← {link.parent_hash[:12]} ({link.cause[:40]})")

        return "\n".join(lines)


class JSONRenderer:
    """Render an ExecutionObject as JSON (for API/web/agent consumption).

    This is the projection for:
    - Web dashboards
    - REST APIs
    - Other LLMs (they see the same state as the terminal)
    - Programmatic access
    """

    @staticmethod
    def render(obj: ExecutionObject) -> str:
        return obj.to_json()

    @staticmethod
    def render_graph(graph: ExecutionGraph) -> str:
        return json.dumps({
            "stats": graph.stats(),
            "roots": graph.roots,
            "heads": graph.heads,
            "objects": {
                h: {
                    "short_hash": obj.short_hash,
                    "status": obj.status.value,
                    "objective": obj.objective.description,
                    "creator": obj.provenance.creator,
                    "causal_links": [
                        {"parent": l.parent_hash[:12], "cause": l.cause}
                        for l in obj.causal_links
                    ],
                    "children": [c[:12] for c in obj.children],
                }
                for h, obj in graph.objects.items()
            },
        }, indent=2)


class AgentRenderer:
    """Render an ExecutionObject for autonomous agent consumption.

    This is the projection for an AI agent that needs to continue
    the computation. It provides:
    - The objective
    - The minimal causal frontier (not full history)
    - The current state
    - What's been tried and what failed

    The agent doesn't see terminal output or formatting.
    It sees structured computation state.
    """

    @staticmethod
    def render(obj: ExecutionObject,
               graph: Optional[ExecutionGraph] = None) -> str:
        """Render for agent consumption — minimal, structured."""
        agent_view = {
            "objective": {
                "description": obj.objective.description,
                "success_criteria": obj.objective.success_criteria,
                "constraints": obj.objective.constraints,
            },
            "current_state": {
                "variables": obj.state.variables,
                "verified_facts": obj.state.verified_facts,
            },
            "what_been_tried": [
                {
                    "action": s.get("action", ""),
                    "result": s.get("result", "")[:200],
                }
                for s in obj.state.reasoning_chain[-10:]
            ],
            "what_failed": [
                {
                    "error": str(e)[:200],
                }
                for e in obj.state.failed_attempts[-5:]
            ],
            "causal_context": {
                "depth": len(obj.causal_links),
                "parents": [
                    {"hash": l.parent_hash[:12], "cause": l.cause}
                    for l in obj.causal_links
                ],
            },
            "status": obj.status.value,
            "tokens_consumed": obj.state.tokens_consumed,
            "compute_seconds": obj.state.compute_seconds,
        }

        # If graph provided, include minimal causal frontier
        if graph:
            from .causal_frontier import CausalReconstructor
            reconstructor = CausalReconstructor(graph)
            try:
                frontier = reconstructor.compute_frontier(obj.hash)
                agent_view["causal_frontier"] = {
                    "required_state": frontier.required_state,
                    "required_facts": frontier.required_facts,
                    "depth": frontier.causal_depth,
                    "compressed_size": frontier.compressed_size,
                }
            except Exception:
                pass

        return json.dumps(agent_view, indent=2, default=str)

    @staticmethod
    def render_prompt(obj: ExecutionObject) -> str:
        """Render as a natural language prompt for any LLM.

        Model-agnostic: works with GPT, Claude, Qwen, Llama, any model.
        The runtime owns the structure; the model interprets it.
        """
        prompt_parts = [
            f"OBJECTIVE: {obj.objective.description}",
            f"SUCCESS CRITERIA: {obj.objective.success_criteria}",
            f"STATUS: {obj.status.value}",
            "",
            "CURRENT STATE:",
        ]

        for k, v in obj.state.variables.items():
            prompt_parts.append(f"  {k} = {str(v)[:200]}")

        if obj.state.verified_facts:
            prompt_parts.append("\nVERIFIED FACTS:")
            for f in obj.state.verified_facts[-10:]:
                prompt_parts.append(f"  - {f}")

        if obj.state.reasoning_chain:
            prompt_parts.append(f"\nPREVIOUS STEPS ({len(obj.state.reasoning_chain)} total, showing last 5):")
            for s in obj.state.reasoning_chain[-5:]:
                prompt_parts.append(f"  - {s.get('action', '?')}: {str(s.get('result', ''))[:100]}")

        if obj.state.failed_attempts:
            prompt_parts.append(f"\nFAILED ATTEMPTS ({len(obj.state.failed_attempts)}):")
            for e in obj.state.failed_attempts[-3:]:
                prompt_parts.append(f"  - {str(e)[:100]}")

        prompt_parts.append("\nWhat is the next step to advance this objective?")

        return "\n".join(prompt_parts)
