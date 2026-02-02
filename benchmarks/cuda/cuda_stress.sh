#!/usr/bin/env bash
set -euo pipefail

echo "=== CUDA Stress Benchmark ==="

if ! command -v nvcc >/dev/null 2>&1; then
  echo "nvcc not found; skipping CUDA benchmark."
  exit 0
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi not found; skipping CUDA benchmark."
  exit 0
fi
if ! nvidia-smi -L >/dev/null 2>&1; then
  echo "No NVIDIA GPU detected; skipping CUDA benchmark."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
mkdir -p "$BUILD_DIR"

SRC="$SCRIPT_DIR/cuda_stress.cu"
BIN="$BUILD_DIR/cuda_stress"

if [ ! -x "$BIN" ] || [ "$SRC" -nt "$BIN" ]; then
  NVCC_FLAGS="${STRESS_CUDA_FLAGS:--O3 --use_fast_math}"
  echo "Compiling CUDA stress kernel..."
  nvcc $NVCC_FLAGS -o "$BIN" "$SRC"
fi

DURATION="${STRESS_CUDA_DURATION:-60}"
SIZE_MB="${STRESS_CUDA_SIZE_MB:-1024}"
ITERS="${STRESS_CUDA_ITERS:-256}"
STREAMS="${STRESS_CUDA_STREAMS:-1}"
SAMPLE_MS="${STRESS_CUDA_SAMPLE_MS:-1000}"
CSV_PATH="${STRESS_CUDA_CSV:-}"
STATUS_PATH="${STRESS_CUDA_STATUS:-}"

if [ -n "$CSV_PATH" ]; then
  echo "ts,util_gpu,util_mem,temp,sm_clock,mem_clock" > "$CSV_PATH"
fi

"$BIN" --duration "$DURATION" --size-mb "$SIZE_MB" --iters "$ITERS" --streams "$STREAMS" --sample-ms "$SAMPLE_MS" &
LOAD_PID=$!

sleep_s=$(awk "BEGIN { printf \"%.3f\", $SAMPLE_MS / 1000 }")
start_ts=$(date +%s)

while kill -0 "$LOAD_PID" 2>/dev/null; do
  ts=$(date +%s)
  line=$(nvidia-smi --query-gpu=utilization.gpu,utilization.memory,temperature.gpu,clocks.sm,clocks.mem --format=csv,noheader,nounits | head -n1 || true)
  if [ -z "$line" ]; then
    echo "nvidia-smi failed; stopping GPU sampling."
    break
  fi
  echo "[+$(($ts - $start_ts))s] $line"
  if [ -n "$STATUS_PATH" ]; then
    echo "$line" > "$STATUS_PATH"
  fi
  if [ -n "$CSV_PATH" ]; then
    clean=$(echo "$line" | tr -d ' ')
    echo "$(($ts - $start_ts)),$clean" >> "$CSV_PATH"
  fi
  sleep "$sleep_s"
done

wait "$LOAD_PID"
