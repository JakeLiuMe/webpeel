#!/usr/bin/env bash
# Task Locking for Parallel Agents
# Inspired by Anthropic's C compiler parallel agent approach.
#
# Usage:
#   task-lock.sh claim <task-name> <agent-id>
#   task-lock.sh release <task-name>
#   task-lock.sh check <task-name>
#   task-lock.sh list

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TASKS_DIR="$PROJECT_ROOT/.tasks"
STALE_THRESHOLD_SECONDS=7200  # 2 hours

# Ensure .tasks directory exists and is gitignored
mkdir -p "$TASKS_DIR"
if ! grep -qx '.tasks/' "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
  echo '.tasks/' >> "$PROJECT_ROOT/.gitignore"
fi

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

# ── Helper: check if lock is stale ─────────────────────────────────────────
is_stale() {
  local lockfile="$1"
  if [[ ! -f "$lockfile" ]]; then return 1; fi
  local timestamp
  timestamp=$(grep '^timestamp=' "$lockfile" | cut -d= -f2)
  if [[ -z "$timestamp" ]]; then return 1; fi
  local now
  now=$(date +%s)
  local age=$(( now - timestamp ))
  if (( age > STALE_THRESHOLD_SECONDS )); then
    return 0  # is stale
  fi
  return 1  # not stale
}

# ── Commands ────────────────────────────────────────────────────────────────
cmd_claim() {
  local task_name="${1:?Usage: task-lock.sh claim <task-name> <agent-id>}"
  local agent_id="${2:?Usage: task-lock.sh claim <task-name> <agent-id>}"
  local lockfile="$TASKS_DIR/${task_name}.lock"

  if [[ -f "$lockfile" ]]; then
    local existing_agent
    existing_agent=$(grep '^agent=' "$lockfile" | cut -d= -f2)
    if is_stale "$lockfile"; then
      echo -e "${YELLOW}⚠ Stale lock detected for '${task_name}' (agent: ${existing_agent}). Overriding.${NC}"
    else
      echo -e "${RED}✗ Task '${task_name}' already locked by ${existing_agent}${NC}"
      exit 1
    fi
  fi

  cat > "$lockfile" <<EOF
agent=${agent_id}
timestamp=$(date +%s)
claimed=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

  echo -e "${GREEN}✓ Task '${task_name}' claimed by ${agent_id}${NC}"
}

cmd_release() {
  local task_name="${1:?Usage: task-lock.sh release <task-name>}"
  local lockfile="$TASKS_DIR/${task_name}.lock"

  if [[ ! -f "$lockfile" ]]; then
    echo -e "${YELLOW}⚠ Task '${task_name}' was not locked${NC}"
    exit 0
  fi

  rm -f "$lockfile"
  echo -e "${GREEN}✓ Task '${task_name}' released${NC}"
}

cmd_check() {
  local task_name="${1:?Usage: task-lock.sh check <task-name>}"
  local lockfile="$TASKS_DIR/${task_name}.lock"

  if [[ ! -f "$lockfile" ]]; then
    echo -e "${GREEN}✓ Task '${task_name}' is unlocked${NC}"
    exit 0
  fi

  local agent
  agent=$(grep '^agent=' "$lockfile" | cut -d= -f2)
  local claimed
  claimed=$(grep '^claimed=' "$lockfile" | cut -d= -f2)

  if is_stale "$lockfile"; then
    echo -e "${YELLOW}⚠ Task '${task_name}' locked by ${agent} (since ${claimed}) — STALE (>2h)${NC}"
  else
    echo -e "${BLUE}🔒 Task '${task_name}' locked by ${agent} (since ${claimed})${NC}"
  fi
  exit 1
}

cmd_list() {
  local count=0
  echo -e "${BLUE}── Active Task Locks ──${NC}"

  if [[ ! -d "$TASKS_DIR" ]] || [[ -z "$(ls -A "$TASKS_DIR" 2>/dev/null)" ]]; then
    echo -e "  ${DIM}No active locks${NC}"
    return
  fi

  for lockfile in "$TASKS_DIR"/*.lock; do
    [[ -f "$lockfile" ]] || continue
    local task_name
    task_name=$(basename "$lockfile" .lock)
    local agent
    agent=$(grep '^agent=' "$lockfile" | cut -d= -f2)
    local claimed
    claimed=$(grep '^claimed=' "$lockfile" | cut -d= -f2)
    local stale_marker=""
    if is_stale "$lockfile"; then
      stale_marker=" ${YELLOW}(STALE)${NC}"
    fi
    echo -e "  🔒 ${task_name} → ${agent} (since ${claimed})${stale_marker}"
    count=$((count + 1))
  done

  echo -e "\n  ${DIM}${count} active lock(s)${NC}"
}

# ── Dispatch ────────────────────────────────────────────────────────────────
case "${1:-help}" in
  claim)   shift; cmd_claim "$@" ;;
  release) shift; cmd_release "$@" ;;
  check)   shift; cmd_check "$@" ;;
  list)    cmd_list ;;
  *)
    echo "Usage: task-lock.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  claim   <task-name> <agent-id>  — Claim a task lock"
    echo "  release <task-name>             — Release a task lock"
    echo "  check   <task-name>             — Check if task is locked (exit 0=unlocked, 1=locked)"
    echo "  list                            — List all active locks"
    ;;
esac
