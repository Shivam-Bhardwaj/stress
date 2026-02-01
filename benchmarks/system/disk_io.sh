#!/usr/bin/env bash
set -e
echo "=== Disk I/O Benchmark ==="

TMPDIR=$(mktemp -d)
TESTFILE="$TMPDIR/testfile"

# Sequential write — 1GB with dd
echo "Sequential write (1GB)..."
WRITE_START=$(date +%s%N)
dd if=/dev/zero of="$TESTFILE" bs=1M count=1024 conv=fdatasync 2>&1
WRITE_END=$(date +%s%N)
WRITE_SEC=$(echo "scale=3; ($WRITE_END - $WRITE_START) / 1000000000" | bc)
WRITE_SPEED=$(echo "scale=1; 1024 / $WRITE_SEC" | bc)
echo "Sequential write: ${WRITE_SEC}s (${WRITE_SPEED} MB/s)"

# Sequential read
echo "Sequential read (1GB)..."
# Drop caches if possible
sync
echo 3 | sudo tee /proc/sys/vm/drop_caches 2>/dev/null || true
READ_START=$(date +%s%N)
dd if="$TESTFILE" of=/dev/null bs=1M 2>&1
READ_END=$(date +%s%N)
READ_SEC=$(echo "scale=3; ($READ_END - $READ_START) / 1000000000" | bc)
READ_SPEED=$(echo "scale=1; 1024 / $READ_SEC" | bc)
echo "Sequential read: ${READ_SEC}s (${READ_SPEED} MB/s)"

# Random 4K I/O (simple version without fio)
echo "Random 4K write (10000 ops)..."
RND_START=$(date +%s%N)
for i in $(seq 1 10000); do
    dd if=/dev/urandom of="$TMPDIR/rnd_$((i % 100))" bs=4K count=1 conv=notrunc 2>/dev/null
done
RND_END=$(date +%s%N)
RND_SEC=$(echo "scale=3; ($RND_END - $RND_START) / 1000000000" | bc)
RND_IOPS=$(echo "scale=0; 10000 / $RND_SEC" | bc)
echo "Random 4K: ${RND_SEC}s (${RND_IOPS} IOPS)"

# Cleanup
rm -rf "$TMPDIR"

TOTAL=$(echo "scale=3; $WRITE_SEC + $READ_SEC + $RND_SEC" | bc)
echo "Total: ${TOTAL}s"
echo "RESULT:system_disk_io:$TOTAL"
