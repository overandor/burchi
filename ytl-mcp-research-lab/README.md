# YTL-MCP Research Lab v0.1

Compliance-first YouTube automation *research lab*.

This project is **not** a spam uploader or engagement manipulator.

It is a receipt-backed system that:

- records research intent
- stores datasets and experiment metadata
- generates original assets (later phases)
- runs policy checks and human approval gates
- integrates with YouTube only through approved APIs (later phases)
- writes an auditable, append-only receipt ledger for every action

## Quickstart

### 1) Create a virtualenv + install

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -e '.[dev]'
```

### 2) Run the server

```bash
uvicorn ytl_lab.main:app --reload --port 8787
```

- Health check: `GET http://127.0.0.1:8787/health`
- MCP endpoint: `POST http://127.0.0.1:8787/mcp`

### 3) Run tests

```bash
pytest
```

## Data directory

By default the server writes to `./data/`:

- SQLite DB: `./data/ytl_lab.db`
- Receipt ledger: `./data/receipts/ledger.jsonl`

Configure with env vars below.

## Environment variables

- `YTL_DATA_DIR`
  - Default: `./data`
- `YTL_DB_PATH`
  - Default: `${YTL_DATA_DIR}/ytl_lab.db`
- `YTL_RECEIPT_LEDGER_PATH`
  - Default: `${YTL_DATA_DIR}/receipts/ledger.jsonl`
- `YTL_LOG_LEVEL`
  - Default: `INFO`

## Safety / Compliance

- Upload tools are not implemented in v0.1.
- Any future upload functionality must default to **private/unlisted**, require a stored approval receipt, and use only approved YouTube APIs.
- No scraping/botting/quota evasion.

## Notes on MCP compatibility

This server exposes a minimal JSON-RPC MCP-style interface with:

- `initialize`
- `tools/list`
- `tools/call`

If a specific client requires additional MCP methods, the tool surface can be extended while keeping receipts and allowlists intact.
