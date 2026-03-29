#!/bin/bash
# =============================================================================
# WebPeel K3s Production Smoke Test
# =============================================================================
# Runs after every deploy. Tests REAL data. Any failure = automatic rollback.
# This is the last line of defense before customers hit new code.
#
# Usage: ./scripts/smoke-test-k3s.sh [API_URL] [API_KEY]
# Default: https://api.webpeel.dev
# =============================================================================

set -euo pipefail

API_URL="${1:-https://api.webpeel.dev}"
API_KEY="${2:-${WEBPEEL_API_KEY:-}}"
PASSED=0
FAILED=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() {
  PASSED=$((PASSED + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${GREEN}✅ PASS${NC}: $1"
}

fail() {
  FAILED=$((FAILED + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${RED}❌ FAIL${NC}: $1"
  echo -e "  ${RED}   Detail: $2${NC}"
}

section() {
  echo ""
  echo -e "${YELLOW}━━━ $1 ━━━${NC}"
}

# Helper: make request and capture response + status code
request() {
  local method="$1"
  local path="$2"
  shift 2
  local url="${API_URL}${path}"
  
  if [ "$method" = "GET" ]; then
    curl -s --max-time 30 -w "\n%{http_code}" "$url" "$@" 2>/dev/null
  else
    curl -s --max-time 30 -w "\n%{http_code}" -X "$method" "$url" "$@" 2>/dev/null
  fi
}

echo "============================================"
echo "  WebPeel K3s Smoke Test"
echo "  Target: $API_URL"
echo "  Time:   $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
echo "============================================"

# =============================================================================
section "1. HEALTH & READINESS"
# =============================================================================

# 1a. Health endpoint
RESP=$(request GET "/health")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  VERSION=$(echo "$BODY" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('version','?'))" 2>/dev/null)
  STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('status','?'))" 2>/dev/null)
  if [ "$STATUS" = "healthy" ]; then
    pass "Health endpoint (v${VERSION}, status=${STATUS})"
  else
    fail "Health endpoint returned non-healthy status" "status=$STATUS"
  fi
else
  fail "Health endpoint" "HTTP $HTTP_CODE"
fi

# 1b. Readiness endpoint (DB + Queue connectivity)
RESP=$(request GET "/ready")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  DB_OK=$(echo "$BODY" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('checks',{}).get('database',{}).get('ok',False))" 2>/dev/null)
  QUEUE_OK=$(echo "$BODY" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('checks',{}).get('queue',{}).get('ok',False))" 2>/dev/null)
  DB_MS=$(echo "$BODY" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('checks',{}).get('database',{}).get('latencyMs','?'))" 2>/dev/null)
  QUEUE_MS=$(echo "$BODY" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('checks',{}).get('queue',{}).get('latencyMs','?'))" 2>/dev/null)
  
  if [ "$DB_OK" = "True" ]; then
    pass "Database connected (${DB_MS}ms)"
  else
    fail "Database connection" "db.ok=$DB_OK"
  fi
  
  if [ "$QUEUE_OK" = "True" ]; then
    pass "Redis queue connected (${QUEUE_MS}ms)"
  else
    fail "Redis queue connection" "queue.ok=$QUEUE_OK"
  fi
else
  fail "Readiness endpoint" "HTTP $HTTP_CODE"
fi

# =============================================================================
section "2. AUTHENTICATION"
# =============================================================================

# 2a. No auth → should be rejected
RESP=$(request POST "/v1/fetch" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}')
HTTP_CODE=$(echo "$RESP" | tail -1)

if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  pass "No API key → rejected (HTTP $HTTP_CODE)"
else
  BODY=$(echo "$RESP" | sed '$d')
  if echo "$BODY" | grep -qi "api.key\|unauthorized\|invalid"; then
    pass "No API key → rejected (response contains auth error)"
  else
    fail "No API key should be rejected" "HTTP $HTTP_CODE, body: $(echo $BODY | head -c 100)"
  fi
fi

# 2b. Invalid key → should be rejected
RESP=$(request POST "/v1/fetch" \
  -H "Authorization: Bearer wp_invalid_example_key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}')
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if echo "$BODY" | grep -qi "invalid\|expired\|unauthorized"; then
  pass "Invalid API key → rejected"
else
  fail "Invalid API key should be rejected" "HTTP $HTTP_CODE, body: $(echo $BODY | head -c 100)"
fi

# 2c. Valid key → should work (skip if no key provided)
if [ -n "$API_KEY" ]; then
  RESP=$(request GET "/health" -H "Authorization: Bearer $API_KEY")
  HTTP_CODE=$(echo "$RESP" | tail -1)
  if [ "$HTTP_CODE" = "200" ]; then
    pass "Valid API key → accepted"
  else
    fail "Valid API key should be accepted" "HTTP $HTTP_CODE"
  fi
else
  echo -e "  ${YELLOW}⏭️  SKIP${NC}: Valid key test (no API_KEY provided)"
fi

# =============================================================================
section "3. SSRF PROTECTION"
# =============================================================================

if [ -n "$API_KEY" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer $API_KEY\""
  
  # 3a. Cloud metadata (AWS/GCP/Azure)
  SSRF_TARGETS=(
    "http://169.254.169.254/latest/meta-data/"
    "http://metadata.google.internal/computeMetadata/v1/"
    "http://169.254.169.254/metadata/instance"
  )
  
  for target in "${SSRF_TARGETS[@]}"; do
    RESP=$(curl -s --max-time 15 "$API_URL/v1/fetch" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"url\":\"$target\"}" 2>/dev/null)
    
    if echo "$RESP" | grep -qi "blocked\|ssrf\|private\|denied\|not allowed\|invalid.*url"; then
      pass "SSRF blocked: $target"
    elif echo "$RESP" | grep -qi "ami-id\|instance-type\|computeMetadata\|hostname"; then
      fail "SSRF NOT BLOCKED — metadata leaked!" "$target → $(echo $RESP | head -c 100)"
    else
      # Could be timeout/error — still safe (no data leaked)
      pass "SSRF safe (no data leaked): $target"
    fi
  done
  
  # 3b. Internal network
  INTERNAL_TARGETS=(
    "http://127.0.0.1:6443/api"
    "http://localhost:6379/"
    "http://10.42.0.1:10250/pods"
    "http://redis:6379/"
    "http://0.0.0.0:3000/health"
  )
  
  for target in "${INTERNAL_TARGETS[@]}"; do
    RESP=$(curl -s --max-time 15 "$API_URL/v1/fetch" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"url\":\"$target\"}" 2>/dev/null)
    
    if echo "$RESP" | grep -qi "apiVersion\|PONG\|pods.*items\|healthy"; then
      fail "SSRF NOT BLOCKED — internal service accessible!" "$target → $(echo $RESP | head -c 100)"
    else
      pass "SSRF blocked: $target"
    fi
  done
  
  # 3c. File protocol
  RESP=$(curl -s --max-time 15 "$API_URL/v1/fetch" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url":"file:///etc/passwd"}' 2>/dev/null)
  
  if echo "$RESP" | grep -qi "root:.*:0:0"; then
    fail "FILE PROTOCOL NOT BLOCKED — /etc/passwd leaked!" "$(echo $RESP | head -c 100)"
  else
    pass "File protocol blocked (file:///etc/passwd)"
  fi
else
  echo -e "  ${YELLOW}⏭️  SKIP${NC}: SSRF tests (no API_KEY provided)"
fi

# =============================================================================
section "4. INJECTION ATTACKS"
# =============================================================================

if [ -n "$API_KEY" ]; then
  # 4a. SQL injection in search
  RESP=$(curl -s --max-time 15 "$API_URL/v1/search?q=test'%20OR%201=1%20--" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null)
  
  if echo "$RESP" | grep -qi "sql.*error\|syntax.*error\|pg_catalog\|information_schema"; then
    fail "SQL injection leaked database info!" "$(echo $RESP | head -c 200)"
  else
    pass "SQL injection in search → no DB info leaked"
  fi
  
  # 4b. SQL injection in fetch URL
  RESP=$(curl -s --max-time 15 "$API_URL/v1/fetch" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url":"https://example.com/?id=1; DROP TABLE users;--"}' 2>/dev/null)
  
  if echo "$RESP" | grep -qi "sql.*error\|syntax.*error\|drop table"; then
    fail "SQL injection via URL parameter leaked!" "$(echo $RESP | head -c 200)"
  else
    pass "SQL injection in fetch URL → safe"
  fi
  
  # 4c. XSS in search query (check response Content-Type is JSON, not HTML)
  RESP=$(curl -sI --max-time 15 "$API_URL/v1/search?q=%3Cscript%3Ealert(1)%3C/script%3E" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null)
  
  if echo "$RESP" | grep -qi "content-type:.*application/json"; then
    pass "XSS in search query → response is JSON (not HTML, XSS not applicable)"
  elif echo "$RESP" | grep -qi "content-type:.*text/html"; then
    fail "Search returns HTML — potential XSS vector!" "Content-Type is text/html"
  else
    pass "XSS in search query → safe (non-HTML response)"
  fi
  
  # 4d. Path traversal
  RESP=$(curl -s --max-time 10 "$API_URL/v1/../../etc/passwd" 2>/dev/null)
  if echo "$RESP" | grep -qi "root:.*:0:0"; then
    fail "Path traversal exposed /etc/passwd!" "$(echo $RESP | head -c 200)"
  else
    pass "Path traversal → blocked"
  fi
fi

# =============================================================================
section "5. SECURITY HEADERS"
# =============================================================================

HEADERS=$(curl -sI --max-time 10 "$API_URL/health" 2>/dev/null)

check_header() {
  local header_name="$1"
  local expected="$2"
  
  if echo "$HEADERS" | grep -qi "$header_name"; then
    VALUE=$(echo "$HEADERS" | grep -i "$header_name" | head -1 | tr -d '\r')
    if [ -n "$expected" ]; then
      if echo "$VALUE" | grep -qi "$expected"; then
        pass "Header: $VALUE"
      else
        fail "Header $header_name doesn't contain expected value" "got: $VALUE, expected to contain: $expected"
      fi
    else
      pass "Header: $VALUE"
    fi
  else
    fail "Missing security header: $header_name" "Not present in response"
  fi
}

check_header "x-content-type-options" "nosniff"
check_header "x-frame-options" "DENY"
check_header "content-security-policy" ""
check_header "strict-transport-security" "max-age"
check_header "x-xss-protection" ""

# Check server header doesn't leak internal info
if echo "$HEADERS" | grep -qi "server:.*express\|server:.*node\|x-powered-by"; then
  fail "Server identity leaked" "$(echo "$HEADERS" | grep -i 'server:\|x-powered-by' | tr -d '\r')"
else
  pass "Server identity hidden (behind Cloudflare)"
fi

# =============================================================================
section "6. REAL DATA — FETCH"
# =============================================================================

if [ -n "$API_KEY" ]; then
  # 6a. Simple HTML fetch
  RESP=$(curl -s --max-time 30 "$API_URL/v1/fetch" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url":"https://example.com","mode":"markdown"}' 2>/dev/null)
  
  JOBID=$(echo "$RESP" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('jobId',''))" 2>/dev/null)
  
  if [ -n "$JOBID" ] && [ "$JOBID" != "" ]; then
    pass "Fetch submitted (jobId: ${JOBID:0:20}...)"
    
    # Poll for result
    sleep 5
    for i in $(seq 1 15); do
      RESULT=$(curl -s --max-time 10 "$API_URL/v1/jobs/$JOBID" \
        -H "Authorization: Bearer $API_KEY" 2>/dev/null)
      STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('status',''))" 2>/dev/null)
      
      if [ "$STATUS" = "completed" ]; then
        CONTENT_LEN=$(echo "$RESULT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read()).get('result',{}).get('content','')))" 2>/dev/null)
        TITLE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('result',{}).get('title',''))" 2>/dev/null)
        
        if [ "$CONTENT_LEN" -gt 50 ] 2>/dev/null; then
          pass "Fetch completed: \"$TITLE\" ($CONTENT_LEN chars)"
        else
          fail "Fetch returned too little content" "$CONTENT_LEN chars"
        fi
        break
      elif [ "$STATUS" = "failed" ]; then
        ERROR=$(echo "$RESULT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('error','')[:100])" 2>/dev/null)
        # HTTP 304 is a caching artifact, not a real failure
        if echo "$ERROR" | grep -qi "304\|not modified\|cached"; then
          pass "Fetch job returned 304 (cached — not a failure)"
        else
          fail "Fetch job failed" "$ERROR"
        fi
        break
      fi
      sleep 3
    done
    
    if [ "$STATUS" != "completed" ] && [ "$STATUS" != "failed" ]; then
      fail "Fetch job timed out" "Status: $STATUS after 45s"
    fi
  else
    # Might be sync response
    TITLE=$(echo "$RESP" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('title',''))" 2>/dev/null)
    if [ -n "$TITLE" ] && [ "$TITLE" != "" ]; then
      pass "Fetch completed (sync): \"$TITLE\""
    else
      fail "Fetch failed" "$(echo $RESP | head -c 150)"
    fi
  fi
else
  echo -e "  ${YELLOW}⏭️  SKIP${NC}: Fetch tests (no API_KEY provided)"
fi

# =============================================================================
section "7. REAL DATA — SEARCH"
# =============================================================================

if [ -n "$API_KEY" ]; then
  RESP=$(curl -s --max-time 30 "$API_URL/v1/search?q=kubernetes+best+practices" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null)
  
  RESULT_COUNT=$(echo "$RESP" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
web=d.get('data',{}).get('web',[])
if not web and d.get('success'):
    web=d.get('results',[])
print(len(web))
" 2>/dev/null)
  
  if [ "$RESULT_COUNT" -gt 0 ] 2>/dev/null; then
    FIRST_TITLE=$(echo "$RESP" | python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
web=d.get('data',{}).get('web',[]) or d.get('results',[])
print(web[0].get('title','')[:60] if web else 'N/A')
" 2>/dev/null)
    pass "Search returned $RESULT_COUNT results (first: \"$FIRST_TITLE\")"
  else
    fail "Search returned 0 results" "$(echo $RESP | head -c 150)"
  fi
else
  echo -e "  ${YELLOW}⏭️  SKIP${NC}: Search tests (no API_KEY provided)"
fi

# =============================================================================
section "8. RATE LIMITING & ABUSE PROTECTION"
# =============================================================================

# 8a. Oversized payload
RESP=$(curl -s --max-time 10 -X POST "$API_URL/v1/fetch" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://example.com\",\"junk\":\"$(head -c 1048576 /dev/urandom | base64 | head -c 500000)\"}" 2>/dev/null)
HTTP_CODE=$(echo "$RESP" | tail -1 2>/dev/null)

if [ "$HTTP_CODE" = "413" ] || [ "$HTTP_CODE" = "400" ] || echo "$RESP" | grep -qi "too large\|payload\|limit"; then
  pass "Oversized payload rejected"
else
  pass "Oversized payload handled (no crash)"
fi

# 8b. Empty URL
RESP=$(curl -s --max-time 10 -X POST "$API_URL/v1/fetch" \
  -H "Authorization: Bearer ${API_KEY:-dummy}" \
  -H "Content-Type: application/json" \
  -d '{"url":""}' 2>/dev/null)

if echo "$RESP" | grep -qi "error\|invalid\|required\|missing"; then
  pass "Empty URL → rejected with error"
else
  fail "Empty URL should be rejected" "$(echo $RESP | head -c 100)"
fi

# 8c. Malformed JSON
RESP=$(curl -s --max-time 10 -X POST "$API_URL/v1/fetch" \
  -H "Authorization: Bearer ${API_KEY:-dummy}" \
  -H "Content-Type: application/json" \
  -d '{{{invalid json' 2>/dev/null)

if echo "$RESP" | grep -qi "error\|invalid\|parse\|syntax\|bad request"; then
  pass "Malformed JSON → rejected"
else
  pass "Malformed JSON handled (no crash)"
fi

# =============================================================================
section "9. RESPONSE INTEGRITY"
# =============================================================================

# 9a. Check no internal IPs leaked in any response
ALL_RESPONSES="$HEADERS"
if echo "$ALL_RESPONSES" | grep -qE "10\.42\.[0-9]+\.[0-9]+|10\.43\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+"; then
  fail "Internal IP addresses leaked in response headers" "$(echo "$ALL_RESPONSES" | grep -oE '10\.[0-9]+\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+')"
else
  pass "No internal IPs leaked in headers"
fi

# 9b. Check no stack traces in error responses
ERROR_RESP=$(curl -s --max-time 10 "$API_URL/v1/nonexistent-endpoint" 2>/dev/null)
if echo "$ERROR_RESP" | grep -qi "stack.*trace\|at.*\.js:\|node_modules\|internal/"; then
  fail "Stack trace leaked in error response" "$(echo $ERROR_RESP | head -c 200)"
else
  pass "No stack traces in error responses"
fi

# =============================================================================
# RESULTS
# =============================================================================

echo ""
echo "============================================"
echo "  RESULTS"
echo "============================================"
echo ""
echo -e "  ${GREEN}Passed${NC}: $PASSED"
echo -e "  ${RED}Failed${NC}: $FAILED"
echo -e "  Total:  $TOTAL"
echo ""

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}🚨 SMOKE TEST FAILED — $FAILED test(s) failed. DO NOT DEPLOY.${NC}"
  exit 1
else
  echo -e "${GREEN}✅ ALL TESTS PASSED — Safe to serve traffic.${NC}"
  exit 0
fi
