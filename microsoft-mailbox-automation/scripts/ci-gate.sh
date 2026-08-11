#!/bin/bash
# CI/CD gate — runs Playwright tests and fails the build if critical routes break.
#
# Usage:
#   ./scripts/ci-gate.sh           # run all tests
#   ./scripts/ci-gate.sh --quick   # run only API contract tests (no browser needed)
#
# Exit codes:
#   0 = all tests passed
#   1 = one or more tests failed (build should be blocked)

set -euo pipefail

cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-https://microsoft-mailbox-automation-one.vercel.app}"
export BASE_URL

echo "═══════════════════════════════════════════════════════════════"
echo "  ADVANTAGE FOUNDRY — CI/CD GATE"
echo "  Target: $BASE_URL"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Ensure Playwright browsers are installed
if ! npx playwright --version &>/dev/null; then
  echo "Installing Playwright..."
  npm install -D @playwright/test --legacy-peer-deps
fi
npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium

echo ""
echo "─── Running API Contract Tests ───"
npx playwright test tests/e2e/api-contract.spec.ts --reporter=list 2>&1
API_EXIT=$?

echo ""
echo "─── Running Page Load Tests ───"
npx playwright test tests/e2e/pages.spec.ts --reporter=list 2>&1
PAGES_EXIT=$?

echo ""
echo "─── Running User Flow Tests ───"
npx playwright test tests/e2e/user-flows.spec.ts --reporter=list 2>&1
FLOWS_EXIT=$?

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  RESULTS"
echo "═══════════════════════════════════════════════════════════════"
echo "  API Contract:   $([ $API_EXIT -eq 0 ] && echo 'PASS ✓' || echo 'FAIL ✗')"
echo "  Page Load:      $([ $PAGES_EXIT -eq 0 ] && echo 'PASS ✓' || echo 'FAIL ✗')"
echo "  User Flows:     $([ $FLOWS_EXIT -eq 0 ] && echo 'PASS ✓' || echo 'FAIL ✗')"
echo ""

if [ $API_EXIT -ne 0 ] || [ $PAGES_EXIT -ne 0 ] || [ $FLOWS_EXIT -ne 0 ]; then
  echo "❌ CI GATE FAILED — critical routes are broken"
  echo "   Review the test output above and fix failing tests before deploying."
  exit 1
fi

echo "✅ CI GATE PASSED — all tests green"
exit 0
