#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# WebPeel Deploy Script — One command to ship everything
# Usage: ./scripts/deploy.sh [--skip-tests] [--skip-npm] [--api-only] [--site-only] [--dash-only]
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SKIP_TESTS=false
SKIP_NPM=false
API_ONLY=false
SITE_ONLY=false
DASH_ONLY=false

for arg in "$@"; do
  case $arg in
    --skip-tests) SKIP_TESTS=true ;;
    --skip-npm) SKIP_NPM=true ;;
    --api-only) API_ONLY=true ;;
    --site-only) SITE_ONLY=true ;;
    --dash-only) DASH_ONLY=true ;;
    --help|-h)
      echo "Usage: ./scripts/deploy.sh [options]"
      echo "  --skip-tests   Skip test suite"
      echo "  --skip-npm     Skip npm publish (deploy existing version)"
      echo "  --api-only     Only deploy API to Render"
      echo "  --site-only    Only deploy site to Vercel"
      echo "  --dash-only    Only deploy dashboard to Vercel"
      exit 0
      ;;
  esac
done

RENDER_API_KEY="${RENDER_API_KEY:-rnd_CfyxBmyl5YFq0EhJoLSS8mJL3SKP}"
RENDER_SERVICE_ID="${RENDER_SERVICE_ID:-srv-d673vsogjchc73ahgj6g}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$PROJECT_ROOT"

step() { echo -e "\n${CYAN}▸ $1${NC}"; }
ok() { echo -e "  ${GREEN}✓ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "  ${RED}✗ $1${NC}"; exit 1; }

echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     WebPeel Deploy Pipeline          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"

# ── 1. Pre-flight checks ──────────────────────────────────────────────────
step "Pre-flight checks"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  warn "Uncommitted changes detected"
  git status --short
  read -p "Continue anyway? [y/N] " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# Check branch
BRANCH=$(git branch --show-current)
[ "$BRANCH" = "main" ] || warn "Not on main branch (on $BRANCH)"

CURRENT_VERSION=$(node -p "require('./package.json').version")
ok "Current version: v$CURRENT_VERSION"
ok "Branch: $BRANCH"

# ── 2. Build ──────────────────────────────────────────────────────────────
step "Building TypeScript"
npm run build 2>&1 | tail -3
ok "Build complete"

# ── 3. Tests ──────────────────────────────────────────────────────────────
if [ "$SKIP_TESTS" = false ]; then
  step "Running tests"
  npm test 2>&1 | tail -5
  ok "Tests passed"
else
  warn "Tests skipped (--skip-tests)"
fi

# ── 4. Dashboard TypeScript check ─────────────────────────────────────────
step "Dashboard TypeScript check"
cd dashboard && npx tsc --noEmit 2>&1
ok "Dashboard compiles clean"
cd "$PROJECT_ROOT"

# ── 5. Version bump + npm publish ─────────────────────────────────────────
if [ "$SKIP_NPM" = false ] && [ "$SITE_ONLY" = false ] && [ "$DASH_ONLY" = false ]; then
  step "Publishing to npm"
  NEW_VERSION=$(npm version patch --no-git-tag-version 2>&1)
  echo "  Version: $NEW_VERSION"
  npm publish 2>&1 | tail -3
  ok "Published $NEW_VERSION to npm"

  # Update Dockerfile.api to pin new version
  VERSION_NUM="${NEW_VERSION#v}"
  sed -i '' "s/RUN npm install webpeel@[0-9.]*/RUN npm install webpeel@$VERSION_NUM/" Dockerfile.api
  ok "Dockerfile.api pinned to $VERSION_NUM"
else
  NEW_VERSION="v$CURRENT_VERSION"
  warn "npm publish skipped"
fi

# ── 6. Git commit + push ─────────────────────────────────────────────────
step "Committing and pushing"
git add -A
if git diff --cached --quiet; then
  ok "Nothing to commit"
else
  git commit -m "release: ${NEW_VERSION} deploy" --no-verify 2>&1 | tail -1
  ok "Committed"
fi
git push origin main 2>&1 | tail -2
ok "Pushed to origin"

# Push to fork if it exists (Render watches JakeLiuMe/webpeel)
if git remote | grep -q jake-fork; then
  git push jake-fork main 2>&1 | tail -1
  ok "Pushed to jake-fork"
fi

# ── 7. Deploy API to Render ──────────────────────────────────────────────
if [ "$SITE_ONLY" = false ] && [ "$DASH_ONLY" = false ]; then
  step "Deploying API to Render"
  DEPLOY_ID=$(curl -s -X POST "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"clearCache": "clear"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "  Deploy ID: $DEPLOY_ID"

  # Wait for deploy
  echo -n "  Waiting: "
  for i in $(seq 1 20); do
    sleep 15
    STATUS=$(curl -s "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys/$DEPLOY_ID" \
      -H "Authorization: Bearer $RENDER_API_KEY" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
    echo -n "."
    if [ "$STATUS" = "live" ]; then
      echo ""
      ok "API deployed successfully"
      break
    elif [ "$STATUS" = "build_failed" ] || [ "$STATUS" = "update_failed" ]; then
      echo ""
      fail "API deploy failed: $STATUS"
    fi
  done

  # Verify health
  HEALTH=$(curl -s "https://api.webpeel.dev/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'v{d[\"version\"]} {d[\"status\"]}')")
  ok "API health: $HEALTH"
fi

# ── 8. Deploy Dashboard to Vercel ─────────────────────────────────────────
if [ "$API_ONLY" = false ] && [ "$SITE_ONLY" = false ]; then
  step "Deploying Dashboard to Vercel"
  cd dashboard
  DASH_URL=$(vercel --prod 2>&1 | grep -o 'https://app.webpeel.dev.*' | head -1)
  ok "Dashboard: ${DASH_URL:-deployed}"
  cd "$PROJECT_ROOT"
fi

# ── 9. Deploy Site to Vercel ──────────────────────────────────────────────
if [ "$API_ONLY" = false ] && [ "$DASH_ONLY" = false ]; then
  step "Deploying Site to Vercel"
  cd site
  SITE_URL=$(vercel --prod 2>&1 | grep -o 'https://.*webpeel.dev.*' | head -1)
  ok "Site: ${SITE_URL:-deployed}"
  cd "$PROJECT_ROOT"
fi

# ── 10. Final verification ────────────────────────────────────────────────
step "Final verification"
./scripts/verify.sh --quiet 2>&1 || warn "Some checks failed — run ./scripts/verify.sh for details"

echo -e "\n${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Deploy complete! 🚀              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo -e "  API:       https://api.webpeel.dev"
echo -e "  Dashboard: https://app.webpeel.dev"
echo -e "  Site:      https://webpeel.dev"
echo -e "  Version:   ${NEW_VERSION}"
