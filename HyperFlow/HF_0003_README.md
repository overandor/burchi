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

A top-level executable wrapper is provided so the CLI is just `./hyperflow`:

```bash
# System status
./hyperflow status

# HyperFlow task lifecycle
./hyperflow new "Create a YouTube transcript scoring experiment" --agent chatgpt --domain lab
./hyperflow assign HF-0003 codex
./hyperflow receipt HF-0003
./hyperflow verify

# YTL-MCP Research Lab
./hyperflow lab status
./hyperflow lab ingest --task HF-0003 --intent "Create a YouTube transcript scoring experiment" --url https://youtu.be/dQw4w9WgXcQ
./hyperflow lab score YTL-xxxx
./hyperflow lab script YTL-xxxx
./hyperflow lab metadata YTL-xxxx
./hyperflow lab shotlist YTL-xxxx
./hyperflow lab policy YTL-xxxx
./hyperflow lab prepare YTL-xxxx

# Receipt chain integrity
./hyperflow verify-receipts

# MCP server (stdio JSON-RPC)
python3 mcp/unified_bridge.py
```

The wrapper delegates to `python3 hyperflow_unified.py`.

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
**Executed on:** 2026-08-12 (HF-001 → YTL-d2a33028).

```bash
./hyperflow new "Create a YouTube transcript scoring experiment" --agent windsurf --domain lab --risks policy_approval --risks api_quota
./hyperflow assign HF-001 windsurf
./hyperflow lab ingest --task HF-001 --intent "Create a YouTube transcript scoring experiment" --url https://youtu.be/dQw4w9WgXcQ
./hyperflow lab score YTL-d2a33028
./hyperflow lab script YTL-d2a33028
./hyperflow lab metadata YTL-d2a33028
./hyperflow lab shotlist YTL-d2a33028
./hyperflow lab policy YTL-d2a33028
./hyperflow lab prepare YTL-d2a33028
./hyperflow receipt HF-001
./hyperflow verify
./hyperflow verify-receipts
```

**Proof:**

| Artifact | Path / Result |
|----------|---------------|
| Task ledger | `HyperFlow/tasks.jsonl` (HF-001, assigned to windsurf) |
| Receipt ledger | `ytl-mcp-research-lab/data/receipts/ledger.jsonl` (7 chained receipts) |
| SQLite record | `ytl-mcp-research-lab/data/ytl_lab.db` (experiment YTL-d2a33028) |
| Transcript score | 0.978 (dominant signal: technical) |
| Policy gate | **approved** |
| Upload package | prepared, `privacy: private` |
| Test result | `pytest tests/test_lab_tools.py` → 7 passed |
| Receipt chain | YTL-MCP: 7/7 verified, 0 broken |
| Unified verify | **OVERALL PASS** |
| Commit hash | captured at run time |

The experiment is held at `privacy: private` until a human approval receipt is recorded. Each receipt in the YTL ledger contains a `prev_hash` field, forming a tamper-evident chain.

## Verification

```bash
./verify_unified.sh
```

Checks:
- `./hyperflow status` runs
- MCP bridge exposes lab tools
- YTL-MCP pytest suite passes
- HyperFlow receipt chain has no broken entries
- YTL-MCP receipt chain is fully verified
- Receipt ledgers exist and are readable
- Git repo state is captured

## Files Added / Changed

- `hyperflow` — top-level executable wrapper
- `hyperflow_unified.py` — unified CLI
- `mcp/unified_bridge.py` — safe MCP tool surface
- `verify_unified.sh` — unified verifier
- `HF_0003_README.md` — this file
- `hyperflow.py` — core CLI with chained receipt hashing + `receipt verify`
- `../ytl-mcp-research-lab/src/ytl_lab/db.py` — SQLite schema
- `../ytl-mcp-research-lab/src/ytl_lab/receipts.py` — receipt ledger with chain hash + `verify_chain`
- `../ytl-mcp-research-lab/src/ytl_lab/tools.py` — lab tools
- `../ytl-mcp-research-lab/src/ytl_lab/main.py` — FastAPI + MCP server
- `../ytl-mcp-research-lab/src/ytl_lab/config.py` — settings helper
- `../ytl-mcp-research-lab/tests/test_lab_tools.py` — 7 passing tests

## Economic Claim

This system converts multi-agent AI work from volatile chat into reproducible production receipts. The financeable asset is not "we automated YouTube." It is:

> A receipt-backed AI production lab where every AI action becomes task state, artifact state, verification state, and economic evidence.

## Next Actions

1. ✅ Run the end-to-end demo task and capture chained receipts.
2. ✅ Commit all artifacts with receipt hashes.
3. Add a ChatGPT App manifest that points MCP clients to `mcp/unified_bridge.py`.
4. Implement Hydra watchdog (`hyperflow hydra watch`) to produce relaunch packets.
5. Add artifact scoring command (`hyperflow value HF-0003`) for reuse/financeability.
