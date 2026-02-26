# WebPeel Installer for Windows — https://webpeel.dev
# Usage: irm https://webpeel.dev/install.ps1 | iex
#
# Installs the WebPeel CLI globally via npm.
# Requires Node.js 18+ and npm.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ◆ WebPeel" -ForegroundColor White -NoNewline
Write-Host ""
Write-Host "  The Web Data Platform for AI Agents" -ForegroundColor DarkGray
Write-Host ""

# Check for Node.js
try {
    $nodeVersion = (node -v) -replace 'v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    
    if ($nodeMajor -lt 18) {
        Write-Host "  ✗ Node.js $nodeVersion is too old. WebPeel requires Node.js 18+." -ForegroundColor Red
        Write-Host "  Update: https://nodejs.org" -ForegroundColor Gray
        exit 1
    }
    
    Write-Host "  node v$nodeVersion ✓" -ForegroundColor DarkGray
} catch {
    Write-Host "  ✗ Node.js is not installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "  WebPeel requires Node.js 18 or later."
    Write-Host "  Install it from: https://nodejs.org"
    Write-Host ""
    Write-Host "  Or use winget:"
    Write-Host "    winget install OpenJS.NodeJS.LTS"
    Write-Host ""
    exit 1
}

# Check for npm
try {
    $npmVersion = npm -v
    Write-Host "  npm $npmVersion ✓" -ForegroundColor DarkGray
} catch {
    Write-Host "  ✗ npm is not installed." -ForegroundColor Red
    Write-Host "  Install Node.js from https://nodejs.org (includes npm)"
    exit 1
}

Write-Host ""
Write-Host "  Installing WebPeel..." -ForegroundColor Cyan
Write-Host ""

try {
    npm install -g webpeel 2>&1 | ForEach-Object {
        if ($_ -match "added|up to date") {
            Write-Host "  $_" -ForegroundColor Green
        }
    }
} catch {
    Write-Host "  ✗ Installation failed." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Try installing manually:"
    Write-Host "    npm install -g webpeel"
    Write-Host ""
    exit 1
}

# Verify installation
try {
    $version = webpeel --version 2>$null
    if (-not $version) { $version = "unknown" }
} catch {
    $version = "unknown"
}

Write-Host ""
Write-Host "  ✓ WebPeel $version installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Get started:" -ForegroundColor White
Write-Host ""
Write-Host "  # Fetch any URL as clean markdown" -ForegroundColor Cyan
Write-Host '  webpeel "https://example.com"'
Write-Host ""
Write-Host "  # Authenticate for 500 free fetches/week" -ForegroundColor Cyan
Write-Host "  webpeel login"
Write-Host ""
Write-Host "  # Search the web" -ForegroundColor Cyan
Write-Host '  webpeel search "latest AI news"'
Write-Host ""
Write-Host "  # Start the MCP server (for Claude, Cursor, etc.)" -ForegroundColor Cyan
Write-Host "  webpeel mcp"
Write-Host ""
Write-Host "  Docs: https://webpeel.dev/docs" -ForegroundColor DarkGray
Write-Host "  Dashboard: https://app.webpeel.dev" -ForegroundColor DarkGray
Write-Host ""
