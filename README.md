# Stress — Benchmark Suite

A menu-driven CLI benchmark suite that runs real-world developer benchmarks (Rust, Python, C++) locally on Linux machines for performance testing and stress evaluation.

## Quick Start

```bash
bash run_all.sh
```

Optional env flags:

```bash
STRESS_VERBOSE=1 STRESS_SMALL=1 STRESS_FAIL_FAST=1 bash run_all.sh
```

Duration profiles (auto‑tune test sizes):

```bash
STRESS_DURATION=5 bash run_all.sh   # ~5 minutes
STRESS_DURATION=10 bash run_all.sh  # ~10 minutes (default)
STRESS_DURATION=30 bash run_all.sh  # ~30 minutes
```

If `STRESS_DURATION` is not set, the runner will prompt you to choose 5/10/30.

Scaling & overrides:

```bash
# Force sizes/loads
STRESS_MEM_BW_MB=1024 STRESS_DISK_MB=2048 STRESS_ROWS=800000 \
STRESS_ASYNC_REQUESTS=15000 STRESS_ASYNC_CONCURRENCY=200 STRESS_ASYNC_FILES=1500 \
STRESS_MULTICORE_ITERS=60000000 STRESS_MULTICORE_SCALE=2 \
STRESS_THERMAL_DURATION=120 \
STRESS_NET_TARGET=8.8.8.8 STRESS_IPERF_TARGET=iperf.example.com \
bash run_all.sh
```

## Benchmarks

### Rust
- **Matrix Multiply** — 1024x1024 f64 matrix multiplication, pure Rust
- **Compile Benchmark** — cargo build on a workspace with serde, tokio, async
- **Web Server Load** — actix-web + reqwest, 10k requests, 100 concurrent

### Python
- **Data Processing** — pandas groupby/merge/pivot pipeline (rows scale to RAM)
- **ML Training** — RandomForest with 5-fold cross-validation (auto small-mode on low RAM)
- **Async I/O** — aiohttp server + concurrent requests + file I/O (load scales to cores)

### C++
- **Ray Tracer** — 1920x1080 scene with reflections and soft shadows
- **Compile Benchmark** — Template-heavy multi-file project with -O2
- **Sorting** — 100M random uint64, std::sort + parallel merge sort

### System
- **Disk I/O** — Sequential read/write (scaled to free space) + random 4K operations
- **Memory Bandwidth** — memcpy bandwidth (buffer scaled to RAM)
- **Multi-core Scaling** — CPU workload across 1, 2, 4, 8, all cores
- **CPU Single-core** — Prime sieve to measure single-thread CPU speed
- **Thermal Throttle** — 60s CPU stress with temp/frequency sampling

## How It Works

1. `run_all.sh` installs dependencies via `benchmarks/setup.sh`
2. Choose benchmarks from the CLI menu (or press Enter for all)
3. Each benchmark runs locally and prints wall time
4. Results/logs are saved under `results/YYYYMMDD_HHMMSS`
5. A summary is printed at the end (plus CSV/JSON output)

### Network
- **Latency** — ping round-trip to `STRESS_NET_TARGET` (default 1.1.1.1)
- **Throughput** — iperf3 client to `STRESS_IPERF_TARGET` (set env var)

## SSH Setup Notes (New Machine → New Server)

Goal: connect from a different machine (Windows/macOS/Linux) to a fresh Linux server.

### Generate a key (client machine)
Linux/macOS:
```bash
ssh-keygen -t ed25519 -C "you@example.com"
```

Windows (PowerShell):
```powershell
ssh-keygen -t ed25519 -C "you@example.com"
```

### Add the public key to the server
Option A — one-liner (recommended):
```bash
ssh-copy-id root@SERVER_IP
```

Option B — manual:
```bash
cat ~/.ssh/id_ed25519.pub
```
Copy the output, then on the server:
```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Connect
```bash
ssh root@SERVER_IP
```

### Windows tips
- Termius: create a new host, add username + IP, then add your private key.
- Built-in OpenSSH: use PowerShell/Windows Terminal with `ssh root@SERVER_IP`.

### Optional hardening (server)
Edit `/etc/ssh/sshd_config` and set:
```
PasswordAuthentication no
PermitRootLogin prohibit-password
```
Then restart SSH:
```bash
sudo systemctl restart ssh
```

## Interactive Thermal/Stress UI

Run the interactive CPU/RAM/Disk stress test with a live ASCII graph:

```bash
bash run_stress_all.sh
```

Controls:
- Press `Q` to stop and print a short report.

Options:
```bash
python3 benchmarks/system/stress_all.py --mem-mb 4096 --cpu-workers 8
python3 benchmarks/system/stress_all.py --no-disk
```
