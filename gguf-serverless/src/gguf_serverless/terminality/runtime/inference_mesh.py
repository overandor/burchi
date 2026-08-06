"""
Inference Mesh — peers are reasoning engines, not machines.

  BitTorrent:  peers are computers, they exchange files
  Terminality: peers are LLMs, they exchange unfinished inference

A peer can be:
  - a local GGUF model
  - GPT, Claude, Gemini, Qwen, DeepSeek
  - a browser model, a phone model
  - a serverless function, a GPU server

The hardware is an implementation detail.
The LLM identity is the network participant.

Instead of "which machine has this file?"
the runtime asks "which reasoning peer owns the continuation?"

The network exchanges:
  - verified conclusions (not bytes)
  - evidence frontiers (not chunks)
  - dependency graphs (not file lists)
  - partial plans (not torrents)
  - execution receipts (not block hashes)

Seeding means:
  - Claude analyzed 8M lines → seeds that analysis
  - GPT continues from Claude's verified state
  - No model starts over — expensive work is reused
"""

from __future__ import annotations
import hashlib
import json
import time
import urllib.request
from dataclasses import dataclass, field, asdict
from typing import Optional, Any, Callable
from enum import Enum

from .inference_rollups import (
    InferenceRollup, ReasoningStep, ModelIndependentState,
    RollupStatus, InferenceRollupManager,
)
from .execution_graph_v2 import GraphNode, NodeKind, ExecutionGraphV2
from .capability_graph import CapabilityGraph, CapabilityLevel


class PeerStatus(Enum):
    ONLINE = "online"          # actively accepting continuations
    BUSY = "busy"              # working on a continuation
    OFFLINE = "offline"        # not available
    SEEDING = "seeding"        # only serving cached state, not accepting new work


@dataclass
class InferenceCapabilities:
    """What a reasoning peer can do.

    Not CPU/RAM/GPU — model family, context capacity, tools, cached artifacts.
    The hardware is an implementation detail.
    """
    model_family: str = ""              # "gpt", "claude", "qwen", "gguf", "gemini"
    model_id: str = ""                  # "gpt-4o", "claude-3.5-sonnet", "qwen2:0.5b"
    context_window: int = 0             # max tokens this peer can process
    available_context: int = 0          # currently free context space
    supported_tools: list[str] = field(default_factory=list)  # ["code", "search", "shell"]
    cached_artifacts: list[str] = field(default_factory=list)  # rollup hashes this peer has
    cached_repositories: list[str] = field(default_factory=list)  # repo hashes already analyzed
    active_branches: list[str] = field(default_factory=list)  # rollup hashes being worked on
    verification_score: float = 1.0     # historical accuracy (0.0-1.0)
    estimated_cost_per_1k_tokens: float = 0.0  # pricing
    avg_latency_ms: float = 0.0
    max_concurrent_tasks: int = 1
    current_tasks: int = 0
    endpoint_url: str = ""              # OpenAI-compatible endpoint
    api_key_env: str = ""               # env var name for API key (never store key)

    def can_continue(self, rollup: InferenceRollup) -> bool:
        """Can this peer continue a given rollup?"""
        # Must have enough context
        prompt_size = len(rollup.to_prompt_context())
        estimated_tokens = prompt_size // 4 + 500  # rough estimate + response
        if estimated_tokens > self.available_context:
            return False
        # Must not be at capacity
        if self.current_tasks >= self.max_concurrent_tasks:
            return False
        return True

    def continuation_score(self, rollup: InferenceRollup) -> float:
        """Score how well this peer can continue a rollup (higher = better)."""
        if not self.can_continue(rollup):
            return 0.0

        score = 0.0

        # Already has this rollup cached (no transfer needed)
        if rollup.hash in self.cached_artifacts:
            score += 100  # massive bonus

        # Has related repositories analyzed
        if self.cached_repositories:
            score += 20

        # Verification score (reliable peers preferred)
        score += self.verification_score * 30

        # Context availability (more spare = better)
        if self.context_window > 0:
            score += (self.available_context / self.context_window) * 15

        # Cost penalty
        if self.estimated_cost_per_1k_tokens > 0:
            score /= (1 + self.estimated_cost_per_1k_tokens * 0.01)

        # Latency penalty
        score /= (1 + self.avg_latency_ms / 1000)

        # Already working on this branch (warm cache)
        if rollup.hash in self.active_branches:
            score += 50

        return score

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SeededReasoning:
    """What a peer seeds — verified reasoning, not files.

    Instead of seeding a torrent (file chunks), an LLM peer seeds:
    - solved compiler passes
    - analyzed repositories
    - parsed documentation
    - dependency graphs
    - vector indexes
    - execution traces
    - verification receipts
    - partial plans

    The expensive work is reused rather than recomputed.
    """
    peer_id: str
    rollup_hash: str               # the inference rollup being seeded
    objective: str                 # what this reasoning achieves
    verified_conclusions: list[str] = field(default_factory=list)
    evidence_frontier: dict[str, Any] = field(default_factory=dict)
    dependency_graph_hash: str = ""
    unresolved_branches: list[str] = field(default_factory=list)
    confidence: float = 0.0        # 0.0-1.0, how confident is this reasoning
    execution_receipts: list[str] = field(default_factory=list)  # proof hashes
    tokens_invested: int = 0       # how much compute was spent
    seed_count: int = 0            # how many peers have downloaded this
    created_at: float = field(default_factory=time.time)

    def hash(self) -> str:
        return hashlib.sha256(
            json.dumps({
                "peer": self.peer_id,
                "rollup": self.rollup_hash,
                "objective": self.objective,
                "conclusions": self.verified_conclusions,
            }, sort_keys=True, default=str).encode()
        ).hexdigest()

    def to_dict(self) -> dict:
        return asdict(self)


class InferencePeer:
    """A reasoning engine as a network participant.

    Not a socket. Not a machine. An active inference state.

    The peer:
    1. Advertises what it can reason about (capabilities)
    2. Seeds verified reasoning it has already done
    3. Accepts continuation requests from other peers
    4. Downloads continuation state from other peers
    5. Verifies reasoning it receives before committing

    The peer IS the LLM. The hardware is an implementation detail.
    """

    def __init__(
        self,
        peer_id: str,
        capabilities: InferenceCapabilities,
        rollup_manager: Optional[InferenceRollupManager] = None,
    ):
        self.peer_id = peer_id
        self.capabilities = capabilities
        self.rollups = rollup_manager or InferenceRollupManager()
        self.seeds: dict[str, SeededReasoning] = {}  # rollup_hash → seed
        self.status: PeerStatus = PeerStatus.ONLINE
        self.contribution_history: list[dict] = []
        self._verify_fn: Optional[Callable] = None

    def advertise(self) -> dict:
        """Advertise this peer's capabilities to the mesh.

        Like a BitTorrent announce, but for reasoning:
        "I am claude-3.5-sonnet, I have these verified conclusions,
        I can continue these branches, here's my confidence score."
        """
        return {
            "peer_id": self.peer_id,
            "status": self.status.value,
            "capabilities": self.capabilities.to_dict(),
            "seeds": [s.to_dict() for s in self.seeds.values()],
            "active_branches": self.capabilities.active_branches,
            "verification_score": self.capabilities.verification_score,
            "available": self.status == PeerStatus.ONLINE,
        }

    def seed_reasoning(self, rollup: InferenceRollup,
                       confidence: float = 0.8) -> SeededReasoning:
        """Seed verified reasoning to the mesh.

        Instead of seeding file chunks, seed the inference rollup.
        Other peers can download this state and continue from it
        without re-doing the expensive reasoning.
        """
        verified_conclusions = [
            f for f in rollup.state.verified_facts
        ]
        seed = SeededReasoning(
            peer_id=self.peer_id,
            rollup_hash=rollup.hash,
            objective=rollup.state.objectives_remaining[0]
                if rollup.state.objectives_remaining else "completed",
            verified_conclusions=verified_conclusions,
            evidence_frontier={
                "open_questions": rollup.state.open_questions,
                "tool_results": list(rollup.state.tool_results.keys()),
            },
            confidence=confidence,
            tokens_invested=sum(s.tokens_consumed for s in rollup.steps),
            execution_receipts=[s.verification_proof for s in rollup.steps
                               if s.verification_proof],
        )
        self.seeds[rollup.hash] = seed
        if rollup.hash not in self.capabilities.cached_artifacts:
            self.capabilities.cached_artifacts.append(rollup.hash)
        return seed

    def download_continuation(self, seed: SeededReasoning,
                              rollup: InferenceRollup) -> InferenceRollup:
        """Download continuation state from another peer.

        Instead of downloading file chunks, download the inference rollup.
        This peer now has the verified reasoning state and can continue
        from where the other peer left off.
        """
        # Store the rollup
        self.rollups.rollups[rollup.hash] = rollup
        if rollup.hash not in self.capabilities.cached_artifacts:
            self.capabilities.cached_artifacts.append(rollup.hash)

        # Update seed count on the original seed
        seed.seed_count += 1

        return rollup

    async def continue_reasoning(self, rollup_hash: str,
                                 prompt: str = "") -> dict:
        """Continue reasoning on a rollup.

        This is where the peer actually does inference.
        Uses its own model to extend the reasoning chain.
        """
        rollup = self.rollups.get(rollup_hash)
        if not rollup:
            return {"ok": False, "error": "Rollup not found"}

        self.status = PeerStatus.BUSY
        self.capabilities.current_tasks += 1
        if rollup_hash not in self.capabilities.active_branches:
            self.capabilities.active_branches.append(rollup_hash)

        try:
            # Build continuation prompt from rollup state
            context = rollup.to_prompt_context()
            full_prompt = f"{context}\n\n{prompt}" if prompt else context

            # Call the model
            response = await self._infer(full_prompt)

            # Parse response into a reasoning step
            step = ReasoningStep(
                step_id=f"step_{self.peer_id}_{int(time.time())}",
                action=prompt or "continue reasoning",
                input_state={"context_hash": rollup.state.hash()},
                output_state={"response": response.get("response", "")[:500]},
                evidence=hashlib.sha256(
                    response.get("response", "").encode()
                ).hexdigest(),
                model_used=self.capabilities.model_id,
                tokens_consumed=response.get("usage", {}).get("total_tokens", 0),
            )

            new_hash = self.rollups.add_step(rollup_hash, step)
            new_rollup = self.rollups.get(new_hash)

            return {
                "ok": True,
                "new_hash": new_hash,
                "response": response.get("response", ""),
                "model": self.capabilities.model_id,
                "tokens": step.tokens_consumed,
                "rollup": new_rollup.to_dict() if new_rollup else None,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}
        finally:
            self.status = PeerStatus.ONLINE
            self.capabilities.current_tasks -= 1

    async def _infer(self, prompt: str) -> dict:
        """Call the model's inference endpoint."""
        if not self.capabilities.endpoint_url:
            # Default to free endpoint
            endpoint = "https://api.llm7.io/v1/chat/completions"
        else:
            endpoint = self.capabilities.endpoint_url

        api_key = os.environ.get(self.capabilities.api_key_env, "") if self.capabilities.api_key_env else ""

        body = json.dumps({
            "model": self.capabilities.model_id or "gpt-oss:20b",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": min(512, self.capabilities.available_context or 512),
            "temperature": 0.3,
        }).encode()

        headers = {"Content-Type": "application/json", "User-Agent": "terminality-mesh/0.1"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        req = urllib.request.Request(endpoint, data=body, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())

        return {
            "response": data.get("choices", [{}])[0].get("message", {}).get("content", ""),
            "usage": data.get("usage", {}),
        }

    def verify_reasoning(self, rollup_hash: str,
                         step_id: str) -> Optional[str]:
        """Verify a reasoning step from another peer.

        Before committing another peer's reasoning, verify it.
        This is the trust mechanism: peers check each other's work.
        """
        rollup = self.rollups.get(rollup_hash)
        if not rollup:
            return None

        # Simple verification: check the step exists and has evidence
        for step in rollup.steps:
            if step.step_id == step_id:
                if step.evidence:
                    proof = hashlib.sha256(
                        f"verified:{step.step_id}:{step.evidence}".encode()
                    ).hexdigest()
                    new_hash = self.rollups.verify_step(rollup_hash, step_id, proof)
                    return new_hash
        return None

    def stats(self) -> dict:
        return {
            "peer_id": self.peer_id,
            "status": self.status.value,
            "model": self.capabilities.model_id,
            "seeds": len(self.seeds),
            "cached_artifacts": len(self.capabilities.cached_artifacts),
            "active_branches": len(self.capabilities.active_branches),
            "verification_score": self.capabilities.verification_score,
            "current_tasks": self.capabilities.current_tasks,
            "contributions": len(self.contribution_history),
        }


class InferenceMesh:
    """The network of reasoning peers.

    Not a network of computers. A network of inference engines.

    Peers:
    - Advertise capabilities (model family, context, tools, cached state)
    - Seed verified reasoning (not files)
    - Exchange continuation state (not bytes)
    - Verify each other's reasoning (trust mechanism)
    - Route continuation to the best reasoning peer

    The mesh is a distributed inference mesh, not a distributed computer cluster.
    The primary replicated object is a verified, resumable unit of computation.
    """

    def __init__(self, capability_graph: Optional[CapabilityGraph] = None):
        self.peers: dict[str, InferencePeer] = {}  # peer_id → peer
        self.capabilities = capability_graph or CapabilityGraph()
        self.routing_history: list[dict] = []

    def register_peer(self, peer: InferencePeer):
        """Register a reasoning peer in the mesh."""
        self.peers[peer.peer_id] = peer

    def unregister_peer(self, peer_id: str):
        self.peers.pop(peer_id, None)

    def get_peer(self, peer_id: str) -> Optional[InferencePeer]:
        return self.peers.get(peer_id)

    def list_peers(self) -> list[dict]:
        """List all peers and their advertisement."""
        return [p.advertise() for p in self.peers.values()]

    def find_seeds(self, objective: Optional[str] = None,
                   min_confidence: float = 0.0) -> list[SeededReasoning]:
        """Find seeded reasoning in the mesh.

        Instead of searching for torrents by name,
        search for verified reasoning by objective.
        """
        results = []
        for peer in self.peers.values():
            for seed in peer.seeds.values():
                if seed.confidence < min_confidence:
                    continue
                if objective and objective.lower() not in seed.objective.lower():
                    continue
                results.append(seed)
        return results

    def route_continuation(self, rollup_hash: str,
                           rollup: InferenceRollup,
                           exclude: Optional[list[str]] = None) -> Optional[InferencePeer]:
        """Route a continuation request to the best reasoning peer.

        The scheduler is an inference router, not a network router.
        It decides which reasoning peer should extend which branch
        based on:
        - cached artifacts (does the peer already have this state?)
        - model capability (can this model handle this reasoning?)
        - verification score (is this peer reliable?)
        - cost (what's the cheapest peer that can do it?)
        - active branches (is this peer already working on this?)
        """
        exclude = exclude or []
        candidates = []

        for peer_id, peer in self.peers.items():
            if peer_id in exclude:
                continue
            if peer.status not in (PeerStatus.ONLINE, PeerStatus.SEEDING):
                continue

            # Check capabilities
            if not peer.capabilities.can_continue(rollup):
                continue

            # Score the peer
            score = peer.capabilities.continuation_score(rollup)
            if score > 0:
                candidates.append((score, peer))

        if not candidates:
            return None

        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0][1]

        self.routing_history.append({
            "rollup_hash": rollup_hash,
            "routed_to": best.peer_id,
            "model": best.capabilities.model_id,
            "score": candidates[0][0],
            "candidates": len(candidates),
            "timestamp": time.time(),
        })

        return best

    async def continue_on_best_peer(
        self,
        rollup_hash: str,
        prompt: str = "",
    ) -> dict:
        """Find the best peer and continue reasoning on it.

        This is the core operation:
        1. Find the rollup
        2. Route to the best reasoning peer
        3. The peer continues the reasoning
        4. The result is available to the entire mesh
        """
        # Find the rollup across all peers
        rollup = None
        owning_peer = None
        for peer in self.peers.values():
            r = peer.rollups.get(rollup_hash)
            if r:
                rollup = r
                owning_peer = peer
                break

        if not rollup:
            return {"ok": False, "error": "Rollup not found in mesh"}

        # Route to best peer
        best = self.route_continuation(rollup_hash, rollup)
        if not best:
            return {"ok": False, "error": "No peer can continue this reasoning"}

        # If best peer is not the owning peer, transfer state
        if best.peer_id != owning_peer.peer_id:
            # Download continuation state to the best peer
            best.download_continuation(
                owning_peer.seeds.get(rollup_hash, SeededReasoning(
                    peer_id=owning_peer.peer_id,
                    rollup_hash=rollup_hash,
                    objective="transfer",
                )),
                rollup,
            )

        # Continue reasoning
        result = await best.continue_reasoning(rollup_hash, prompt)

        if result.get("ok"):
            # Seed the new state
            new_rollup = best.rollups.get(result["new_hash"])
            if new_rollup:
                best.seed_reasoning(new_rollup, confidence=0.7)

            # Record contribution
            best.contribution_history.append({
                "rollup": rollup_hash,
                "new_hash": result["new_hash"],
                "model": best.capabilities.model_id,
                "tokens": result.get("tokens", 0),
                "timestamp": time.time(),
            })

        return {
            **result,
            "routed_to": best.peer_id,
            "model": best.capabilities.model_id,
        }

    def cross_model_transfer(
        self,
        from_peer_id: str,
        to_peer_id: str,
        rollup_hash: str,
    ) -> dict:
        """Transfer reasoning state between different models.

        Claude analyzed 8M lines → GPT continues from Claude's state.
        The transfer is model-independent: structured execution state,
        not raw KV cache tensors.

        The receiving model gets:
        - verified conclusions
        - evidence frontier
        - dependency graph
        - unresolved branches
        - execution receipts

        It reconstructs its own internal state from this structured input.
        """
        from_peer = self.peers.get(from_peer_id)
        to_peer = self.peers.get(to_peer_id)
        if not from_peer or not to_peer:
            return {"ok": False, "error": "Peer not found"}

        rollup = from_peer.rollups.get(rollup_hash)
        if not rollup:
            return {"ok": False, "error": "Rollup not found on source peer"}

        # Generate model-independent continuation context
        context = rollup.to_prompt_context()

        # Transfer to receiving peer
        to_peer.download_continuation(
            from_peer.seeds.get(rollup_hash, SeededReasoning(
                peer_id=from_peer_id,
                rollup_hash=rollup_hash,
                objective="cross_model_transfer",
            )),
            rollup,
        )

        return {
            "ok": True,
            "from_peer": from_peer_id,
            "from_model": from_peer.capabilities.model_id,
            "to_peer": to_peer_id,
            "to_model": to_peer.capabilities.model_id,
            "rollup_hash": rollup_hash,
            "context_transferred": len(context),
            "verified_facts": len(rollup.state.verified_facts),
            "steps": len(rollup.steps),
        }

    def stats(self) -> dict:
        return {
            "total_peers": len(self.peers),
            "online": sum(1 for p in self.peers.values()
                         if p.status == PeerStatus.ONLINE),
            "busy": sum(1 for p in self.peers.values()
                       if p.status == PeerStatus.BUSY),
            "seeding": sum(1 for p in self.peers.values()
                          if p.status == PeerStatus.SEEDING),
            "total_seeds": sum(len(p.seeds) for p in self.peers.values()),
            "total_artifacts": sum(
                len(p.capabilities.cached_artifacts)
                for p in self.peers.values()
            ),
            "model_families": list(set(
                p.capabilities.model_family for p in self.peers.values()
                if p.capabilities.model_family
            )),
            "models": list(set(
                p.capabilities.model_id for p in self.peers.values()
                if p.capabilities.model_id
            )),
            "routing_decisions": len(self.routing_history),
        }
