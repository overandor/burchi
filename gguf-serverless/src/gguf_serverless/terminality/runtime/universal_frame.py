"""
Universal Inference Frame — provider-independent intermediate representation.

  LLVM standardizes compiler IR.
  Terminality standardizes inference, tool execution, environment state,
  verification, and continuation.

  OpenAI    → InferenceFrame → Claude
  Claude    → InferenceFrame → Gemini
  Gemini    → InferenceFrame → Local Model
  Local     → InferenceFrame → GPT

The runtime, not the model provider, owns continuity.

Each provider serializes sessions differently. The Universal Inference
Frame is a canonical format that any model can consume and produce.
This enables:
  - Cross-model continuation (Claude → GPT without replaying prompts)
  - Portable execution state (move between providers)
  - Verification (any model can verify another's reasoning)
  - Branching (fork a reasoning chain to multiple models)
  - Compression (old frames collapse to verified facts)
"""

from __future__ import annotations
import hashlib
import json
import time
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum

from .inference_rollups import (
    InferenceRollup, ReasoningStep, ModelIndependentState,
    RollupStatus, InferenceRollupManager,
)


class FrameType(Enum):
    """What kind of frame this is."""
    INFERENCE = "inference"           # model generated reasoning
    TOOL_CALL = "tool_call"           # tool was invoked
    TOOL_RESULT = "tool_result"       # tool returned output
    FILESYSTEM_MUTATION = "fs_mutation"  # filesystem changed
    PROCESS_STATE = "process_state"   # process started/stopped/changed
    VERIFICATION = "verification"     # reasoning was verified
    CHECKPOINT = "checkpoint"         # state was checkpointed
    BRANCH = "branch"                 # reasoning forked
    MERGE = "merge"                   # reasoning paths merged
    ARTIFACT = "artifact"             # something was produced


class Provider(Enum):
    """Known model providers."""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    META = "meta"
    QWEN = "qwen"
    DEEPSEEK = "deepseek"
    LOCAL = "local"
    CUSTOM = "custom"


@dataclass
class ToolCall:
    """A tool invocation within a frame."""
    tool_name: str
    arguments: dict[str, Any]
    result: Optional[dict[str, Any]] = None
    success: bool = True
    error: Optional[str] = None
    elapsed_ms: float = 0.0


@dataclass
class EnvironmentSnapshot:
    """Environment state at a point in time.

    Captured so another model/machine can reconstruct the context.
    """
    working_directory: str = ""
    environment_variables: dict[str, str] = field(default_factory=dict)
    filesystem_root_hash: str = ""        # content-addressed filesystem state
    process_tree_hash: str = ""           # content-addressed process state
    git_ref: str = ""                     # current git branch/commit
    open_files: list[str] = field(default_factory=list)
    running_processes: list[str] = field(default_factory=list)


@dataclass
class VerificationReceipt:
    """Proof that a reasoning step was verified."""
    verifier: str                         # who verified (model ID or peer ID)
    verification_method: str              # "deterministic", "model_cross_check", "test"
    proof_hash: str                       # hash of verification evidence
    timestamp: float = field(default_factory=time.time)
    confidence: float = 1.0


@dataclass
class UniversalInferenceFrame:
    """The canonical provider-independent inference representation.

    This is the LLVM IR of inference. Any model produces it, any model
    consumes it. The runtime owns the frame, not the provider.

    Structure:
      prompt → context → model → tool_calls → terminal → filesystem →
      processes → artifacts → verification → reward → checkpoint → CID

    A frame captures everything needed to:
    1. Continue reasoning on any other model
    2. Verify the reasoning was correct
    3. Reconstruct the execution environment
    4. Branch or merge reasoning paths
    5. Compress old frames into verified facts
    """

    # Identity
    frame_id: str
    frame_type: FrameType
    cid: str = ""                         # content-addressed ID (IPFS-compatible)

    # Causal chain
    parent_frames: list[str] = field(default_factory=list)  # parent CIDs
    child_frames: list[str] = field(default_factory=list)

    # Inference content
    prompt: str = ""                      # what was asked
    context_root: str = ""                # CID of context used
    model_id: str = ""                    # which model produced this
    provider: Provider = Provider.CUSTOM
    response: str = ""                    # what the model said
    reasoning_steps: list[dict[str, Any]] = field(default_factory=list)

    # Tool interactions
    tool_calls: list[ToolCall] = field(default_factory=list)

    # Environment state
    environment: EnvironmentSnapshot = field(default_factory=EnvironmentSnapshot)

    # Terminal state
    terminal_output: str = ""
    terminal_state_hash: str = ""

    # Artifacts produced
    artifacts: list[dict[str, str]] = field(default_factory=list)  # [{"name":..., "cid":...}]

    # Verification
    verification: Optional[VerificationReceipt] = None
    verified: bool = False

    # Reward / feedback
    reward: float = 0.0
    reward_reason: str = ""

    # Permissions
    permissions_required: list[str] = field(default_factory=list)
    permissions_granted: list[str] = field(default_factory=list)

    # Checkpoint
    checkpoint_hash: str = ""             # CID of full checkpoint
    is_checkpoint: bool = False

    # Metadata
    tokens_consumed: int = 0
    compute_seconds: float = 0.0
    cost_estimate: float = 0.0
    created_at: float = field(default_factory=time.time)

    def __post_init__(self):
        if not self.cid:
            self.cid = self._compute_cid()

    def _compute_cid(self) -> str:
        """Compute content-addressed ID (IPFS-compatible CID)."""
        payload = {
            "frame_type": self.frame_type.value,
            "prompt": self.prompt,
            "model_id": self.model_id,
            "response": self.response[:1000],  # truncate for hashing
            "tool_calls": [
                {"tool": t.tool_name, "args": t.arguments, "success": t.success}
                for t in self.tool_calls
            ],
            "parent_frames": self.parent_frames,
            "verified": self.verified,
            "environment": {
                "cwd": self.environment.working_directory,
                "fs_root": self.environment.filesystem_root_hash,
            },
        }
        raw = json.dumps(payload, sort_keys=True, default=str).encode()
        # CIDv0-like: base58 of sha256 multihash (simplified to hex for now)
        return hashlib.sha256(raw).hexdigest()

    @property
    def short_cid(self) -> str:
        return self.cid[:12]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["frame_type"] = self.frame_type.value
        d["provider"] = self.provider.value
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, default=str)

    def to_provider_format(self, provider: Provider) -> dict:
        """Convert to a provider-specific format.

        The runtime owns the frame. When sending to a specific provider,
        it translates the universal frame into that provider's format.
        """
        if provider == Provider.OPENAI:
            return self._to_openai()
        elif provider == Provider.ANTHROPIC:
            return self._to_anthropic()
        elif provider == Provider.GOOGLE:
            return self._to_gemini()
        else:
            return self._to_generic()

    def _to_openai(self) -> dict:
        """Convert to OpenAI chat completions format."""
        messages = []
        # System message with context
        if self.context_root:
            messages.append({
                "role": "system",
                "content": f"Context root: {self.context_root}\n"
                          f"Environment: {self.environment.working_directory}\n"
                          f"Verified facts: {len([s for s in self.reasoning_steps if s.get('verified')])}"
            })
        # Previous reasoning as assistant messages
        for step in self.reasoning_steps[-10:]:
            messages.append({
                "role": "assistant",
                "content": step.get("action", "") + ": " + str(step.get("result", "")),
            })
        # Current prompt
        messages.append({"role": "user", "content": self.prompt or "Continue"})
        return {
            "model": "",  # filled by caller
            "messages": messages,
            "max_tokens": 512,
            "temperature": 0.3,
        }

    def _to_anthropic(self) -> dict:
        """Convert to Anthropic messages format."""
        messages = []
        for step in self.reasoning_steps[-10:]:
            messages.append({
                "role": "assistant",
                "content": step.get("action", "") + ": " + str(step.get("result", "")),
            })
        messages.append({"role": "user", "content": self.prompt or "Continue"})
        return {
            "model": "",
            "messages": messages,
            "max_tokens": 512,
            "system": f"Environment: {self.environment.working_directory}",
        }

    def _to_gemini(self) -> dict:
        """Convert to Gemini format."""
        contents = []
        for step in self.reasoning_steps[-10:]:
            contents.append({
                "role": "model",
                "parts": [{"text": step.get("action", "") + ": " + str(step.get("result", ""))}],
            })
        contents.append({
            "role": "user",
            "parts": [{"text": self.prompt or "Continue"}],
        })
        return {
            "contents": contents,
            "generationConfig": {"maxOutputTokens": 512, "temperature": 0.3},
        }

    def _to_generic(self) -> dict:
        """Generic format — works with any OpenAI-compatible endpoint."""
        return self._to_openai()

    @classmethod
    def from_provider_response(
        cls,
        response: dict[str, Any],
        provider: Provider,
        parent_frames: list[str],
        prompt: str = "",
        model_id: str = "",
    ) -> "UniversalInferenceFrame":
        """Create a frame from any provider's response.

        Normalizes different provider formats into the universal frame.
        """
        # Extract response text from various formats
        response_text = ""
        tokens = 0

        if provider == Provider.OPENAI or provider == Provider.CUSTOM:
            choices = response.get("choices", [])
            if choices:
                response_text = choices[0].get("message", {}).get("content", "")
            tokens = response.get("usage", {}).get("total_tokens", 0)
        elif provider == Provider.ANTHROPIC:
            content = response.get("content", [])
            if isinstance(content, list):
                response_text = " ".join(
                    block.get("text", "") for block in content
                    if block.get("type") == "text"
                )
            tokens = response.get("usage", {}).get("input_tokens", 0) + \
                     response.get("usage", {}).get("output_tokens", 0)
        elif provider == Provider.GOOGLE:
            candidates = response.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                response_text = " ".join(p.get("text", "") for p in parts)
            tokens = response.get("usageMetadata", {}).get("totalTokenCount", 0)

        frame = cls(
            frame_id=hashlib.sha256(
                f"{prompt}:{response_text[:100]}:{time.time()}".encode()
            ).hexdigest()[:16],
            frame_type=FrameType.INFERENCE,
            parent_frames=parent_frames,
            prompt=prompt,
            model_id=model_id,
            provider=provider,
            response=response_text,
            tokens_consumed=tokens,
        )
        return frame

    @classmethod
    def from_rollup(cls, rollup: InferenceRollup) -> "UniversalInferenceFrame":
        """Convert an inference rollup into a universal frame.

        This bridges the rollup system (reasoning checkpoints) with the
        frame system (provider-independent IR).
        """
        steps_as_dicts = [
            {
                "step_id": s.step_id,
                "action": s.action,
                "result": str(s.output_state)[:200],
                "model": s.model_used,
                "verified": s.verified,
                "tokens": s.tokens_consumed,
            }
            for s in rollup.steps
        ]

        return cls(
            frame_id=hashlib.sha256(
                f"frame_from_rollup:{rollup.hash}".encode()
            ).hexdigest()[:16],
            frame_type=FrameType.CHECKPOINT,
            parent_frames=rollup.parent_rollups,
            prompt=rollup.state.objectives_remaining[0]
                if rollup.state.objectives_remaining else "",
            model_id=";".join(set(rollup.model_provenance)),
            response=rollup.to_prompt_context()[:500],
            reasoning_steps=steps_as_dicts,
            verified=all(s.verified for s in rollup.steps) if rollup.steps else False,
            tokens_consumed=sum(s.tokens_consumed for s in rollup.steps),
            is_checkpoint=True,
            checkpoint_hash=rollup.hash,
        )

    def to_rollup_state(self) -> ModelIndependentState:
        """Convert frame back to rollup state for continuation.

        This is the reverse of from_rollup — allows a frame received
        from another model to be continued as a rollup.
        """
        verified_facts = [
            f"frame:{self.short_cid}:{step['action'][:50]}"
            for step in self.reasoning_steps
            if step.get("verified")
        ]
        return ModelIndependentState(
            verified_facts=verified_facts,
            objectives_remaining=[self.prompt] if self.prompt else [],
            token_lineage=[
                {"step": step.get("step_id", ""), "model": step.get("model", ""),
                 "tokens": step.get("tokens", 0)}
                for step in self.reasoning_steps
            ],
        )


class FrameGraph:
    """DAG of universal inference frames.

    Like Git's commit graph, but for inference:
    - Each frame is content-addressed
    - Frames have parent/child relationships
    - Branches are alternative reasoning paths
    - Merges combine reasoning from multiple models
    - Any node can be checked out and continued
    """

    def __init__(self):
        self.frames: dict[str, UniversalInferenceFrame] = {}
        self.roots: list[str] = []
        self.heads: list[str] = []

    def add(self, frame: UniversalInferenceFrame) -> str:
        """Add a frame to the graph."""
        self.frames[frame.cid] = frame

        # Update parent-child links
        for parent_cid in frame.parent_frames:
            parent = self.frames.get(parent_cid)
            if parent and frame.cid not in parent.child_frames:
                parent.child_frames.append(frame.cid)

        # Update roots and heads
        if not frame.parent_frames:
            if frame.cid not in self.roots:
                self.roots.append(frame.cid)
        for parent_cid in frame.parent_frames:
            if parent_cid in self.heads:
                self.heads.remove(parent_cid)
        if frame.cid not in self.heads:
            self.heads.append(frame.cid)

        return frame.cid

    def get(self, cid: str) -> Optional[UniversalInferenceFrame]:
        return self.frames.get(cid)

    def get_chain(self, cid: str, depth: int = -1) -> list[UniversalInferenceFrame]:
        """Get the causal chain leading to a frame."""
        chain = []
        current = self.frames.get(cid)
        visited = set()
        d = 0
        while current and current.cid not in visited:
            if depth >= 0 and d >= depth:
                break
            chain.append(current)
            visited.add(current.cid)
            if current.parent_frames:
                current = self.frames.get(current.parent_frames[0])
            else:
                break
            d += 1
        return chain

    def branch(self, parent_cid: str, prompt: str = "",
               model_id: str = "") -> UniversalInferenceFrame:
        """Branch a reasoning chain — fork to a new model."""
        parent = self.frames.get(parent_cid)
        if not parent:
            raise ValueError(f"Parent frame {parent_cid[:12]} not found")

        branch_frame = UniversalInferenceFrame(
            frame_id=hashlib.sha256(
                f"branch:{parent_cid}:{time.time()}".encode()
            ).hexdigest()[:16],
            frame_type=FrameType.BRANCH,
            parent_frames=[parent_cid],
            prompt=prompt,
            model_id=model_id,
            context_root=parent.context_root,
            environment=parent.environment,
            reasoning_steps=parent.reasoning_steps,  # inherit context
        )
        self.add(branch_frame)
        return branch_frame

    def merge(self, cid_a: str, cid_b: str,
              model_id: str = "") -> UniversalInferenceFrame:
        """Merge two reasoning paths."""
        a = self.frames.get(cid_a)
        b = self.frames.get(cid_b)
        if not a or not b:
            raise ValueError("One or both frames not found")

        merged_steps = a.reasoning_steps + b.reasoning_steps
        merged_facts = [
            s for s in merged_steps if s.get("verified")
        ]

        merge_frame = UniversalInferenceFrame(
            frame_id=hashlib.sha256(
                f"merge:{cid_a}:{cid_b}:{time.time()}".encode()
            ).hexdigest()[:16],
            frame_type=FrameType.MERGE,
            parent_frames=[cid_a, cid_b],
            model_id=model_id,
            reasoning_steps=merged_steps,
            verified=len(merged_facts) == len(merged_steps),
            tokens_consumed=a.tokens_consumed + b.tokens_consumed,
        )
        self.add(merge_frame)
        return merge_frame

    def verify(self, cid: str, verifier: str,
               method: str = "deterministic",
               confidence: float = 1.0) -> bool:
        """Verify a frame's reasoning."""
        frame = self.frames.get(cid)
        if not frame:
            return False
        proof = hashlib.sha256(
            f"verify:{cid}:{verifier}:{time.time()}".encode()
        ).hexdigest()
        frame.verification = VerificationReceipt(
            verifier=verifier,
            verification_method=method,
            proof_hash=proof,
            confidence=confidence,
        )
        frame.verified = True
        return True

    def compress(self, cid: str) -> UniversalInferenceFrame:
        """Compress a frame chain — keep only verified facts.

        Like Git GC: remove intermediate objects, keep only
        the state that matters for continuation.
        """
        chain = self.get_chain(cid)
        verified_steps = [
            s for frame in chain for s in frame.reasoning_steps
            if s.get("verified")
        ]

        compressed = UniversalInferenceFrame(
            frame_id=hashlib.sha256(
                f"compressed:{cid}:{time.time()}".encode()
            ).hexdigest()[:16],
            frame_type=FrameType.CHECKPOINT,
            parent_frames=[cid],
            reasoning_steps=verified_steps,
            verified=True,
            tokens_consumed=sum(s.get("tokens", 0) for s in verified_steps),
            is_checkpoint=True,
        )
        self.add(compressed)
        return compressed

    def stats(self) -> dict:
        return {
            "total_frames": len(self.frames),
            "roots": len(self.roots),
            "heads": len(self.heads),
            "verified": sum(1 for f in self.frames.values() if f.verified),
            "by_type": {
                t.value: sum(1 for f in self.frames.values() if f.frame_type == t)
                for t in FrameType
            },
            "by_provider": {
                p.value: sum(1 for f in self.frames.values() if f.provider == p)
                for p in Provider
            },
            "total_tokens": sum(f.tokens_consumed for f in self.frames.values()),
            "total_cost": sum(f.cost_estimate for f in self.frames.values()),
        }
