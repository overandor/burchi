# HYPERFLOW.md — Multi-Agent AI Production Control Plane

## Core Primitive

**Many AI agents, one repo, one task ledger, one artifact registry, one build truth.**

## Architecture

```
ChatGPT (strategist/command)
    ↓ intent + spec
Claude (deep reasoning/audit)
    ↓ review + refactor
Codex (bounded patch worker)
    ↓ scoped diff + tests
Windsurf (IDE/operator cockpit)
    ↓ file edits + terminal
Xcode (build/sign/release authority)
    ↓ build → sign → archive
GitHub (source of truth + CI)
    ↓ merge → CI gates
MCP (bridge between all agents and repo)
    ↓ tool surface + context
Hydra (continuity — survives all agent deaths)
    ↓ state capture + resume
```

## Workflow

```
intent → spec → architecture → code → local build → Xcode compile → test → patch → commit → receipt → deploy → valuation packet
```

Each transition produces a receipt. No transition is claimed complete without evidence.

## Task Ledger Format

```json
{
  "task_id": "HF-001",
  "title": "Implement GlyphCanon canonicalization",
  "agent": "windsurf",
  "status": "in_progress",
  "files_affected": ["glyph_canon.py", "tests/test_canon.py"],
  "risks": ["unicode normalization edge cases"],
  "verification": "pytest tests/test_canon.py -v",
  "created_at": "2026-07-10T19:46:00Z",
  "updated_at": "2026-07-10T19:46:00Z",
  "receipt_id": null
}
```

## Receipt Format

```json
{
  "receipt_id": "R-001",
  "task_id": "HF-001",
  "agent": "windsurf",
  "type": "build",
  "status": "pass",
  "evidence": {
    "command": "pytest tests/test_canon.py -v",
    "exit_code": 0,
    "output_hash": "sha256:...",
    "duration_ms": 1234
  },
  "artifacts": ["glyph_canon.py", "tests/test_canon.py"],
  "commit_hash": "abc123",
  "timestamp": "2026-07-10T19:46:00Z"
}
```

## Evidence Types

| Type | Source | Authority |
|------|--------|-----------|
| `build` | local build / Xcode | compile success |
| `test` | pytest / xctest | test pass |
| `lint` | flake8 / swiftlint | code quality |
| `benchmark` | benchmark script | performance |
| `artifact` | file hash | file exists + integrity |
| `commit` | git hash | change recorded |
| `runtime` | execution trace | runs correctly |
| `receipt` | nested receipt | composite proof |

## Valuation

Conservative dollar appraisal only when backed by:
- Working files
- Tests
- Benchmarks
- Receipts
- Documentation

No appraisal without evidence. No claim without receipt.

## Crown Thesis

**ECR-3000 / Glyph Field Crystallization** is the crown.
- Microglyph = physical/visual carrier
- Engleash = executable-English control language
- FileVM = deployment substrate
- Receipts = trust layer
- HyperFlow = production ledger
- Hydra/Widevin = continuity layer
- YTL-MCP = first applied lab
- GlyphCanon = pre-tokenization normalization

## Defensible Claim

Not that transformers are replaced today. But that canonicalization, receipts, KV-bloat residue analysis, deterministic replay, task ledgers, field traces, and reproducibility benchmarks can reduce ambiguity, reduce wasted inference, expose transformations before tokenization, and convert volatile AI work into verifiable artifacts.
