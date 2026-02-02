use std::env;
use std::fs::{File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{self, IsTerminal, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::collections::hash_map::DefaultHasher;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static GLOBAL_STOP: AtomicBool = AtomicBool::new(false);

type SigHandler = extern "C" fn(i32);

extern "C" {
    fn signal(sig: i32, handler: SigHandler) -> SigHandler;
}

extern "C" fn handle_sig(_sig: i32) {
    GLOBAL_STOP.store(true, Ordering::Relaxed);
}

const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;

fn install_signal_handlers() {
    unsafe {
        signal(SIGINT, handle_sig);
        signal(SIGTERM, handle_sig);
    }
}

struct Args {
    duration_s: u64,
    cpu_workers: usize,
    mem_mb: u64,
    disk_gb: f64,
    temp_dir: Option<PathBuf>,
    enable_disk: bool,
    enable_mem: bool,
    sample_ms: u64,
    csv_path: Option<PathBuf>,
    graph_width: usize,
    graph_height: usize,
    gpu_status_path: Option<PathBuf>,
}

fn print_usage() {
    eprintln!(
        "Rust Stress All (CPU/RAM/Disk)\n\
Usage: stress_all [options]\n\n\
Options:\n\
  --duration <sec|Xm>   Run for N seconds or minutes (0 = until Ctrl+C).\n\
  --cpu-workers <N>     CPU worker threads (default: all cores).\n\
  --mem-mb <MB>         Memory target in MB (default: ~60% of RAM, capped).\n\
  --disk-gb <GB>        Disk file size in GB (default: 1.0).\n\
  --temp-dir <path>     Directory for disk stress file (default: system temp).\n\
  --no-disk             Disable disk stress.\n\
  --no-mem              Disable memory stress.\n\
  --sample-ms <ms>      Sample interval in ms (default: 1000).\n\
  --csv <path>          Append samples to CSV file.\n\
  --graph-width <N>     Graph width (default: terminal width - 25).\n\
  --graph-height <N>    Graph height (default: 6).\n\
  --gpu-status <path>   Read GPU stats from a status file (nvidia-smi output).\n\
  -h, --help            Show this help.\n"
    );
}

fn parse_u64(s: &str, name: &str) -> u64 {
    s.parse::<u64>().unwrap_or_else(|_| {
        eprintln!("Invalid {}: {}", name, s);
        std::process::exit(2);
    })
}

fn parse_f64(s: &str, name: &str) -> f64 {
    s.parse::<f64>().unwrap_or_else(|_| {
        eprintln!("Invalid {}: {}", name, s);
        std::process::exit(2);
    })
}

fn parse_duration(s: &str) -> u64 {
    if let Some(stripped) = s.strip_suffix('m') {
        parse_u64(stripped, "duration") * 60
    } else if let Some(stripped) = s.strip_suffix('s') {
        parse_u64(stripped, "duration")
    } else {
        parse_u64(s, "duration")
    }
}

fn parse_args() -> Args {
    let mut duration_s = 0u64;
    let mut cpu_workers = 0usize;
    let mut mem_mb = 0u64;
    let mut disk_gb = 1.0f64;
    let mut temp_dir = None;
    let mut enable_disk = true;
    let mut enable_mem = true;
    let mut sample_ms = 1000u64;
    let mut csv_path = None;
    let mut graph_width = 0usize;
    let mut graph_height = 8usize;
    let mut gpu_status_path = None;

    let mut it = env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--duration" => {
                if let Some(v) = it.next() {
                    duration_s = parse_duration(&v);
                } else {
                    eprintln!("--duration requires a value");
                    std::process::exit(2);
                }
            }
            "--cpu-workers" => {
                if let Some(v) = it.next() {
                    cpu_workers = parse_u64(&v, "cpu-workers") as usize;
                } else {
                    eprintln!("--cpu-workers requires a value");
                    std::process::exit(2);
                }
            }
            "--mem-mb" => {
                if let Some(v) = it.next() {
                    mem_mb = parse_u64(&v, "mem-mb");
                } else {
                    eprintln!("--mem-mb requires a value");
                    std::process::exit(2);
                }
            }
            "--disk-gb" => {
                if let Some(v) = it.next() {
                    disk_gb = parse_f64(&v, "disk-gb");
                } else {
                    eprintln!("--disk-gb requires a value");
                    std::process::exit(2);
                }
            }
            "--temp-dir" => {
                if let Some(v) = it.next() {
                    temp_dir = Some(PathBuf::from(v));
                } else {
                    eprintln!("--temp-dir requires a value");
                    std::process::exit(2);
                }
            }
            "--no-disk" => enable_disk = false,
            "--no-mem" => enable_mem = false,
            "--sample-ms" => {
                if let Some(v) = it.next() {
                    sample_ms = parse_u64(&v, "sample-ms");
                } else {
                    eprintln!("--sample-ms requires a value");
                    std::process::exit(2);
                }
            }
            "--csv" => {
                if let Some(v) = it.next() {
                    csv_path = Some(PathBuf::from(v));
                } else {
                    eprintln!("--csv requires a value");
                    std::process::exit(2);
                }
            }
            "--graph-width" => {
                if let Some(v) = it.next() {
                    graph_width = parse_u64(&v, "graph-width") as usize;
                } else {
                    eprintln!("--graph-width requires a value");
                    std::process::exit(2);
                }
            }
            "--graph-height" => {
                if let Some(v) = it.next() {
                    graph_height = parse_u64(&v, "graph-height") as usize;
                } else {
                    eprintln!("--graph-height requires a value");
                    std::process::exit(2);
                }
            }
            "--gpu-status" => {
                if let Some(v) = it.next() {
                    gpu_status_path = Some(PathBuf::from(v));
                } else {
                    eprintln!("--gpu-status requires a value");
                    std::process::exit(2);
                }
            }
            "-h" | "--help" => {
                print_usage();
                std::process::exit(0);
            }
            _ => {
                eprintln!("Unknown option: {}", arg);
                print_usage();
                std::process::exit(2);
            }
        }
    }

    let graph_width = if graph_width > 0 {
        graph_width
    } else {
        let cols = env::var("COLUMNS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(80);
        let w = if cols > 25 { cols - 25 } else { 20 };
        w.clamp(20, 120)
    };
    let graph_height = graph_height.clamp(4, 12);

    Args {
        duration_s,
        cpu_workers,
        mem_mb,
        disk_gb,
        temp_dir,
        enable_disk,
        enable_mem,
        sample_ms,
        csv_path,
        graph_width,
        graph_height,
        gpu_status_path,
    }
}

fn read_cpu_times() -> Option<(u64, u64)> {
    let mut buf = String::new();
    File::open("/proc/stat").ok()?.read_to_string(&mut buf).ok()?;
    let line = buf.lines().next()?;
    let mut parts = line.split_whitespace();
    if parts.next()? != "cpu" {
        return None;
    }
    let mut nums = Vec::new();
    for _ in 0..7 {
        if let Some(v) = parts.next() {
            if let Ok(n) = v.parse::<u64>() {
                nums.push(n);
            }
        }
    }
    if nums.len() < 4 {
        return None;
    }
    let total: u64 = nums.iter().sum();
    let idle = nums[3] + nums.get(4).copied().unwrap_or(0);
    Some((total, idle))
}

fn read_mem_used_kb() -> Option<(u64, u64)> {
    let mut buf = String::new();
    File::open("/proc/meminfo")
        .ok()?
        .read_to_string(&mut buf)
        .ok()?;
    let mut total = 0u64;
    let mut free = 0u64;
    let mut buffers = 0u64;
    let mut cached = 0u64;
    for line in buf.lines() {
        if line.starts_with("MemTotal:") {
            total = line.split_whitespace().nth(1)?.parse::<u64>().ok()?;
        } else if line.starts_with("MemFree:") {
            free = line.split_whitespace().nth(1)?.parse::<u64>().ok()?;
        } else if line.starts_with("Buffers:") {
            buffers = line.split_whitespace().nth(1)?.parse::<u64>().ok()?;
        } else if line.starts_with("Cached:") {
            cached = line.split_whitespace().nth(1)?.parse::<u64>().ok()?;
        }
    }
    if total == 0 {
        return None;
    }
    let used = total.saturating_sub(free + buffers + cached);
    Some((total, used))
}

fn read_mem_total_mb() -> u64 {
    read_mem_used_kb().map(|(t, _)| t / 1024).unwrap_or(0)
}

fn read_cpu_freq_khz() -> Option<u64> {
    let mut total = 0u64;
    let mut count = 0u64;
    let entries = std::fs::read_dir("/sys/devices/system/cpu").ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("cpu") || !name[3..].chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let path = entry.path().join("cpufreq/scaling_cur_freq");
        if let Ok(mut f) = File::open(path) {
            let mut s = String::new();
            if f.read_to_string(&mut s).is_ok() {
                if let Ok(v) = s.trim().parse::<u64>() {
                    total += v;
                    count += 1;
                }
            }
        }
    }
    if count == 0 {
        None
    } else {
        Some(total / count)
    }
}

fn read_temp_c() -> Option<f64> {
    let entries = std::fs::read_dir("/sys/class/thermal").ok()?;
    let mut max_milli = 0i64;
    let mut found = false;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("thermal_zone") {
            continue;
        }
        let path = entry.path().join("temp");
        if let Ok(mut f) = File::open(path) {
            let mut s = String::new();
            if f.read_to_string(&mut s).is_ok() {
                if let Ok(v) = s.trim().parse::<i64>() {
                    if v > max_milli {
                        max_milli = v;
                    }
                    found = true;
                }
            }
        }
    }
    if !found {
        None
    } else {
        Some(max_milli as f64 / 1000.0)
    }
}

fn read_loadavg() -> Option<(f64, f64, f64)> {
    let mut buf = String::new();
    File::open("/proc/loadavg").ok()?.read_to_string(&mut buf).ok()?;
    let mut parts = buf.split_whitespace();
    let one = parts.next()?.parse::<f64>().ok()?;
    let five = parts.next()?.parse::<f64>().ok()?;
    let fifteen = parts.next()?.parse::<f64>().ok()?;
    Some((one, five, fifteen))
}

fn read_gpu_status(path: &PathBuf) -> Option<(f64, f64, f64, f64, f64)> {
    let mut buf = String::new();
    File::open(path).ok()?.read_to_string(&mut buf).ok()?;
    let line = buf.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    let mut parts = line.split(',');
    let util = parts.next()?.trim().parse::<f64>().ok()?;
    let mem_util = parts.next()?.trim().parse::<f64>().ok()?;
    let temp = parts.next()?.trim().parse::<f64>().ok()?;
    let sm_clock = parts.next()?.trim().parse::<f64>().ok()?;
    let mem_clock = parts.next()?.trim().parse::<f64>().ok()?;
    Some((util, mem_util, temp, sm_clock, mem_clock))
}

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        let seed = if seed == 0 { 0x9e3779b97f4a7c15 } else { seed };
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn next_u32(&mut self) -> u32 {
        self.next_u64() as u32
    }
}

fn seed_from_time() -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_nanos(0));
    let mut hasher = DefaultHasher::new();
    thread::current().id().hash(&mut hasher);
    let tid = hasher.finish();
    now.as_nanos() as u64 ^ tid
}

fn cpu_worker_ops(stop: Arc<AtomicBool>, ops: Arc<AtomicU64>) {
    let mut rng = Rng::new(seed_from_time());
    let mut x = 0u64;
    while !stop.load(Ordering::Relaxed) {
        let burst = 5000 + (rng.next_u32() % 15000) as u64;
        for _ in 0..burst {
            x = x
                .wrapping_mul(1664525)
                .wrapping_add(1013904223)
                .rotate_left(5);
        }
        ops.fetch_add(burst, Ordering::Relaxed);
        if rng.next_u32() % 1200 == 0 {
            thread::sleep(Duration::from_micros(200));
        }
    }
    std::hint::black_box(x);
}

fn mem_worker(stop: Arc<AtomicBool>, target_mb: u64, ops: Arc<AtomicU64>) {
    let chunk = 8 * 1024 * 1024usize;
    let target_bytes = target_mb * 1024 * 1024;
    let mut buffers: Vec<Vec<u8>> = Vec::new();
    let mut allocated = 0u64;
    while allocated < target_bytes && !stop.load(Ordering::Relaxed) {
        let size = (target_bytes - allocated).min(chunk as u64) as usize;
        let mut buf = vec![0u8; size];
        let mut i = 0usize;
        while i < size {
            buf[i] = 1;
            i += 4096;
        }
        buffers.push(buf);
        allocated += size as u64;
    }

    let mut rng = Rng::new(seed_from_time());
    while !stop.load(Ordering::Relaxed) {
        if buffers.is_empty() {
            thread::sleep(Duration::from_millis(200));
            continue;
        }
        let idx = (rng.next_u32() as usize) % buffers.len();
        let buf = &mut buffers[idx];
        let off = (rng.next_u32() as usize) % buf.len();
        buf[off] = buf[off].wrapping_add(1);
        ops.fetch_add(1, Ordering::Relaxed);
        if rng.next_u32() % 1000 == 0 {
            thread::sleep(Duration::from_micros(200));
        }
    }
    std::hint::black_box(buffers);
}

fn disk_worker(
    stop: Arc<AtomicBool>,
    bytes_written: Arc<AtomicU64>,
    ops: Arc<AtomicU64>,
    path: PathBuf,
    max_bytes: u64,
) {
    let mut file = match OpenOptions::new().create(true).read(true).write(true).open(&path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Disk worker: cannot open {}: {}", path.display(), e);
            return;
        }
    };
    let max_bytes = max_bytes.max(4 * 1024 * 1024);
    let _ = file.set_len(max_bytes);

    let mut rng = Rng::new(seed_from_time());
    let block_max = 4 * 1024 * 1024usize;
    let block_min = 4 * 1024usize;
    let mut buf = vec![0u8; block_max];
    for i in (0..block_max).step_by(4096) {
        buf[i] = (i / 4096) as u8;
    }

    while !stop.load(Ordering::Relaxed) {
        let mut size = block_min + (rng.next_u32() as usize % (block_max - block_min + 1));
        size &= !0xFFF;
        if size == 0 {
            size = block_min;
        }
        let max_off = max_bytes.saturating_sub(size as u64);
        let offset = if max_off == 0 {
            0
        } else {
            rng.next_u64() % max_off
        };
        if file.seek(SeekFrom::Start(offset)).is_err() {
            break;
        }
        if file.write_all(&buf[..size]).is_err() {
            break;
        }
        bytes_written.fetch_add(size as u64, Ordering::Relaxed);
        ops.fetch_add(1, Ordering::Relaxed);
        if rng.next_u32() % 200 == 0 {
            let _ = file.flush();
        }
    }
}

fn stats_window(hist: &[f64], head: usize, filled: usize) -> (f64, f64, f64) {
    if filled == 0 {
        return (0.0, 0.0, 0.0);
    }
    let len = hist.len();
    let mut min_v = f64::MAX;
    let mut max_v = f64::MIN;
    let mut sum = 0.0;
    for i in 0..filled {
        let idx = (head + len - filled + i) % len;
        let v = hist[idx];
        if v < min_v {
            min_v = v;
        }
        if v > max_v {
            max_v = v;
        }
        sum += v;
    }
    let avg = sum / filled as f64;
    (min_v, avg, max_v)
}

fn format_rate(value: f64, unit: &str) -> String {
    let (scaled, suffix) = if value >= 1_000_000_000.0 {
        (value / 1_000_000_000.0, "G")
    } else if value >= 1_000_000.0 {
        (value / 1_000_000.0, "M")
    } else if value >= 1_000.0 {
        (value / 1_000.0, "K")
    } else {
        (value, "")
    };
    format!("{:.2}{}{}", scaled, suffix, unit)
}

fn build_chart(hist: &[f64], head: usize, width: usize, height: usize, max: f64) -> Vec<Vec<char>> {
    let max = if max <= 0.0 { 1.0 } else { max };
    let mut grid = vec![vec![' '; width]; height];
    let mut prev_row: Option<usize> = None;
    for x in 0..width {
        let v = hist[(head + x) % width];
        let mut ratio = v / max;
        if ratio < 0.0 {
            ratio = 0.0;
        }
        if ratio > 1.0 {
            ratio = 1.0;
        }
        let y = ((height as f64 - 1.0) * ratio).round() as usize;
        let row = height - 1 - y;
        if let Some(prev) = prev_row {
            if prev != row {
                let (from, to) = if prev < row { (prev, row) } else { (row, prev) };
                for r in from..=to {
                    if grid[r][x] == ' ' {
                        grid[r][x] = '|';
                    }
                }
            }
        }
        grid[row][x] = '*';
        prev_row = Some(row);
    }
    grid
}

fn render_chart(
    label: &str,
    unit: &str,
    current: f64,
    hist: &[f64],
    head: usize,
    filled: usize,
    max: f64,
    width: usize,
    height: usize,
) -> Vec<String> {
    let max = if max <= 0.0 { 1.0 } else { max };
    let (min_v, avg_v, max_v) = stats_window(hist, head, filled);
    let mut lines = Vec::new();
    lines.push(format!(
        "{label} {current:6.1}{unit} (min {min_v:6.1} avg {avg_v:6.1} max {max_v:6.1})"
    ));

    let grid = build_chart(hist, head, width, height, max);
    for row in 0..height {
        let axis_val = max * (height - 1 - row) as f64 / (height - 1) as f64;
        let label = if row == 0 || row == height - 1 || row == height / 2 {
            format!("{:>6.0}", axis_val)
        } else {
            "      ".to_string()
        };
        let line: String = grid[row].iter().collect();
        lines.push(format!("{label}|{line}"));
    }
    lines.push(format!("      +{}", "-".repeat(width)));
    lines
}

fn main() {
    install_signal_handlers();
    let args = parse_args();

    let cpu_workers = if args.cpu_workers == 0 {
        thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
    } else {
        args.cpu_workers
    };

    let mem_total_mb = read_mem_total_mb();
    let mut mem_target = if args.mem_mb > 0 {
        args.mem_mb
    } else if mem_total_mb > 0 {
        (mem_total_mb as f64 * 0.60) as u64
    } else {
        512
    };
    if mem_target < 256 {
        mem_target = 256;
    }
    if mem_target > 16384 {
        mem_target = 16384;
    }

    let disk_bytes = if args.enable_disk {
        let gb = if args.disk_gb <= 0.0 { 1.0 } else { args.disk_gb };
        (gb * 1024.0 * 1024.0 * 1024.0) as u64
    } else {
        0
    };

    let stop = Arc::new(AtomicBool::new(false));
    let bytes_written = Arc::new(AtomicU64::new(0));
    let cpu_ops = Arc::new(AtomicU64::new(0));
    let mem_ops = Arc::new(AtomicU64::new(0));
    let disk_ops = Arc::new(AtomicU64::new(0));

    let mut handles = Vec::new();
    for _ in 0..cpu_workers {
        let s = Arc::clone(&stop);
        let ops = Arc::clone(&cpu_ops);
        handles.push(thread::spawn(move || cpu_worker_ops(s, ops)));
    }

    if args.enable_mem {
        let s = Arc::clone(&stop);
        let ops = Arc::clone(&mem_ops);
        handles.push(thread::spawn(move || mem_worker(s, mem_target, ops)));
    }

    let mut disk_path = None;
    if args.enable_disk {
        let dir = args
            .temp_dir
            .unwrap_or_else(|| env::temp_dir().join("stress_rust"));
        if let Err(e) = std::fs::create_dir_all(&dir) {
            eprintln!("Disk worker: cannot create {}: {}", dir.display(), e);
        } else {
            let path = dir.join("stress_rust.dat");
            let path_for_thread = path.clone();
            let s = Arc::clone(&stop);
            let bw = Arc::clone(&bytes_written);
            let ops = Arc::clone(&disk_ops);
            handles.push(thread::spawn(move || disk_worker(s, bw, ops, path_for_thread, disk_bytes)));
            disk_path = Some(path);
        }
    }

    let mut csv_file = args.csv_path.as_ref().and_then(|path| {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
    });
    if let Some(f) = csv_file.as_mut() {
        let _ = writeln!(
            f,
            "ts,cpu_pct,mem_pct,disk_mb_s,cpu_ops_s,mem_ops_s,disk_iops,temp_c,cpu_freq_ghz,load1,load5,load15,mem_used_mb,mem_total_mb,gpu_util,gpu_mem_util,gpu_temp_c,gpu_sm_clock_mhz,gpu_mem_clock_mhz"
        );
    }

    let width = args.graph_width.max(20);
    let height = args.graph_height.max(4);
    let mut cpu_hist = vec![0.0f64; width];
    let mut mem_hist = vec![0.0f64; width];
    let mut disk_hist = vec![0.0f64; width];
    let mut cpu_ops_hist = vec![0.0f64; width];
    let mut mem_ops_hist = vec![0.0f64; width];
    let mut disk_ops_hist = vec![0.0f64; width];
    let mut head = 0usize;
    let mut disk_peak = 1.0f64;
    let mut filled = 0usize;

    let mut prev_cpu = read_cpu_times();
    let mut prev_bytes = bytes_written.load(Ordering::Relaxed);
    let mut prev_cpu_ops = cpu_ops.load(Ordering::Relaxed);
    let mut prev_mem_ops = mem_ops.load(Ordering::Relaxed);
    let mut prev_disk_ops = disk_ops.load(Ordering::Relaxed);
    let start = Instant::now();
    let sample = Duration::from_millis(args.sample_ms.max(200));
    let mut next_tick = Instant::now();

    let is_tty = io::stdout().is_terminal();

    loop {
        if GLOBAL_STOP.load(Ordering::Relaxed) {
            break;
        }
        if args.duration_s > 0 && start.elapsed().as_secs() >= args.duration_s {
            break;
        }

        let now = Instant::now();
        if now < next_tick {
            thread::sleep(next_tick - now);
        }
        next_tick += sample;

        let cpu_pct = if let (Some(prev), Some(cur)) = (prev_cpu, read_cpu_times()) {
            let total = cur.0.saturating_sub(prev.0);
            let idle = cur.1.saturating_sub(prev.1);
            prev_cpu = Some(cur);
            if total > 0 {
                100.0 * (total - idle) as f64 / total as f64
            } else {
                0.0
            }
        } else {
            0.0
        };

        let (mem_total_kb, mem_used_kb, mem_pct) = if let Some((total_kb, used_kb)) = read_mem_used_kb() {
            if total_kb > 0 {
                (total_kb, used_kb, 100.0 * used_kb as f64 / total_kb as f64)
            } else {
                (0, 0, 0.0)
            }
        } else {
            (0, 0, 0.0)
        };
        let mem_total_mb = mem_total_kb / 1024;
        let mem_used_mb = mem_used_kb / 1024;

        let cur_bytes = bytes_written.load(Ordering::Relaxed);
        let delta_bytes = cur_bytes.saturating_sub(prev_bytes);
        prev_bytes = cur_bytes;
        let disk_mb_s = delta_bytes as f64 / (1024.0 * 1024.0) / sample.as_secs_f64();
        if disk_mb_s > disk_peak {
            disk_peak = disk_mb_s;
        }

        let cur_cpu_ops = cpu_ops.load(Ordering::Relaxed);
        let delta_cpu_ops = cur_cpu_ops.saturating_sub(prev_cpu_ops);
        prev_cpu_ops = cur_cpu_ops;
        let cpu_ops_s = delta_cpu_ops as f64 / sample.as_secs_f64();

        let cur_mem_ops = mem_ops.load(Ordering::Relaxed);
        let delta_mem_ops = cur_mem_ops.saturating_sub(prev_mem_ops);
        prev_mem_ops = cur_mem_ops;
        let mem_ops_s = delta_mem_ops as f64 / sample.as_secs_f64();

        let cur_disk_ops = disk_ops.load(Ordering::Relaxed);
        let delta_disk_ops = cur_disk_ops.saturating_sub(prev_disk_ops);
        prev_disk_ops = cur_disk_ops;
        let disk_iops = delta_disk_ops as f64 / sample.as_secs_f64();

        let temp_opt = read_temp_c();
        let temp_c = temp_opt.unwrap_or(-1.0);
        let freq_opt = read_cpu_freq_khz();
        let freq_ghz = freq_opt.map(|v| v as f64 / 1_000_000.0).unwrap_or(-1.0);
        let load_opt = read_loadavg();
        let (load1, load5, load15) = load_opt.unwrap_or((0.0, 0.0, 0.0));
        let gpu_opt = args
            .gpu_status_path
            .as_ref()
            .and_then(|p| read_gpu_status(p));
        let (gpu_util, gpu_mem_util, gpu_temp, gpu_sm, gpu_memclk) =
            gpu_opt.unwrap_or((-1.0, -1.0, -1.0, -1.0, -1.0));

        cpu_hist[head] = cpu_pct;
        mem_hist[head] = mem_pct;
        disk_hist[head] = disk_mb_s;
        cpu_ops_hist[head] = cpu_ops_s;
        mem_ops_hist[head] = mem_ops_s;
        disk_ops_hist[head] = disk_iops;
        head = (head + 1) % width;
        if filled < width {
            filled += 1;
        }

        if is_tty {
            print!("\x1b[2J\x1b[H");
            println!("Rust Stress All - Ctrl+C to stop");
            println!(
                "CPU workers: {}  Mem target: {} MB  Disk: {}  Sample: {}ms",
                cpu_workers,
                if args.enable_mem { mem_target } else { 0 },
                if args.enable_disk {
                    format!("{:.1} GB", disk_bytes as f64 / (1024.0 * 1024.0 * 1024.0))
                } else {
                    "off".to_string()
                },
                sample.as_millis()
            );
            let elapsed = start.elapsed().as_secs();
            let window_s = (filled as u64 * sample.as_millis() as u64) / 1000;
            if args.duration_s > 0 {
                println!("Elapsed: {}s / {}s  Window: {}s", elapsed, args.duration_s, window_s);
            } else {
                println!("Elapsed: {}s  Window: {}s", elapsed, window_s);
            }

            let temp_str = if temp_opt.is_some() {
                format!("{:.1}C", temp_c)
            } else {
                "n/a".to_string()
            };
            let freq_str = if freq_opt.is_some() {
                format!("{:.2}GHz", freq_ghz)
            } else {
                "n/a".to_string()
            };
            let load_str = if load_opt.is_some() {
                format!("{:.2} {:.2} {:.2}", load1, load5, load15)
            } else {
                "n/a".to_string()
            };
            println!(
                "SENS temp {}  freq {}  load {}  mem {}/{} MB",
                temp_str, freq_str, load_str, mem_used_mb, mem_total_mb
            );
            if args.gpu_status_path.is_some() {
                if gpu_opt.is_some() {
                    println!(
                        "GPU  util {:>5.1}% mem {:>5.1}% temp {:>5.1}C sm {:>4.0}MHz mem {:>4.0}MHz",
                        gpu_util, gpu_mem_util, gpu_temp, gpu_sm, gpu_memclk
                    );
                } else {
                    println!("GPU  n/a");
                }
            }

            for line in render_chart("CPU", "%", cpu_pct, &cpu_hist, head, filled, 100.0, width, height) {
                println!("{line}");
            }
            let (_, cpu_ops_avg, cpu_ops_max) = stats_window(&cpu_ops_hist, head, filled);
            println!(
                "CPU ops/s: {} (avg {}, max {})",
                format_rate(cpu_ops_s, "ops/s"),
                format_rate(cpu_ops_avg, "ops/s"),
                format_rate(cpu_ops_max, "ops/s")
            );
            for line in render_chart("MEM", "%", mem_pct, &mem_hist, head, filled, 100.0, width, height) {
                println!("{line}");
            }
            let (_, mem_ops_avg, mem_ops_max) = stats_window(&mem_ops_hist, head, filled);
            println!(
                "MEM ops/s: {} (avg {}, max {})",
                format_rate(mem_ops_s, "ops/s"),
                format_rate(mem_ops_avg, "ops/s"),
                format_rate(mem_ops_max, "ops/s")
            );
            for line in render_chart("DSK", "MB/s", disk_mb_s, &disk_hist, head, filled, disk_peak, width, height) {
                println!("{line}");
            }
            let (_, disk_ops_avg, disk_ops_max) = stats_window(&disk_ops_hist, head, filled);
            println!(
                "DSK IOPS: {} (avg {}, max {})",
                format_rate(disk_iops, "IOPS"),
                format_rate(disk_ops_avg, "IOPS"),
                format_rate(disk_ops_max, "IOPS")
            );
            println!("Legend: '*' sample, '|' join. Disk scale uses peak MB/s in window.");
            let _ = io::stdout().flush();
        } else {
            println!(
                "{},{:.1},{:.1},{:.1},{:.2},{:.2},{:.2},{:.1},{:.3},{:.2},{:.2},{:.2},{},{},{:.1},{:.1},{:.1},{:.0},{:.0}",
                start.elapsed().as_secs_f64(),
                cpu_pct,
                mem_pct,
                disk_mb_s,
                cpu_ops_s,
                mem_ops_s,
                disk_iops,
                temp_c,
                freq_ghz,
                load1,
                load5,
                load15,
                mem_used_mb,
                mem_total_mb,
                gpu_util,
                gpu_mem_util,
                gpu_temp,
                gpu_sm,
                gpu_memclk
            );
        }

        if let Some(f) = csv_file.as_mut() {
            let _ = writeln!(
                f,
                "{},{:.2},{:.2},{:.2},{:.2},{:.2},{:.2},{:.2},{:.3},{:.2},{:.2},{:.2},{},{},{:.2},{:.2},{:.2},{:.0},{:.0}",
                start.elapsed().as_secs_f64(),
                cpu_pct,
                mem_pct,
                disk_mb_s,
                cpu_ops_s,
                mem_ops_s,
                disk_iops,
                temp_c,
                freq_ghz,
                load1,
                load5,
                load15,
                mem_used_mb,
                mem_total_mb,
                gpu_util,
                gpu_mem_util,
                gpu_temp,
                gpu_sm,
                gpu_memclk
            );
        }
    }

    stop.store(true, Ordering::Relaxed);
    for h in handles {
        let _ = h.join();
    }

    if let Some(path) = disk_path {
        let _ = std::fs::remove_file(path);
    }
}
