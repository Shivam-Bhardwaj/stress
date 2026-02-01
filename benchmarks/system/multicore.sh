#!/usr/bin/env bash
set -e
echo "=== Multi-core Scaling Benchmark ==="

TOTAL_CORES=$(nproc)
echo "Available cores: $TOTAL_CORES"

# Create a CPU-intensive worker
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/worker.c" << 'CEOF'
#include <stdio.h>
#include <math.h>

int main() {
    // CPU-intensive computation: compute many square roots
    double sum = 0;
    for (long i = 0; i < 50000000L; i++) {
        sum += sin((double)i * 0.000001) * cos((double)i * 0.000002);
    }
    printf("%.6f\n", sum);
    return 0;
}
CEOF

gcc -O2 -o "$TMPDIR/worker" "$TMPDIR/worker.c" -lm

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
