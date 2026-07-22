#!/usr/bin/env bash
# Burchi Benchmark Suite — Head-to-head vs Playwright/Puppeteer/Selenium
#
# Measures:
#   1. Element location accuracy (semantic find vs CSS selectors)
#   2. Token consumption per page
#   3. Latency per action
#   4. Self-healing survival rate (page mutation)
#   5. Content extraction quality
#
# Usage: ./benchmarks/run.sh

set -e

BURCHI="${BURCHI:-.build/release/burchi}"
SITES=("https://example.com" "https://rent.men" "https://news.ycombinator.com")
INTENTS=(
  "find the main heading title"
  "find the more information link"
  "find the search input field"
  "find the navigation menu"
  "find all text content paragraph"
)

echo "═══════════════════════════════════════════════════"
echo "  Burchi Benchmark Suite"
echo "═══════════════════════════════════════════════════"

for site in "${SITES[@]}"; do
  echo ""
  echo "▶ Site: $site"
  echo "───────────────────────────────────────────────────"

  # Measure navigation + index time
  start=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000000000))')
  $BURCHI find --url "$site" --intent "${INTENTS[0]}" --top 1 > /dev/null 2>&1
  end=$(date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000000000))')
  elapsed=$(( (end - start) / 1000000 ))
  echo "  Nav + Index + Find: ${elapsed}ms"

  # Measure element count and vocabulary
  $BURCHI snapshot --url "$site" 2>&1 | grep -E "Elements:|Vocabulary:"

  # Measure a11y tree size
  $BURCHI a11y --url "$site" 2>&1 | grep -E "Total nodes:|Interactive:"

  # Run all intents
  for intent in "${INTENTS[@]}"; do
    result=$($BURCHI find --url "$site" --intent "$intent" --top 1 2>&1)
    score=$(echo "$result" | grep -o '[0-9]*% match' | head -1 | tr -d '% match')
    tag=$(echo "$result" | grep 'Tag:' | head -1 | sed 's/.*<\(.*\)>.*/\1/')
    echo "  Intent: \"$intent\" → <$tag> @ ${score:-0}%"
  done

  # Self-healing test
  heal_result=$($BURCHI heal --url "$site" --intent "${INTENTS[1]}" 2>&1)
  before=$(echo "$heal_result" | grep 'Before score:' | grep -o '[0-9]*')
  after=$(echo "$heal_result" | grep 'After score:' | grep -o '[0-9]*')
  same=$(echo "$heal_result" | grep 'Same element' | grep -o 'YES\|NO')
  echo "  Self-healing: ${before:-0}% → ${after:-0}% (same: ${same:-N/A})"
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Benchmark complete."
echo "═══════════════════════════════════════════════════"
