#include <cuda_runtime.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

static void die(const char *msg, cudaError_t err) {
    fprintf(stderr, "CUDA error: %s: %s\n", msg, cudaGetErrorString(err));
    std::exit(1);
}

static void usage() {
    printf("CUDA Stress (compute + memory)\n\n");
    printf("Options:\n");
    printf("  --duration <sec>    Runtime in seconds (default: 60).\n");
    printf("  --size-mb <MB>      GPU buffer size (default: 1024).\n");
    printf("  --iters <N>         Work iterations per element (default: 256).\n");
    printf("  --streams <N>       CUDA streams (default: 1).\n");
    printf("  --sample-ms <ms>    Sample interval (default: 1000).\n");
    printf("  -h, --help          Show this help.\n");
}

__global__ void stress_kernel(float *a, float *b, size_t n, int iters) {
    size_t idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) {
        return;
    }
    float x = a[idx];
    for (int i = 0; i < iters; i++) {
        x = x * 1.000001f + 0.000001f;
    }
    b[idx] = x;
}

struct Args {
    int duration_s = 60;
    size_t size_mb = 1024;
    int iters = 256;
    int streams = 1;
    int sample_ms = 1000;
};

int main(int argc, char **argv) {
    Args args;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--duration") && i + 1 < argc) {
            args.duration_s = std::atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--size-mb") && i + 1 < argc) {
            args.size_mb = static_cast<size_t>(std::strtoull(argv[++i], nullptr, 10));
        } else if (!strcmp(argv[i], "--iters") && i + 1 < argc) {
            args.iters = std::atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--streams") && i + 1 < argc) {
            args.streams = std::atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--sample-ms") && i + 1 < argc) {
            args.sample_ms = std::atoi(argv[++i]);
        } else if (!strcmp(argv[i], "-h") || !strcmp(argv[i], "--help")) {
            usage();
            return 0;
        } else {
            fprintf(stderr, "Unknown option: %s\n", argv[i]);
            usage();
            return 2;
        }
    }

    if (args.sample_ms < 200) {
        args.sample_ms = 200;
    }
    if (args.iters < 1) {
        args.iters = 1;
    }
    if (args.streams < 1) {
        args.streams = 1;
    }

    int device = 0;
    cudaError_t err = cudaGetDevice(&device);
    if (err != cudaSuccess) {
        die("cudaGetDevice", err);
    }
    cudaDeviceProp prop{};
    err = cudaGetDeviceProperties(&prop, device);
    if (err != cudaSuccess) {
        die("cudaGetDeviceProperties", err);
    }

    size_t free_mem = 0;
    size_t total_mem = 0;
    err = cudaMemGetInfo(&free_mem, &total_mem);
    if (err != cudaSuccess) {
        die("cudaMemGetInfo", err);
    }

    size_t req_bytes = args.size_mb * 1024ULL * 1024ULL;
    size_t cap_bytes = static_cast<size_t>(free_mem * 0.6);
    if (cap_bytes < 64ULL * 1024ULL * 1024ULL) {
        cap_bytes = free_mem / 2;
    }
    if (req_bytes > cap_bytes) {
        req_bytes = cap_bytes;
        args.size_mb = req_bytes / (1024ULL * 1024ULL);
    }
    if (req_bytes < 32ULL * 1024ULL * 1024ULL) {
        req_bytes = 32ULL * 1024ULL * 1024ULL;
        args.size_mb = req_bytes / (1024ULL * 1024ULL);
    }

    size_t n = req_bytes / sizeof(float);

    float *d_a = nullptr;
    float *d_b = nullptr;
    err = cudaMalloc(&d_a, n * sizeof(float));
    if (err != cudaSuccess) {
        die("cudaMalloc a", err);
    }
    err = cudaMalloc(&d_b, n * sizeof(float));
    if (err != cudaSuccess) {
        die("cudaMalloc b", err);
    }
    err = cudaMemset(d_a, 1, n * sizeof(float));
    if (err != cudaSuccess) {
        die("cudaMemset", err);
    }

    std::vector<cudaStream_t> streams;
    streams.reserve(args.streams);
    for (int i = 0; i < args.streams; i++) {
        cudaStream_t s;
        err = cudaStreamCreate(&s);
        if (err != cudaSuccess) {
            die("cudaStreamCreate", err);
        }
        streams.push_back(s);
    }

    printf("gpu,name,%s\n", prop.name);
    printf("gpu,cc,%d.%d\n", prop.major, prop.minor);
    printf("gpu,mem_total_mb,%zu\n", total_mem / (1024ULL * 1024ULL));
    printf("gpu,mem_used_mb,%zu\n", (total_mem - free_mem) / (1024ULL * 1024ULL));
    printf("gpu,buffer_mb,%zu\n", args.size_mb);
    printf("time_s,gflops,gbps,iters,size_mb\n");

    unsigned long long rng = 0x9e3779b97f4a7c15ULL;
    auto next_u32 = [&]() {
        rng = rng * 6364136223846793005ULL + 1ULL;
        return static_cast<unsigned int>(rng >> 32);
    };

    const int threads = 256;
    size_t chunk = (n + args.streams - 1) / args.streams;

    auto start = std::chrono::steady_clock::now();
    auto last_sample = start;
    auto next_sample = start + std::chrono::milliseconds(args.sample_ms);

    double sample_ops = 0.0;
    double sample_bytes = 0.0;
    long long sample_iters = 0;

    while (true) {
        auto now = std::chrono::steady_clock::now();
        if (args.duration_s > 0 &&
            std::chrono::duration_cast<std::chrono::seconds>(now - start).count() >= args.duration_s) {
            break;
        }

        int jitter = args.iters;
        if (args.iters > 10) {
            int span = args.iters / 5;
            int base = args.iters - args.iters / 10;
            jitter = base + static_cast<int>(next_u32() % (span + 1));
            if (jitter < 1) {
                jitter = 1;
            }
        }

        for (int s = 0; s < args.streams; s++) {
            size_t offset = static_cast<size_t>(s) * chunk;
            if (offset >= n) {
                continue;
            }
            size_t len = chunk;
            if (offset + len > n) {
                len = n - offset;
            }
            int blocks = static_cast<int>((len + threads - 1) / threads);
            stress_kernel<<<blocks, threads, 0, streams[s]>>>(d_a + offset, d_b + offset, len, jitter);
        }

        err = cudaDeviceSynchronize();
        if (err != cudaSuccess) {
            die("cudaDeviceSynchronize", err);
        }

        sample_ops += static_cast<double>(n) * static_cast<double>(jitter) * 2.0;
        sample_bytes += static_cast<double>(n) * 8.0;
        sample_iters += jitter;

        now = std::chrono::steady_clock::now();
        if (now >= next_sample) {
            double dt = std::chrono::duration<double>(now - last_sample).count();
            double gflops = sample_ops / dt / 1.0e9;
            double gbps = sample_bytes / dt / 1.0e9;
            long long elapsed_s =
                std::chrono::duration_cast<std::chrono::seconds>(now - start).count();
            printf("%lld,%.2f,%.2f,%lld,%zu\n", elapsed_s, gflops, gbps, sample_iters, args.size_mb);
            fflush(stdout);
            sample_ops = 0.0;
            sample_bytes = 0.0;
            sample_iters = 0;
            last_sample = now;
            next_sample += std::chrono::milliseconds(args.sample_ms);
        }
    }

    for (auto s : streams) {
        cudaStreamDestroy(s);
    }
    cudaFree(d_a);
    cudaFree(d_b);
    return 0;
}
