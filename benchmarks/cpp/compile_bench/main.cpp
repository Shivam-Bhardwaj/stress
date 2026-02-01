#include "math_lib.hpp"
#include "container_lib.hpp"
#include "string_lib.hpp"
#include <cstdio>

int main() {
    printf("C++ Compile Benchmark — running all modules\n");
    run_math_benchmarks();
    run_container_benchmarks();
    run_string_benchmarks();
    printf("All modules OK\n");
    return 0;
}
