#!/usr/bin/env bash
# Standalone CLI runner — runs all benchmarks locally without the GUI.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$SCRIPT_DIR/benchmarks"

echo "=========================================="
echo "  Stress Benchmark Suite — CLI Runner"
echo "=========================================="
echo ""

# Setup
echo ">>> Running setup..."
bash "$BENCH_DIR/setup.sh"
echo ""

source "$HOME/.cargo/env" 2>/dev/null || true

RESULTS=""

run_bench() {
  local name="$1"
  local cmd="$2"
  echo ">>> [$name]"
  START=$(date +%s%N)
  eval "$cmd"
  END=$(date +%s%N)
  WALL=$(echo "scale=3; ($END - $START) / 1000000000" | bc)
  echo "    Wall time: ${WALL}s"
  RESULTS="$RESULTS\n$name: ${WALL}s"
  echo ""
}

# Rust benchmarks
echo "=== Rust ==="
run_bench "Rust: Matrix Multiply" "cd $BENCH_DIR/rust/matrix_multiply && cargo run --release 2>&1"
run_bench "Rust: Compile Bench" "cd $BENCH_DIR/rust/compile_bench && cargo clean 2>/dev/null; cargo build --release 2>&1"
run_bench "Rust: Web Server Load" "cd $BENCH_DIR/rust/web_server_load && cargo run --release 2>&1"

# Python benchmarks
echo "=== Python ==="
run_bench "Python: Data Processing" "cd $BENCH_DIR/python && python3 data_processing.py"
run_bench "Python: ML Training" "cd $BENCH_DIR/python && python3 ml_training.py"
run_bench "Python: Async I/O" "cd $BENCH_DIR/python && python3 async_io.py"

# C++ benchmarks
echo "=== C++ ==="
run_bench "C++: Ray Tracer" "cd $BENCH_DIR/cpp && g++ -O2 -std=c++17 -o raytracer raytracer.cpp -lpthread && ./raytracer"
run_bench "C++: Compile Bench" "cd $BENCH_DIR/cpp/compile_bench && make clean 2>/dev/null; make -j\$(nproc) 2>&1"
run_bench "C++: Sorting" "cd $BENCH_DIR/cpp && g++ -O2 -std=c++17 -o sorting sorting.cpp -lpthread && ./sorting"

# System benchmarks
echo "=== System ==="
run_bench "System: Disk I/O" "bash $BENCH_DIR/system/disk_io.sh"
run_bench "System: Memory BW" "bash $BENCH_DIR/system/memory_bw.sh"
run_bench "System: Multi-core" "bash $BENCH_DIR/system/multicore.sh"

echo "=========================================="
echo "  Summary"
echo "=========================================="
echo -e "$RESULTS"
