# HF-0003: Unified HyperFlow Command Router

**Status:** In Progress — MVP built, end-to-end demo pending.  
**Definition of done:** One CLI addresses both HyperFlow and YTL-MCP; one MCP server exposes safe tools; one receipt ledger records both code tasks and lab tasks; one verifier proves local health; one README shows the full loop; one demo task runs from intent to receipt.

## What This Is

The Unified Command Router is the production operating layer that turns multi-agent AI work from volatile chat into reproducible receipts. It binds:

- **HyperFlow Ledger OS** — code task lifecycle, build verification, valuation
- **YTL-MCP Research Lab** — YouTube research experiment lifecycle, policy gates, upload packages
- **MCP bridge** — safe tool surface for ChatGPT, Claude, Codex, Windsurf
- **One verifier** — proves local health of the entire stack

The durable brain remains **Git + task ledger + receipts + verifier logs**. The chat window, Windsurf, and Devin are disposable surfaces.

## Architecture

```
ChatGPT App / Windsurf / Claude / Codex
                │
                ▼
      ┌─────────────────────┐
      │  Unified MCP Server │  ← safe, narrow tools only
      │   mcp/unified_bridge.py
      └─────────────────────┘
                │
                ▼
      ┌─────────────────────┐
      │ hyperflow_unified.py│  ← one CLI for both domains
      └─────────────────────┘
           │           │
           ▼           ▼
   HyperFlow core   YTL-MCP Lab
   tasks.jsonl      SQLite + receipts
   receipts.jsonl  ../ytl-mcp-research-lab
   verify_unified.sh
```

## Commands

```bash
# System status
python3 hyperflow_unified.py status

# HyperFlow task lifecycle
python3 hyperflow_unified.py new "Create a YouTube transcript scoring experiment" --agent chatgpt --domain lab
python3 hyperflow_unified.py assign HF-0003 codex
python3 hyperflow_unified.py receipt HF-0003
python3 hyperflow_unified.py verify

# YTL-MCP Research Lab
python3 hyperflow_unified.py lab status
python3 hyperflow_unified.py lab ingest --task HF-0003 --intent "Create a YouTube transcript scoring experiment" --url https://youtu.be/dQw4w9WgXcQ
python3 hyperflow_unified.py lab score YTL-xxxx
python3 hyperflow_unified.py lab script YTL-xxxx
python3 hyperflow_unified.py lab metadata YTL-xxxx
python3 hyperflow_unified.py lab shotlist YTL-xxxx
python3 hyperflow_unified.py lab policy YTL-xxxx
python3 hyperflow_unified.py lab prepare YTL-xxxx

# MCP server (stdio JSON-RPC)
python3 mcp/unified_bridge.py
```

## Safe MCP Tool Surface

No raw shell. Each tool is scoped and receipt-backed:

- `hyperflow.status`
- `hyperflow.new_task`
- `hyperflow.assign`
- `hyperflow.receipt`
- `hyperflow.verify`
- `hyperflow.snapshot_repo`
- `hyperflow.lab.status`
- `hyperflow.lab.ingest`
- `hyperflow.lab.score`
- `hyperflow.lab.policy`
- `hyperflow.lab.prepare_upload`

## Demo Task (Completed)

**Task:** Create a YouTube transcript scoring experiment.  
**Executed on:** 2026-08-12 (HF-001 → YTL-9cc2499e).

```bash
python3 hyperflow_unified.py new "Create a YouTube transcript scoring experiment" --agent chatgpt --domain lab --risks policy_approval --risks api_quota
python3 hyperflow_unified.py assign HF-001 codex
python3 hyperflow_unified.py lab ingest --task HF-001 --intent "Create a YouTube transcript scoring experiment" --url https://youtu.be/dQw4w9WgXcQ
python3 hyperflow_unified.py lab score YTL-9cc2499e
python3 hyperflow_unified.py lab script YTL-9cc2499e
python3 hyperflow_unified.py lab metadata YTL-9cc2499e
python3 hyperflow_unified.py lab shotlist YTL-9cc2499e
python3 hyperflow_unified.py lab policy YTL-9cc2499e
python3 hyperflow_unified.py lab prepare YTL-9cc2499e
python3 hyperflow_unified.py receipt HF-001
python3 hyperflow_unified.py verify
```

**Proof:**

| Artifact | Path |
|----------|------|
| Task ledger | `HyperFlow/tasks.jsonl` (HF-001) |
| Receipt ledger | `ytl-mcp-research-lab/data/receipts/ledger.jsonl` (7 receipts) |
| SQLite record | `ytl-mcp-research-lab/data/ytl_lab.db` (experiment YTL-9cc2499e) |
| Test result | `pytest tests/test_lab_tools.py` → 7 passed |
| Commit hash | captured at run time |

The experiment was approved by the policy gate, prepared as a private upload package, and is held at `privacy: private` until human approval is recorded.

## Verification

```bash
./verify_unified.sh
```

Checks:
- `hyperflow_unified.py status` runs
- MCP bridge exposes lab tools
- YTL-MCP pytest suite passes
- Receipt ledgers exist and are readable
- Git repo state is captured

## Files Added / Changed

- `hyperflow_unified.py` — unified CLI
- `mcp/unified_bridge.py` — safe MCP tool surface
- `verify_unified.sh` — unified verifier
- `HF_0003_README.md` — this file
- `../ytl-mcp-research-lab/src/ytl_lab/db.py` — SQLite schema
- `../ytl-mcp-research-lab/src/ytl_lab/receipts.py` — receipt ledger
- `../ytl-mcp-research-lab/src/ytl_lab/tools.py` — lab tools
- `../ytl-mcp-research-lab/src/ytl_lab/main.py` — FastAPI + MCP server
- `../ytl-mcp-research-lab/src/ytl_lab/config.py` — settings helper
- `../ytl-mcp-research-lab/tests/test_lab_tools.py` — 7 passing tests

## Economic Claim

This system converts multi-agent AI work from volatile chat into reproducible production receipts. The financeable asset is not "we automated YouTube." It is:

> A receipt-backed AI production lab where every AI action becomes task state, artifact state, verification state, and economic evidence.

## Next Actions

1. Run the end-to-end demo task and capture receipts.
2. Commit all artifacts with receipt hashes.
3. Extend MCP tools for `lab.script`, `lab.metadata`, `lab.shotlist` if needed by command surface.
4. Add a ChatGPT App manifest that points MCP clients to `mcp/unified_bridge.py`.
