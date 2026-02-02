#!/usr/bin/env python3
"""
Interactive stress test (CPU + RAM + Disk) with a lightweight ASCII TUI.
Press Q to stop and print a short report.
"""
import argparse
import curses
import os
import signal
import tempfile
import time
from multiprocessing import Event, Process, Value


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


def read_freq_khz():
    total = 0
    count = 0
    try:
        entries = os.listdir("/sys/devices/system/cpu")
    except OSError:
        return 0
    for f in entries:
        if not f.startswith("cpu") or not f[3:].isdigit():
            continue
        path = f"/sys/devices/system/cpu/{f}/cpufreq/scaling_cur_freq"
        try:
            with open(path, "r", encoding="utf-8") as fh:
                total += int(fh.read().strip())
                count += 1
        except OSError:
            continue
    if count == 0:
        return 0
    return total // count


def read_temp_c():
    max_millic = 0
    found = False
    try:
        entries = os.listdir("/sys/class/thermal")
    except OSError:
        entries = []
    for tdir in entries:
        if not tdir.startswith("thermal_zone"):
            continue
        path = f"/sys/class/thermal/{tdir}/temp"
        try:
            with open(path, "r", encoding="utf-8") as fh:
                v = int(fh.read().strip())
            if v > max_millic:
                max_millic = v
            found = True
        except OSError:
            continue
    if not found:
        return 0.0
    return max_millic / 1000.0


def cpu_worker(stop: Event):
    x = 0
    while not stop.is_set():
        x = (x * 1664525 + 1013904223) & 0xFFFFFFFF
    return x


def mem_worker(stop: Event, target_mb: int):
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


def disk_worker(stop: Event, bytes_written: Value, tmpdir: str, max_bytes: int, disk_error: Value):
    path = os.path.join(tmpdir, "stress_all.dat")
    block = b"x" * (4 * 1024 * 1024)
    written_in_file = 0
    with open(path, "wb") as f:
        while not stop.is_set():
            if written_in_file + len(block) > max_bytes:
                f.flush()
                os.fsync(f.fileno())
                f.seek(0)
                written_in_file = 0
            try:
                f.write(block)
            except OSError as e:
                if e.errno == 28:
                    with disk_error.get_lock():
                        disk_error.value = 1
                    break
                raise
            written_in_file += len(block)
            f.flush()
            os.fsync(f.fileno())
            with bytes_written.get_lock():
                bytes_written.value += len(block)


def bar(value, max_value, width):
    if max_value <= 0:
        max_value = 1
    filled = int((value / max_value) * width)
    if filled > width:
        filled = width
    if filled < 0:
        filled = 0
    return "#" * filled + "-" * (width - filled)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mem-mb", type=int, default=0, help="RAM to allocate (MB)")
    parser.add_argument("--disk", action="store_true", help="Enable disk stress (default: on)")
    parser.add_argument("--no-disk", action="store_true", help="Disable disk stress")
    parser.add_argument("--cpu-workers", type=int, default=0, help="CPU workers (default: cores)")
    parser.add_argument("--disk-gb", type=float, default=0.0, help="Max disk file size (GB)")
    parser.add_argument("--temp-dir", type=str, default="", help="Temp dir for disk writes")
    args = parser.parse_args()

    stop = Event()
    if args.temp_dir:
        tmpdir = args.temp_dir
        os.makedirs(tmpdir, exist_ok=True)
    else:
        tmpdir = tempfile.mkdtemp(prefix="stress_all_")
    bytes_written = Value("L", 0)
    disk_error = Value("i", 0)

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
    free_bytes = 0
    if enable_disk:
        try:
            st = os.statvfs(tmpdir)
            free_bytes = st.f_bavail * st.f_frsize
        except OSError:
            free_bytes = 0
    if args.disk_gb > 0:
        disk_max = int(args.disk_gb * 1024 * 1024 * 1024)
    else:
        disk_max = int(free_bytes * 0.05) if free_bytes else 256 * 1024 * 1024
        if disk_max < 256 * 1024 * 1024:
            disk_max = 256 * 1024 * 1024
        if disk_max > 8 * 1024 * 1024 * 1024:
            disk_max = 8 * 1024 * 1024 * 1024

    procs = []
    for _ in range(cpu_workers):
        p = Process(target=cpu_worker, args=(stop,))
        p.start()
        procs.append(p)

    pmem = Process(target=mem_worker, args=(stop, mem_target))
    pmem.start()
    procs.append(pmem)

    if enable_disk:
        pdisk = Process(target=disk_worker, args=(stop, bytes_written, tmpdir, disk_max, disk_error))
        pdisk.start()
        procs.append(pdisk)

    def handle_sigint(_sig, _frame):
        stop.set()

    signal.signal(signal.SIGINT, handle_sigint)

    def tui(stdscr):
        curses.curs_set(0)
        stdscr.nodelay(True)
        stdscr.timeout(200)

        prev_cpu = read_cpu_times()
        last_bytes = 0
        start = time.time()
        initial_freq = read_freq_khz()
        min_freq = initial_freq if initial_freq > 0 else 0
        max_temp = 0.0
        disk_hist = []

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
            disk_hist.append(disk_mb_s)

            temp = read_temp_c()
            freq = read_freq_khz()
            if freq > 0 and (min_freq == 0 or freq < min_freq):
                min_freq = freq
            if temp > 0 and temp > max_temp:
                max_temp = temp

            h, w = stdscr.getmaxyx()
            graph_w = max(10, w - 30)

            stdscr.erase()
            stdscr.addstr(0, 0, "Stress All — press Q to stop")
            stdscr.addstr(1, 0, f"Uptime: {int(time.time() - start)}s  CPU workers: {cpu_workers}")
            disk_info = "off" if not enable_disk else f"on (max {disk_max // (1024*1024)} MB)"
            stdscr.addstr(2, 0, f"Memory target: {mem_target} MB  Disk: {disk_info}")
            stdscr.addstr(4, 0, f"CPU  {cpu:6.1f}% | {bar(cpu, 100.0, graph_w)}")
            stdscr.addstr(5, 0, f"MEM  {mem_pct:6.1f}% | {bar(mem_pct, 100.0, graph_w)}")
            dsk_max = max(disk_hist) if disk_hist else 1.0
            stdscr.addstr(6, 0, f"DSK  {disk_mb_s:6.1f}MB/s | {bar(disk_mb_s, dsk_max, graph_w)}")
            if initial_freq > 0 and min_freq > 0:
                drop_pct = max(0.0, (1.0 - (min_freq / initial_freq)) * 100.0)
                throttle_flag = "YES" if drop_pct >= 15.0 else "no"
                stdscr.addstr(
                    7,
                    0,
                    f"FRQ  {freq/1000:6.2f}GHz min {min_freq/1000:6.2f}GHz "
                    f"drop {drop_pct:4.0f}% | throttle: {throttle_flag}",
                )
            if max_temp > 0:
                stdscr.addstr(8, 0, f"TEMP {temp:6.1f}C max {max_temp:6.1f}C")
            with disk_error.get_lock():
                if disk_error.value == 1:
                    stdscr.addstr(9, 0, "DISK ERROR: No space left; disk stress stopped.")

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
    final_freq = read_freq_khz()
    final_temp = read_temp_c()
    mem_total_mb, mem_used_mb = read_mem_used_mb()
    print("=== Stress All Report ===")
    print(f"CPU workers: {cpu_workers}")
    print(f"Memory target: {mem_target} MB")
    print(f"Memory used: {mem_used_mb}/{mem_total_mb} MB")
    if initial_freq > 0 and min_freq > 0:
        drop_pct = max(0.0, (1.0 - (min_freq / initial_freq)) * 100.0)
        print(f"CPU freq start: {initial_freq/1000:.2f} GHz")
        print(f"CPU freq min:   {min_freq/1000:.2f} GHz")
        print(f"CPU freq final: {final_freq/1000:.2f} GHz")
        print(f"Freq drop:      {drop_pct:.0f}%")
    if max_temp > 0 or final_temp > 0:
        print(f"Max temp:       {max_temp:.1f} C")
        print(f"Final temp:     {final_temp:.1f} C")
    with bytes_written.get_lock():
        bw = bytes_written.value
    with disk_error.get_lock():
        derr = disk_error.value
    if enable_disk:
        print(f"Disk bytes written: {bw}")
        if derr == 1:
            print("Disk status: stopped due to no space left on device")
    print(f"Ended at: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(total_sec))}")


if __name__ == "__main__":
    main()
