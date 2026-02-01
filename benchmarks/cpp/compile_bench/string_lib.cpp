#include "string_lib.hpp"
#include <cstdio>

void run_string_benchmarks() {
    auto upper = StringUtils::to_upper("hello world");
    auto lower = StringUtils::to_lower("HELLO WORLD");
    printf("Upper: %s, Lower: %s\n", upper.c_str(), lower.c_str());

    auto parts = StringUtils::split("one,two,three,four", ',');
    auto joined = StringUtils::join(parts, " | ");
    printf("Split/Join: %s\n", joined.c_str());

    auto trimmed = StringUtils::trim("  hello  ");
    printf("Trimmed: '%s'\n", trimmed.c_str());

    auto replaced = StringUtils::replace_all("foo bar foo baz foo", "foo", "qux");
    printf("Replaced: %s\n", replaced.c_str());

    auto formatted = Formatter<int>::format(42);
    auto vec_formatted = Formatter<std::vector<std::string>>::format({"a", "b", "c"});
    printf("Formatted: %s, Vec: %s\n", formatted.c_str(), vec_formatted.c_str());

    auto concat = string_concat("Hello", ' ', 42, " world ", 3.14);
    printf("Concat: %s\n", concat.c_str());
}
