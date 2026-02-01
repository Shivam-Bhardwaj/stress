#!/usr/bin/env bash
set -euo pipefail
echo "=== Multi-core Scaling Benchmark ==="

TOTAL_CORES=$(nproc)
echo "Available cores: $TOTAL_CORES"

# Create a CPU-intensive worker
TMPDIR=$(mktemp -d)
ITER_BASE="${STRESS_MULTICORE_ITERS:-50000000}"
if [ -n "${STRESS_MULTICORE_SCALE:-}" ]; then
  ITER_SCALE="${STRESS_MULTICORE_SCALE}"
else
  ITER_SCALE=$((TOTAL_CORES / 4))
  if [ "$ITER_SCALE" -lt 1 ]; then ITER_SCALE=1; fi
fi
ITERATIONS=$((ITER_BASE * ITER_SCALE))

cat > "$TMPDIR/worker.c" << 'CEOF'
#include <stdio.h>
#include <math.h>

#ifndef ITERATIONS
#define ITERATIONS 50000000L
#endif

int main() {
    // CPU-intensive computation: compute many square roots
    double sum = 0;
    for (long i = 0; i < ITERATIONS; i++) {
        sum += sin((double)i * 0.000001) * cos((double)i * 0.000002);
    }
    printf("%.6f\n", sum);
    return 0;
}
CEOF

gcc -O2 -DITERATIONS="${ITERATIONS}L" -o "$TMPDIR/worker" "$TMPDIR/worker.c" -lm

WORK_PER_CORE=1  # Each core runs 1 worker instance

run_with_cores() {
    local cores=$1
    echo -n "  ${cores} core(s): "

    START=$(date +%s%N)
    pids=()
    for i in $(seq 1 $cores); do
        "$TMPDIR/worker" > /dev/null &
        pids+=($!)
    done
    for pid in "${pids[@]}"; do
        wait $pid
    done
    END=$(date +%s%N)
    ELAPSED=$(echo "scale=3; ($END - $START) / 1000000000" | bc)
    SPEEDUP=$(echo "scale=2; $SINGLE / $ELAPSED" | bc 2>/dev/null || echo "1.00")
    echo "${ELAPSED}s (speedup: ${SPEEDUP}x)"
    echo "$ELAPSED"
}

# Single core baseline
echo "Running single-core baseline..."
START=$(date +%s%N)
"$TMPDIR/worker" > /dev/null
END=$(date +%s%N)
SINGLE=$(echo "scale=3; ($END - $START) / 1000000000" | bc)
echo "  1 core: ${SINGLE}s (baseline)"

# Scale up
LAST_TIME=$SINGLE
for cores in 2 4 8 $TOTAL_CORES; do
    if [ $cores -gt $TOTAL_CORES ]; then continue; fi
    if [ $cores -eq 1 ]; then continue; fi
    LAST_TIME=$(run_with_cores $cores)
done

echo "RESULT:system_multicore:$LAST_TIME"

rm -rf "$TMPDIR"
