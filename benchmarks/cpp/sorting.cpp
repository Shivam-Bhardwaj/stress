// Sorting Benchmark: 100M random uint64 — std::sort + parallel
#include <cstdio>
#include <cstdint>
#include <vector>
#include <algorithm>
#include <chrono>
#include <random>
#include <thread>
#include <numeric>

const size_t N = 100'000'000;

void single_threaded_sort(std::vector<uint64_t>& data) {
    std::sort(data.begin(), data.end());
}

// Simple parallel merge sort
void parallel_sort_helper(std::vector<uint64_t>& data, int depth, int max_depth) {
    if (depth >= max_depth || data.size() < 100000) {
        std::sort(data.begin(), data.end());
        return;
    }
    size_t mid = data.size() / 2;
    std::vector<uint64_t> left(data.begin(), data.begin() + mid);
    std::vector<uint64_t> right(data.begin() + mid, data.end());

    std::thread t1([&left, depth, max_depth]() { parallel_sort_helper(left, depth+1, max_depth); });
    parallel_sort_helper(right, depth+1, max_depth);
    t1.join();

    std::merge(left.begin(), left.end(), right.begin(), right.end(), data.begin());
}

void parallel_sort(std::vector<uint64_t>& data) {
    int threads = std::thread::hardware_concurrency();
    int depth = 0;
    while ((1 << depth) < threads) depth++;
    parallel_sort_helper(data, 0, depth);
}

int main() {
    printf("Sorting Benchmark: %zu elements\n", N);
    printf("Hardware threads: %u\n", std::thread::hardware_concurrency());

    std::mt19937_64 rng(42);
    std::vector<uint64_t> original(N);
    for (auto& v : original) v = rng();

    // Single-threaded sort
    {
        printf("Running single-threaded std::sort...\n");
        auto data = original;
        auto start = std::chrono::high_resolution_clock::now();
        single_threaded_sort(data);
        auto end = std::chrono::high_resolution_clock::now();
        double elapsed = std::chrono::duration<double>(end - start).count();
        printf("Single-threaded: %.3fs\n", elapsed);
        printf("Verified sorted: %s\n", std::is_sorted(data.begin(), data.end()) ? "yes" : "NO");
    }

    // Parallel sort
    double parallel_time;
    {
        printf("Running parallel sort...\n");
        auto data = original;
        auto start = std::chrono::high_resolution_clock::now();
        parallel_sort(data);
        auto end = std::chrono::high_resolution_clock::now();
        parallel_time = std::chrono::duration<double>(end - start).count();
        printf("Parallel: %.3fs\n", parallel_time);
        printf("Verified sorted: %s\n", std::is_sorted(data.begin(), data.end()) ? "yes" : "NO");
    }

    printf("RESULT:cpp_sorting:%.4f\n", parallel_time);
    return 0;
}
