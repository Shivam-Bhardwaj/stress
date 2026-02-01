// Benchmark definitions — each benchmark has a name, category, setup command, and run command.
// Commands are executed on the remote machine. The run command must print RESULT:<name>:<seconds> to stdout.

const BENCHMARKS = {
  // ── Rust ──────────────────────────────────────────────
  rust_matrix_multiply: {
    name: 'Matrix Multiply (Rust)',
    category: 'rust',
    description: '1024x1024 f64 matrix multiplication — pure Rust, no BLAS',
    setup: 'cd ~/stress-benchmarks/rust/matrix_multiply && cargo build --release 2>&1',
    run: 'cd ~/stress-benchmarks/rust/matrix_multiply && cargo run --release 2>&1',
  },
  rust_compile_bench: {
    name: 'Compile Benchmark (Rust)',
    category: 'rust',
    description: 'cargo build --release on a workspace with generics and async code',
    setup: 'cd ~/stress-benchmarks/rust/compile_bench && cargo clean 2>&1',
    run: `cd ~/stress-benchmarks/rust/compile_bench && START=$(date +%s%N) && cargo build --release 2>&1 && END=$(date +%s%N) && ELAPSED=$(echo "scale=3; ($END - $START) / 1000000000" | bc) && echo "RESULT:rust_compile_bench:$ELAPSED"`,
  },
  rust_web_server_load: {
    name: 'Web Server Load (Rust)',
    category: 'rust',
    description: 'actix-web server + tokio client, 10k requests, 100 concurrent',
    setup: 'cd ~/stress-benchmarks/rust/web_server_load && cargo build --release 2>&1',
    run: 'cd ~/stress-benchmarks/rust/web_server_load && cargo run --release 2>&1',
  },

  // ── Python ────────────────────────────────────────────
  python_data_processing: {
    name: 'Data Processing (Python)',
    category: 'python',
    description: '1M-row pandas groupby/merge/pivot/agg pipeline',
    run: 'cd ~/stress-benchmarks/python && python3 data_processing.py 2>&1',
  },
  python_ml_training: {
    name: 'ML Training (Python)',
    category: 'python',
    description: '100k samples, 50 features, RandomForest 5-fold CV',
    run: 'cd ~/stress-benchmarks/python && python3 ml_training.py 2>&1',
  },
  python_async_io: {
    name: 'Async I/O (Python)',
    category: 'python',
    description: 'asyncio HTTP server + 10k concurrent aiohttp requests',
    run: 'cd ~/stress-benchmarks/python && python3 async_io.py 2>&1',
  },

  // ── C++ ───────────────────────────────────────────────
  cpp_raytracer: {
    name: 'Ray Tracer (C++)',
    category: 'cpp',
    description: '1920x1080 ray traced scene with reflections and soft shadows',
    setup: 'cd ~/stress-benchmarks/cpp && g++ -O2 -std=c++17 -o raytracer raytracer.cpp -lpthread 2>&1',
    run: 'cd ~/stress-benchmarks/cpp && ./raytracer 2>&1',
  },
  cpp_compile_bench: {
    name: 'Compile Benchmark (C++)',
    category: 'cpp',
    description: 'Template-heavy multi-file project with -O2',
    run: `cd ~/stress-benchmarks/cpp/compile_bench && make clean 2>/dev/null; START=$(date +%s%N) && make -j$(nproc) 2>&1 && END=$(date +%s%N) && ELAPSED=$(echo "scale=3; ($END - $START) / 1000000000" | bc) && echo "RESULT:cpp_compile_bench:$ELAPSED"`,
  },
  cpp_sorting: {
    name: 'Sorting 100M ints (C++)',
    category: 'cpp',
    description: '100M random uint64 — std::sort single-thread + parallel',
    setup: 'cd ~/stress-benchmarks/cpp && g++ -O2 -std=c++17 -o sorting sorting.cpp -lpthread 2>&1',
    run: 'cd ~/stress-benchmarks/cpp && ./sorting 2>&1',
  },

  // ── System ────────────────────────────────────────────
  system_disk_io: {
    name: 'Disk I/O',
    category: 'system',
    description: 'Sequential write (dd 1GB) + random 4K read/write',
    run: 'cd ~/stress-benchmarks/system && bash disk_io.sh 2>&1',
  },
  system_memory_bw: {
    name: 'Memory Bandwidth',
    category: 'system',
    description: 'Large buffer memcpy bandwidth test',
    run: 'cd ~/stress-benchmarks/system && bash memory_bw.sh 2>&1',
  },
  system_multicore: {
    name: 'Multi-core Scaling',
    category: 'system',
    description: 'CPU workload across 1, 2, 4, 8, all cores',
    run: 'cd ~/stress-benchmarks/system && bash multicore.sh 2>&1',
  },

  // ── Network ───────────────────────────────────────────
  network_latency: {
    name: 'Network Latency',
    category: 'network',
    description: 'Ping round-trip between machines',
    // run is dynamically built — needs target IP
    run: null,
    needsTarget: true,
    buildRun: (targetHost) => `ping -c 20 ${targetHost} 2>&1 | tail -1 | awk -F'/' '{printf "RESULT:network_latency:%s\\n", $5/1000}'`,
  },
  network_throughput: {
    name: 'Network Throughput',
    category: 'network',
    description: 'iperf3 TCP bandwidth between machines',
    run: null,
    needsTarget: true,
    buildRun: (targetHost) => `iperf3 -c ${targetHost} -t 10 -J 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); bps=d['end']['sum_received']['bits_per_second']; print(f'Throughput: {bps/1e9:.2f} Gbps'); print(f'RESULT:network_throughput:{bps/1e9:.4f}')" 2>&1`,
  },
  network_ssh_overhead: {
    name: 'SSH Overhead',
    category: 'network',
    description: 'Time to establish SSH + run trivial command',
    run: null,
    needsTarget: true,
    buildRun: (targetHost) => {
      // This is measured from the server side, not on the remote
      return `echo "SSH overhead is measured server-side" && echo "RESULT:network_ssh_overhead:0"`;
    },
  },
};

module.exports = BENCHMARKS;
