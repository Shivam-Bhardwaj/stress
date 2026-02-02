#!/usr/bin/env python3
"""
Interactive stress test (CPU + RAM + Disk) with a lightweight ASCII TUI.
Press Q to stop and print a short report.
"""
import argparse
import curses
import os
import queue
import signal
import tempfile
import time
from multiprocessing import Event, Process, Value

LEVELS = " .:-=+*#%@"


def read_mem_total_mb():
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        return None
    return None


def read_mem_used_mb():
    mem_total = mem_free = buffers = cached = 0
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    mem_total = int(line.split()[1])
                elif line.startswith("MemFree:"):
                    mem_free = int(line.split()[1])
                elif line.startswith("Buffers:"):
                    buffers = int(line.split()[1])
                elif line.startswith("Cached:"):
                    cached = int(line.split()[1])
    except OSError:
        return 0, 0
    used = mem_total - mem_free - buffers - cached
    return mem_total // 1024, used // 1024


def read_cpu_times():
    try:
        with open("/proc/stat", "r", encoding="utf-8") as f:
            parts = f.readline().split()
            if parts[0] != "cpu":
                return None
            nums = list(map(int, parts[1:8]))
            total = sum(nums)
            idle = nums[3] + nums[4]
            return total, idle
    except OSError:
        return None


def cpu_worker(stop: Event):
    x = 0
    while not stop.is_set():
        x = (x * 1664525 + 1013904223) & 0xFFFFFFFF
    return x


def mem_worker(stop: Event, target_mb: int):
    # Allocate and touch memory in chunks
    chunk = 64 * 1024 * 1024
    data = []
    allocated = 0
    while allocated < target_mb and not stop.is_set():
        buf = bytearray(chunk)
        for i in range(0, len(buf), 4096):
            buf[i] = 1
        data.append(buf)
        allocated += chunk // (1024 * 1024)
    while not stop.is_set():
        time.sleep(0.2)


def disk_worker(stop: Event, bytes_written: Value, tmpdir: str):
    path = os.path.join(tmpdir, "stress_all.dat")
    block = b"x" * (4 * 1024 * 1024)
    with open(path, "wb") as f:
        while not stop.is_set():
            f.write(block)
            f.flush()
            os.fsync(f.fileno())
            with bytes_written.get_lock():
                bytes_written.value += len(block)


def sparkline(values, width):
    if not values:
        return ""
    vals = values[-width:]
    vmax = max(vals) if max(vals) > 0 else 1
    out = []
    for v in vals:
        idx = int((v / vmax) * (len(LEVELS) - 1))
        out.append(LEVELS[idx])
    return "".join(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mem-mb", type=int, default=0, help="RAM to allocate (MB)")
    parser.add_argument("--disk", action="store_true", help="Enable disk stress (default: on)")
    parser.add_argument("--no-disk", action="store_true", help="Disable disk stress")
    parser.add_argument("--cpu-workers", type=int, default=0, help="CPU workers (default: cores)")
    args = parser.parse_args()

    stop = Event()
    tmpdir = tempfile.mkdtemp(prefix="stress_all_")
    bytes_written = Value("L", 0)

    mem_total = read_mem_total_mb() or 0
    if args.mem_mb > 0:
        mem_target = args.mem_mb
    else:
        mem_target = int(mem_total * 0.6) if mem_total else 512
        if mem_target < 256:
            mem_target = 256
        if mem_target > 8192:
            mem_target = 8192

    cpu_workers = args.cpu_workers if args.cpu_workers > 0 else (os.cpu_count() or 1)
    enable_disk = False if args.no_disk else True

    procs = []
    for _ in range(cpu_workers):
        p = Process(target=cpu_worker, args=(stop,))
        p.start()
        procs.append(p)

    pmem = Process(target=mem_worker, args=(stop, mem_target))
    pmem.start()
    procs.append(pmem)

    if enable_disk:
        pdisk = Process(target=disk_worker, args=(stop, bytes_written, tmpdir))
        pdisk.start()
        procs.append(pdisk)

    def handle_sigint(_sig, _frame):
        stop.set()

    signal.signal(signal.SIGINT, handle_sigint)

    def tui(stdscr):
        curses.curs_set(0)
        stdscr.nodelay(True)
        stdscr.timeout(200)

        cpu_hist = []
        mem_hist = []
        disk_hist = []

        prev_cpu = read_cpu_times()
        last_bytes = 0
        start = time.time()

        while not stop.is_set():
            ch = stdscr.getch()
            if ch in (ord("q"), ord("Q")):
                stop.set()
                break

            now = time.time()
            cpu = 0.0
            cur = read_cpu_times()
            if prev_cpu and cur:
                total = cur[0] - prev_cpu[0]
                idle = cur[1] - prev_cpu[1]
                if total > 0:
                    cpu = 100.0 * (total - idle) / total
            prev_cpu = cur

            mem_total_mb, mem_used_mb = read_mem_used_mb()
            mem_pct = (mem_used_mb / mem_total_mb * 100.0) if mem_total_mb else 0.0

            with bytes_written.get_lock():
                bw = bytes_written.value
            delta_bytes = bw - last_bytes
            last_bytes = bw
            disk_mb_s = delta_bytes / (1024 * 1024) / max(0.2, (time.time() - now))

            cpu_hist.append(cpu)
            mem_hist.append(mem_pct)
            disk_hist.append(disk_mb_s)

            h, w = stdscr.getmaxyx()
            graph_w = max(10, w - 30)

            stdscr.erase()
            stdscr.addstr(0, 0, "Stress All — press Q to stop")
            stdscr.addstr(1, 0, f"Uptime: {int(time.time() - start)}s  CPU workers: {cpu_workers}")
            stdscr.addstr(2, 0, f"Memory target: {mem_target} MB  Disk: {'on' if enable_disk else 'off'}")
            stdscr.addstr(4, 0, f"CPU  {cpu:6.1f}% | {sparkline(cpu_hist, graph_w)}")
            stdscr.addstr(5, 0, f"MEM  {mem_pct:6.1f}% | {sparkline(mem_hist, graph_w)}")
            stdscr.addstr(6, 0, f"DSK  {disk_mb_s:6.1f}MB/s | {sparkline(disk_hist, graph_w)}")

            stdscr.refresh()
            time.sleep(0.8)

    try:
        curses.wrapper(tui)
    finally:
        stop.set()
        for p in procs:
            p.join(timeout=1)
            if p.is_alive():
                p.terminate()

    total_sec = int(time.time())
    mem_total_mb, mem_used_mb = read_mem_used_mb()
    print("=== Stress All Report ===")
    print(f"CPU workers: {cpu_workers}")
    print(f"Memory target: {mem_target} MB")
    print(f"Memory used: {mem_used_mb}/{mem_total_mb} MB")
    with bytes_written.get_lock():
        bw = bytes_written.value
    print(f"Disk bytes written: {bw}")
    print(f"Ended at: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(total_sec))}")


if __name__ == "__main__":
    main()
