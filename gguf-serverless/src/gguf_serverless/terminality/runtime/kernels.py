"""
Kernel Architecture — seven kernels that form the runtime.

  Terminal Kernel     — PTYs, shells, signals, pipes, process trees
  Inference Kernel    — model invocation, provider routing, context assembly
  Memory Kernel       — semantic, temporal, execution, artifact retrieval
  Storage Kernel      — content addressing, Merkle DAGs, dedup, replication
  Rollup Kernel       — compact representations of inference/execution/state
  Verification Kernel — integrity, permissions, replay consistency, receipts
  Evolution Kernel    — model selection, branch selection, peer selection

The LLM never owns execution. The kernels do.
The kernels ask the models what to do. The kernels decide what happens.
"""

from __future__ import annotations
import hashlib
import json
import time
import os
import subprocess
from dataclasses import dataclass, field, asdict
from typing import Optional, Any, Callable
from enum import Enum

from .universal_frame import (
    UniversalInferenceFrame, FrameGraph, FrameType, Provider,
    ToolCall, EnvironmentSnapshot, VerificationReceipt,
)
from .terminal_state import TerminalState, TerminalStateGraph, capture_current_state
from .ledgers import LedgerSystem, LedgerType, LedgerEntry
from .inference_rollups import InferenceRollup, ReasoningStep, InferenceRollupManager
from .capability_graph import CapabilityGraph, CapabilityLevel
from .execution_graph_v2 import ExecutionGraphV2, GraphNode, NodeKind
from .inference_mesh import InferenceMesh, InferencePeer, InferenceCapabilities, PeerStatus


class KernelStatus(Enum):
    INITIALIZING = "initializing"
    READY = "ready"
    BUSY = "busy"
    ERROR = "error"


@dataclass
class KernelResult:
    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    error: str = ""
    elapsed_ms: float = 0.0


class TerminalKernel:
    """Owns PTYs, shells, signals, pipes, process trees, terminal sessions."""

    def __init__(self):
        self.status = KernelStatus.INITIALIZING
        self.state_graph = TerminalStateGraph()
        self.current_state: Optional[TerminalState] = None
        self.status = KernelStatus.READY

    def capture(self, working_dir: str = ".") -> TerminalState:
        """Capture the current terminal state from the real environment."""
        state = capture_current_state(working_dir)
        self.state_graph.add(state)
        self.current_state = state
        return state

    def execute(self, command: str, cwd: str = ".") -> KernelResult:
        """Execute a real command and capture the state change."""
        start = time.time()
        try:
            result = subprocess.run(
                command, shell=True, capture_output=True,
                text=True, timeout=30, cwd=cwd,
            )
            elapsed = (time.time() - start) * 1000

            # Capture new state after command
            new_state = capture_current_state(cwd)
            new_state.pty_buffer = result.stdout
            if result.stderr:
                new_state.pty_buffer += f"\n[stderr]\n{result.stderr}"
            new_state.shell_history = (
                (self.current_state.shell_history if self.current_state else []) + [command]
            )

            self.state_graph.add(new_state)
            self.current_state = new_state

            return KernelResult(
                ok=result.returncode == 0,
                data={
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "exit_code": result.returncode,
                    "state_cid": new_state.short_cid,
                },
                elapsed_ms=elapsed,
            )
        except Exception as e:
            return KernelResult(ok=False, error=str(e), elapsed_ms=(time.time()-start)*1000)

    def checkpoint(self) -> str:
        """Checkpoint the current terminal state."""
        return self.state_graph.checkpoint()

    def stats(self) -> dict:
        return {
            "status": self.status.value,
            "state_graph": self.state_graph.stats(),
            "current_state": self.current_state.short_cid if self.current_state else None,
        }


class InferenceKernel:
    """Owns model invocation, provider routing, context assembly, inference frames."""

    def __init__(self, mesh: Optional[InferenceMesh] = None):
        self.status = KernelStatus.READY
        self.mesh = mesh or InferenceMesh()
        self.frame_graph = FrameGraph()
        self.rollup_mgr = InferenceRollupManager()
        self.total_tokens = 0
        self.total_cost = 0.0

    async def invoke(self, prompt: str, model_id: str = "",
                     parent_frames: Optional[list[str]] = None,
                     provider: Provider = Provider.CUSTOM) -> KernelResult:
        """Invoke a model and create a universal inference frame."""
        start = time.time()
        try:
            # Find best peer for this inference
            peers = [p for p in self.mesh.peers.values()
                    if p.status == PeerStatus.ONLINE]
            if not peers:
                return KernelResult(ok=False, error="No available peers")

            # Use the first available peer (router will improve this)
            peer = peers[0]

            # Build frame from prompt
            frame = UniversalInferenceFrame(
                frame_id=hashlib.sha256(
                    f"invoke:{prompt[:50]}:{time.time()}".encode()
                ).hexdigest()[:16],
                frame_type=FrameType.INFERENCE,
                parent_frames=parent_frames or [],
                prompt=prompt,
                model_id=model_id or peer.capabilities.model_id,
                provider=provider,
            )

            # Call the model
            response = await peer._infer(prompt)
            elapsed = (time.time() - start) * 1000

            # Create response frame
            response_frame = UniversalInferenceFrame.from_provider_response(
                response=response,
                provider=provider,
                parent_frames=[frame.cid],
                prompt=prompt,
                model_id=frame.model_id,
            )

            self.frame_graph.add(frame)
            self.frame_graph.add(response_frame)

            self.total_tokens += response_frame.tokens_consumed

            return KernelResult(
                ok=True,
                data={
                    "response": response_frame.response,
                    "frame_cid": response_frame.short_cid,
                    "model": response_frame.model_id,
                    "tokens": response_frame.tokens_consumed,
                },
                elapsed_ms=elapsed,
            )
        except Exception as e:
            return KernelResult(ok=False, error=str(e), elapsed_ms=(time.time()-start)*1000)

    def stats(self) -> dict:
        return {
            "status": self.status.value,
            "frame_graph": self.frame_graph.stats(),
            "total_tokens": self.total_tokens,
            "total_cost": self.total_cost,
            "mesh_peers": len(self.mesh.peers),
        }


class MemoryKernel:
    """Owns semantic, temporal, execution, artifact retrieval."""

    def __init__(self):
        self.status = KernelStatus.READY
        self.semantic_index: dict[str, list[str]] = {}  # keyword → [frame_cids]
        self.temporal_index: list[tuple[float, str]] = []  # (timestamp, cid)
        self.artifact_index: dict[str, str] = {}  # name → cid
        self.execution_index: dict[str, str] = {}  # command → state_cid

    def index_frame(self, frame: UniversalInferenceFrame):
        """Index a frame for retrieval."""
        # Semantic: extract keywords from prompt and response
        words = set((frame.prompt + " " + frame.response).lower().split())
        for word in words:
            if len(word) > 3:
                if word not in self.semantic_index:
                    self.semantic_index[word] = []
                self.semantic_index[word].append(frame.cid)

        # Temporal
        self.temporal_index.append((frame.created_at, frame.cid))

        # Artifacts
        for artifact in frame.artifacts:
            self.artifact_index[artifact.get("name", "")] = artifact.get("cid", "")

    def index_state(self, state: TerminalState, command: str = ""):
        """Index a terminal state for retrieval."""
        if command:
            self.execution_index[command] = state.cid
        self.temporal_index.append((state.created_at, state.cid))

    def retrieve_semantic(self, query: str, limit: int = 10) -> list[str]:
        """Retrieve frames by semantic similarity (keyword matching)."""
        words = set(query.lower().split())
        scores: dict[str, int] = {}
        for word in words:
            for cid in self.semantic_index.get(word, []):
                scores[cid] = scores.get(cid, 0) + 1
        return sorted(scores, key=lambda x: -scores[x])[:limit]

    def retrieve_temporal(self, since: float = 0, until: float = 0,
                          limit: int = 10) -> list[str]:
        """Retrieve by time range."""
        results = []
        for ts, cid in reversed(self.temporal_index):
            if since and ts < since:
                continue
            if until and ts > until:
                continue
            results.append(cid)
            if len(results) >= limit:
                break
        return results

    def retrieve_artifact(self, name: str) -> Optional[str]:
        """Retrieve an artifact by name."""
        return self.artifact_index.get(name)

    def retrieve_execution(self, command: str) -> Optional[str]:
        """Retrieve the state resulting from a command."""
        return self.execution_index.get(command)

    def stats(self) -> dict:
        return {
            "status": self.status.value,
            "semantic_entries": len(self.semantic_index),
            "temporal_entries": len(self.temporal_index),
            "artifacts": len(self.artifact_index),
            "executions": len(self.execution_index),
        }


class StorageKernel:
    """Owns content addressing, Merkle DAGs, dedup, replication."""

    def __init__(self):
        self.status = KernelStatus.READY
        self.objects: dict[str, dict[str, Any]] = {}  # cid → object
        self.sizes: dict[str, int] = {}  # cid → size in bytes
        self.refs: dict[str, list[str]] = {}  # cid → [referrer cids]
        self.total_storage = 0
        self.dedup_savings = 0

    def store(self, obj: dict[str, Any]) -> str:
        """Store an object and return its CID."""
        raw = json.dumps(obj, sort_keys=True, default=str).encode()
        cid = hashlib.sha256(raw).hexdigest()
        size = len(raw)

        if cid in self.objects:
            self.dedup_savings += size
            return cid

        self.objects[cid] = obj
        self.sizes[cid] = size
        self.total_storage += size

        # Update refs
        for key in ("parent", "parent_cid", "parent_hash", "parents"):
            if key in obj:
                parents = obj[key] if isinstance(obj[key], list) else [obj[key]]
                for p in parents:
                    if p not in self.refs:
                        self.refs[p] = []
                    self.refs[p].append(cid)

        return cid

    def get(self, cid: str) -> Optional[dict[str, Any]]:
        return self.objects.get(cid)

    def exists(self, cid: str) -> bool:
        return cid in self.objects

    def get_refs(self, cid: str) -> list[str]:
        """Get all objects that reference this one."""
        return self.refs.get(cid, [])

    def gc(self) -> int:
        """Remove unreferenced objects (except roots). Return count removed."""
        referenced = set()
        for refs in self.refs.values():
            referenced.update(refs)
        # Also keep objects that are referenced by something
        to_remove = []
        for cid in list(self.objects.keys()):
            if cid not in referenced and not self.refs.get(cid):
                # Only remove if no one references it and it references nothing
                to_remove.append(cid)
        for cid in to_remove:
            size = self.sizes.pop(cid, 0)
            self.objects.pop(cid, None)
            self.total_storage -= size
        return len(to_remove)

    def stats(self) -> dict:
        return {
            "status": self.status.value,
            "objects": len(self.objects),
            "total_storage_kb": round(self.total_storage / 1024, 1),
            "dedup_savings_kb": round(self.dedup_savings / 1024, 1),
            "refs": len(self.refs),
        }


class RollupKernel:
    """Produces compact representations of inference, execution, filesystem, artifacts."""

    def __init__(self, frame_graph: Optional[FrameGraph] = None):
        self.status = KernelStatus.READY
        self.frame_graph = frame_graph or FrameGraph()
        self.rollups_created = 0

    def create_rollup(self, frame_cid: str) -> UniversalInferenceFrame:
        """Create a compact rollup from a frame chain."""
        chain = self.frame_graph.get_chain(frame_cid)
        verified_steps = [
            {
                "action": f.response[:100],
                "model": f.model_id,
                "tokens": f.tokens_consumed,
                "verified": f.verified,
            }
            for f in chain
        ]

        rollup = UniversalInferenceFrame(
            frame_id=hashlib.sha256(
                f"rollup:{frame_cid}:{time.time()}".encode()
            ).hexdigest()[:16],
            frame_type=FrameType.CHECKPOINT,
            parent_frames=[frame_cid],
            reasoning_steps=verified_steps,
            verified=all(s["verified"] for s in verified_steps) if verified_steps else False,
            tokens_consumed=sum(s["tokens"] for s in verified_steps),
            is_checkpoint=True,
        )
        self.frame_graph.add(rollup)
        self.rollups_created += 1
        return rollup

    def stats(self) -> dict:
        return {
            "status": self.status.value,
            "rollups_created": self.rollups_created,
            "frame_graph": self.frame_graph.stats(),
        }


class VerificationKernel:
    """Checks artifact integrity, permission boundaries, replay consistency."""

    def __init__(self, cap_graph: Optional[CapabilityGraph] = None):
        self.status = KernelStatus.READY
        self.capabilities = cap_graph or CapabilityGraph()
        self.verifications: list[dict[str, Any]] = []
        self.failed_verifications: list[dict[str, Any]] = []

    def verify_frame(self, frame: UniversalInferenceFrame,
                     verifier: str = "system") -> bool:
        """Verify a frame's integrity."""
        # Check content hash
        expected_cid = frame._compute_cid()
        if expected_cid != frame.cid:
            self.failed_verifications.append({
                "frame": frame.cid,
                "reason": "CID mismatch",
                "timestamp": time.time(),
            })
            return False

        # Check verification receipt if present
        if frame.verification:
            receipt = frame.verification
            if receipt.confidence < 0.5:
                self.failed_verifications.append({
                    "frame": frame.cid,
                    "reason": f"Low confidence: {receipt.confidence}",
                    "timestamp": time.time(),
                })
                return False

        # Mark as verified
        self.verifications.append({
            "frame": frame.cid,
            "verifier": verifier,
            "timestamp": time.time(),
        })
        return True

    def verify_permission(self, peer_id: str, action: str) -> tuple[bool, str]:
        """Check if a peer is allowed to perform an action."""
        return self.capabilities.check_action(peer_id, action)

    def verify_replay(self, frame_graph: FrameGraph,
                      from_cid: str, to_cid: str) -> bool:
        """Verify that replaying from one frame to another is consistent."""
        chain = frame_graph.get_chain(to_cid)
        for frame in chain:
            if frame.cid == from_cid:
                return True
            if not frame.verify() if hasattr(frame, 'verify') else False:
                return False
        return False

    def stats(self) -> dict:
        return {
            "status": self.status.value,
            "verifications": len(self.verifications),
            "failed": len(self.failed_verifications),
            "capabilities": self.capabilities.stats(),
        }


class EvolutionKernel:
    """Selects models, branches, checkpoints, workflows, peers, skills.

    Uses verification and reward signals to select:
    - Which model to call
    - Which execution branch to continue
    - Which checkpoints to retain
    - Which workflows to promote
    - Which peers should execute a task
    - Which verified trajectories become reusable skills
    """

    def __init__(self):
        self.status = KernelStatus.READY
        self.model_scores: dict[str, dict[str, float]] = {}  # model → {task_type → score}
        self.branch_scores: dict[str, float] = {}  # frame_cid → score
        self.skill_registry: dict[str, dict[str, Any]] = {}  # skill_name → {cid, score, uses}
        self.decisions: list[dict[str, Any]] = []

    def record_model_performance(self, model_id: str, task_type: str,
                                 success: bool, reward: float = 0):
        """Record how a model performed on a task type."""
        if model_id not in self.model_scores:
            self.model_scores[model_id] = {}
        if task_type not in self.model_scores[model_id]:
            self.model_scores[model_id][task_type] = 0.5  # start neutral

        # Exponential moving average
        current = self.model_scores[model_id][task_type]
        outcome = 1.0 if success else 0.0
        self.model_scores[model_id][task_type] = 0.7 * current + 0.3 * outcome

    def select_model(self, task_type: str) -> Optional[str]:
        """Select the best model for a task type."""
        best_model = None
        best_score = -1
        for model_id, scores in self.model_scores.items():
            score = scores.get(task_type, 0.5)
            if score > best_score:
                best_score = score
                best_model = model_id
        return best_model

    def select_branch(self, candidates: list[str]) -> Optional[str]:
        """Select the best branch to continue."""
        best = None
        best_score = -1
        for cid in candidates:
            score = self.branch_scores.get(cid, 0.5)
            if score > best_score:
                best_score = score
                best = cid
        if best:
            self.decisions.append({
                "type": "branch_selection",
                "selected": best,
                "score": best_score,
                "candidates": len(candidates),
                "timestamp": time.time(),
            })
        return best

    def register_skill(self, name: str, frame_cid: str,
                       score: float = 0.5):
        """Register a verified trajectory as a reusable skill."""
        self.skill_registry[name] = {
            "frame_cid": frame_cid,
            "score": score,
            "uses": 0,
            "registered_at": time.time(),
        }

    def get_skill(self, task_type: str) -> Optional[dict[str, Any]]:
        """Find a reusable skill for a task type."""
        best = None
        best_score = 0.6  # minimum threshold
        for name, skill in self.skill_registry.items():
            if task_type.lower() in name.lower() and skill["score"] > best_score:
                best_score = skill["score"]
                best = skill
        if best:
            best["uses"] += 1
        return best

    def stats(self) -> dict:
        return {
            "status": self.status.value,
            "models_tracked": len(self.model_scores),
            "branches_tracked": len(self.branch_scores),
            "skills": len(self.skill_registry),
            "decisions": len(self.decisions),
            "top_models": {
                model: max(scores.values())
                for model, scores in self.model_scores.items()
                if scores
            },
        }


class TerminalityRuntime:
    """The complete runtime — all seven kernels operating together.

    This is the Content-Addressed Agent Runtime.
    The kernels own execution. The LLMs are replaceable compute engines.
    """

    def __init__(self):
        # Kernels
        self.terminal = TerminalKernel()
        self.inference = InferenceKernel()
        self.memory = MemoryKernel()
        self.storage = StorageKernel()
        self.rollup = RollupKernel(self.inference.frame_graph)
        self.verification = VerificationKernel()
        self.evolution = EvolutionKernel()

        # Ledgers
        self.ledgers = LedgerSystem()

        # Execution graph
        self.graph = ExecutionGraphV2()

    def stats(self) -> dict:
        return {
            "kernels": {
                "terminal": self.terminal.stats(),
                "inference": self.inference.stats(),
                "memory": self.memory.stats(),
                "storage": self.storage.stats(),
                "rollup": self.rollup.stats(),
                "verification": self.verification.stats(),
                "evolution": self.evolution.stats(),
            },
            "ledgers": self.ledgers.stats(),
            "execution_graph": self.graph.stats(),
            "state_root": self.ledgers.get_state_root_hash()[:12],
        }
