#!/bin/bash
# npm-experience-check.sh — Verifies npm users get the FULL WebPeel experience
#
# Runs automatically before every version bump (via pre-publish-gate.sh).
# Catches the exact bug from 2026-03-19: code split broke npm user experience
# because extractors/SPA detection were routed through unregistered hooks.
#
# This script imports from dist/ (compiled JS) WITHOUT registering premium hooks,
# simulating exactly what an npm user sees.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
FAIL=0

echo "🔍 npm experience check..."

# 1. Domain extractors load from compiled JS (no premium hooks)
echo -n "  Domain extractors... "
RESULT=$(node --input-type=module -e "
import { getDomainExtractor } from './dist/index.js';
const sites = ['reddit.com','github.com','news.ycombinator.com','x.com','youtube.com','en.wikipedia.org','stackoverflow.com','amazon.com','yelp.com','producthunt.com'];
let pass = 0;
for (const s of sites) { if (getDomainExtractor('https://' + s) !== null) pass++; }
console.log(pass);
process.exit(0);
" 2>/dev/null)
if [ "$RESULT" -ge 8 ]; then
  echo -e "${GREEN}OK${NC} ($RESULT/10 extractors available)"
else
  echo -e "${RED}FAIL${NC} — only $RESULT/10 extractors loaded (need ≥8)"
  echo "  npm users won't get domain extraction. Check domain-extractors-public.ts"
  FAIL=1
fi

# 2. SPA auto-detection has full domain list (not empty stubs)
echo -n "  SPA detection... "
SPA_COUNT=$(node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('dist/core/pipeline.js', 'utf8');
// Count entries in DEFAULT_SPA_DOMAINS set constructor
const match = src.match(/DEFAULT_SPA_DOMAINS\s*=\s*new\s+Set\(\[([^\]]*)\]\)/s);
if (!match) { console.log('0'); process.exit(0); }
const entries = match[1].split(',').filter(e => e.trim().length > 3);
console.log(entries.length);
process.exit(0);
" 2>/dev/null)
if [ "$SPA_COUNT" -ge 8 ]; then
  echo -e "${GREEN}OK${NC} ($SPA_COUNT SPA domains in pipeline)"
else
  echo -e "${RED}FAIL${NC} — only $SPA_COUNT SPA domains (need ≥8)"
  echo "  npm users won't get auto-render for Kayak/Airbnb/etc. Check pipeline.ts DEFAULT_SPA_DOMAINS"
  FAIL=1
fi

# 3. Challenge solver available from compiled JS
echo -n "  Challenge solver... "
CS_OK=$(node --input-type=module -e "
try {
  const mod = await import('./dist/ee/challenge-solver.js');
  console.log(typeof mod.solveChallenge === 'function' ? 'yes' : 'no');
} catch { console.log('no'); }
process.exit(0);
" 2>/dev/null)
if [ "$CS_OK" = "yes" ]; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAIL${NC} — solveChallenge not available"
  echo "  npm users won't get CAPTCHA solving. Check challenge-solver compiled JS"
  FAIL=1
fi

# 4. ee/ source files are tracked in git (protected by Enterprise License)
echo -n "  ee/ source tracked... "
EE_TRACKED=0
for f in src/ee/domain-extractors.ts src/ee/challenge-solver.ts src/ee/premium-hooks.ts; do
  if git ls-files --error-unmatch "$f" 2>/dev/null | grep -q "$f"; then
    EE_TRACKED=$((EE_TRACKED + 1))
  fi
done
if [ "$EE_TRACKED" -ge 3 ]; then
  echo -e "${GREEN}OK${NC} (ee/ source tracked under Enterprise License)"
else
  echo -e "${RED}FAIL${NC} — ee/ source not tracked by git ($EE_TRACKED/3 files)"
  echo "  Run: git add src/ee/"
  FAIL=1
fi

# 5. peel() returns content without premium hooks
echo -n "  Basic peel()... "
PEEL_OK=$(node --input-type=module -e "
import { peel } from './dist/index.js';
const r = await peel('https://example.com');
console.log(r.tokens > 0 ? 'yes' : 'no');
process.exit(0);
" 2>/dev/null)
if [ "$PEEL_OK" = "yes" ]; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAIL${NC} — peel() returned 0 tokens"
  FAIL=1
fi

# 6. dist/ee in package.json files array (so npm includes it)
echo -n "  dist/ee in package.json files... "
DIST_EE=$(node -e "const p=require('./package.json'); console.log(p.files && p.files.includes('dist/ee') ? 'yes' : 'no')" 2>/dev/null)
if [ "$DIST_EE" = "yes" ]; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAIL${NC} — dist/ee not in package.json files array"
  echo "  npm users won't get the ee/ compiled code"
  FAIL=1
fi

if [ $FAIL -ne 0 ]; then
  echo ""
  echo -e "${RED}❌ npm experience check FAILED — version bump blocked${NC}"
  echo "  npm users would get a broken experience. Fix before publishing."
  exit 1
fi

echo -e "${GREEN}✅ npm experience check passed${NC}"
