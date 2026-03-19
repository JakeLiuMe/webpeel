#!/bin/bash
# Generate type-compatible stubs for gitignored proprietary modules.
# These stubs allow tsc to compile in CI where the real source doesn't exist.
# The compiled JS at runtime uses dynamic imports with try/catch, so stubs are never called.

set -euo pipefail

# Only generate if the real file doesn't exist
if [ ! -s src/core/domain-extractors.ts ]; then
  echo "Generating CI stub: src/core/domain-extractors.ts"
  cat > src/core/domain-extractors.ts << 'EOF'
// CI stub — real implementation is proprietary (.gitignore'd)
import type { DomainExtractResult, DomainExtractor } from './domain-extractors-basic.js';
export type { DomainExtractResult, DomainExtractor };
export function getDomainExtractor(_url: string): DomainExtractor | null { return null; }
export async function extractDomainData(_html: string, _url: string): Promise<DomainExtractResult | null> { return null; }
export function setExtractorRedis(_redis: any): void {}
EOF
fi

if [ ! -s src/core/challenge-solver.ts ]; then
  echo "Generating CI stub: src/core/challenge-solver.ts"
  cat > src/core/challenge-solver.ts << 'EOF'
// CI stub — real implementation is proprietary (.gitignore'd)
export async function solveChallenge(_url: string, _type: string, _html: string, _opts?: any): Promise<any> { return { solved: false }; }
EOF
fi

if [ ! -s src/server/premium/index.ts ]; then
  echo "Generating CI stub: src/server/premium/index.ts"
  mkdir -p src/server/premium
  cat > src/server/premium/index.ts << 'EOF'
// CI stub — real implementation is proprietary (.gitignore'd)
export function registerPremiumHooks(): void {}
export function clearDomainIntel(): void {}
EOF
fi

echo "✅ CI stubs ready"
