#include "container_lib.hpp"
#include <cstdio>
#include <list>

void run_container_benchmarks() {
    SortedVector<int> sv;
    for (int i = 100; i >= 0; i--) sv.insert(i);
    printf("SortedVector size: %zu, contains 50: %d\n", sv.size(), sv.contains(50));

    LRUCache<std::string, int> cache(100);
    for (int i = 0; i < 200; i++) {
        cache.put("key_" + std::to_string(i), i * i);
    }
    auto val = cache.get("key_199");
    printf("LRU cache size: %zu, key_199: %d\n", cache.size(), val.value_or(-1));

    TypeRegistry<int, double, std::string> reg;
    reg.add(42);
    reg.add(3.14);
    reg.add(std::string("hello"));
    reg.add(100);
    printf("Registry total: %zu, ints: %zu, strings: %zu\n",
        reg.total(), reg.count<int>(), reg.count<std::string>());

    auto root = std::make_unique<TreeNode<int>>(50);
    for (int v : {25, 75, 12, 37, 62, 87, 6, 18, 31, 43}) root->insert(v);
    printf("Tree depth: %zu, find 37: %d\n", root->depth(), root->find(37));
}
