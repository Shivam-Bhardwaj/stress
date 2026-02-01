#!/usr/bin/env bash
set -euo pipefail

TARGET="${STRESS_IPERF_TARGET:-}"
TIME="${STRESS_IPERF_TIME:-15}"
PARALLEL="${STRESS_IPERF_PARALLEL:-4}"

if ! command -v iperf3 >/dev/null 2>&1; then
  echo "iperf3 not available; skipping."
  exit 0
fi

if [ -z "$TARGET" ]; then
  echo "No iperf3 target set. Set STRESS_IPERF_TARGET=host to run."
  exit 0
fi

echo "Network Throughput Benchmark: iperf3 to $TARGET for ${TIME}s (${PARALLEL} streams)"
iperf3 -c "$TARGET" -t "$TIME" -P "$PARALLEL"
