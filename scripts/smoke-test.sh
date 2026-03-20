#!/bin/bash
# WebPeel Post-Deploy Smoke Test
# Run after every deploy: ./scripts/smoke-test.sh
API="https://api.webpeel.dev"
API_KEY=$(node -e "console.log(require(require('os').homedir()+'/.webpeel/config.json').apiKey)" 2>/dev/null)
PASS=0
FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  ✅ $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

# Poll a job until completed/failed (max 30s)
poll_job() {
  local poll_url="$1"
  local max_wait=30
  local elapsed=0
  while [ "$elapsed" -lt "$max_wait" ]; do
    local resp=$(curl -s --max-time 10 "${API}${poll_url}" -H "Authorization: Bearer $API_KEY" 2>/dev/null)
    local status=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null)
    if [ "$status" = "completed" ]; then
      # Return the result object
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

# Fetch via API with async job polling
fetch_url() {
  local url="$1"
  local extra_params="$2"
  local initial=$(curl -s --max-time 10 "${API}/v1/fetch?url=${url}${extra_params}" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null)
  local poll_url=$(echo "$initial" | python3 -c "import sys,json; print(json.load(sys.stdin).get('pollUrl',''))" 2>/dev/null)

  if [ -n "$poll_url" ] && [ "$poll_url" != "" ]; then
    # Async mode — poll for result
    poll_job "$poll_url"
  else
    # Sync mode — result is inline
    echo "$initial"
  fi
}

echo "🔍 WebPeel Smoke Test"
echo "===================="
if [ -z "$API_KEY" ]; then
  echo "  ⚠️  No API key found at ~/.webpeel/config.json — auth tests will fail"
fi

# 1. Health
echo ""
echo "1. Health"
HEALTH=$(curl -s "$API/health")
VERSION=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null)
check "API healthy" "healthy" "$STATUS"
echo "  ℹ️  Version: $VERSION"

# 2. Auth enforcement (unauthenticated requests should be rejected)
echo ""
echo "2. Auth Enforcement"
NOAUTH_SEARCH=$(curl -s "$API/v1/search?q=test" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('type','none') if isinstance(json.load(open('/dev/stdin')).get('error'), dict) else json.load(open('/dev/stdin')).get('error','none'))" 2>/dev/null)
# Retry with simpler parse
NOAUTH_SEARCH=$(curl -s "$API/v1/search?q=test" | python3 -c "
import sys, json
d = json.load(sys.stdin)
e = d.get('error', {})
print(e.get('type', 'none') if isinstance(e, dict) else e)
" 2>/dev/null)
check "Search requires auth" "authentication_required" "$NOAUTH_SEARCH"

NOAUTH_MCP=$(curl -s -X POST "$API/mcp" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -c "
import sys, json
d = json.load(sys.stdin)
e = d.get('error', {})
print(e.get('type', 'none') if isinstance(e, dict) else e)
" 2>/dev/null)
check "MCP requires auth" "authentication_required" "$NOAUTH_MCP"

# 3. SSRF protection (these don't need auth — tested via unauth rejection or direct block)
echo ""
echo "3. SSRF Protection"
SSRF_LOCAL=$(curl -s "$API/v1/fetch?url=http://localhost:3000" \
  -H "Authorization: Bearer $API_KEY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
e = d.get('error', {})
print(e.get('type', 'none') if isinstance(e, dict) else e)
" 2>/dev/null)
check "SSRF localhost blocked" "forbidden" "$SSRF_LOCAL"

SSRF_META=$(curl -s "$API/v1/fetch?url=http://169.254.169.254/" \
  -H "Authorization: Bearer $API_KEY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
e = d.get('error', {})
print(e.get('type', 'none') if isinstance(e, dict) else e)
" 2>/dev/null)
check "SSRF metadata blocked" "forbidden" "$SSRF_META"

# 4. Authenticated fetch (polls job if async)
echo ""
echo "4. Core Functionality"
FETCH_RESULT=$(fetch_url "https://example.com" "")
TITLE=$(echo "$FETCH_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('title','?'))" 2>/dev/null)
check "Simple fetch works" "Example Domain" "$TITLE"

# Use a JS-heavy site for render test (example.com is too simple — API skips browser)
RENDER_RESULT=$(fetch_url "https://react.dev" "&render=true")
RENDER_TITLE=$(echo "$RENDER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('title','?'))" 2>/dev/null)
check "Browser render works" "React" "$RENDER_TITLE"

# 5. Websites
echo ""
echo "5. Websites"
SITE=$(curl -s -o /dev/null -w "%{http_code}" "https://webpeel.dev")
check "webpeel.dev" "200" "$SITE"

DASH=$(curl -s -o /dev/null -w "%{http_code}" "https://app.webpeel.dev")
check "app.webpeel.dev" "307" "$DASH"

# 6. Content consistency
echo ""
echo "6. Content Consistency"
PKG_VER=$(python3 -c "import json; print(json.load(open('package.json'))['version'])" 2>/dev/null)
check "API version matches package.json" "$PKG_VER" "$VERSION"

# Summary
echo ""
echo "===================="
echo "✅ Passed: $PASS"
echo "❌ Failed: $FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "🚨 SMOKE TEST FAILED — DO NOT PROCEED"
  exit 1
else
  echo "✅ ALL CLEAR"
fi
