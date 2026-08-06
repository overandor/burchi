"""
Inference Rollups — checkpoint reasoning, not just processes.

Instead of checkpointing only processes, checkpoint reasoning.
Future inference continues from previous verified reasoning
instead of reconstructing everything from prompts.

  Traditional: prompt → [full inference] → response → discard state
  Rollup:      prompt → [partial inference] → checkpoint → continue later

An InferenceRollup captures:
  - The reasoning chain (verified steps)
  - The model-independent inference state (not raw KV cache)
  - The causal evidence that supports each step
  - The frontier (what's been proven, what's still open)

Between same-architecture models: can transfer KV cache directly.
Between different architectures: transfer model-independent state
(token lineage, verified facts, reasoning structure) and let the
new model reconstruct internal state from the prompt + rollup.

This makes inference resumable across:
  - Different models (Qwen → Llama → GPT)
  - Different machines (cold start on new node)
  - Different times (pause today, resume tomorrow)
  - Different peers (one peer starts, another continues)
"""

from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum

from .execution_object import (
    ExecutionObject, ExecutionState, CausalLink,
    Objective, Provenance, ExecutionStatus,
)
from .execution_graph_v2 import GraphNode, NodeKind, ExecutionGraphV2


class RollupStatus(Enum):
    OPEN = "open"           # reasoning in progress, more steps needed
    VERIFIED = "verified"   # all steps verified, can be continued safely
    CONFLICTED = "conflicted"  # some steps contradict each other
    SUPERSEDED = "superseded"  # replaced by a newer rollup
    SEALED = "sealed"       # reasoning complete, no more steps needed


@dataclass
class ReasoningStep:
    """A single step in a reasoning chain.

    Each step is verified by the deterministic layer before
    being included in the rollup. Unverified steps are tentative.
    """
    step_id: str
    action: str                    # what was done
    input_state: dict[str, Any]    # state before this step
    output_state: dict[str, Any]   # state after this step
    evidence: str                   # hash of evidence supporting this step
    model_used: str                 # which model produced this
    verified: bool = False          # has deterministic layer verified
    verification_proof: Optional[str] = None  # hash of verification
    tokens_consumed: int = 0
    timestamp: float = field(default_factory=time.time)

    @property
    def tokens(self) -> int:
        return self.tokens_consumed

    def hash(self) -> str:
        return hashlib.sha256(
            json.dumps(asdict(self), sort_keys=True, default=str).encode()
        ).hexdigest()


@dataclass
class ModelIndependentState:
    """Model-independent inference state.

    This is NOT raw KV cache (which is model-specific).
    This is the semantic state that any model can use to continue:

    - verified_facts: proven true statements
    - open_questions: what still needs to be resolved
    - reasoning_structure: the shape of the reasoning tree
    - token_lineage: which tokens led to which conclusions
    - tool_state: what tools have been used and their results
    - file_state: what files have been read/written
    - process_state: what processes have been started/stopped

    Any model (Qwen, Llama, GPT, Claude) can consume this state
    and continue reasoning without replaying the full prompt history.
    """
    verified_facts: list[str] = field(default_factory=list)
    open_questions: list[str] = field(default_factory=list)
    reasoning_tree: dict[str, Any] = field(default_factory=dict)
    token_lineage: list[dict[str, Any]] = field(default_factory=list)
    tool_results: dict[str, Any] = field(default_factory=dict)
    file_hashes: dict[str, str] = field(default_factory=dict)
    process_states: dict[str, str] = field(default_factory=dict)
    objectives_completed: list[str] = field(default_factory=list)
    objectives_remaining: list[str] = field(default_factory=list)

    def hash(self) -> str:
        return hashlib.sha256(
            json.dumps(asdict(self), sort_keys=True, default=str).encode()
        ).hexdigest()

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class InferenceRollup:
    """A checkpoint of reasoning that can be continued anywhere.

    Like a Git commit for inference:
    - Contains the full reasoning state at a point in time
    - Has parents (previous rollups it continues from)
    - Can be forked (multiple continuations from same point)
    - Can be merged (combine reasoning from different paths)
    - Is content-addressed (same reasoning = same rollup)

    The rollup is model-independent. It doesn't contain KV cache
    tensors. It contains the semantic state that any model can
    use to resume reasoning.
    """
    rollup_id: str
    state: ModelIndependentState
    steps: list[ReasoningStep]
    parent_rollups: list[str]       # hashes of parent rollups
    status: RollupStatus = RollupStatus.OPEN
    model_provenance: list[str] = field(default_factory=list)  # which models contributed
    created_at: float = field(default_factory=time.time)
    sealed_at: Optional[float] = None
    _hash: Optional[str] = None

    @property
    def hash(self) -> str:
        if self._hash:
            return self._hash
        payload = {
            "state": self.state.hash(),
            "steps": [s.hash() for s in self.steps],
            "parents": self.parent_rollups,
        }
        self._hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()
        return self._hash

    @property
    def short_hash(self) -> str:
        return self.hash[:12]

    def add_step(self, step: ReasoningStep) -> None:
        """Add a reasoning step to the rollup."""
        self.steps.append(step)
        # Update state
        if step.verified:
            self.state.verified_facts.append(
                f"step:{step.step_id}:{step.action[:50]}"
            )
        self.state.token_lineage.append({
            "step": step.step_id,
            "model": step.model_used,
            "tokens": step.tokens_consumed,
        })
        self.model_provenance.append(step.model_used)
        self._hash = None  # invalidate cache

    def verify_step(self, step_id: str, proof_hash: str) -> bool:
        """Verify a reasoning step. Only verified steps are safe to continue from."""
        for step in self.steps:
            if step.step_id == step_id:
                step.verified = True
                step.verification_proof = proof_hash
                self.state.verified_facts.append(
                    f"verified:{step.action[:50]}"
                )
                self._hash = None
                return True
        return False

    def rehash(self) -> str:
        """Force hash recomputation and return new hash."""
        self._hash = None
        return self.hash

    def fork(self) -> "InferenceRollup":
        """Fork this rollup — start a new reasoning branch."""
        return InferenceRollup(
            rollup_id=hashlib.sha256(
                f"{self.hash}:{time.time()}".encode()
            ).hexdigest()[:16],
            state=ModelIndependentState(
                verified_facts=list(self.state.verified_facts),
                open_questions=list(self.state.open_questions),
                tool_results=dict(self.state.tool_results),
                file_hashes=dict(self.state.file_hashes),
                process_states=dict(self.state.process_states),
                objectives_completed=list(self.state.objectives_completed),
                objectives_remaining=list(self.state.objectives_remaining),
            ),
            steps=[],  # new branch starts with no steps
            parent_rollups=[self.hash],
            model_provenance=list(self.model_provenance),
        )

    def merge(self, other: "InferenceRollup") -> "InferenceRollup":
        """Merge two rollups — combine reasoning from different paths."""
        merged_state = ModelIndependentState(
            verified_facts=list(set(self.state.verified_facts + other.state.verified_facts)),
            open_questions=list(set(self.state.open_questions + other.state.open_questions)),
            tool_results={**self.state.tool_results, **other.state.tool_results},
            file_hashes={**self.state.file_hashes, **other.state.file_hashes},
            process_states={**self.state.process_states, **other.state.process_states},
            objectives_completed=list(set(
                self.state.objectives_completed + other.state.objectives_completed
            )),
            objectives_remaining=list(set(
                self.state.objectives_remaining + other.state.objectives_remaining
            )),
        )
        return InferenceRollup(
            rollup_id=hashlib.sha256(
                f"merge:{self.hash}:{other.hash}:{time.time()}".encode()
            ).hexdigest()[:16],
            state=merged_state,
            steps=self.steps + other.steps,
            parent_rollups=[self.hash, other.hash],
            model_provenance=list(set(self.model_provenance + other.model_provenance)),
        )

    def seal(self) -> None:
        """Seal the rollup — reasoning complete, no more steps."""
        self.status = RollupStatus.SEALED
        self.sealed_at = time.time()

    def to_prompt_context(self) -> str:
        """Convert to a prompt that any model can use to continue.

        This is the model-independent continuation format.
        Any LLM (GPT, Claude, Qwen, Llama) can read this and
        resume reasoning without seeing the original prompt.
        """
        parts = ["=== REASONING ROLLUP ==="]
        parts.append(f"ID: {self.short_hash}")
        parts.append(f"Status: {self.status.value}")
        parts.append(f"Steps: {len(self.steps)} ({sum(1 for s in self.steps if s.verified)} verified)")

        if self.state.verified_facts:
            parts.append("\nVERIFIED FACTS:")
            for f in self.state.verified_facts[-20:]:
                parts.append(f"  ✓ {f}")

        if self.state.open_questions:
            parts.append("\nOPEN QUESTIONS:")
            for q in self.state.open_questions:
                parts.append(f"  ? {q}")

        if self.state.objectives_remaining:
            parts.append("\nREMAINING OBJECTIVES:")
            for obj in self.state.objectives_remaining:
                parts.append(f"  → {obj}")

        if self.state.tool_results:
            parts.append("\nTOOL RESULTS:")
            for tool, result in list(self.state.tool_results.items())[-5:]:
                parts.append(f"  [{tool}] {str(result)[:100]}")

        if self.steps:
            parts.append(f"\nRECENT STEPS (last 5 of {len(self.steps)}):")
            for step in self.steps[-5:]:
                verified_mark = "✓" if step.verified else "?"
                parts.append(f"  {verified_mark} [{step.model_used}] {step.action[:80]}")

        parts.append("\nContinue reasoning from this state.")
        return "\n".join(parts)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["hash"] = self.hash
        d["short_hash"] = self.short_hash
        d["status"] = self.status.value
        return d


class InferenceRollupManager:
    """Manages inference rollups — create, continue, verify, merge.

    The runtime uses this to:
    1. Checkpoint reasoning at any point
    2. Continue reasoning on a different model/machine
    3. Merge reasoning from parallel paths
    4. Verify reasoning steps before committing
    5. Compress old rollups (keep only verified facts)
    """

    def __init__(self):
        self.rollups: dict[str, InferenceRollup] = {}
        self.head: Optional[str] = None  # current rollup hash

    def create(self, objective: str) -> InferenceRollup:
        """Create a new inference rollup for an objective."""
        rollup = InferenceRollup(
            rollup_id=hashlib.sha256(
                f"{objective}:{time.time()}".encode()
            ).hexdigest()[:16],
            state=ModelIndependentState(
                objectives_remaining=[objective],
            ),
            steps=[],
            parent_rollups=[],
        )
        self.rollups[rollup.hash] = rollup
        self.head = rollup.hash
        return rollup

    def checkpoint(self, rollup: InferenceRollup) -> str:
        """Save a rollup as a checkpoint."""
        self.rollups[rollup.hash] = rollup
        return rollup.hash

    def continue_from(self, rollup_hash: str,
                      model_id: str = "") -> InferenceRollup:
        """Continue reasoning from a checkpoint.

        Forks the rollup — the original is preserved,
        the continuation is a new branch.
        """
        parent = self.rollups.get(rollup_hash)
        if not parent:
            raise ValueError(f"Rollup {rollup_hash[:12]} not found")
        forked = parent.fork()
        self.rollups[forked.hash] = forked
        self.head = forked.hash
        return forked

    def merge_rollups(self, hash_a: str, hash_b: str) -> InferenceRollup:
        """Merge two reasoning paths."""
        a = self.rollups.get(hash_a)
        b = self.rollups.get(hash_b)
        if not a or not b:
            raise ValueError("One or both rollups not found")
        merged = a.merge(b)
        self.rollups[merged.hash] = merged
        self.head = merged.hash
        return merged

    def add_step(self, rollup_hash: str, step: 'ReasoningStep') -> str:
        """Add a reasoning step to a rollup and re-register it.

        Returns the new hash (hash changes when steps are added).
        """
        rollup = self.rollups.get(rollup_hash)
        if not rollup:
            raise ValueError(f"Rollup {rollup_hash[:12]} not found")
        del self.rollups[rollup_hash]
        rollup.add_step(step)
        new_hash = rollup.rehash()
        self.rollups[new_hash] = rollup
        if self.head == rollup_hash:
            self.head = new_hash
        return new_hash

    def verify_step(self, rollup_hash: str,
                    step_id: str, proof_hash: str) -> str | None:
        """Verify a reasoning step in a rollup. Returns new hash or None."""
        rollup = self.rollups.get(rollup_hash)
        if not rollup:
            return None
        del self.rollups[rollup_hash]
        ok = rollup.verify_step(step_id, proof_hash)
        if not ok:
            self.rollups[rollup_hash] = rollup
            return None
        new_hash = rollup.rehash()
        self.rollups[new_hash] = rollup
        if self.head == rollup_hash:
            self.head = new_hash
        return new_hash

    def compress(self, rollup_hash: str) -> InferenceRollup:
        """Compress a rollup — keep only verified facts, discard steps.

        Like Git GC: remove intermediate objects, keep only
        the state that matters for continuation.
        """
        rollup = self.rollups.get(rollup_hash)
        if not rollup:
            raise ValueError(f"Rollup {rollup_hash[:12]} not found")

        verified_steps = [s for s in rollup.steps if s.verified]
        compressed = InferenceRollup(
            rollup_id=hashlib.sha256(
                f"compressed:{rollup.hash}:{time.time()}".encode()
            ).hexdigest()[:16],
            state=rollup.state,
            steps=verified_steps,  # only verified steps
            parent_rollups=rollup.parent_rollups,
            status=RollupStatus.VERIFIED if verified_steps else RollupStatus.OPEN,
            model_provenance=list(set(rollup.model_provenance)),
        )
        self.rollups[compressed.hash] = compressed
        return compressed

    def get(self, rollup_hash: str) -> Optional[InferenceRollup]:
        return self.rollups.get(rollup_hash)

    def get_head(self) -> Optional[InferenceRollup]:
        if self.head:
            return self.rollups.get(self.head)
        return None

    def stats(self) -> dict:
        return {
            "total_rollups": len(self.rollups),
            "verified": sum(1 for r in self.rollups.values()
                          if r.status == RollupStatus.VERIFIED),
            "sealed": sum(1 for r in self.rollups.values()
                         if r.status == RollupStatus.SEALED),
            "open": sum(1 for r in self.rollups.values()
                       if r.status == RollupStatus.OPEN),
            "total_steps": sum(len(r.steps) for r in self.rollups.values()),
            "verified_steps": sum(
                sum(1 for s in r.steps if s.verified)
                for r in self.rollups.values()
            ),
            "models_used": list(set(
                m for r in self.rollups.values()
                for m in r.model_provenance
            )),
        }
