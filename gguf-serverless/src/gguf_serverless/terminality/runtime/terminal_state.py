"""
Universal Terminal State Object — composite content-addressed state.

A terminal session becomes a composite state object:

  TerminalState {
      PTY
      processTree
      shellState
      environment
      filesystemRoot
      dependencyGraph
      gitGraph
      toolOutputs
      agentMemory
      inferenceDAG
      permissionState
      verificationReceipts
      rewardHistory
      checkpoint
      CID
  }

Every mutation creates a new content-addressed state.
Branches represent alternative execution trajectories.
Peers replicate selected state components independently.
"""

from __future__ import annotations
import hashlib
import json
import time
import os
import subprocess
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from enum import Enum

from .universal_frame import UniversalInferenceFrame, FrameGraph, FrameType, Provider
from .capability_graph import CapabilityGraph, CapabilityLevel


@dataclass
class ProcessState:
    """State of a process in the terminal."""
    pid: int = 0
    name: str = ""
    command: str = ""
    status: str = "unknown"  # running, stopped, exited, crashed
    exit_code: Optional[int] = None
    parent_pid: Optional[int] = None
    children: list[int] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    environment: dict[str, str] = field(default_factory=dict)


@dataclass
class FilesystemDelta:
    """A filesystem mutation — what changed."""
    path: str
    operation: str  # "create", "modify", "delete", "move"
    old_hash: str = ""
    new_hash: str = ""
    size_delta: int = 0
    timestamp: float = field(default_factory=time.time)


@dataclass
class GitState:
    """Git state at a point in time."""
    branch: str = ""
    commit: str = ""
    dirty: bool = False
    staged_files: list[str] = field(default_factory=list)
    modified_files: list[str] = field(default_factory=list)
    remote: str = ""


@dataclass
class TerminalState:
    """Universal Terminal State Object — composite content-addressed state.

    This is the single object that captures everything about a terminal
    session at a point in time. It's content-addressed, so the same
    state always has the same CID.

    Every mutation (command, file change, process start/stop) creates
    a new TerminalState with a causal link to the previous one.

    This is what gets replicated, checkpointed, and reconstructed.
    """
    # Terminal
    pty_buffer: str = ""                   # current terminal output
    pty_dimensions: tuple[int, int] = (24, 80)  # rows, cols
    cursor_position: tuple[int, int] = (0, 0)
    shell_state: str = "bash"              # bash, zsh, fish, etc.
    shell_history: list[str] = field(default_factory=list)

    # Process tree
    process_tree: dict[int, ProcessState] = field(default_factory=dict)
    foreground_pid: Optional[int] = None

    # Environment
    working_directory: str = ""
    environment_variables: dict[str, str] = field(default_factory=dict)

    # Filesystem
    filesystem_root_hash: str = ""         # Merkle root of tracked files
    filesystem_deltas: list[FilesystemDelta] = field(default_factory=list)

    # Git
    git_state: Optional[GitState] = None

    # Dependency graph
    dependency_graph_hash: str = ""

    # Tool outputs (most recent)
    tool_outputs: dict[str, Any] = field(default_factory=dict)

    # Agent memory
    agent_memory_hash: str = ""            # CID of semantic memory
    agent_objectives: list[str] = field(default_factory=list)

    # Inference DAG
    inference_dag_root: str = ""           # CID of inference frame graph root
    inference_dag_head: str = ""           # CID of current head

    # Permissions
    permission_state_hash: str = ""        # CID of capability graph state
    active_capabilities: list[str] = field(default_factory=list)

    # Verification
    verification_receipts: list[dict[str, Any]] = field(default_factory=list)

    # Reward
    reward_history: list[dict[str, Any]] = field(default_factory=list)
    total_reward: float = 0.0

    # Checkpoint
    checkpoint_hash: str = ""
    is_checkpoint: bool = False

    # Causal chain
    parent_state_cid: str = ""
    child_state_cids: list[str] = field(default_factory=list)

    # Metadata
    created_at: float = field(default_factory=time.time)
    creator: str = "terminal"
    _cid: Optional[str] = None

    @property
    def cid(self) -> str:
        """Content-addressed ID — same state always has same CID."""
        if self._cid:
            return self._cid
        payload = {
            "pty_buffer_hash": hashlib.sha256(self.pty_buffer.encode()).hexdigest(),
            "process_count": len(self.process_tree),
            "cwd": self.working_directory,
            "fs_root": self.filesystem_root_hash,
            "git": self.git_state.commit if self.git_state else "",
            "inference_head": self.inference_dag_head,
            "parent": self.parent_state_cid,
            "objectives": self.agent_objectives,
        }
        self._cid = hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()
        return self._cid

    @property
    def short_cid(self) -> str:
        return self.cid[:12]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["cid"] = self.cid
        d["short_cid"] = self.short_cid
        if self.git_state:
            d["git_state"] = asdict(self.git_state)
        d["process_tree"] = {
            str(k): asdict(v) for k, v in self.process_tree.items()
        }
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, default=str)

    def mutate(self, **changes) -> "TerminalState":
        """Create a new state with mutations applied.

        Every mutation creates a new content-addressed state.
        The old state is preserved — this is append-only.
        """
        new_state = TerminalState(
            pty_buffer=changes.get("pty_buffer", self.pty_buffer),
            pty_dimensions=changes.get("pty_dimensions", self.pty_dimensions),
            cursor_position=changes.get("cursor_position", self.cursor_position),
            shell_state=changes.get("shell_state", self.shell_state),
            shell_history=changes.get("shell_history", self.shell_history),
            process_tree=changes.get("process_tree", self.process_tree),
            foreground_pid=changes.get("foreground_pid", self.foreground_pid),
            working_directory=changes.get("working_directory", self.working_directory),
            environment_variables=changes.get("environment_variables", self.environment_variables),
            filesystem_root_hash=changes.get("filesystem_root_hash", self.filesystem_root_hash),
            filesystem_deltas=changes.get("filesystem_deltas", self.filesystem_deltas),
            git_state=changes.get("git_state", self.git_state),
            dependency_graph_hash=changes.get("dependency_graph_hash", self.dependency_graph_hash),
            tool_outputs=changes.get("tool_outputs", self.tool_outputs),
            agent_memory_hash=changes.get("agent_memory_hash", self.agent_memory_hash),
            agent_objectives=changes.get("agent_objectives", self.agent_objectives),
            inference_dag_root=changes.get("inference_dag_root", self.inference_dag_root),
            inference_dag_head=changes.get("inference_dag_head", self.inference_dag_head),
            permission_state_hash=changes.get("permission_state_hash", self.permission_state_hash),
            active_capabilities=changes.get("active_capabilities", self.active_capabilities),
            verification_receipts=changes.get("verification_receipts", self.verification_receipts),
            reward_history=changes.get("reward_history", self.reward_history),
            total_reward=changes.get("total_reward", self.total_reward),
            parent_state_cid=self.cid,
        )
        return new_state


class TerminalStateGraph:
    """Graph of terminal states — like Git commits for terminal sessions.

    Each state is content-addressed. States form a DAG through
    parent_state_cid. Branches are alternative execution trajectories.
    """

    def __init__(self):
        self.states: dict[str, TerminalState] = {}
        self.roots: list[str] = []
        self.heads: list[str] = []
        self.current_head: Optional[str] = None

    def add(self, state: TerminalState) -> str:
        """Add a state to the graph."""
        cid = state.cid
        self.states[cid] = state

        # Update parent-child links
        if state.parent_state_cid:
            parent = self.states.get(state.parent_state_cid)
            if parent and cid not in parent.child_state_cids:
                parent.child_state_cids.append(cid)
            if state.parent_state_cid in self.heads:
                self.heads.remove(state.parent_state_cid)
        else:
            if cid not in self.roots:
                self.roots.append(cid)

        if cid not in self.heads:
            self.heads.append(cid)
        self.current_head = cid
        return cid

    def get(self, cid: str) -> Optional[TerminalState]:
        return self.states.get(cid)

    def get_current(self) -> Optional[TerminalState]:
        if self.current_head:
            return self.states.get(self.current_head)
        return None

    def get_history(self, cid: str, depth: int = -1) -> list[TerminalState]:
        """Get the history leading to a state."""
        chain = []
        current = self.states.get(cid)
        visited = set()
        d = 0
        while current and current.cid not in visited:
            if depth >= 0 and d >= depth:
                break
            chain.append(current)
            visited.add(current.cid)
            if current.parent_state_cid:
                current = self.states.get(current.parent_state_cid)
            else:
                break
            d += 1
        return chain

    def branch(self, from_cid: Optional[str] = None) -> TerminalState:
        """Branch from a state — alternative execution trajectory."""
        parent_cid = from_cid or self.current_head
        parent = self.states.get(parent_cid) if parent_cid else None

        if parent:
            new_state = parent.mutate()
        else:
            new_state = TerminalState()
        return new_state

    def checkpoint(self) -> str:
        """Checkpoint the current state."""
        current = self.get_current()
        if not current:
            return ""
        checkpoint_state = current.mutate(is_checkpoint=True)
        checkpoint_state.checkpoint_hash = current.cid
        return self.add(checkpoint_state)

    def stats(self) -> dict:
        return {
            "total_states": len(self.states),
            "roots": len(self.roots),
            "heads": len(self.heads),
            "checkpoints": sum(1 for s in self.states.values() if s.is_checkpoint),
            "processes_tracked": sum(
                len(s.process_tree) for s in self.states.values()
            ),
            "fs_mutations": sum(
                len(s.filesystem_deltas) for s in self.states.values()
            ),
            "total_reward": sum(s.total_reward for s in self.states.values()),
        }


def capture_current_state(working_dir: str = ".") -> TerminalState:
    """Capture the real terminal state from the current environment.

    This is not a mock — it reads the actual filesystem, process tree,
    and git state.
    """
    state = TerminalState()
    state.working_directory = os.path.abspath(working_dir)
    state.environment_variables = dict(os.environ)

    # Capture git state
    try:
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            stderr=subprocess.DEVNULL, cwd=working_dir
        ).decode().strip()
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            stderr=subprocess.DEVNULL, cwd=working_dir
        ).decode().strip()
        dirty = bool(subprocess.check_output(
            ["git", "status", "--porcelain"],
            stderr=subprocess.DEVNULL, cwd=working_dir
        ).decode().strip())
        state.git_state = GitState(branch=branch, commit=commit[:12], dirty=dirty)
    except Exception:
        state.git_state = None

    # Capture process tree (current process and children)
    current_pid = os.getpid()
    state.process_tree[current_pid] = ProcessState(
        pid=current_pid,
        name="terminality",
        command=" ".join(os.sys.argv[:3]),
        status="running",
    )

    # Compute filesystem root hash (hash of tracked files)
    try:
        tracked_files = subprocess.check_output(
            ["git", "ls-files"],
            stderr=subprocess.DEVNULL, cwd=working_dir
        ).decode().strip().split("\n")
        hasher = hashlib.sha256()
        for f in sorted(tracked_files)[:100]:  # limit for performance
            filepath = os.path.join(working_dir, f)
            if os.path.isfile(filepath):
                try:
                    with open(filepath, "rb") as fh:
                        hasher.update(fh.read()[:4096])  # first 4KB
                except Exception:
                    pass
        state.filesystem_root_hash = hasher.hexdigest()
    except Exception:
        state.filesystem_root_hash = ""

    return state
