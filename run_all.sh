#!/usr/bin/env bash
# Standalone CLI runner — menu-driven, runs benchmarks locally.
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$SCRIPT_DIR/benchmarks"
RESULTS_DIR="$SCRIPT_DIR/results/$(date +%Y%m%d_%H%M%S)"
VERBOSE="${STRESS_VERBOSE:-0}"
FAIL_FAST="${STRESS_FAIL_FAST:-0}"
SMALL_MODE="${STRESS_SMALL:-0}"
mkdir -p "$RESULTS_DIR"

echo "=========================================="
echo "  Stress Benchmark Suite — CLI Runner"
echo "=========================================="
echo ""

# Setup
echo ">>> Running setup..."
if ! bash "$BENCH_DIR/setup.sh"; then
  echo "Setup failed. Continuing; some benchmarks may fail."
fi
echo ""

source "$HOME/.cargo/env" 2>/dev/null || true

RESULTS=""
RESULTS_JSON="$RESULTS_DIR/summary.json"
RESULTS_CSV="$RESULTS_DIR/summary.csv"
RESULTS_TXT="$RESULTS_DIR/summary.txt"

printf 'name,group,status,wall_time_s\n' > "$RESULTS_CSV"
printf '{"generated_at":"%s","results":[' "$(date -Is 2>/dev/null || date)" > "$RESULTS_JSON"
JSON_FIRST=1

finalize_results() {
  if ! grep -q ']}$' "$RESULTS_JSON" 2>/dev/null; then
    printf ']}' >> "$RESULTS_JSON"
  fi
}

trap finalize_results EXIT

emit_json() {
  local name="$1"
  local group="$2"
  local status="$3"
  local wall="$4"
  if [ $JSON_FIRST -eq 0 ]; then
    printf ',' >> "$RESULTS_JSON"
  fi
  JSON_FIRST=0
  printf '{"name":"%s","group":"%s","status":"%s","wall_time_s":%s}' \
    "$name" "$group" "$status" "$wall" >> "$RESULTS_JSON"
}

safe_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

print_sysinfo() {
  local out="$RESULTS_DIR/system_info.txt"
  {
    echo "Timestamp: $(date -Is 2>/dev/null || date)"
    echo "Hostname: $(hostname 2>/dev/null || true)"
    echo "Uname: $(uname -a 2>/dev/null || true)"
    if safe_cmd lscpu; then
      echo ""
      echo "== lscpu =="
      lscpu
    fi
    if safe_cmd free; then
      echo ""
      echo "== free -h =="
      free -h
    fi
    if safe_cmd lsblk; then
      echo ""
      echo "== lsblk =="
      lsblk -d -o NAME,SIZE,MODEL,ROTA,TYPE,TRAN
    fi
    if safe_cmd df; then
      echo ""
      echo "== df -h =="
      df -h
    fi
  } > "$out" 2>&1
}

print_sysinfo

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
  "System: Thermal Throttle"
  "Network: Latency"
  "Network: Throughput"
)

bench_cmds=(
  "cd $BENCH_DIR/rust/matrix_multiply && cargo run --release"
  "cd $BENCH_DIR/rust/compile_bench && cargo clean 2>/dev/null; cargo build --release"
  "cd $BENCH_DIR/rust/web_server_load && cargo run --release"
  "cd $BENCH_DIR/python && python3 data_processing.py"
  "cd $BENCH_DIR/python && STRESS_DIAGNOSE=$VERBOSE STRESS_SMALL=$SMALL_MODE python3 ml_training.py"
  "cd $BENCH_DIR/python && python3 async_io.py"
  "cd $BENCH_DIR/cpp && g++ -O2 -std=c++17 -o raytracer raytracer.cpp -lpthread && ./raytracer"
  "cd $BENCH_DIR/cpp/compile_bench && make clean 2>/dev/null; make -j\$(nproc)"
  "cd $BENCH_DIR/cpp && g++ -O2 -std=c++17 -o sorting sorting.cpp -lpthread && ./sorting"
  "bash $BENCH_DIR/system/disk_io.sh"
  "bash $BENCH_DIR/system/memory_bw.sh"
  "bash $BENCH_DIR/system/multicore.sh"
  "bash $BENCH_DIR/system/cpu_single.sh"
  "bash $BENCH_DIR/system/thermal_throttle.sh"
  "bash $BENCH_DIR/system/network_latency.sh"
  "bash $BENCH_DIR/system/network_throughput.sh"
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
  "system"
  "network"
  "network"
)

run_bench() {
  local name="$1"
  local cmd="$2"
  local group="$3"
  local log="$RESULTS_DIR/$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' /:' '___')".log
  echo ">>> [$name]"
  if [ "$VERBOSE" = "1" ]; then
    echo "    Cmd: $cmd"
    echo "    Log: $log"
  fi
  START=$(date +%s%N)
  if [ "$VERBOSE" = "1" ]; then
    eval "$cmd" 2>&1 | tee "$log"
    STATUS=${PIPESTATUS[0]}
  else
    eval "$cmd" >"$log" 2>&1
    STATUS=$?
  fi
  END=$(date +%s%N)
  WALL=$(echo "scale=3; ($END - $START) / 1000000000" | bc)
  if [ "$STATUS" -ne 0 ]; then
    echo "    Status: FAIL (exit $STATUS)"
  fi
  echo "    Wall time: ${WALL}s"
  RESULTS="$RESULTS\n$name: ${WALL}s"
  printf '%s,%s,%s,%s\n' "$name" "$group" "$([ "$STATUS" -eq 0 ] && echo OK || echo FAIL)" "$WALL" >> "$RESULTS_CSV"
  emit_json "$name" "$group" "$([ "$STATUS" -eq 0 ] && echo OK || echo FAIL)" "$WALL"
  echo ""
  if [ "$STATUS" -ne 0 ] && [ "$FAIL_FAST" = "1" ]; then
    echo "Fail-fast enabled; stopping."
    exit "$STATUS"
  fi
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
  echo "Env: STRESS_VERBOSE=1 STRESS_FAIL_FAST=1 STRESS_SMALL=1"
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
    run_bench "${bench_names[$idx]}" "${bench_cmds[$idx]}" "$group"
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
echo -e "$RESULTS" | tee "$RESULTS_TXT"
echo ""
echo "Results saved in: $RESULTS_DIR"
