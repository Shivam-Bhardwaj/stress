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
STRESS_CUDA_DURATION=600 STRESS_CUDA_SIZE_MB=2048 STRESS_CUDA_ITERS=512 \
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
- **Rust Stress (CPU/RAM/Disk)** — Randomized mixed load with live 3‑line ASCII graph
- **Thermal Throttle** — 60s CPU stress with temp/frequency sampling

### GPU
- **CUDA Stress** — GPU compute + memory stress with per‑second throughput

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

Rust version (memory-safe, randomized mixed load with a 3‑line ASCII chart):

```bash
bash run_rust_stress.sh --duration 600
```

One script to stress CPU/RAM/Disk + GPU (if available) and log CSVs:

```bash
bash run_stress_full.sh
```

Note: Ctrl+C stops both Rust + CUDA; the script now force‑terminates lingering GPU workers.

Controls:
- Python UI: press `Q` to stop and print a short report.
- Rust UI: press `Ctrl+C` to stop.

Options:
```bash
python3 benchmarks/system/stress_all.py --mem-mb 4096 --cpu-workers 8
python3 benchmarks/system/stress_all.py --no-disk
python3 benchmarks/system/stress_all.py --disk-gb 2
python3 benchmarks/system/stress_all.py --temp-dir /var/tmp
```

Rust options (examples):

```bash
bash run_rust_stress.sh --mem-mb 16384 --disk-gb 8 --cpu-workers 32
bash run_rust_stress.sh --no-disk --duration 300
bash run_rust_stress.sh --csv /tmp/stress_samples.csv
bash run_rust_stress.sh --graph-height 8 --graph-width 100
bash run_rust_stress.sh --gpu-status /tmp/gpu_status.txt
```

Full stress options (examples):

```bash
STRESS_DURATION=900 STRESS_RUST_ARGS="--mem-mb 16000 --disk-gb 8" \\
  STRESS_CUDA_DURATION=900 bash run_stress_full.sh
```

CUDA stress (examples):

```bash
bash benchmarks/cuda/cuda_stress.sh
STRESS_CUDA_DURATION=300 STRESS_CUDA_SIZE_MB=1024 STRESS_CUDA_ITERS=512 \
  bash benchmarks/cuda/cuda_stress.sh
```

Graph legend (Python UI):
- CPU/MEM bars are % utilization (0–100).
- DSK is write throughput (MB/s). It writes to a capped file and rewrites in place.
- FRQ shows average CPU frequency; a large drop indicates throttling.
- OPS shows raw compute throughput (ops/sec); 1c is single-core baseline.

Rust chart notes:
- CPU/MEM/DSK lines are scaled to the left axis (0–100% or peak MB/s).
- `*` marks samples; `|` connects vertical changes in the line.
- Ops lines show per‑second rate for CPU (loop ops), MEM (touch ops), and DSK (IOPS).
- SENS line shows temp (max thermal zone), avg CPU freq, load averages, and mem used/total.
- GPU line (if enabled) shows util, mem util, temp, and clocks.
