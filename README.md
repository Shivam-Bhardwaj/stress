# Stress — Benchmark Suite

A web-based benchmark suite with a GUI that runs real-world developer benchmarks (Rust, Python, C++) on any machine via SSH, with live streaming output via WebSockets.

## Quick Start

```bash
cd server
npm install
npm start
```

Open http://localhost:3000 in your browser.

## CLI Mode

Run all benchmarks locally without the GUI:

```bash
bash run_all.sh
```

## Benchmarks

### Rust
- **Matrix Multiply** — 1024x1024 f64 matrix multiplication, pure Rust
- **Compile Benchmark** — cargo build on a workspace with serde, tokio, async
- **Web Server Load** — actix-web + reqwest, 10k requests, 100 concurrent

### Python
- **Data Processing** — 1M-row pandas groupby/merge/pivot pipeline
- **ML Training** — 100k samples RandomForest with 5-fold cross-validation
- **Async I/O** — aiohttp server + 10k concurrent requests + file I/O

### C++
- **Ray Tracer** — 1920x1080 scene with reflections and soft shadows
- **Compile Benchmark** — Template-heavy multi-file project with -O2
- **Sorting** — 100M random uint64, std::sort + parallel merge sort

### System
- **Disk I/O** — Sequential read/write (1GB) + random 4K operations
- **Memory Bandwidth** — 256MB buffer memcpy, 10 iterations
- **Multi-core Scaling** — CPU workload across 1, 2, 4, 8, all cores

### Network (between machines)
- **Latency** — Ping round-trip
- **Throughput** — iperf3 TCP bandwidth
- **SSH Overhead** — Connection + trivial command time

## How It Works

1. Add target machines with SSH credentials
2. Select benchmarks to run
3. Click Run — the server SSHes into each target
4. Benchmark files are deployed via tar/SSH
5. `setup.sh` installs dependencies on first run
6. Each benchmark streams live output over WebSocket
7. Results are parsed and displayed in a comparison table

## Architecture

- **Backend:** Node.js + Express + `ws` + `ssh2`
- **Frontend:** Vanilla HTML/CSS/JS (no framework, no build step)
- **Benchmarks:** Self-contained source files deployed to targets
