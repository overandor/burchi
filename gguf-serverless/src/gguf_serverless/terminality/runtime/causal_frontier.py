"""
Causal Frontier — minimal causal chain reconstruction.

Instead of replaying millions of log lines, the runtime reconstructs
only the causal frontier needed to continue work.

  History asks: "what happened yesterday?"
  Causality asks: "what minimal chain of events explains why this state exists?"

The causal frontier is the minimal set of execution objects whose state
is REQUIRED to resume computation. Everything else can be discarded.
"""

from __future__ import annotations
import hashlib
import json
from dataclasses import dataclass, field
from typing import Optional, Any

from .execution_object import (
    ExecutionObject, ExecutionState, CausalLink, ExecutionGraph,
    ExecutionContext, Objective, Provenance, ExecutionStatus,
)


@dataclass
class CausalFrontier:
    """The minimal causal frontier for resuming a computation.

    Contains only what's needed to continue — not the full history.
    This is what gets distributed to peers, stored, or resumed.
    """
    head_hash: str                    # the execution object to resume
    required_objects: list[str]       # hashes of objects needed for context
    required_state: dict[str, Any]    # minimal state snapshot
    required_facts: list[str]         # verified facts that must hold
    required_files: list[str]         # files that must exist
    objective_hash: str               # what we're trying to achieve
    causal_depth: int                 # how many links back are preserved
    compressed_size: int = 0          # estimated bytes of the frontier

    def hash(self) -> str:
        return hashlib.sha256(
            json.dumps({
                "head": self.head_hash,
                "required": self.required_objects,
                "state": self.required_state,
                "facts": self.required_facts,
                "objective": self.objective_hash,
            }, sort_keys=True, default=str).encode()
        ).hexdigest()

    def to_json(self) -> str:
        return json.dumps({
            "head_hash": self.head_hash,
            "required_objects": self.required_objects,
            "required_state": self.required_state,
            "required_facts": self.required_facts,
            "required_files": self.required_files,
            "objective_hash": self.objective_hash,
            "causal_depth": self.causal_depth,
            "compressed_size": self.compressed_size,
            "hash": self.hash(),
        }, indent=2)


class CausalReconstructor:
    """Reconstructs computation from the causal frontier.

    Given a CausalFrontier + the execution objects it references,
    rebuild the minimal state needed to continue work.

    This is NOT replay. We don't re-execute history.
    We reconstruct only the state that causally matters.
    """

    def __init__(self, graph: ExecutionGraph):
        self.graph = graph

    def compute_frontier(self, head_hash: str) -> CausalFrontier:
        """Compute the minimal causal frontier for a head object."""
        head = self.graph.get(head_hash)
        if not head:
            raise ValueError(f"Object {head_hash[:12]} not in graph")

        # Walk causal chain and collect only what's needed
        chain = self.graph.get_causal_chain(head_hash)
        required_objects = [head_hash]
        required_state = {}
        required_facts = list(head.context.required_facts)
        required_files = list(head.context.required_files)

        # Include head's state
        required_state.update(head.state.variables)

        # Walk back collecting required state/facts
        for obj in chain[1:]:
            # Only include if it has state we need
            needed_keys = set(head.context.required_state.keys())
            has_needed = needed_keys & set(obj.state.variables.keys())
            if has_needed:
                for k in has_needed:
                    if k not in required_state:
                        required_state[k] = obj.state.variables[k]
                required_objects.append(obj.hash)

            # Include if it has facts we need
            needed_facts = set(head.context.required_facts)
            has_facts = needed_facts & set(obj.state.verified_facts)
            if has_facts:
                for f in has_facts:
                    if f not in required_facts:
                        required_facts.append(f)
                if obj.hash not in required_objects:
                    required_objects.append(obj.hash)

            # Stop if we have everything
            if (set(head.context.required_state.keys()) <= set(required_state.keys())
                and set(head.context.required_facts) <= set(required_facts)):
                break

        # Estimate compressed size
        compressed_size = len(json.dumps(required_state, default=str))
        compressed_size += sum(len(f) for f in required_facts)
        compressed_size += len(required_objects) * 64  # hash size

        return CausalFrontier(
            head_hash=head_hash,
            required_objects=required_objects,
            required_state=required_state,
            required_facts=required_facts,
            required_files=required_files,
            objective_hash=head.objective.hash(),
            causal_depth=len(required_objects),
            compressed_size=compressed_size,
        )

    def reconstruct(self, frontier: CausalFrontier,
                    objects: dict[str, ExecutionObject]) -> ExecutionObject:
        """Reconstruct an execution object from a causal frontier.

        Given the frontier + the objects it references, rebuild
        the head object with all required state present.
        """
        head = objects.get(frontier.head_hash)
        if not head:
            raise ValueError(f"Head object {frontier.head_hash[:12]} not provided")

        # Verify all required objects are present
        for h in frontier.required_objects:
            if h not in objects:
                raise ValueError(f"Required object {h[:12]} not provided")

        # Verify required state is present
        for key in frontier.required_state:
            if key not in head.state.variables:
                # Pull from the object that has it
                for h in frontier.required_objects:
                    obj = objects.get(h)
                    if obj and key in obj.state.variables:
                        head.state.variables[key] = obj.state.variables[key]
                        break

        # Verify required facts
        for fact in frontier.required_facts:
            if fact not in head.state.verified_facts:
                head.state.verified_facts.append(fact)

        # Verify causal integrity
        if not head.verify():
            raise ValueError("Causal integrity check failed on reconstruction")

        return head

    def compare_frontiers(self, f1: CausalFrontier, f2: CausalFrontier) -> dict:
        """Compare two causal frontiers — useful for merge decisions."""
        return {
            "f1_depth": f1.causal_depth,
            "f2_depth": f2.causal_depth,
            "f1_size": f1.compressed_size,
            "f2_size": f2.compressed_size,
            "shared_state": set(f1.required_state.keys()) & set(f2.required_state.keys()),
            "shared_facts": set(f1.required_facts) & set(f2.required_facts),
            "shared_objects": set(f1.required_objects) & set(f2.required_objects),
            "f1_unique_state": set(f1.required_state.keys()) - set(f2.required_state.keys()),
            "f2_unique_state": set(f2.required_state.keys()) - set(f1.required_state.keys()),
        }
