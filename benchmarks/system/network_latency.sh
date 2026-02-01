#!/usr/bin/env bash
set -euo pipefail

TARGET="${STRESS_NET_TARGET:-1.1.1.1}"
COUNT="${STRESS_NET_PING_COUNT:-20}"

if ! command -v ping >/dev/null 2>&1; then
  echo "ping not available; skipping."
  exit 0
fi

echo "Network Latency Benchmark: ping $TARGET ($COUNT packets)"
output=$(ping -c "$COUNT" "$TARGET" 2>&1 || true)
echo "$output"
avg=$(echo "$output" | awk -F'/' '/^rtt/ {print $5}')
if [ -n "$avg" ]; then
  echo "Average RTT: ${avg} ms"
  echo "RESULT:network_latency:${avg}"
else
  echo "Could not parse ping output; skipping."
fi
