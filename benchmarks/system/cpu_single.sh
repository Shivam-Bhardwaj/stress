#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
import math

limit = 5_000_000
sieve = bytearray(b"\x01") * (limit + 1)
sieve[0:2] = b"\x00\x00"

for i in range(2, int(math.isqrt(limit)) + 1):
    if sieve[i]:
        start = i * i
        step = i
        sieve[start:limit + 1:step] = b"\x00" * (((limit - start) // step) + 1)

print(sieve.count(1))
PY
