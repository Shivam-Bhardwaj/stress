#!/usr/bin/env bash
set -euo pipefail

DURATION="${STRESS_THERMAL_DURATION:-60}"
SAMPLE_INTERVAL=1

read_freq_khz() {
  local total=0
  local count=0
  for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq; do
    if [ -r "$f" ]; then
      total=$((total + $(cat "$f")))
      count=$((count + 1))
    fi
  done
  if [ "$count" -gt 0 ]; then
    echo $((total / count))
  else
    echo 0
  fi
}

read_temp_c() {
  local max_millic=0
  local found=0
  for t in /sys/class/thermal/thermal_zone*/temp; do
    if [ -r "$t" ]; then
      v=$(cat "$t")
      if [ "$v" -gt "$max_millic" ]; then
        max_millic="$v"
      fi
      found=1
    fi
  done
  if [ "$found" -eq 1 ]; then
    echo "$(awk "BEGIN { printf \"%.1f\", $max_millic/1000 }")"
  else
    echo "0.0"
  fi
}

cpu_stress() {
  python3 - <<PY
import os
import time
from multiprocessing import Process

def burn():
    x = 0
    end = time.time() + ${DURATION}
    while time.time() < end:
        x = (x * 1664525 + 1013904223) & 0xFFFFFFFF
    return x

procs = []
for _ in range(os.cpu_count() or 1):
    p = Process(target=burn)
    p.daemon = True
    p.start()
    procs.append(p)
for p in procs:
    p.join()
PY
}

echo "Thermal Throttle Benchmark: ${DURATION}s CPU stress with temp/freq sampling"

start_freq=$(read_freq_khz)
max_temp="0.0"
min_freq=99999999
sum_freq=0
samples=0

cpu_stress &
stress_pid=$!

end_ts=$((SECONDS + DURATION))
while [ $SECONDS -lt $end_ts ]; do
  temp=$(read_temp_c)
  freq=$(read_freq_khz)
  if awk "BEGIN {exit !($temp > $max_temp)}"; then
    max_temp="$temp"
  fi
  if [ "$freq" -gt 0 ] && [ "$freq" -lt "$min_freq" ]; then
    min_freq="$freq"
  fi
  if [ "$freq" -gt 0 ]; then
    sum_freq=$((sum_freq + freq))
    samples=$((samples + 1))
  fi
  sleep "$SAMPLE_INTERVAL"
done

wait "$stress_pid" 2>/dev/null || true

avg_freq=0
if [ "$samples" -gt 0 ]; then
  avg_freq=$((sum_freq / samples))
fi

echo "Start freq: ${start_freq} kHz"
echo "Min freq:   ${min_freq} kHz"
echo "Avg freq:   ${avg_freq} kHz"
echo "Max temp:   ${max_temp} C"
echo "RESULT:system_thermal_throttle:${min_freq}:${max_temp}"
