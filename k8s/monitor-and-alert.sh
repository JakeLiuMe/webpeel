#!/bin/bash
# WebPeel K8s Health Monitor with Discord Alerts
# Run every 5 minutes via cron

DISCORD_WEBHOOK="$DISCORD_WEBHOOK_URL"
K3S_NAMESPACE="webpeel"

# Color codes for Discord embeds
RED="16711680"      # #FF0000
YELLOW="16776960"   # #FFFF00
GREEN="65280"       # #00FF00

alert_discord() {
  local title="$1"
  local description="$2"
  local color="$3"
  
  curl -X POST "$DISCORD_WEBHOOK" \
    -H 'Content-Type: application/json' \
    -d "{
      \"embeds\": [{
        \"title\": \"🚨 $title\",
        \"description\": \"$description\",
        \"color\": $color,
        \"timestamp\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\"
      }]
    }" \
    2>/dev/null || true
}

# Check pod restarts
check_restarts() {
  local restart_count=$(kubectl get pods -n $K3S_NAMESPACE -o jsonpath='{.items[*].status.containerStatuses[*].restartCount}' | tr ' ' '\n' | sort -n | tail -1)
  
  if [ "$restart_count" -gt 3 ]; then
    local pod=$(kubectl get pods -n $K3S_NAMESPACE -o jsonpath="{.items[?(@.status.containerStatuses[0].restartCount>3)].metadata.name}" | head -1)
    alert_discord "Pod Restart Alert" "Pod $pod has restarted $restart_count times" "$RED"
  fi
}

# Check memory usage
check_memory() {
  local pods=$(kubectl top pods -n $K3S_NAMESPACE 2>/dev/null | tail -n +2)
  
  while IFS= read -r line; do
    local pod=$(echo "$line" | awk '{print $1}')
    local memory=$(echo "$line" | awk '{print $3}' | sed 's/Mi//')
    
    if [ "$memory" -gt 450 ]; then
      alert_discord "High Memory Usage" "Pod $pod is using ${memory}Mi (>90% of 512Mi limit)" "$YELLOW"
    fi
  done <<< "$pods"
}

# Check API latency
check_latency() {
  local latency=$(curl -s -w "%{time_total}" -o /dev/null http://localhost:3000/health 2>/dev/null | awk '{printf "%.0f", $1 * 1000}')
  
  if [ "$latency" -gt 5000 ]; then
    alert_discord "API Latency Alert" "API /health took ${latency}ms (>5s)" "$YELLOW"
  fi
}

# Check all pods are running
check_pod_status() {
  local not_running=$(kubectl get pods -n $K3S_NAMESPACE --field-selector=status.phase!=Running -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
  
  if [ -n "$not_running" ]; then
    alert_discord "Pod Down" "Pods not running: $not_running" "$RED"
  fi
}

# Run all checks
check_pod_status
check_restarts
check_memory
check_latency

echo "✅ Health check completed at $(date)"
