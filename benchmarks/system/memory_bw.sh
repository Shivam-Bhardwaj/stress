#!/usr/bin/env bash
set -e
echo "=== Memory Bandwidth Benchmark ==="

# Create a simple C program for memcpy bandwidth test
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/membw.c" << 'CEOF'
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

int main() {
    const size_t SIZE = 256 * 1024 * 1024; // 256 MB
    const int ITERATIONS = 10;

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
gcc -O2 -o "$TMPDIR/membw" "$TMPDIR/membw.c"

echo "Running..."
"$TMPDIR/membw"

rm -rf "$TMPDIR"
