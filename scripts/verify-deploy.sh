#!/usr/bin/env bash
# Post-deploy verification — tests real production endpoints
set -uo pipefail

API_KEY=$(node -e "console.log(require(require('os').homedir()+'/.webpeel/config.json').apiKey)" 2>/dev/null)
API_URL="https://api.webpeel.dev"
PASS=0
FAIL=0
EXPECTED_VER=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")

echo "═══════════════════════════════════════════════"
echo "  WebPeel Deploy Verification"
echo "  Expected version: $EXPECTED_VER"
echo "═══════════════════════════════════════════════"
echo ""

if [ -z "$API_KEY" ]; then
  echo "  ⚠️  No API key found at ~/.webpeel/config.json"
  echo "  Endpoint tests will fail without auth."
  echo ""
fi

# Poll a job until completed/failed (max 30s)
poll_job() {
  local poll_url="$1"
  local max_wait=30
  local elapsed=0
  while [ "$elapsed" -lt "$max_wait" ]; do
    local resp=$(curl -s --max-time 10 "${API_URL}${poll_url}" -H "Authorization: Bearer $API_KEY" 2>/dev/null)
    local status=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null)
    if [ "$status" = "completed" ]; then
      echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('result', d)))" 2>/dev/null
      return 0
    elif [ "$status" = "failed" ]; then
      echo '{"error":"job_failed"}'
      return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo '{"error":"timeout"}'
  return 1
}

# Fetch via API — handles both sync and async (job queue) responses
fetch_url() {
  local url="$1"
  local initial=$(curl -s --max-time 15 "$API_URL/v1/fetch?url=$url" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null)
  local poll_url=$(echo "$initial" | python3 -c "import sys,json; print(json.load(sys.stdin).get('pollUrl',''))" 2>/dev/null)

  if [ -n "$poll_url" ] && [ "$poll_url" != "" ]; then
    poll_job "$poll_url"
  else
    echo "$initial"
  fi
}

# Check helper
check() {
  local label="$1"
  local min_words="$2"
  local url="$3"

  local result=$(fetch_url "$url")

  local method=$(echo "$result" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).method||'?')}catch{console.log('ERR')}" 2>/dev/null)
  local words=$(echo "$result" | node -e "try{const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(r.content?.trim().split(/\s+/).length||0)}catch{console.log(0)}" 2>/dev/null)
  local elapsed=$(echo "$result" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).elapsed||'?')}catch{console.log('?')}" 2>/dev/null)

  local status="❌"
  if [ "$words" -ge "$min_words" ] 2>/dev/null; then
    status="✅"
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi

  printf "  %s %-16s %-12s %4sw  %sms\n" "$status" "$label" "$method" "$words" "$elapsed"
}

# Health check
echo "▶ Health Check"
HEALTH=$(curl -s --max-time 5 "$API_URL/health" 2>/dev/null)
LIVE_VER=$(echo "$HEALTH" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version)}catch{console.log('DOWN')}" 2>/dev/null)
if [ "$LIVE_VER" = "$EXPECTED_VER" ]; then
  echo "  ✅ Version $LIVE_VER matches expected"
  PASS=$((PASS + 1))
elif [ "$LIVE_VER" = "DOWN" ]; then
  echo "  ❌ Server is DOWN (502)"
  FAIL=$((FAIL + 1))
else
  echo "  ⚠️  Version mismatch: live=$LIVE_VER expected=$EXPECTED_VER"
  FAIL=$((FAIL + 1))
fi
echo ""

# Endpoint tests
echo "▶ Endpoint Tests"
check "example.com"     10  "https://example.com"
check "github/react"    20  "https://github.com/facebook/react"
check "wikipedia/dog"   100 "https://en.wikipedia.org/wiki/Dog"
check "npm/express"     50  "https://www.npmjs.com/package/express"
check "hackernews"      100 "https://news.ycombinator.com"
check "arxiv"           50  "https://arxiv.org/abs/2501.00001"
check "pypi/requests"   50  "https://pypi.org/project/requests/"
check "youtube"         50  "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
echo ""

# Search test
echo "▶ Search Test"
SEARCH_RESULT=$(curl -s --max-time 10 "$API_URL/v1/search?q=javascript+framework" \
  -H "Authorization: Bearer $API_KEY" 2>/dev/null)
SEARCH_COUNT=$(echo "$SEARCH_RESULT" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.data?.web?.length||0)}catch{console.log(0)}" 2>/dev/null)
if [ "$SEARCH_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ✅ Search returned $SEARCH_COUNT results"
  PASS=$((PASS + 1))
else
  echo "  ❌ Search returned 0 results"
  FAIL=$((FAIL + 1))
fi
echo ""

# Summary
echo "═══════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "  Result: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
  echo "  ⚠️  $FAIL test(s) FAILED"
  exit 1
else
  echo "  ✅ All tests passed!"
  exit 0
fi
