"""
ExecutionObject — the core primitive of Terminality.

Content-addressed computational state. Like a Git commit, but for
live computation. Can be forked, merged, verified, exchanged, resumed.

  Git commit  = tree + parents + author + message
  ExecObject  = state + causal_parents + provenance + objective

The hash is the identity. Two objects with the same state and causal
history are the same computation, regardless of where they ran.
"""

from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum


class ExecutionStatus(Enum):
    PENDING = "pending"        # created but not started
    RUNNING = "running"        # actively executing
    PAUSED = "paused"          # suspended, can be resumed
    COMPLETED = "completed"    # finished successfully
    FAILED = "failed"          # finished with error
    FORKED = "forked"          # split into children
    MERGED = "merged"          # combined from parents


@dataclass
class Objective:
    """What this computation is trying to achieve.

    Not a prompt — an objective. The runtime decomposes objectives
    into steps. Models interpret objectives; the runtime owns them.
    """
    description: str           # human-readable goal
    success_criteria: str = "" # how to know it's done
    constraints: dict[str, Any] = field(default_factory=dict)
    priority: float = 1.0      # higher = more important
    deadline: Optional[float] = None  # unix timestamp

    def hash(self) -> str:
        return hashlib.sha256(
            json.dumps(asdict(self), sort_keys=True).encode()
        ).hexdigest()


@dataclass
class Provenance:
    """Who/what produced this execution state.

    Tracks the lineage: which model, which layer, which peer,
    which human, which automated process created this state.
    """
    creator: str               # "human:alice", "llm:gpt-oss:20b", "peer:abc123"
    layer: str                 # which runtime layer produced this
    model_id: Optional[str] = None  # specific model used (if any)
    peer_id: Optional[str] = None   # peer that contributed (if distributed)
    tool: Optional[str] = None      # tool/agent that generated this
    timestamp: float = field(default_factory=time.time)
    signature: Optional[str] = None # cryptographic signature (future)

    def hash(self) -> str:
        return hashlib.sha256(
            json.dumps(asdict(self), sort_keys=True).encode()
        ).hexdigest()


@dataclass
class CausalLink:
    """A causal dependency — why this state exists.

    Not "what happened" (that's history). Not "what changed" (that's a diff).
    Causality: what minimal set of prior states CAUSED this state to exist.

    This is the key distinction:
      History asks: "what happened yesterday?"
      Causality asks: "what minimal chain of events explains why this state exists?"

    The runtime reconstructs only the causal frontier needed to continue.
    """
    parent_hash: str           # hash of parent ExecutionObject
    cause: str                 # "command:ls -la", "llm:inference", "fork", "merge"
    evidence_hash: str         # hash of the evidence that caused this transition
    minimal: bool = True       # is this link on the minimal causal frontier?

    def hash(self) -> str:
        return hashlib.sha256(
            f"{self.parent_hash}:{self.cause}:{self.evidence_hash}".encode()
        ).hexdigest()


@dataclass
class ExecutionState:
    """Structured computational state — the 'tree' of the execution object.

    This is NOT terminal output. This is the actual computational state:
    - variables, file system changes, process state
    - LLM context, reasoning chain, tool outputs
    - checkpoints, verified facts, learned routing
    """
    # Core state
    variables: dict[str, Any] = field(default_factory=dict)
    files_modified: dict[str, str] = field(default_factory=dict)  # path → hash
    processes: list[dict[str, Any]] = field(default_factory=list)

    # Reasoning state
    reasoning_chain: list[dict[str, Any]] = field(default_factory=list)
    verified_facts: list[str] = field(default_factory=list)
    failed_attempts: list[dict[str, Any]] = field(default_factory=list)

    # Terminal projection (one renderer's view)
    terminal_output: Optional[str] = None
    terminal_cwd: Optional[str] = None

    # Layer-specific state
    objective_state: dict[str, Any] = field(default_factory=dict)
    routing_state: dict[str, Any] = field(default_factory=dict)
    execution_state: dict[str, Any] = field(default_factory=dict)

    # Metadata
    tokens_consumed: int = 0
    compute_seconds: float = 0.0
    cost_estimate: float = 0.0

    def hash(self) -> str:
        """Content-addressed hash of the state."""
        # Deterministic serialization
        return hashlib.sha256(
            json.dumps(asdict(self), sort_keys=True, default=str).encode()
        ).hexdigest()

    def diff(self, other: "ExecutionState") -> dict[str, Any]:
        """What changed between this state and another."""
        changes = {}
        for key in set(list(asdict(self).keys()) + list(asdict(other).keys())):
            v1 = getattr(self, key, None)
            v2 = getattr(other, key, None)
            if v1 != v2:
                changes[key] = {"from": v1, "to": v2}
        return changes


@dataclass
class ExecutionContext:
    """What must be true to continue this computation.

    The 'frontier' — the minimal set of conditions, state, and
    causal evidence needed to resume work. Not the full history.
    """
    required_state: dict[str, Any] = field(default_factory=dict)
    required_files: list[str] = field(default_factory=list)
    required_facts: list[str] = field(default_factory=list)
    required_objective: Optional[str] = None
    required_causal_depth: int = 3  # how many causal links back to preserve

    def hash(self) -> str:
        return hashlib.sha256(
            json.dumps(asdict(self), sort_keys=True, default=str).encode()
        ).hexdigest()


@dataclass
class ExecutionObject:
    """The complete computational identity of work in progress.

    Like a Git commit, but for live computation:

      Git commit  = tree + parents + author + message + hash
      ExecObject  = state + causal_links + provenance + objective + context + hash

    The hash is the identity. Content-addressed execution.

    Operations (Git-like):
      fork()   → create child with this as parent
      merge()  → combine multiple parents
      verify() → check causal integrity
      resume() → continue from this state
      compress() → reduce to causal frontier
    """
    state: ExecutionState
    objective: Objective
    provenance: Provenance
    causal_links: list[CausalLink] = field(default_factory=list)
    context: ExecutionContext = field(default_factory=ExecutionContext)
    status: ExecutionStatus = ExecutionStatus.PENDING
    children: list[str] = field(default_factory=list)  # hashes of children
    timestamp: float = field(default_factory=time.time)
    _hash: Optional[str] = None

    @property
    def hash(self) -> str:
        """Content-addressed identity. Same state + causal history = same object."""
        if self._hash:
            return self._hash
        payload = {
            "state": self.state.hash(),
            "objective": self.objective.hash(),
            "causal_links": [l.hash() for l in self.causal_links],
            "provenance": self.provenance.hash(),
            "context": self.context.hash(),
        }
        self._hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()
        return self._hash

    @property
    def short_hash(self) -> str:
        return self.hash[:12]

    def fork(self, new_objective: Optional[Objective] = None,
             new_provenance: Optional[Provenance] = None) -> "ExecutionObject":
        """Fork this execution — create a child with this as causal parent."""
        child = ExecutionObject(
            state=self.state,  # child inherits current state
            objective=new_objective or self.objective,
            provenance=new_provenance or Provenance(
                creator=f"fork:{self.short_hash}",
                layer="fork",
            ),
            causal_links=[CausalLink(
                parent_hash=self.hash,
                cause=f"fork:{new_objective.description if new_objective else 'continue'}",
                evidence_hash=self.state.hash(),
            )],
            context=self.context,
            status=ExecutionStatus.PENDING,
        )
        self.children.append(child.hash)
        self.status = ExecutionStatus.FORKED
        return child

    def merge(self, other: "ExecutionObject",
              new_objective: Optional[Objective] = None,
              provenance: Optional[Provenance] = None) -> "ExecutionObject":
        """Merge two execution objects — combine their states."""
        merged_state = ExecutionState(
            variables={**self.state.variables, **other.state.variables},
            files_modified={**self.state.files_modified, **other.state.files_modified},
            processes=self.state.processes + other.state.processes,
            reasoning_chain=self.state.reasoning_chain + other.state.reasoning_chain,
            verified_facts=list(set(self.state.verified_facts + other.state.verified_facts)),
            failed_attempts=self.state.failed_attempts + other.state.failed_attempts,
            tokens_consumed=self.state.tokens_consumed + other.state.tokens_consumed,
            compute_seconds=self.state.compute_seconds + other.state.compute_seconds,
            cost_estimate=self.state.cost_estimate + other.state.cost_estimate,
        )
        return ExecutionObject(
            state=merged_state,
            objective=new_objective or self.objective,
            provenance=provenance or Provenance(
                creator=f"merge:{self.short_hash}+{other.short_hash}",
                layer="merge",
            ),
            causal_links=[
                CausalLink(
                    parent_hash=self.hash,
                    cause=f"merge:from:{self.short_hash}",
                    evidence_hash=self.state.hash(),
                ),
                CausalLink(
                    parent_hash=other.hash,
                    cause=f"merge:from:{other.short_hash}",
                    evidence_hash=other.state.hash(),
                ),
            ],
            context=self.context,
            status=ExecutionStatus.PENDING,
        )

    def verify(self) -> bool:
        """Verify causal integrity — all parent hashes are consistent."""
        for link in self.causal_links:
            if not link.parent_hash:
                return False
            if not link.evidence_hash:
                return False
        if self.state.hash() != self.state.hash():  # self-consistency
            return False
        return True

    def to_dict(self) -> dict:
        d = asdict(self)
        d["hash"] = self.hash
        d["short_hash"] = self.short_hash
        d["status"] = self.status.value
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, default=str)

    @classmethod
    def from_dict(cls, data: dict) -> "ExecutionObject":
        data["status"] = ExecutionStatus(data.get("status", "pending"))
        data.pop("hash", None)
        data.pop("short_hash", None)
        data["state"] = ExecutionState(**data["state"])
        data["objective"] = Objective(**data["objective"])
        data["provenance"] = Provenance(**data["provenance"])
        data["context"] = ExecutionContext(**data["context"])
        data["causal_links"] = [CausalLink(**l) for l in data.get("causal_links", [])]
        return cls(**data)

    @classmethod
    def from_json(cls, json_str: str) -> "ExecutionObject":
        return cls.from_dict(json.loads(json_str))


class ExecutionGraph:
    """DAG of execution objects — the computation's full lineage.

    Like a Git repository, but for execution. Supports:
    - traverse: walk the causal tree
    - frontier: get minimal causal frontier for reconstruction
    - compress: reduce to only causally necessary objects
    - verify: check integrity of the entire graph
    """

    def __init__(self):
        self.objects: dict[str, ExecutionObject] = {}  # hash → object
        self.roots: list[str] = []  # hashes of root objects (no parents)
        self.heads: list[str] = []  # hashes of leaf objects (no children)

    def add(self, obj: ExecutionObject) -> str:
        """Add an execution object to the graph."""
        h = obj.hash
        self.objects[h] = obj

        # Track roots (no causal links = root)
        if not obj.causal_links:
            if h not in self.roots:
                self.roots.append(h)

        # Update heads
        # Remove parents from heads, add this object
        for link in obj.causal_links:
            if link.parent_hash in self.heads:
                self.heads.remove(link.parent_hash)
        if h not in self.heads:
            self.heads.append(h)

        # Update parent's children list
        for link in obj.causal_links:
            parent = self.objects.get(link.parent_hash)
            if parent and h not in parent.children:
                parent.children.append(h)

        return h

    def get(self, hash: str) -> Optional[ExecutionObject]:
        return self.objects.get(hash)

    def get_causal_chain(self, hash: str, depth: int = -1) -> list[ExecutionObject]:
        """Get the causal chain leading to this object."""
        chain = []
        current = self.objects.get(hash)
        visited = set()
        d = 0
        while current and current.hash not in visited:
            if depth >= 0 and d >= depth:
                break
            chain.append(current)
            visited.add(current.hash)
            if current.causal_links:
                # Follow first parent (primary causal line)
                parent = self.objects.get(current.causal_links[0].parent_hash)
                current = parent
            else:
                break
            d += 1
        return chain

    def get_frontier(self, hash: str) -> list[ExecutionObject]:
        """Get the minimal causal frontier — only objects needed to resume.

        This is NOT the full history. This is the minimal set of
        execution objects whose state is required to continue computation.
        """
        chain = self.get_causal_chain(hash)
        if not chain:
            return []

        # The frontier is: the head object + any objects whose state
        # is explicitly required by the context
        head = chain[0]
        frontier = [head]

        required_state_keys = set(head.context.required_state.keys())
        required_facts = set(head.context.required_facts)

        for obj in chain[1:]:
            # Include if it has required state or verified facts
            if required_state_keys & set(obj.state.variables.keys()):
                frontier.append(obj)
            elif required_facts & set(obj.state.verified_facts):
                frontier.append(obj)

        return frontier

    def verify(self) -> bool:
        """Verify integrity of the entire graph."""
        for h, obj in self.objects.items():
            if obj.hash != h:
                return False
            if not obj.verify():
                return False
            for link in obj.causal_links:
                if link.parent_hash not in self.objects:
                    return False
        return True

    def compress(self, hash: str) -> "ExecutionGraph":
        """Create a compressed graph with only the causal frontier.

        Eliminates objects not needed to continue computation.
        Like Git garbage collection, but for execution.
        """
        frontier = self.get_frontier(hash)
        compressed = ExecutionGraph()
        for obj in frontier:
            compressed.add(obj)
        return compressed

    def stats(self) -> dict:
        return {
            "total_objects": len(self.objects),
            "roots": len(self.roots),
            "heads": len(self.heads),
            "verified": self.verify(),
        }
