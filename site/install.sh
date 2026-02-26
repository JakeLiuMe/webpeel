#!/bin/bash
# WebPeel Installer — https://webpeel.dev
# Usage: curl -fsSL https://webpeel.dev/install.sh | bash
#
# Installs the WebPeel CLI globally via npm.
# Requires Node.js 18+ and npm.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD_WHITE='\033[1;37m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No color

# Logo
echo ""
echo -e "${BOLD_WHITE}  ◆ WebPeel${NC}"
echo -e "${DIM}  The Web Data Platform for AI Agents${NC}"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js is not installed.${NC}"
  echo ""
  echo "  WebPeel requires Node.js 18 or later."
  echo "  Install it from: https://nodejs.org"
  echo ""
  echo "  Or use a version manager:"
  echo "    curl -fsSL https://fnm.vercel.app/install | bash"
  echo "    fnm install --lts"
  echo ""
  exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}✗ Node.js $NODE_VERSION is too old. WebPeel requires Node.js 18+.${NC}"
  echo "  Current: $(node -v)"
  echo "  Update:  https://nodejs.org"
  exit 1
fi

echo -e "${DIM}  node $(node -v) ✓${NC}"

# Check for npm
if ! command -v npm &> /dev/null; then
  echo -e "${RED}✗ npm is not installed.${NC}"
  echo "  Install Node.js from https://nodejs.org (includes npm)"
  exit 1
fi

echo -e "${DIM}  npm $(npm -v) ✓${NC}"
echo ""

# Install WebPeel globally
echo -e "${CYAN}  Installing WebPeel...${NC}"
echo ""

if npm install -g webpeel 2>&1 | while IFS= read -r line; do
  # Show progress but keep it clean
  if echo "$line" | grep -q "added\|up to date"; then
    echo -e "  ${GREEN}${line}${NC}"
  fi
done; then
  echo ""
else
  echo ""
  echo -e "${YELLOW}  ⚠ npm install failed. Trying with sudo...${NC}"
  echo ""
  if sudo npm install -g webpeel 2>&1 | while IFS= read -r line; do
    if echo "$line" | grep -q "added\|up to date"; then
      echo -e "  ${GREEN}${line}${NC}"
    fi
  done; then
    echo ""
  else
    echo ""
    echo -e "${RED}  ✗ Installation failed.${NC}"
    echo ""
    echo "  Try installing manually:"
    echo "    npm install -g webpeel"
    echo ""
    echo "  If you get permission errors:"
    echo "    sudo npm install -g webpeel"
    echo "    # or fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors"
    echo ""
    exit 1
  fi
fi

# Verify installation
if ! command -v webpeel &> /dev/null; then
  echo -e "${YELLOW}  ⚠ 'webpeel' command not found in PATH.${NC}"
  echo ""
  echo "  The package was installed, but the binary isn't in your PATH."
  echo "  Try: npx webpeel --version"
  echo ""
  exit 1
fi

VERSION=$(webpeel --version 2>/dev/null || echo "unknown")

echo -e "${GREEN}${BOLD}  ✓ WebPeel ${VERSION} installed successfully!${NC}"
echo ""
echo -e "  ${BOLD}Get started:${NC}"
echo ""
echo -e "  ${CYAN}# Fetch any URL as clean markdown${NC}"
echo -e "  webpeel \"https://example.com\""
echo ""
echo -e "  ${CYAN}# Authenticate for 500 free fetches/week${NC}"
echo -e "  webpeel login"
echo ""
echo -e "  ${CYAN}# Search the web${NC}"
echo -e "  webpeel search \"latest AI news\""
echo ""
echo -e "  ${CYAN}# Start the MCP server (for Claude, Cursor, etc.)${NC}"
echo -e "  webpeel mcp"
echo ""
echo -e "  ${DIM}Docs: https://webpeel.dev/docs${NC}"
echo -e "  ${DIM}Dashboard: https://app.webpeel.dev${NC}"
echo ""
