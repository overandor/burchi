# AGENTS.md — HyperFlow Agent Ledger

## Agent Roles

| Agent | Role | Authority |
|-------|------|-----------|
| **ChatGPT** | Strategist, architect, auditor, artifact compiler, valuation layer, command surface | Intent → spec → architecture |
| **Claude** | Deep reasoning, refactor, adversarial audit layer | Code review, security audit, refactor |
| **Codex** | Bounded code patch and test-generation worker | Scoped diffs, test generation |
| **Windsurf** | Persistent IDE/operator cockpit | File edits, terminal, verification |
| **Xcode** | Apple build, signing, simulator, profiling, archive, release authority | Build → sign → archive → release |
| **Devin/Hydra** | Disposable worker inside Hydra continuity layer | Bounded execution, dies gracefully |
| **GitHub** | Source of truth, CI, PR, issue tracking | Merge authority, CI gates |
| **MCP** | Bridge between agents and repo | Tool surface, context injection |

## Operating Principles

1. **Repo is truth.** Chat is not truth. Git diff is truth. Receipts are truth.
2. **Every task is bounded.** Task ID, files affected, risks, verification, receipt.
3. **Small diffs.** Reversible changes. Explicit contracts.
4. **Receipt-backed claims.** No success without evidence.
5. **Devin can die. The task cannot die.** Hydra resumes.
6. **One repo, one task ledger, one artifact registry, one build truth.**

## Task Lifecycle

```
intent → spec → architecture → code → local build → Xcode compile → test → patch → commit → receipt → deploy → valuation packet
```

## Agent Communication

Agents do not talk to each other directly. They communicate through:
- `tasks.jsonl` — task ledger
- `receipts.jsonl` — receipt ledger
- `artifacts/` — produced files
- `git diff` — code changes
- `HYDRA_STATE.json` — continuity state

## File Contract

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. Agent roles and operating principles. |
| `HYPERFLOW.md` | System architecture and workflow spec. |
| `HYDRA.md` | Continuity layer spec (Sentinel, Archivist, Executor Router). |
| `MCP_ORACLE_HYDRA.md` | MCP bridge spec. |
| `TASK_LEDGER.md` | Human-readable task ledger. |
| `DISRUPTION_LEDGER.md` | Ranked disruption primitives. |
| `tasks.jsonl` | Machine-readable task ledger. |
| `receipts.jsonl` | Machine-readable receipt ledger. |
| `hyperflow.py` | CLI for task/receipt/diff/verify. |
| `verify.sh` | Verification script. |
| `.github/workflows/hyperflow-ci.yml` | CI workflow. |
