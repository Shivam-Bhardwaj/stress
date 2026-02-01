# Stress — Benchmark Suite

A menu-driven CLI benchmark suite that runs real-world developer benchmarks (Rust, Python, C++) locally on Linux machines for performance testing and stress evaluation.

## Quick Start

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
- **CPU Single-core** — Prime sieve to measure single-thread CPU speed

## How It Works

1. `run_all.sh` installs dependencies via `benchmarks/setup.sh`
2. Choose benchmarks from the CLI menu (or press Enter for all)
3. Each benchmark runs locally and prints wall time
4. A summary is printed at the end
