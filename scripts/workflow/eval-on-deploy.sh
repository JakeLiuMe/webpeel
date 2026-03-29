#!/usr/bin/env bash
# Post-Deploy Eval Runner
# Runs critical eval subsets against production after deploy.
# Exit 0 = all pass, Exit 1 = failures detected.
#
# Usage:
#   bash scripts/workflow/eval-on-deploy.sh
#   bash scripts/workflow/eval-on-deploy.sh --local   # test against localhost

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

TARGET="${1:---production}"

echo -e "${BOLD}${CYAN}━━━ WebPeel Post-Deploy Eval ━━━${NC}"
echo -e "${DIM}Target: ${TARGET}${NC}"
echo -e "${DIM}Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")${NC}"
echo ""

FAILURES=0
START_TIME=$(date +%s)

# ── Smart Search Critical Tests ─────────────────────────────────────────────
echo -e "${BOLD}▶ Smart Search (critical tests)${NC}"
if npx tsx "$PROJECT_ROOT/scripts/eval-smart-search.ts" "$TARGET" --category=critical; then
  echo -e "${GREEN}✓ Smart Search critical tests passed${NC}"
else
  echo -e "${RED}✗ Smart Search critical tests FAILED${NC}"
  FAILURES=$((FAILURES + 1))
fi

echo ""

# ── Fetch Critical Tests ───────────────────────────────────────────────────
echo -e "${BOLD}▶ Fetch (critical tests)${NC}"
if npx tsx "$PROJECT_ROOT/scripts/eval-fetch.ts" "$TARGET" --category=critical; then
  echo -e "${GREEN}✓ Fetch critical tests passed${NC}"
else
  echo -e "${RED}✗ Fetch critical tests FAILED${NC}"
  FAILURES=$((FAILURES + 1))
fi

# ── Summary ─────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo -e "${BOLD}${CYAN}━━━ Deploy Eval Summary ━━━${NC}"
echo -e "${DIM}Duration: ${ELAPSED}s${NC}"

if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✅ All critical evals passed — deploy is good${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}❌ ${FAILURES} eval suite(s) failed — investigate before proceeding${NC}"
  exit 1
fi
