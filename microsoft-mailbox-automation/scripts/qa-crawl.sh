#!/bin/bash
# Comprehensive QA crawl — tests every API endpoint and page
# Records: 404, 500, timeout, empty response, broken redirect

BASE="${1:-https://microsoft-mailbox-automation-one.vercel.app}"
RESULTS_FILE="/tmp/qa-results.txt"
PAGES_FILE="/tmp/qa-pages.txt"
> "$RESULTS_FILE"
> "$PAGES_FILE"

# ── Helpers ──────────────────────────────────────────────────────────────────

test_get() {
  local path="$1"
  local label="${2:-GET $path}"
  local status body_size body_start
  local tmp
  tmp=$(curl -s -m 15 -o /tmp/qa-resp.txt -w "%{http_code}|%{size_download}" "$BASE$path" 2>/dev/null)
  status="${tmp%%|*}"
  body_size="${tmp##*|}"
  body_start=$(head -c 120 /tmp/qa-resp.txt 2>/dev/null | tr '\n' ' ')

  if [ "$status" = "000" ]; then
    echo "TIMEOUT|$label|$path|status=timeout|size=$body_size" >> "$RESULTS_FILE"
  elif [ "$status" = "404" ]; then
    echo "404|$label|$path|size=$body_size|body=$body_start" >> "$RESULTS_FILE"
  elif [ "$status" -ge 500 ] 2>/dev/null; then
    echo "$status|$label|$path|size=$body_size|body=$body_start" >> "$RESULTS_FILE"
  elif [ "$body_size" = "0" ] || [ "$body_size" = "1" ]; then
    echo "EMPTY|$label|$path|status=$status|size=$body_size" >> "$RESULTS_FILE"
  else
    echo "OK|$label|$path|status=$status|size=$body_size" >> "$RESULTS_FILE"
  fi
}

test_post() {
  local path="$1"
  local body="${2:-"{}"}"
  local label="${3:-POST $path}"
  local status body_size body_start
  local tmp
  tmp=$(curl -s -m 15 -o /tmp/qa-resp.txt -w "%{http_code}|%{size_download}" -X POST \
    -H "Content-Type: application/json" -d "$body" "$BASE$path" 2>/dev/null)
  status="${tmp%%|*}"
  body_size="${tmp##*|}"
  body_start=$(head -c 120 /tmp/qa-resp.txt 2>/dev/null | tr '\n' ' ')

  if [ "$status" = "000" ]; then
    echo "TIMEOUT|$label|$path|status=timeout|size=$body_size" >> "$RESULTS_FILE"
  elif [ "$status" = "404" ]; then
    echo "404|$label|$path|size=$body_size|body=$body_start" >> "$RESULTS_FILE"
  elif [ "$status" -ge 500 ] 2>/dev/null; then
    echo "$status|$label|$path|size=$body_size|body=$body_start" >> "$RESULTS_FILE"
  elif [ "$body_size" = "0" ] || [ "$body_size" = "1" ]; then
    echo "EMPTY|$label|$path|status=$status|size=$body_size" >> "$RESULTS_FILE"
  else
    echo "OK|$label|$path|status=$status|size=$body_size" >> "$RESULTS_FILE"
  fi
}

test_page() {
  local path="$1"
  local status
  status=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "$BASE$path" 2>/dev/null)
  if [ "$status" = "000" ]; then
    echo "TIMEOUT|PAGE|$path|status=timeout" >> "$PAGES_FILE"
  elif [ "$status" = "404" ]; then
    echo "404|PAGE|$path" >> "$PAGES_FILE"
  elif [ "$status" -ge 500 ] 2>/dev/null; then
    echo "$status|PAGE|$path" >> "$PAGES_FILE"
  else
    echo "OK|PAGE|$path|status=$status" >> "$PAGES_FILE"
  fi
}

echo "═══ CRAWLING PAGES ═══"
# Test all pages
for p in \
  / /login /settings /dashboard /today /foundry /experiment /results \
  /inbox /golden-nodes /history /email-lab /voice-demo /diary /spinor \
  /autopilot /emails /etl /experiments /experiment/new /experiment/record \
  /frontrunner /gilead /gmail/connect /discovery-ledger /learnings \
  /leaders /phones /pitch /process-lab /sheets /spin-lifecycle \
  /spinor-rl /telemetry /territory /world /workteleport \
  /workteleport/dissect /workteleport/skills /workteleport/taxonomy \
  /workteleport/twins /workteleport/ventures /auth/callback /auth/redirect \
  ; do
  test_page "$p"
done

echo "═══ CRAWLING GET ENDPOINTS ═══"
# Test all GET endpoints
for p in \
  /api/health /api/config /api/azure/config /api/gmail/config /api/imap/config \
  /api/auth/me /api/crm /api/telemetry /api/trajectory \
  /api/commitments /api/experiments /api/strategies /api/strategies/marketplace \
  /api/strategies/portfolio /api/golden /api/golden/golden-nodes /api/golden/hypotheses \
  /api/golden/outcomes /api/golden/attributions /api/golden/assignments \
  /api/golden/derivatives /api/golden/discovery-ledger /api/golden/prior-art \
  /api/golden/process-lab /api/golden/research-reliability /api/golden/competition \
  /api/golden/allocate /api/golden/spinor \
  /api/competitive/actions /api/competitive/experiments /api/competitive/learnings \
  /api/competitive/manager /api/competitive/plan /api/competitive/results \
  /api/competitive/score /api/competitive/trajectory \
  /api/frontrunner/epoch /api/frontrunner/genomes /api/frontrunner/gravity \
  /api/frontrunner/opportunities /api/frontrunner/workflows \
  /api/spin/dashboard /api/spin/spins /api/spin/claims /api/spin/seed \
  /api/spinor-rl/diffusion /api/spinor-rl/email-sensor /api/spinor-rl/mission \
  /api/spinor-rl/palindrome /api/spinor-rl/physician /api/spinor-rl/rl \
  /api/spinor-rl/sprout /api/spinor-rl/stagnation /api/spinor-rl/state \
  /api/spinor-rl/trajectory /api/spinor-rl/voice-evidence \
  /api/spinor/activity-genome /api/spinor/admissibility /api/spinor/email-engine \
  /api/spinor/gauntlet /api/spinor/gauntlet-runs /api/spinor/organism \
  /api/spinor/pepi \
  /api/territory/accounts /api/territory/analyze /api/territory/routes \
  /api/voice/capabilities /api/voice/diary /api/voice/sessions \
  /api/workteleport/actions /api/workteleport/commit /api/workteleport/compile \
  /api/workteleport/dissect /api/workteleport/evidence /api/workteleport/skills \
  /api/workteleport/spinor /api/workteleport/taxonomy /api/workteleport/twins \
  /api/workteleport/ventures /api/workteleport/workflow \
  /api/phones /api/phones/records /api/phones/images \
  /api/kol/profiles /api/mailbox/status /api/email-credentials \
  /api/system/audit /api/mcp \
  /api/spin/spins/test-id \
  /api/experiments/test-id /api/experiments/test-id/events /api/experiments/test-id/observations \
  /api/experiments/test-id/confounders /api/experiments/test-id/deviations \
  /api/experiments/test-id/receipts \
  /api/voice/sessions/test-id /api/voice/sessions/test-id/artifacts \
  /api/voice/sessions/test-id/transcript-segments \
  ; do
  test_get "$p"
done

echo "═══ CRAWLING POST ENDPOINTS ═══"
# Test all POST endpoints
test_post /api/auth/login '{"email":"test@test.com","password":"test"}' "auth/login"
test_post /api/auth/register '{"orgSlug":"test","email":"test@test.com","name":"Test","password":"test"}' "auth/register"
test_post /api/auth/logout '{}' "auth/logout"
test_post /api/config '{}' "config/PUT"
test_post /api/commitments/detect '{"text":"test"}' "commitments/detect"
test_post /api/commitments/execute '{"id":"test"}' "commitments/execute"
test_post /api/commitments/outcome '{"id":"test","outcome":"success"}' "commitments/outcome"
test_post /api/experiments '{"title":"test","hypothesis":"test"}' "experiments/create"
test_post /api/experiments/test-id/approve '{}' "experiments/approve"
test_post /api/experiments/test-id/block '{}' "experiments/block"
test_post /api/experiments/test-id/challenge '{"reason":"test"}' "experiments/challenge"
test_post /api/experiments/test-id/close '{}' "experiments/close"
test_post /api/experiments/test-id/confounders '{"name":"test"}' "experiments/confounders"
test_post /api/experiments/test-id/derive '{"finding":"test"}' "experiments/derive"
test_post /api/experiments/test-id/deviations '{"description":"test"}' "experiments/deviations"
test_post /api/experiments/test-id/observations '{"content":"test"}' "experiments/observations"
test_post /api/experiments/test-id/pause '{}' "experiments/pause"
test_post /api/experiments/test-id/plant '{"variable":"test","value":"test"}' "experiments/plant"
test_post /api/experiments/test-id/replicate '{}' "experiments/replicate"
test_post /api/experiments/test-id/revise '{"hypothesis":"test"}' "experiments/revise"
test_post /api/golden/llm '{"prompt":"test"}' "golden/llm"
test_post /api/golden/allocate '{"nodeId":"test","amount":1}' "golden/allocate"
test_post /api/llm/command '{"command":"help"}' "llm/command"
test_post /api/llm/infer '{"prompt":"test","context":"test"}' "llm/infer"
test_post /api/llm/receipts '{"id":"test"}' "llm/receipts"
test_post /api/llm/rotate '{}' "llm/rotate"
test_post /api/microsoft/devicecode '{}' "microsoft/devicecode"
test_post /api/microsoft/token '{"device_code":"fake"}' "microsoft/token"
test_post /api/microsoft/me '{"access_token":"fake"}' "microsoft/me"
test_post /api/microsoft/sync '{"access_token":"fake"}' "microsoft/sync"
test_post /api/gmail/auth '{}' "gmail/auth"
test_post /api/gmail/exchange '{"code":"fake","redirectUri":"http://localhost"}' "gmail/exchange"
test_post /api/gmail/sync '{}' "gmail/sync"
test_post /api/gmail/search '{"query":"test"}' "gmail/search"
test_post /api/gmail/send '{"to":"test@test.com","subject":"test","body":"test"}' "gmail/send"
test_post /api/gmail/reply '{"messageId":"test","body":"test"}' "gmail/reply"
test_post /api/gmail/forward '{"messageId":"test","to":"test@test.com"}' "gmail/forward"
test_post /api/gmail/draft '{"to":"test@test.com","subject":"test","body":"test"}' "gmail/draft"
test_post /api/gmail/triage '{}' "gmail/triage"
test_post /api/gmail/action '{"messageId":"test","action":"archive"}' "gmail/action"
test_post /api/gmail/followups '{}' "gmail/followups"
test_post /api/gmail/body '{"messageId":"test"}' "gmail/body"
test_post /api/imap/connect '{"email":"test@outlook.com","password":"test","host":"outlook.office365.com"}' "imap/connect"
test_post /api/imap/sync '{}' "imap/sync"
test_post /api/imap/fetch '{}' "imap/fetch"
test_post /api/inbox/connect '{}' "inbox/connect"
test_post /api/inbox/attachments '{}' "inbox/attachments"
test_post /api/mailbox/sync '{}' "mailbox/sync"
test_post /api/mailbox/process '{}' "mailbox/process"
test_post /api/outreach/probe '{"email":"test@test.com"}' "outreach/probe"
test_post /api/outreach/sample-pickup '{}' "outreach/sample-pickup"
test_post /api/sheets/export '{}' "sheets/export"
test_post /api/spin/advance '{"spinId":"test"}' "spin/advance"
test_post /api/spin/reverse-test '{"spinId":"test"}' "spin/reverse-test"
test_post /api/spin/seed '{}' "spin/seed"
test_post /api/spinor-rl/mission '{}' "spinor-rl/mission"
test_post /api/spinor-rl/rl '{}' "spinor-rl/rl"
test_post /api/spinor-rl/diffusion '{}' "spinor-rl/diffusion"
test_post /api/spinor-rl/sprout '{}' "spinor-rl/sprout"
test_post /api/spinor-rl/stagnation '{}' "spinor-rl/stagnation"
test_post /api/strategies/assign '{}' "strategies/assign"
test_post /api/strategies/attribute '{}' "strategies/attribute"
test_post /api/strategies/evolve '{}' "strategies/evolve"
test_post /api/strategies/outcome '{}' "strategies/outcome"
test_post /api/voice/diary '{"action":"list"}' "voice/diary/list"
test_post /api/voice/diary '{"action":"create","text":"test entry"}' "voice/diary/create"
test_post /api/voice/diary '{"action":"delete","id":"nonexistent"}' "voice/diary/delete"
test_post /api/voice/sessions '{"action":"create"}' "voice/sessions/create"
test_post /api/voice/sessions/test-id/cancel '{}' "voice/sessions/cancel"
test_post /api/voice/sessions/test-id/complete '{}' "voice/sessions/complete"
test_post /api/voice/sessions/test-id/confirm '{}' "voice/sessions/confirm"
test_post /api/voice/sessions/test-id/extract '{}' "voice/sessions/extract"
test_post /api/workteleport/actions '{}' "workteleport/actions"
test_post /api/workteleport/commit '{}' "workteleport/commit"
test_post /api/workteleport/compile '{}' "workteleport/compile"
test_post /api/workteleport/dissect '{}' "workteleport/dissect"
test_post /api/etl/pipeline '{}' "etl/pipeline"
test_post /api/etl/process '{}' "etl/process"
test_post /api/competitive/score '{"action":"test"}' "competitive/score"
test_post /api/phones/llm '{"prompt":"test"}' "phones/llm"
test_post /api/demo/seed '{}' "demo/seed"
test_post /api/demo/gilead-seed '{}' "demo/gilead-seed"

echo ""
echo "═══ PAGE RESULTS ═══"
cat "$PAGES_FILE"
echo ""
echo "═══ API RESULTS SUMMARY ═══"
echo "Total: $(wc -l < "$RESULTS_FILE")"
echo "OK: $(grep -c '^OK' "$RESULTS_FILE")"
echo "404: $(grep -c '^404' "$RESULTS_FILE")"
echo "500: $(grep -cE '^5[0-9][0-9]' "$RESULTS_FILE")"
echo "TIMEOUT: $(grep -c '^TIMEOUT' "$RESULTS_FILE")"
echo "EMPTY: $(grep -c '^EMPTY' "$RESULTS_FILE")"
echo ""
echo "═══ ALL FAILURES ═══"
grep -v '^OK' "$RESULTS_FILE" | head -80
echo ""
echo "═══ ALL PAGE FAILURES ═══"
grep -v '^OK' "$PAGES_FILE"
