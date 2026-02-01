#!/usr/bin/env bash
set -euo pipefail
echo "=== Disk I/O Benchmark ==="

TMPDIR=$(mktemp -d)
TESTFILE="$TMPDIR/testfile"

# Use sudo only when needed.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

# Scale size based on free space, with env override.
free_mb=$(df -Pm "$TMPDIR" | awk 'NR==2 {print $4}')
if [ -n "${STRESS_DISK_MB:-}" ]; then
  test_mb="$STRESS_DISK_MB"
else
  # Use ~20% of free space, floor 512MB, cap 4096MB.
  test_mb=$((free_mb / 5))
  if [ "$test_mb" -lt 512 ]; then test_mb=512; fi
  if [ "$test_mb" -gt 4096 ]; then test_mb=4096; fi
fi

ops=$((test_mb * 10))
if [ "$ops" -lt 5000 ]; then ops=5000; fi
if [ "$ops" -gt 50000 ]; then ops=50000; fi

# Sequential write
echo "Sequential write (${test_mb}MB)..."
WRITE_START=$(date +%s%N)
dd if=/dev/zero of="$TESTFILE" bs=1M count="$test_mb" conv=fdatasync 2>&1
WRITE_END=$(date +%s%N)
WRITE_SEC=$(echo "scale=3; ($WRITE_END - $WRITE_START) / 1000000000" | bc)
WRITE_SPEED=$(echo "scale=1; $test_mb / $WRITE_SEC" | bc)
echo "Sequential write: ${WRITE_SEC}s (${WRITE_SPEED} MB/s)"

# Sequential read
echo "Sequential read (${test_mb}MB)..."
# Drop caches if possible
sync
echo 3 | $SUDO tee /proc/sys/vm/drop_caches 2>/dev/null || true
READ_START=$(date +%s%N)
dd if="$TESTFILE" of=/dev/null bs=1M 2>&1
READ_END=$(date +%s%N)
READ_SEC=$(echo "scale=3; ($READ_END - $READ_START) / 1000000000" | bc)
READ_SPEED=$(echo "scale=1; $test_mb / $READ_SEC" | bc)
echo "Sequential read: ${READ_SEC}s (${READ_SPEED} MB/s)"

# Random 4K I/O (simple version without fio)
echo "Random 4K write (${ops} ops)..."
RND_START=$(date +%s%N)
for i in $(seq 1 "$ops"); do
    dd if=/dev/urandom of="$TMPDIR/rnd_$((i % 100))" bs=4K count=1 conv=notrunc 2>/dev/null
done
RND_END=$(date +%s%N)
RND_SEC=$(echo "scale=3; ($RND_END - $RND_START) / 1000000000" | bc)
RND_IOPS=$(echo "scale=0; $ops / $RND_SEC" | bc)
echo "Random 4K: ${RND_SEC}s (${RND_IOPS} IOPS)"

# Cleanup
rm -rf "$TMPDIR"

TOTAL=$(echo "scale=3; $WRITE_SEC + $READ_SEC + $RND_SEC" | bc)
echo "Total: ${TOTAL}s"
echo "RESULT:system_disk_io:$TOTAL"
