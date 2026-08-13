"""Optimistic Concurrency Control for Reasoning Agents.

When multiple agents edit shared files, stale-base overwrites create
destructive races. This module implements a three-way merge protocol:

    BASE
   /    \\
  /      \\
CURRENT   PROPOSED
  \\      /
   \\    /
   MERGED

Every agent carries three versions of a file:

    BASE     — the file state the agent originally saw
    CURRENT  — the canonical file state right now
    PROPOSED — what the agent wanted to produce

The merge operation computes the semantic delta between BASE and
PROPOSED, then rebases that delta onto CURRENT. If the delta conflicts
with changes already in CURRENT, the commit is rejected as stale and
the agent receives the intervening revisions to rebase against.

An architectural constitution enforces system invariants that no
agent may violate regardless of its individual perspective:

    - no regression in passing tests
    - existing public API preserved unless migration approved
    - no destructive schema change without migration
    - security constraints outrank convenience
    - latency target < X
    - single source of truth for state
    - no duplicate infrastructure
    - new abstraction must remove more complexity than it adds

File-level versions track revisions so stale commits are detected:

    backend.py        revision 184
    database.py       revision 201

When an agent begins editing backend.py, it records read_revision = 184.
Before committing, the orchestrator checks again. If the file is now
revision 189, the commit is rejected as stale and the agent gets
revisions 185–189 to rebase against.
"""

from __future__ import annotations

import difflib
import hashlib
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional


# ═══════════════════════════════════════════════════════════════
# File Revision Tracking
# ═══════════════════════════════════════════════════════════════

@dataclass
class FileRevision:
    """A single revision of a file in the canonical store.

    The filesystem at the latest validated revision is canonical.
    An agent's local memory is never canonical.
    """
    path: str
    revision: int
    content_hash: str
    content: str = ""
    modified_at: float = field(default_factory=time.time)
    modified_by: str = ""  # agent_id or "system"
    commit_message: str = ""


class FileRevisionStore:
    """Tracks file-level revisions for optimistic concurrency control.

    Every file has a monotonically increasing revision number.
    When an agent reads a file, it records the current revision.
    When it tries to commit, the store checks if the revision has
    advanced since the agent's read.
    """

    def __init__(self) -> None:
        self._revisions: dict[str, list[FileRevision]] = {}
        self._current: dict[str, int] = {}  # path -> latest revision number

    def read(self, path: str) -> FileRevision:
        """Read the current canonical revision of a file."""
        if path not in self._revisions:
            # Initialize from filesystem if file exists
            content = ""
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            rev = FileRevision(
                path=path,
                revision=1,
                content_hash=self._hash(content),
                content=content,
                modified_by="system",
                commit_message="initial import",
            )
            self._revisions[path] = [rev]
            self._current[path] = 1
            return rev

        rev_num = self._current[path]
        return self._revisions[path][rev_num - 1]

    def get_revision(self, path: str, revision: int) -> Optional[FileRevision]:
        """Get a specific revision of a file."""
        if path not in self._revisions:
            return None
        revs = self._revisions[path]
        if revision < 1 or revision > len(revs):
            return None
        return revs[revision - 1]

    def get_revisions_since(self, path: str, since: int) -> list[FileRevision]:
        """Get all revisions after the given revision number.

        Used when an agent's commit is rejected as stale — it receives
        these intervening revisions to rebase against.
        """
        if path not in self._revisions:
            return []
        revs = self._revisions[path]
        if since >= len(revs):
            return []
        return revs[since:]  # revisions since+1 .. latest

    def current_revision(self, path: str) -> int:
        """Get the current revision number for a file."""
        return self._current.get(path, 0)

    def commit(self, path: str, content: str, modified_by: str,
               commit_message: str = "") -> FileRevision:
        """Commit a new revision. This is the canonical write.

        Only called after merge validation succeeds.
        """
        rev_num = self._current.get(path, 0) + 1
        rev = FileRevision(
            path=path,
            revision=rev_num,
            content_hash=self._hash(content),
            content=content,
            modified_by=modified_by,
            commit_message=commit_message,
        )
        if path not in self._revisions:
            self._revisions[path] = []
        self._revisions[path].append(rev)
        self._current[path] = rev_num

        # Write to filesystem
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

        return rev

    @staticmethod
    def _hash(content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


# ═══════════════════════════════════════════════════════════════
# Three-Way Merge
# ═══════════════════════════════════════════════════════════════

class MergeStatus(Enum):
    """Result of a three-way merge attempt."""
    CLEAN = "clean"            # no conflicts, merge applied
    STALE = "stale"            # base revision is behind current, needs rebase
    CONFLICT = "conflict"      # semantic conflict between proposed and current
    NO_CHANGES = "no_changes"  # proposed is identical to base, nothing to merge


@dataclass
class MergeResult:
    """Result of a three-way merge operation."""
    status: MergeStatus
    merged_content: str = ""
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    intervening_revisions: list[FileRevision] = field(default_factory=list)
    diff_base_proposed: list[str] = field(default_factory=list)
    diff_base_current: list[str] = field(default_factory=list)
    reasoning: str = ""


class ThreeWayMerger:
    """Performs three-way semantic merge of file content.

    The merge protocol:

        1. Read current canonical file (CURRENT)
        2. Compare with agent's expected base (BASE)
        3. Compute semantic delta (BASE → PROPOSED)
        4. Rebase proposed change onto CURRENT
        5. Validate against constitution
        6. Commit merged result

    If BASE == CURRENT, the merge is trivial — just apply PROPOSED.
    If BASE != CURRENT, we need to check whether the changes in
    PROPOSED conflict with the changes in CURRENT.
    """

    @staticmethod
    def merge(base: str, current: str, proposed: str) -> MergeResult:
        """Perform a three-way merge.

        Args:
            base:     The file content the agent originally saw (BASE)
            current:  The canonical file content right now (CURRENT)
            proposed: What the agent wanted to produce (PROPOSED)

        Returns:
            MergeResult with status and merged content or conflict info.
        """
        # If proposed is identical to base, nothing to do
        if proposed == base:
            return MergeResult(
                status=MergeStatus.NO_CHANGES,
                reasoning="Proposed content is identical to base — no changes to merge.",
            )

        # If current is identical to base, clean apply
        if current == base:
            return MergeResult(
                status=MergeStatus.CLEAN,
                merged_content=proposed,
                diff_base_proposed=ThreeWayMerger._diff(base, proposed),
                reasoning="Current matches base — applying proposed changes directly.",
            )

        # Base differs from current — need to rebase
        diff_bp = ThreeWayMerger._diff(base, proposed)
        diff_bc = ThreeWayMerger._diff(base, current)

        # Check for conflicts: did the agent and the intervening changes
        # modify the same lines?
        conflicts = ThreeWayMerger._detect_conflicts(diff_bp, diff_bc)

        if conflicts:
            return MergeResult(
                status=MergeStatus.CONFLICT,
                conflicts=conflicts,
                diff_base_proposed=diff_bp,
                diff_base_current=diff_bc,
                reasoning=(
                    f" {len(conflicts)} conflict(s) detected between proposed "
                    f"and intervening changes. Manual rebase required."
                ),
            )

        # No conflicts — attempt line-level rebase
        merged = ThreeWayMerger._rebase(base, current, proposed)

        if merged is None:
            return MergeResult(
                status=MergeStatus.CONFLICT,
                conflicts=[{"type": "rebase_failure",
                            "reason": "Could not automatically rebase changes"}],
                diff_base_proposed=diff_bp,
                diff_base_current=diff_bc,
                reasoning="Automatic rebase failed — changes overlap in complex ways.",
            )

        return MergeResult(
            status=MergeStatus.CLEAN,
            merged_content=merged,
            diff_base_proposed=diff_bp,
            diff_base_current=diff_bc,
            reasoning=(
                "Rebased proposed changes onto current canonical version. "
                "No conflicts detected."
            ),
        )

    @staticmethod
    def _diff(a: str, b: str) -> list[str]:
        """Compute unified diff between two strings."""
        a_lines = a.splitlines(keepends=True)
        b_lines = b.splitlines(keepends=True)
        return list(difflib.unified_diff(a_lines, b_lines, lineterm=""))

    @staticmethod
    def _detect_conflicts(diff_proposed: list[str],
                          diff_current: list[str]) -> list[dict[str, Any]]:
        """Detect whether proposed and current changes modify the same lines.

        Two changes conflict if they both modify the same source line
        in the base version.
        """
        proposed_changed = ThreeWayMerger._extract_changed_lines(diff_proposed)
        current_changed = ThreeWayMerger._extract_changed_lines(diff_current)

        conflicts: list[dict[str, Any]] = []
        for line_num in proposed_changed:
            if line_num in current_changed:
                conflicts.append({
                    "type": "line_conflict",
                    "line": line_num,
                    "proposed_change": proposed_changed[line_num],
                    "current_change": current_changed[line_num],
                    "reason": (
                        f"Both proposed and current changes modify line {line_num}. "
                        f"Cannot auto-merge."
                    ),
                })
        return conflicts

    @staticmethod
    def _extract_changed_lines(diff: list[str]) -> dict[int, str]:
        """Extract changed line numbers from a unified diff.

        Returns a dict mapping base line number -> new content.
        """
        changed: dict[int, str] = {}
        base_line = 0

        for line in diff:
            if line.startswith("@@"):
                # Parse hunk header: @@ -start,count +start,count @@
                import re
                match = re.match(r"@@ -(\d+)", line)
                if match:
                    base_line = int(match.group(1))
            elif line.startswith("-") and not line.startswith("---"):
                changed[base_line] = line[1:].rstrip()
                base_line += 1
            elif line.startswith("+") and not line.startswith("+++"):
                pass  # addition, doesn't consume base line
            elif line.startswith(" "):
                base_line += 1

        return changed

    @staticmethod
    def _rebase(base: str, current: str, proposed: str) -> Optional[str]:
        """Rebase proposed changes onto current version.

        Strategy: Apply only the lines that changed in proposed (relative
        to base) onto current, preserving all intervening changes in current.
        """
        base_lines = base.splitlines(keepends=True)
        current_lines = current.splitlines(keepends=True)
        proposed_lines = proposed.splitlines(keepends=True)

        # If line counts are too different, simple rebase won't work
        if abs(len(base_lines) - len(current_lines)) > len(base_lines) * 0.5:
            return None

        # Build a mapping: for each line in base, what did proposed change it to?
        # Use difflib to find corresponding blocks
        matcher = difflib.SequenceMatcher(None, base_lines, proposed_lines)
        proposed_changes: dict[int, str] = {}  # base_line_index -> new content

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            elif tag == "replace":
                for i in range(i1, i2):
                    if i - i1 < j2 - j1:
                        proposed_changes[i] = proposed_lines[j1 + (i - i1)]
            elif tag == "insert":
                # Insert before line i1 — mark with empty key
                proposed_changes[i1] = "".join(proposed_lines[j1:j2])
            elif tag == "delete":
                for i in range(i1, i2):
                    proposed_changes[i] = None  # mark for deletion

        # Now apply proposed_changes onto current_lines
        # We need to map base line indices to current line indices
        base_current_matcher = difflib.SequenceMatcher(None, base_lines, current_lines)
        base_to_current: dict[int, int] = {}

        for tag, i1, i2, j1, j2 in base_current_matcher.get_opcodes():
            if tag == "equal":
                for offset in range(i2 - i1):
                    base_to_current[i1 + offset] = j1 + offset

        # Build merged content
        result_lines: list[str] = []
        current_idx = 0

        while current_idx < len(current_lines):
            # Check if this current line corresponds to a base line that was changed
            base_idx = None
            for b_idx, c_idx in base_to_current.items():
                if c_idx == current_idx:
                    base_idx = b_idx
                    break

            if base_idx is not None and base_idx in proposed_changes:
                new_content = proposed_changes[base_idx]
                if new_content is not None:
                    result_lines.append(new_content)
                # Skip the current line (it's being replaced)
                current_idx += 1
            else:
                # Keep the current line as-is (preserving intervening changes)
                result_lines.append(current_lines[current_idx])
                current_idx += 1

        return "".join(result_lines)


# ═══════════════════════════════════════════════════════════════
# Architectural Constitution
# ═══════════════════════════════════════════════════════════════

class InvariantPriority(Enum):
    """Priority of architectural invariants.

    Higher priority invariants outrank lower ones.
    Security always wins over convenience.
    """
    SECURITY = 100
    CORRECTNESS = 90
    DATA_INTEGRITY = 85
    API_STABILITY = 70
    PERFORMANCE = 60
    SIMPLICITY = 50
    CONVENTION = 30


@dataclass
class ArchitecturalInvariant:
    """A system-wide invariant that no agent may violate.

    An agent isn't allowed to say 'my architectural perspective is better,
    therefore overwrite.' It has to say 'my proposal improves invariant X
    while preserving Y and Z.'
    """
    invariant_id: str
    name: str
    description: str
    priority: InvariantPriority = InvariantPriority.CORRECTNESS
    check: Optional[Callable[[str, str], tuple[bool, str]]] = None
    # check(proposed_content, current_content) -> (passes, reason)

    def validate(self, proposed: str, current: str) -> tuple[bool, str]:
        """Validate that the proposed change preserves this invariant."""
        if self.check is None:
            return True, "No check defined"
        return self.check(proposed, current)


class ArchitecturalConstitution:
    """The constitution that governs all agent edits.

    System invariants:
        - no regression in passing tests
        - existing public API preserved unless migration approved
        - no destructive schema change without migration
        - security constraints outrank convenience
        - latency target < X
        - single source of truth for state
        - no duplicate infrastructure
        - new abstraction must remove more complexity than it adds
    """

    def __init__(self) -> None:
        self._invariants: dict[str, ArchitecturalInvariant] = {}
        self._setup_default_invariants()

    def _setup_default_invariants(self) -> None:
        """Register the default system invariants."""

        def check_no_syntax_errors(proposed: str, current: str) -> tuple[bool, str]:
            """No syntax errors in Python files."""
            if not proposed.strip():
                return True, "Empty file"
            try:
                compile(proposed, "<merge>", "exec")
                return True, "No syntax errors"
            except SyntaxError as e:
                return False, f"Syntax error: {e}"

        def check_no_security_regression(proposed: str, current: str) -> tuple[bool, str]:
            """Security constraints outrank convenience."""
            dangerous_patterns = [
                "eval(input(", "exec(input(", "os.system(",
                "subprocess.call('", "pickle.loads(",
            ]
            proposed_lower = proposed.lower()
            current_lower = current.lower()
            for pattern in dangerous_patterns:
                if pattern not in current_lower and pattern in proposed_lower:
                    return False, f"Security regression: introduces '{pattern}'"
            return True, "No security regressions"

        def check_api_preservation(proposed: str, current: str) -> tuple[bool, str]:
            """Existing public API preserved unless migration approved."""
            import re
            current_defs = set(re.findall(r"^\s*(?:def|class)\s+(\w+)", current, re.MULTILINE))
            proposed_defs = set(re.findall(r"^\s*(?:def|class)\s+(\w+)", proposed, re.MULTILINE))
            removed = current_defs - proposed_defs
            if removed:
                return False, f"API regression: removed definitions: {removed}"
            return True, "All public definitions preserved"

        def check_no_duplicate_infrastructure(proposed: str, current: str) -> tuple[bool, str]:
            """No duplicate infrastructure."""
            import re
            proposed_classes = re.findall(r"class\s+(\w+)", proposed)
            seen: set[str] = set()
            for cls in proposed_classes:
                if cls in seen:
                    return False, f"Duplicate class definition: {cls}"
                seen.add(cls)
            return True, "No duplicate infrastructure"

        self.register(ArchitecturalInvariant(
            invariant_id="no_syntax_errors",
            name="No Syntax Errors",
            description="Proposed code must be syntactically valid",
            priority=InvariantPriority.CORRECTNESS,
            check=check_no_syntax_errors,
        ))

        self.register(ArchitecturalInvariant(
            invariant_id="no_security_regression",
            name="No Security Regression",
            description="Security constraints outrank convenience",
            priority=InvariantPriority.SECURITY,
            check=check_no_security_regression,
        ))

        self.register(ArchitecturalInvariant(
            invariant_id="api_preservation",
            name="API Preservation",
            description="Existing public API preserved unless migration approved",
            priority=InvariantPriority.API_STABILITY,
            check=check_api_preservation,
        ))

        self.register(ArchitecturalInvariant(
            invariant_id="no_duplicate_infrastructure",
            name="No Duplicate Infrastructure",
            description="No duplicate class or function definitions",
            priority=InvariantPriority.SIMPLICITY,
            check=check_no_duplicate_infrastructure,
        ))

    def register(self, invariant: ArchitecturalInvariant) -> None:
        """Register a new invariant."""
        self._invariants[invariant.invariant_id] = invariant

    def unregister(self, invariant_id: str) -> None:
        """Remove an invariant."""
        self._invariants.pop(invariant_id, None)

    def validate(self, proposed: str, current: str) -> tuple[bool, list[dict[str, Any]]]:
        """Validate proposed content against all invariants.

        Returns (all_pass, violations).
        Violations are sorted by priority (highest first).
        """
        violations: list[dict[str, Any]] = []

        for inv in self._invariants.values():
            passes, reason = inv.validate(proposed, current)
            if not passes:
                violations.append({
                    "invariant_id": inv.invariant_id,
                    "name": inv.name,
                    "priority": inv.priority.value,
                    "reason": reason,
                })

        violations.sort(key=lambda v: v["priority"], reverse=True)
        return len(violations) == 0, violations

    def summary(self) -> dict[str, Any]:
        return {
            "invariant_count": len(self._invariants),
            "invariants": [
                {
                    "id": inv.invariant_id,
                    "name": inv.name,
                    "priority": inv.priority.name,
                    "description": inv.description,
                }
                for inv in self._invariants.values()
            ],
        }


# ═══════════════════════════════════════════════════════════════
# Agent Edit Session
# ═══════════════════════════════════════════════════════════════

class EditSessionStatus(Enum):
    """Status of an agent edit session."""
    OPEN = "open"          # agent has read the file, hasn't committed
    COMMITTED = "committed"  # merge succeeded, changes applied
    STALE = "stale"        # base revision is behind current, needs rebase
    CONFLICT = "conflict"  # semantic conflict detected
    REJECTED = "rejected"  # constitution validation failed
    ABORTED = "aborted"    # agent gave up


@dataclass
class AgentEditSession:
    """An agent's edit session for a single file.

    The agent carries three versions:

        BASE     — the file state the agent originally saw
        CURRENT  — the canonical file state right now
        PROPOSED — what the agent wanted to produce

    The session enforces the merge protocol:

        read current → compare with expected base → compute semantic delta
        → rebase proposed change → validate → commit
    """
    session_id: str
    agent_id: str
    agent_type: str  # backend_architect, database_architect, security, performance, etc.
    file_path: str
    base_revision: int
    base_content: str
    proposed_content: str = ""
    status: EditSessionStatus = EditSessionStatus.OPEN
    merge_result: Optional[MergeResult] = None
    constitution_violations: list[dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    committed_at: float = 0.0
    reasoning: str = ""


# ═══════════════════════════════════════════════════════════════
# Merge Orchestrator
# ═══════════════════════════════════════════════════════════════

class MergeOrchestrator:
    """Orchestrates optimistic concurrency control for agent file edits.

    Rules about authority:

        1. The filesystem at the latest validated revision is canonical.
        2. An agent's local memory is never canonical.
        3. Existing changes are presumed intentional until proven defective.
        4. Never overwrite a changed file solely because it differs from
           the agent's starting copy.
        5. Diff first.
        6. Rebase the proposed architectural contribution onto the current version.
        7. Run tests (constitution validation).
        8. Only then promote the merged state.
    """

    def __init__(self, constitution: Optional[ArchitecturalConstitution] = None,
                 store: Optional[FileRevisionStore] = None) -> None:
        self.constitution = constitution or ArchitecturalConstitution()
        self.store = store or FileRevisionStore()
        self._sessions: dict[str, AgentEditSession] = {}
        self._session_counter = 0

    def begin_edit(self, file_path: str, agent_id: str,
                   agent_type: str = "general") -> AgentEditSession:
        """An agent begins editing a file.

        This records the current canonical revision as the agent's BASE.
        The agent must not assume the file will remain in this state.
        """
        rev = self.store.read(file_path)

        self._session_counter += 1
        session_id = f"EDIT-{self._session_counter:06d}"

        session = AgentEditSession(
            session_id=session_id,
            agent_id=agent_id,
            agent_type=agent_type,
            file_path=file_path,
            base_revision=rev.revision,
            base_content=rev.content,
        )
        self._sessions[session_id] = session
        return session

    def propose(self, session_id: str, proposed_content: str,
                reasoning: str = "") -> MergeResult:
        """An agent proposes a change.

        This is where the three-way merge happens:

            1. Read current canonical file (CURRENT)
            2. Compare with agent's expected base (BASE)
            3. Compute semantic delta (BASE → PROPOSED)
            4. Rebase proposed change onto CURRENT
            5. Validate against constitution
            6. Return result (don't commit yet)

        The agent should call commit() if the result is CLEAN.
        """
        session = self._sessions.get(session_id)
        if session is None:
            return MergeResult(
                status=MergeStatus.CONFLICT,
                reasoning=f"Session {session_id} not found",
            )
        if session.status != EditSessionStatus.OPEN:
            return MergeResult(
                status=MergeStatus.CONFLICT,
                reasoning=f"Session is {session.status.value}, not open",
            )

        session.proposed_content = proposed_content
        session.reasoning = reasoning

        # Step 1: Read current canonical version
        current_rev = self.store.read(session.file_path)

        # Step 2: Check if base is stale
        if current_rev.revision > session.base_revision:
            # Base is stale — agent needs intervening revisions to rebase
            intervening = self.store.get_revisions_since(
                session.file_path, session.base_revision)

            # Try to merge anyway — the three-way merger will detect conflicts
            result = ThreeWayMerger.merge(
                base=session.base_content,
                current=current_rev.content,
                proposed=proposed_content,
            )
            result.intervening_revisions = intervening

            if result.status == MergeStatus.CLEAN:
                # Auto-rebase succeeded — validate against constitution
                passes, violations = self.constitution.validate(
                    result.merged_content, current_rev.content)
                if not passes:
                    session.status = EditSessionStatus.REJECTED
                    session.constitution_violations = violations
                    result.status = MergeStatus.CONFLICT
                    result.reasoning = (
                        f"Constitution validation failed: "
                        f"{[v['name'] for v in violations]}. "
                        f"Auto-rebase succeeded but invariants were violated."
                    )
                else:
                    session.status = EditSessionStatus.STALE
                    session.merge_result = result
            else:
                session.status = EditSessionStatus.STALE
                session.merge_result = result

            return result

        # Step 3: Base is current — normal merge
        result = ThreeWayMerger.merge(
            base=session.base_content,
            current=current_rev.content,
            proposed=proposed_content,
        )

        if result.status == MergeStatus.CLEAN:
            # Step 5: Validate against constitution
            passes, violations = self.constitution.validate(
                result.merged_content, current_rev.content)
            if not passes:
                session.status = EditSessionStatus.REJECTED
                session.constitution_violations = violations
                result.status = MergeStatus.CONFLICT
                result.reasoning = (
                    f"Constitution validation failed: "
                    f"{[v['name'] for v in violations]}"
                )

        session.merge_result = result
        return result

    def commit(self, session_id: str) -> tuple[bool, str, Optional[FileRevision]]:
        """Commit a proposed change after successful merge.

        Returns (success, message, new_revision).
        Only succeeds if the merge result was CLEAN.
        """
        session = self._sessions.get(session_id)
        if session is None:
            return False, "Session not found", None

        if session.merge_result is None:
            return False, "No proposal has been made", None

        if session.merge_result.status != MergeStatus.CLEAN:
            return False, (
                f"Cannot commit: merge status is {session.merge_result.status.value}. "
                f"Reason: {session.merge_result.reasoning}"
            ), None

        # Final check: is the file still at the expected revision?
        current_rev = self.store.read(session.file_path)
        if current_rev.revision > session.base_revision and \
                session.status != EditSessionStatus.STALE:
            # Someone committed while we were validating
            return False, (
                f"Race detected: file advanced from revision "
                f"{session.base_revision} to {current_rev.revision} "
                f"during merge. Rebase required."
            ), None

        # Commit the merged content
        merged_content = session.merge_result.merged_content
        new_rev = self.store.commit(
            path=session.file_path,
            content=merged_content,
            modified_by=f"{session.agent_id} ({session.agent_type})",
            commit_message=session.reasoning or f"Edit via session {session.session_id}",
        )

        session.status = EditSessionStatus.COMMITTED
        session.committed_at = time.time()

        return True, (
            f"Committed as revision {new_rev.revision}. "
            f"{session.merge_result.reasoning}"
        ), new_rev

    def rebase_and_retry(self, session_id: str,
                         new_proposed: str) -> MergeResult:
        """An agent rebases its proposal after a stale rejection.

        The agent receives the intervening revisions and produces a
        new proposal that accounts for the changes. This is the
        'determine which of my intended changes are still absent'
        step.
        """
        session = self._sessions.get(session_id)
        if session is None:
            return MergeResult(
                status=MergeStatus.CONFLICT,
                reasoning="Session not found",
            )

        # Update base to current
        current_rev = self.store.read(session.file_path)
        session.base_revision = current_rev.revision
        session.base_content = current_rev.content
        session.status = EditSessionStatus.OPEN
        session.merge_result = None
        session.constitution_violations = []

        return self.propose(session_id, new_proposed)

    def abort(self, session_id: str) -> bool:
        """Abort an edit session."""
        session = self._sessions.get(session_id)
        if session is None:
            return False
        session.status = EditSessionStatus.ABORTED
        return True

    def get_session(self, session_id: str) -> Optional[AgentEditSession]:
        return self._sessions.get(session_id)

    def active_sessions(self) -> list[AgentEditSession]:
        return [s for s in self._sessions.values() if s.status == EditSessionStatus.OPEN]

    def session_history(self, file_path: Optional[str] = None) -> list[AgentEditSession]:
        if file_path:
            return [s for s in self._sessions.values() if s.file_path == file_path]
        return list(self._sessions.values())

    def summary(self) -> dict[str, Any]:
        status_counts: dict[str, int] = {}
        for s in self._sessions.values():
            status_counts[s.status.value] = status_counts.get(s.status.value, 0) + 1
        return {
            "total_sessions": len(self._sessions),
            "active": len(self.active_sessions()),
            "status_breakdown": status_counts,
            "constitution": self.constitution.summary(),
            "tracked_files": len(self.store._current),
        }


# ═══════════════════════════════════════════════════════════════
# Agent Specialization Lenses
# ═══════════════════════════════════════════════════════════════

class AgentLens(Enum):
    """Architectural lenses that agents can possess.

    Each agent has a different architectural perspective. The last
    agent benefits from the accumulated objections of everyone before it.
    """
    BACKEND_ARCHITECT = "backend_architect"
    DATABASE_ARCHITECT = "database_architect"
    SECURITY = "security"
    PERFORMANCE = "performance"
    RELIABILITY = "reliability"
    SIMPLIFICATION = "simplification"
    UX = "ux"
    ACCESSIBILITY = "accessibility"


@dataclass
class AgentObjection:
    """An objection raised by an agent during architectural review.

    Example chain:
        Backend architect: "Your service boundaries are wrong."
        Database architect: "Those boundaries create transactional inconsistency."
        Security agent: "That transaction path introduces an authorization gap."
        Performance agent: "The secure implementation creates N+1 calls."
        Reliability agent: "The optimization removes idempotency."
        Simplification agent: "All five problems disappear if this boundary moves here."
    """
    objection_id: str
    agent_lens: AgentLens
    target_session_id: str
    description: str
    severity: str = "medium"  # critical, high, medium, low
    suggested_fix: str = ""
    timestamp: float = field(default_factory=time.time)


class ArchitecturalReview:
    """Multi-agent architectural review chain.

    Agents with different lenses review a proposed change in sequence.
    Each agent can raise objections. Later agents benefit from the
    accumulated objections of earlier agents.
    """

    def __init__(self) -> None:
        self._objections: list[AgentObjection] = []

    def review(self, session: AgentEditSession,
               lens: AgentLens,
               description: str,
               severity: str = "medium",
               suggested_fix: str = "") -> AgentObjection:
        """An agent raises an objection during review."""
        import uuid
        objection = AgentObjection(
            objection_id=str(uuid.uuid4())[:8],
            agent_lens=lens,
            target_session_id=session.session_id,
            description=description,
            severity=severity,
            suggested_fix=suggested_fix,
        )
        self._objections.append(objection)
        return objection

    def objections_for(self, session_id: str) -> list[AgentObjection]:
        """Get all objections for a session, ordered by severity."""
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        obs = [o for o in self._objections if o.target_session_id == session_id]
        return sorted(obs, key=lambda o: severity_order.get(o.severity, 4))

    def accumulated_context(self, session_id: str) -> str:
        """Build accumulated context from all prior objections.

        The last agent in the chain sees all prior objections and
        can propose a fix that addresses all of them simultaneously.
        """
        obs = self.objections_for(session_id)
        if not obs:
            return "No prior objections."

        lines = ["Prior objections from architectural review:"]
        for o in obs:
            lines.append(
                f"  [{o.agent_lens.value}] ({o.severity}) {o.description}"
            )
            if o.suggested_fix:
                lines.append(f"    → Suggested fix: {o.suggested_fix}")

        return "\n".join(lines)

    def summary(self) -> dict[str, Any]:
        return {
            "total_objections": len(self._objections),
            "by_lens": {
                lens.value: sum(1 for o in self._objections if o.agent_lens == lens)
                for lens in AgentLens
            },
            "by_severity": {
                sev: sum(1 for o in self._objections if o.severity == sev)
                for sev in ["critical", "high", "medium", "low"]
            },
        }
