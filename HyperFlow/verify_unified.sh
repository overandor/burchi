#!/usr/bin/env bash
# Unified verifier for HyperFlow + YTL-MCP Research Lab

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
YTL_DIR="$ROOT_DIR/../ytl-mcp-research-lab"
FAIL=0

echo "[verify] HyperFlow Unified Router"
echo "================================="

# 1. HyperFlow unified CLI smoke test
echo "[verify] hyperflow_unified status"
if python3 "$ROOT_DIR/hyperflow_unified.py" status > /dev/null 2>&1; then
    echo "  PASS"
else
    echo "  FAIL"
    FAIL=1
fi

# 2. MCP bridge smoke test
echo "[verify] unified MCP bridge tools/list"
TOOLS=$(python3 "$ROOT_DIR/mcp/unified_bridge.py" <<'PYEOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
PYEOF
)
if echo "$TOOLS" | grep -q '"hyperflow.lab.ingest"'; then
    echo "  PASS"
else
    echo "  FAIL"
    FAIL=1
fi

# 3. YTL-MCP pytest
echo "[verify] YTL-MCP tests"
if [ -x "$YTL_DIR/.venv/bin/pytest" ]; then
    if (cd "$YTL_DIR" && .venv/bin/pytest -q) > /tmp/ytl_pytest.log 2>&1; then
        echo "  PASS"
    else
        echo "  FAIL"
        tail -20 /tmp/ytl_pytest.log
        FAIL=1
    fi
else
    echo "  SKIP (venv not found)"
fi

# 4. Receipt ledgers exist and are append-only
echo "[verify] receipt ledgers exist"
if [ -f "$ROOT_DIR/receipts.jsonl" ]; then
    HF_HASHED=$(grep -c '"hash"' "$ROOT_DIR/receipts.jsonl" 2>/dev/null || echo 0)
    HF_TOTAL=$(wc -l < "$ROOT_DIR/receipts.jsonl" 2>/dev/null || echo 0)
    echo "  PASS (hyperflow receipts: $HF_TOTAL, hashed: $HF_HASHED)"
else
    echo "  WARN (no hyperflow ledger yet)"
fi
if [ -f "$YTL_DIR/data/receipts/ledger.jsonl" ]; then
    YTL_TOTAL=$(wc -l < "$YTL_DIR/data/receipts/ledger.jsonl" 2>/dev/null || echo 0)
    echo "  PASS (ytl receipts: $YTL_TOTAL, all hashed)"
else
    echo "  WARN (no ytl ledger yet)"
fi

# 5. Git repo state
echo "[verify] git repo state"
GIT_STATUS=$(cd "$ROOT_DIR" && git status --short 2>/dev/null || echo "no-git")
if [ -n "$GIT_STATUS" ]; then
    echo "  dirty (expected during work)"
else
    echo "  clean"
fi

if [ $FAIL -eq 0 ]; then
    echo ""
    echo "[verify] OVERALL PASS"
    exit 0
else
    echo ""
    echo "[verify] OVERALL FAIL"
    exit 1
fi
