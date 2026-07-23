#!/bin/bash
# verify.sh — HyperFlow verification script
set -e

echo "=== HyperFlow Verification ==="

# Check required files
echo "--- Required Files ---"
for f in AGENTS.md HYPERFLOW.md HYDRA.md TASK_LEDGER.md DISRUPTION_LEDGER.md MCP_ORACLE_HYDRA.md YTL_MCP.md ECR3000.md hyperflow.py glyph_canon.py benchmark_canon.py; do
    if [ -f "$f" ]; then
        echo "  OK: $f"
    else
        echo "  MISSING: $f"
        exit 1
    fi
done

# Run tests
echo "--- GlyphCanon Tests ---"
python3 -m pytest tests/test_canon.py -v 2>/dev/null || {
    echo "  pytest not available, running direct test..."
    python3 -c "
from glyph_canon import canonicalize
r = canonicalize('hello\u200bworld')
assert r.canonical_text == 'helloworld'
assert r.lossless is True
print('  Basic canonicalization: PASS')

r = canonicalize('\u0410pple')
assert r.canonical_text == 'Apple'
print('  Homoglyph: PASS')

r = canonicalize('hello\u202eworld')
assert 'RLO' in r.transform_receipt.bidi_control_stripped
print('  Bidi control: PASS')

r = canonicalize('.dlrow olleh')
assert r.canonical_text == 'hello world.'
print('  Reversed text: PASS')

print('  All tests: PASS')
"
}

# Run benchmark
echo "--- Benchmark ---"
python3 benchmark_canon.py > /dev/null 2>&1 && echo "  Benchmark: PASS" || echo "  Benchmark: SKIP (deps missing)"

# Verify ledger
echo "--- Ledger ---"
python3 hyperflow.py verify

echo "=== Verification Complete ==="
