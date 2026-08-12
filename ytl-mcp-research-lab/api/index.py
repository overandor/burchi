"""Vercel serverless entry point for YTL-MCP Research Lab."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure src is on the path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

# Set up temp data directory for serverless environment
os.environ.setdefault("YTL_DATA_DIR", "/tmp/ytl_data")
os.environ.setdefault("YTL_DB_PATH", "/tmp/ytl_data/ytl_lab.db")
os.environ.setdefault("YTL_RECEIPT_LEDGER_PATH", "/tmp/ytl_data/receipts/ledger.jsonl")

# Create temp dirs
Path("/tmp/ytl_data/receipts").mkdir(parents=True, exist_ok=True)

from ytl_lab.main import app  # noqa: E402

# Vercel Python runtime uses ASGI
handler = app
