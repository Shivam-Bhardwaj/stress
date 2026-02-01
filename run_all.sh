#!/usr/bin/env bash
# Standalone CLI runner — menu-driven, runs benchmarks locally.
set -euo pipefail

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

bench_names=(
  "Rust: Matrix Multiply"
  "Rust: Compile Bench"
  "Rust: Web Server Load"
  "Python: Data Processing"
  "Python: ML Training"
  "Python: Async I/O"
  "C++: Ray Tracer"
  "C++: Compile Bench"
  "C++: Sorting"
  "System: Disk I/O"
  "System: Memory BW"
  "System: Multi-core"
  "System: CPU Single-core"
)

bench_cmds=(
  "cd $BENCH_DIR/rust/matrix_multiply && cargo run --release 2>&1"
  "cd $BENCH_DIR/rust/compile_bench && cargo clean 2>/dev/null; cargo build --release 2>&1"
  "cd $BENCH_DIR/rust/web_server_load && cargo run --release 2>&1"
  "cd $BENCH_DIR/python && python3 data_processing.py"
  "cd $BENCH_DIR/python && python3 ml_training.py"
  "cd $BENCH_DIR/python && python3 async_io.py"
  "cd $BENCH_DIR/cpp && g++ -O2 -std=c++17 -o raytracer raytracer.cpp -lpthread && ./raytracer"
  "cd $BENCH_DIR/cpp/compile_bench && make clean 2>/dev/null; make -j\$(nproc) 2>&1"
  "cd $BENCH_DIR/cpp && g++ -O2 -std=c++17 -o sorting sorting.cpp -lpthread && ./sorting"
  "bash $BENCH_DIR/system/disk_io.sh"
  "bash $BENCH_DIR/system/memory_bw.sh"
  "bash $BENCH_DIR/system/multicore.sh"
  "bash $BENCH_DIR/system/cpu_single.sh"
)

bench_groups=(
  "rust"
  "rust"
  "rust"
  "python"
  "python"
  "python"
  "cpp"
  "cpp"
  "cpp"
  "system"
  "system"
  "system"
  "system"
)

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

print_menu() {
  echo "Select benchmarks to run:"
  echo ""
  local i=1
  while [ $i -le ${#bench_names[@]} ]; do
    printf "  %2d) %s\n" "$i" "${bench_names[$((i-1))]}"
    i=$((i+1))
  done
  echo ""
  echo "Enter numbers (space/comma separated), a group (rust/python/cpp/system), or 'all'."
  echo "Press Enter for 'all'."
  echo ""
}

run_indices() {
  local indices=("$@")
  local last_group=""
  for idx in "${indices[@]}"; do
    local group="${bench_groups[$idx]}"
    if [ "$group" != "$last_group" ]; then
      echo "=== ${group^} ==="
      last_group="$group"
    fi
    run_bench "${bench_names[$idx]}" "${bench_cmds[$idx]}"
  done
}

run_group() {
  local group="$1"
  local selected=()
  local i=0
  while [ $i -lt ${#bench_names[@]} ]; do
    if [ "${bench_groups[$i]}" = "$group" ]; then
      selected+=("$i")
    fi
    i=$((i+1))
  done
  run_indices "${selected[@]}"
}

print_menu
read -r selection
selection="${selection,,}"

if [ -z "$selection" ] || [ "$selection" = "all" ]; then
  run_indices $(seq 0 $((${#bench_names[@]} - 1)))
elif [ "$selection" = "rust" ] || [ "$selection" = "python" ] || [ "$selection" = "cpp" ] || [ "$selection" = "system" ]; then
  run_group "$selection"
else
  selection="${selection//,/ }"
  indices=()
  for token in $selection; do
    if [[ "$token" =~ ^[0-9]+$ ]]; then
      idx=$((token - 1))
      if [ $idx -ge 0 ] && [ $idx -lt ${#bench_names[@]} ]; then
        indices+=("$idx")
      else
        echo "Invalid selection: $token"
        exit 1
      fi
    else
      echo "Invalid selection: $token"
      exit 1
    fi
  done
  run_indices "${indices[@]}"
fi

echo "=========================================="
echo "  Summary"
echo "=========================================="
echo -e "$RESULTS"
