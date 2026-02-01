#!/usr/bin/env bash
set -euo pipefail
echo "=== Memory Bandwidth Benchmark ==="

# Scale buffer size based on system memory (MB), with env override.
mem_total_mb=0
if [ -r /proc/meminfo ]; then
  mem_total_mb=$(awk '/MemTotal:/ {print int($2/1024)}' /proc/meminfo)
fi

if [ -n "${STRESS_MEM_BW_MB:-}" ]; then
  size_mb="$STRESS_MEM_BW_MB"
else
  # Use ~25% of RAM, floor 128MB, cap 2048MB.
  size_mb=$((mem_total_mb / 4))
  if [ "$size_mb" -lt 128 ]; then size_mb=128; fi
  if [ "$size_mb" -gt 2048 ]; then size_mb=2048; fi
fi

# Create a simple C program for memcpy bandwidth test
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/membw.c" << 'CEOF'
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifndef SIZE_MB
#define SIZE_MB 256
#endif
#ifndef ITERATIONS
#define ITERATIONS 10
#endif

int main() {
    const size_t SIZE = (size_t)SIZE_MB * 1024 * 1024;

    char *src = (char *)malloc(SIZE);
    char *dst = (char *)malloc(SIZE);
    if (!src || !dst) { fprintf(stderr, "malloc failed\n"); return 1; }

    // Initialize to avoid lazy allocation
    memset(src, 'A', SIZE);
    memset(dst, 'B', SIZE);

    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);

    for (int i = 0; i < ITERATIONS; i++) {
        memcpy(dst, src, SIZE);
    }

    clock_gettime(CLOCK_MONOTONIC, &end);

    double elapsed = (end.tv_sec - start.tv_sec) + (end.tv_nsec - start.tv_nsec) / 1e9;
    double total_gb = (double)SIZE * ITERATIONS / (1024.0 * 1024.0 * 1024.0);
    double bandwidth = total_gb / elapsed;

    printf("Buffer size: %zu MB\n", SIZE / (1024*1024));
    printf("Iterations: %d\n", ITERATIONS);
    printf("Total copied: %.1f GB\n", total_gb);
    printf("Time: %.3fs\n", elapsed);
    printf("Bandwidth: %.2f GB/s\n", bandwidth);
    printf("RESULT:system_memory_bw:%.4f\n", elapsed);

    free(src);
    free(dst);
    return 0;
}
CEOF

echo "Compiling memory bandwidth test..."
gcc -O2 -DSIZE_MB="$size_mb" -o "$TMPDIR/membw" "$TMPDIR/membw.c"

echo "Running..."
"$TMPDIR/membw"

rm -rf "$TMPDIR"
