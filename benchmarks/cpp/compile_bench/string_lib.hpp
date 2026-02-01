#pragma once
#include <string>
#include <string_view>
#include <vector>
#include <sstream>
#include <regex>
#include <algorithm>
#include <functional>

template<typename CharT = char>
class BasicStringUtils {
public:
    using String = std::basic_string<CharT>;
    using StringView = std::basic_string_view<CharT>;

    static String to_upper(StringView s) {
        String result(s);
        std::transform(result.begin(), result.end(), result.begin(), ::toupper);
        return result;
    }

    static String to_lower(StringView s) {
        String result(s);
        std::transform(result.begin(), result.end(), result.begin(), ::tolower);
        return result;
    }

    static std::vector<String> split(StringView s, CharT delim) {
        std::vector<String> tokens;
        size_t start = 0;
        for (size_t i = 0; i <= s.size(); i++) {
            if (i == s.size() || s[i] == delim) {
                tokens.emplace_back(s.substr(start, i - start));
                start = i + 1;
            }
        }
        return tokens;
    }

    static String join(const std::vector<String>& parts, StringView sep) {
        String result;
        for (size_t i = 0; i < parts.size(); i++) {
            if (i > 0) result += sep;
            result += parts[i];
        }
        return result;
    }

    static String trim(StringView s) {
        auto start = s.find_first_not_of(" \t\n\r");
        if (start == StringView::npos) return String();
        auto end = s.find_last_not_of(" \t\n\r");
        return String(s.substr(start, end - start + 1));
    }

    static String replace_all(String s, StringView from, StringView to) {
        size_t pos = 0;
        while ((pos = s.find(from, pos)) != String::npos) {
            s.replace(pos, from.length(), to);
            pos += to.length();
        }
        return s;
    }
};

using StringUtils = BasicStringUtils<char>;
using WStringUtils = BasicStringUtils<wchar_t>;

template<typename T>
class Formatter {
public:
    static std::string format(const T& value) {
        std::ostringstream oss;
        oss << value;
        return oss.str();
    }
};

template<>
class Formatter<std::vector<std::string>> {
public:
    static std::string format(const std::vector<std::string>& vec) {
        std::string result = "[";
        for (size_t i = 0; i < vec.size(); i++) {
            if (i > 0) result += ", ";
            result += "\"" + vec[i] + "\"";
        }
        return result + "]";
    }
};

template<typename... Args>
std::string string_concat(const Args&... args) {
    std::ostringstream oss;
    (oss << ... << args);
    return oss.str();
}

void run_string_benchmarks();
