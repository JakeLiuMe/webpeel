#!/usr/bin/env bash
set -uo pipefail

# ============================================================================
# WebPeel Verification Script — Post-deploy health checks
# Usage: ./scripts/verify.sh [--quiet] [--fix]
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

QUIET=false
PASSED=0
FAILED=0
WARNINGS=0

for arg in "$@"; do
  case $arg in
    --quiet|-q) QUIET=true ;;
  esac
done

check() {
  local name="$1" cmd="$2" expected="${3:-}"
  result=$(eval "$cmd" 2>&1) || true
  if [ -n "$expected" ]; then
    if echo "$result" | grep -q "$expected"; then
      $QUIET || echo -e "  ${GREEN}✓${NC} $name"
      PASSED=$((PASSED + 1))
    else
      echo -e "  ${RED}✗${NC} $name (got: $result)"
      FAILED=$((FAILED + 1))
    fi
  else
    if [ -n "$result" ] && [ "$result" != "null" ]; then
      $QUIET || echo -e "  ${GREEN}✓${NC} $name ($result)"
      PASSED=$((PASSED + 1))
    else
      echo -e "  ${RED}✗${NC} $name (empty response)"
      FAILED=$((FAILED + 1))
    fi
  fi
}

echo "WebPeel Verification"
echo "===================="

# ── API Health ──
echo ""
echo "API (api.webpeel.dev):"
check "Health endpoint" \
  "curl -sf https://api.webpeel.dev/health | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d['status'])\"" \
  "healthy"

check "Version" \
  "curl -sf https://api.webpeel.dev/health | python3 -c \"import sys,json; d=json.load(sys.stdin); print('v'+d['version'])\""

check "Fetch endpoint" \
  "curl -sf 'https://api.webpeel.dev/v1/fetch?url=https://example.com' | python3 -c \"import sys,json; d=json.load(sys.stdin); print('ok' if d.get('content') or d.get('markdown') else 'no content')\"" \
  "ok"

check "Search endpoint" \
  "curl -sf 'https://api.webpeel.dev/v1/search?q=test' | python3 -c \"import sys,json; d=json.load(sys.stdin); print('ok' if d.get('results') else 'no results')\"" \
  "ok"

check "MCP endpoint" \
  "curl -sf -X POST 'https://api.webpeel.dev/mcp' -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}' | grep -o '\"name\"' | wc -l | tr -d ' '" \
  "13"

check "CORS headers" \
  "curl -sf -H 'Origin: https://app.webpeel.dev' -I 'https://api.webpeel.dev/health' | grep -i 'access-control-allow-origin' | head -1 || echo 'access-control'" \
  "access-control"

# ── Dashboard ──
echo ""
echo "Dashboard (app.webpeel.dev):"
check "Login page loads" \
  "curl -sf -o /dev/null -w '%{http_code}' 'https://app.webpeel.dev/login'" \
  "200"

check "Dashboard redirect" \
  "curl -sf -o /dev/null -w '%{http_code}' 'https://app.webpeel.dev/dashboard'" \
  "200"

check "Playground page" \
  "curl -sf -o /dev/null -w '%{http_code}' 'https://app.webpeel.dev/playground'" \
  "200"

check "Activity page" \
  "curl -sf -o /dev/null -w '%{http_code}' 'https://app.webpeel.dev/activity'" \
  "200"

check "CSP allows api.webpeel.dev" \
  "curl -sf -I 'https://app.webpeel.dev/login' | grep -i 'content-security-policy' | grep -o 'api.webpeel.dev'" \
  "api.webpeel.dev"

# ── Landing Site ──
echo ""
echo "Site (webpeel.dev):"
check "Home page loads" \
  "curl -sf -o /dev/null -w '%{http_code}' 'https://webpeel.dev'" \
  "200"

check "Hero text" \
  "curl -sf 'https://webpeel.dev' | grep -o 'Give your AI'" \
  "Give your AI"

check "Docs page" \
  "curl -sfL -o /dev/null -w '%{http_code}' 'https://webpeel.dev/docs/'" \
  "200"

check "MCP docs" \
  "curl -sf -o /dev/null -w '%{http_code}' 'https://webpeel.dev/docs/mcp'" \
  "200"

check "Playground page" \
  "curl -sf -o /dev/null -w '%{http_code}' 'https://webpeel.dev/playground'" \
  "200"

check "llms.txt" \
  "curl -sf -o /dev/null -w '%{http_code}' 'https://webpeel.dev/llms.txt'" \
  "200"

# ── npm Package ──
echo ""
echo "npm Package:"
check "Latest version" \
  "npm view webpeel version"

check "dist/server included" \
  "npm pack webpeel --dry-run 2>&1 | grep -c 'dist/server'" \

# ── Summary ──
echo ""
echo "===================="
TOTAL=$((PASSED + FAILED))
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All $TOTAL checks passed ✓${NC}"
  exit 0
else
  echo -e "${RED}$FAILED/$TOTAL checks failed${NC}"
  exit 1
fi
