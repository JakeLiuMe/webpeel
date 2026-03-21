#!/bin/bash
# WebPeel End-to-End Feature Tests
# Tests features against the LIVE API (not local peel)
# Run after every deploy: ./scripts/test-e2e-features.sh
set -uo pipefail

API_KEY=$(node -e "console.log(require(require('os').homedir()+'/.webpeel/config.json').apiKey)" 2>/dev/null)
API="https://api.webpeel.dev"
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

# Helper: fetch via API, poll job if async, return result JSON
api_fetch() {
  local url_params="$1"
  local response=$(curl -s --max-time 15 "${API}/v1/fetch?${url_params}" \
    -H "Authorization: Bearer $API_KEY" 2>/dev/null)
  
  local poll_url=$(echo "$response" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).pollUrl||'')}catch{console.log('')}" 2>/dev/null)
  
  if [ -n "$poll_url" ] && [ "$poll_url" != "" ]; then
    sleep 12
    curl -s --max-time 10 "${API}${poll_url}" -H "Authorization: Bearer $API_KEY" 2>/dev/null | \
      node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(JSON.stringify(d.result||d))}catch{console.log('{}')}" 2>/dev/null
  else
    echo "$response"
  fi
}

echo "🧪 WebPeel E2E Feature Tests"
echo "============================"
echo ""

# 1. Basic fetch
echo "1. Basic Fetch"
RESULT=$(api_fetch "url=https://example.com")
METHOD=$(echo "$RESULT" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).method||'?')}catch{console.log('?')}" 2>/dev/null)
check "Example.com fetches" "simple" "$METHOD"

# 2. Domain API extractor
echo ""
echo "2. Domain API Extractor"
RESULT=$(api_fetch "url=https://news.ycombinator.com")
METHOD=$(echo "$RESULT" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).method||'?')}catch{console.log('?')}" 2>/dev/null)
check "HN uses domain-api" "domain-api" "$METHOD"

# 3. Skip domain API flag
echo ""
echo "3. --skip-domain-api (noDomainApi)"
RESULT=$(api_fetch "url=https://www.accuweather.com/en/us/new-york/10007/weather-forecast/349727&noDomainApi=true")
METHOD=$(echo "$RESULT" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).method||'?')}catch{console.log('?')}" 2>/dev/null)
HAS_ACCUWEATHER=$(echo "$RESULT" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log((d.content||'').includes('AccuWeather')?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
check "Bypasses domain extractor" "simple" "$METHOD"
check "Returns real AccuWeather" "yes" "$HAS_ACCUWEATHER"

# 4. Smart search
echo ""
echo "4. Smart Search"
SMART=$(curl -s --max-time 40 "${API}/v1/search/smart" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"q":"best ramen in brooklyn"}' 2>/dev/null)
TYPE=$(echo "$SMART" | node -e "try{console.log((JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).data||{}).type||'?')}catch{console.log('?')}" 2>/dev/null)
check "Restaurant intent" "restaurants" "$TYPE"

# 5. Affiliate redirect
echo ""
echo "5. Affiliate /go/ Redirect"
LOCATION=$(curl -sI "${API}/go?url=https://www.amazon.com/dp/B0D1" 2>/dev/null | grep -i "location:" | head -1)
check "Redirect includes tag" "tag=wp0b7-20" "$LOCATION"

# 6. RSS Feed
echo ""
echo "6. RSS Feed Discovery"
FEED=$(curl -s --max-time 10 "${API}/v1/feed?url=https://techcrunch.com&limit=2" \
  -H "Authorization: Bearer $API_KEY" 2>/dev/null)
FEED_OK=$(echo "$FEED" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).success?'yes':'no')}catch{console.log('no')}" 2>/dev/null)
check "Feed discovery works" "yes" "$FEED_OK"

# 7. Health
echo ""
echo "7. API Health"
HEALTH=$(curl -s "${API}/health" 2>/dev/null)
STATUS=$(echo "$HEALTH" | node -e "try{console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).status||'?')}catch{console.log('?')}" 2>/dev/null)
check "API healthy" "healthy" "$STATUS"

# Summary
echo ""
echo "============================"
echo "✅ Passed: $PASS"
echo "❌ Failed: $FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "🚨 E2E TESTS FAILED"
  exit 1
else
  echo "✅ ALL E2E TESTS PASSED"
fi
