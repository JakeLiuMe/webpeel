#!/bin/bash
# synthetic-monitor.sh — Real-user simulation, runs every 5 min via cron
# Alerts to Discord webhook on any failure
set -euo pipefail

API_URL="https://api.webpeel.dev"
API_KEY="${WEBPEEL_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
  echo "Missing WEBPEEL_API_KEY." >&2
  exit 1
fi
DISCORD_WEBHOOK="${DISCORD_WEBHOOK_URL:-}"
FAIL=0
RESULTS=""

check() {
  local name="$1"
  local cmd="$2"
  local expect="$3"

  START=$(date +%s%N)
  RESULT=$(eval "$cmd" 2>/dev/null) || RESULT=""
  END=$(date +%s%N)
  MS=$(( (END - START) / 1000000 ))

  if echo "$RESULT" | grep -q "$expect"; then
    RESULTS="${RESULTS}✅ ${name} (${MS}ms)\n"
  else
    RESULTS="${RESULTS}❌ ${name} (${MS}ms) — expected '$expect'\n"
    FAIL=1
  fi
}

# Test 1: Health check
check "Health" "curl -sf --max-time 10 ${API_URL}/health" '"status":"healthy"'

# Test 2: GET /v1/fetch (what CLI users do)
check "GET fetch" "curl -sf --max-time 15 -H 'Authorization: Bearer ${API_KEY}' '${API_URL}/v1/fetch?url=https://example.com'" '"success":true'

# Test 3: POST /v1/fetch (what API users do)
check "POST fetch" "curl -sf --max-time 15 -H 'Authorization: Bearer ${API_KEY}' -H 'Content-Type: application/json' -d '{\"url\":\"https://example.com\"}' ${API_URL}/v1/fetch" '"success":true'

# Test 4: Search
check "Search" "curl -sf --max-time 15 -H 'Authorization: Bearer ${API_KEY}' '${API_URL}/v1/search?q=test'" '"success":true'

# Test 5: Auth rejection (no key should get 401)
check "Auth reject" "curl -s --max-time 10 ${API_URL}/v1/fetch?url=https://example.com" '"unauthorized"'

# Test 6: Job polling requires auth
check "Job auth" "curl -s --max-time 10 ${API_URL}/v1/jobs/fake-id" '"unauthorized"'

# Output
echo -e "$RESULTS"

if [ $FAIL -ne 0 ] && [ -n "$DISCORD_WEBHOOK" ]; then
  # Send Discord alert
  ALERT="🚨 **WebPeel Synthetic Monitor FAILED**\n$(echo -e "$RESULTS" | grep '❌')\n\nTime: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  curl -sf -H "Content-Type: application/json" \
    -d "{\"content\":\"${ALERT}\"}" \
    "$DISCORD_WEBHOOK" > /dev/null 2>&1 || true
fi

exit $FAIL
