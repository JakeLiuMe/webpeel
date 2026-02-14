# Sub-Agent Task Rules

## MANDATORY in every task prompt:

### 1. Verification Steps (ALWAYS include)
```
Before finishing:
1. Run `npx tsc --noEmit` — ZERO errors required
2. Run `npx vitest run` — all tests must pass
3. Run `git diff --stat` — show what you changed
```

### 2. Honesty Clause (ALWAYS include)
```
IMPORTANT:
- Only use function names that ACTUALLY EXIST in the codebase
- Do NOT invent features, files, or APIs that don't exist
- If you're unsure about an API, READ the source file first
- If you reference a competitor feature, verify it's real
```

### 3. File Boundaries (ALWAYS specify)
```
You may ONLY modify: [list specific files]
Do NOT touch: [list files other agents own]
```

### 4. Wiring Check (for multi-file changes)
```
If you add a new module/function:
- Verify it's imported where needed
- Verify it's initialized/called (not just defined)
- Check that types match at every call site
```

## Review Checklist (Jarvis runs AFTER every sub-agent)
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes  
- [ ] No fake function names (grep imports vs actual exports)
- [ ] No embellished features in docs (every claim maps to real code)
- [ ] No duplicate imports or declarations
- [ ] Changes compile into dist/ cleanly

## Anti-Patterns to Watch For
- Agent says "I'll create X" but X already exists differently
- Agent copies patterns from memory instead of reading actual code
- Agent writes tests that test the wrong thing (happy path only)
- Agent adds dependencies not in package.json
- Two agents assigned overlapping files → merge conflicts
