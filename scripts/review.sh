#!/bin/bash
# Post-sub-agent review script
# Run this after accepting sub-agent work, before committing

set -e
echo "🔍 Running post-sub-agent review..."

echo ""
echo "=== 1. TypeScript Compilation ==="
npx tsc --noEmit && echo "✅ Clean compile" || { echo "❌ TypeScript errors!"; exit 1; }

echo ""
echo "=== 2. Test Suite ==="
npx vitest run 2>&1 | tail -5

echo ""
echo "=== 3. Check for common issues ==="

# Check for duplicate imports
echo -n "Duplicate imports: "
grep -rn "^import" src/ --include="*.ts" | sort | uniq -d | wc -l | tr -d ' '

# Check for unused imports (rough check)
echo -n "Files with potential issues: "
npx tsc --noEmit 2>&1 | grep "error" | wc -l | tr -d ' '

echo ""
echo "=== 4. Git status ==="
git diff --stat

echo ""
echo "=== 5. Verify exports match usage ==="
echo "Real exports from index.ts:"
grep "^export" src/index.ts | head -20

echo ""
echo "✅ Review complete"
