#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results/$(date +%Y%m%d_%H%M%S)_stress_full"
mkdir -p "$RESULTS_DIR"

DURATION="${STRESS_DURATION:-600}"
RUST_ARGS="${STRESS_RUST_ARGS:-}"
RUST_GRAPH_HEIGHT="${STRESS_RUST_GRAPH_HEIGHT:-8}"
RUST_GRAPH_WIDTH="${STRESS_RUST_GRAPH_WIDTH:-0}"
CUDA_DURATION="${STRESS_CUDA_DURATION:-$DURATION}"

RUST_CSV="$RESULTS_DIR/rust_stress.csv"
CUDA_CSV="$RESULTS_DIR/cuda_stress.csv"
CUDA_STATUS="$RESULTS_DIR/cuda_status.txt"

CUDA_PID=""

cleanup() {
  if [ -n "$CUDA_PID" ] && kill -0 "$CUDA_PID" 2>/dev/null; then
    kill "$CUDA_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

if command -v nvcc >/dev/null 2>&1 && command -v nvidia-smi >/dev/null 2>&1; then
  if nvidia-smi -L >/dev/null 2>&1; then
    echo "Starting CUDA stress in background..."
    STRESS_CUDA_DURATION="$CUDA_DURATION" \
      STRESS_CUDA_CSV="$CUDA_CSV" \
      STRESS_CUDA_STATUS="$CUDA_STATUS" \
      bash "$SCRIPT_DIR/benchmarks/cuda/cuda_stress.sh" \
      >"$RESULTS_DIR/cuda_stress.log" 2>&1 &
    CUDA_PID=$!
  else
    echo "No NVIDIA GPU detected; skipping CUDA stress."
  fi
else
  echo "CUDA tools not found; skipping CUDA stress."
fi

RUST_FLAGS="--duration $DURATION --csv $RUST_CSV --graph-height $RUST_GRAPH_HEIGHT --gpu-status $CUDA_STATUS"
if [ "$RUST_GRAPH_WIDTH" -gt 0 ] 2>/dev/null; then
  RUST_FLAGS="$RUST_FLAGS --graph-width $RUST_GRAPH_WIDTH"
fi

set -x
bash "$SCRIPT_DIR/run_rust_stress.sh" $RUST_FLAGS $RUST_ARGS
set +x

wait

echo "Results saved in: $RESULTS_DIR"
