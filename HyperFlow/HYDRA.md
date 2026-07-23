# HYDRA.md — Continuity Layer

> **Devin can die. The task cannot die.**

## Three Heads

### 1. Sentinel (Watcher)

Watches liveness and detects anomalies:
- File changes (fsnotify / fswatch)
- Git diff accumulation
- Terminal output patterns
- PR activity
- Repeated failure detection
- Build log monitoring
- Task state transitions
- Agent heartbeat timeout

**Sentinel does not execute. It observes and alerts.**

### 2. Archivist (Memory)

Captures state at every transition:
- Current task ID and status
- Files modified (with hashes)
- Git diff (uncommitted changes)
- Terminal command history
- TODOs and blockers
- Human decisions logged
- Receipts produced
- Current branch and commit hash
- Artifact paths
- Next planned action
- Agent that was active
- Timestamp of last activity

**Archivist writes to `HYDRA_STATE.json` and `hydra_archive.jsonl`.**

### 3. Executor Router (Resume)

Generates resume packets and routes work:
- Reads `HYDRA_STATE.json`
- Determines which agent should resume
- Generates a resume prompt with:
  - Last task ID
  - Files affected
  - What was done
  - What remains
  - Verification command
- Routes to: Devin, Codex, Claude, ChatGPT, Windsurf, Xcode, local terminal, GitHub issue/PR, or human checkpoint

**Executor Router does not bypass provider limits. It makes work resilient to interruptions.**

## State File

```json
{
  "hydra_version": 1,
  "last_heartbeat": "2026-07-10T19:46:00Z",
  "active_agent": "windsurf",
  "active_task": "HF-001",
  "task_status": "in_progress",
  "branch": "main",
  "commit_hash": "abc123",
  "uncommitted_files": ["glyph_canon.py"],
  "uncommitted_diff_hash": "sha256:...",
  "artifacts_produced": ["glyph_canon.py"],
  "receipts_produced": [],
  "blockers": [],
  "next_action": "Run pytest tests/test_canon.py -v",
  "next_agent": "windsurf",
  "archive_entries": 0
}
```

## Failure Modes Handled

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Agent session timeout | Heartbeat > 5 min | Executor Router generates resume packet |
| Agent context loss | Task status = in_progress, no heartbeat | Archivist restores from HYDRA_STATE.json |
| Browser sleep | Sentinel detects no terminal output | Wake + resume from last checkpoint |
| Environment crash | Sentinel detects process death | Reboot + restore from archive |
| Repeated build failure | Sentinel detects 3+ consecutive failures | Escalate to human checkpoint |
| Drift (agent off-task) | Sentinel detects file changes outside task scope | Alert + re-scope task |

## Archive Format

```jsonl
{"timestamp": "...", "event": "heartbeat", "agent": "windsurf", "task": "HF-001", "status": "in_progress"}
{"timestamp": "...", "event": "file_change", "file": "glyph_canon.py", "hash": "sha256:..."}
{"timestamp": "...", "event": "receipt", "receipt_id": "R-001", "status": "pass"}
{"timestamp": "...", "event": "crash", "agent": "devin", "reason": "timeout"}
{"timestamp": "...", "event": "resume", "agent": "windsurf", "from_task": "HF-001", "from_state": "in_progress"}
```

## Implementation Status

- **Spec**: Complete (this document)
- **Sentinel**: Not yet implemented (needs fswatch + heartbeat monitor)
- **Archivist**: Not yet implemented (needs state capture script)
- **Executor Router**: Not yet implemented (needs resume packet generator)
- **HYDRA_STATE.json**: Schema defined, not yet auto-populated
