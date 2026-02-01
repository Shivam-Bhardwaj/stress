#pragma once
#include <vector>
#include <map>
#include <unordered_map>
#include <string>
#include <memory>
#include <list>
#include <functional>
#include <optional>
#include <variant>
#include <algorithm>

template<typename T>
class SortedVector {
    std::vector<T> data_;
public:
    void insert(const T& val) {
        auto it = std::lower_bound(data_.begin(), data_.end(), val);
        data_.insert(it, val);
    }
    bool contains(const T& val) const {
        return std::binary_search(data_.begin(), data_.end(), val);
    }
    size_t size() const { return data_.size(); }
    const T& operator[](size_t i) const { return data_[i]; }
};

template<typename Key, typename Value>
class LRUCache {
    size_t capacity_;
    std::list<std::pair<Key, Value>> items_;
    std::unordered_map<Key, typename std::list<std::pair<Key, Value>>::iterator> map_;
public:
    explicit LRUCache(size_t cap) : capacity_(cap) {}

    std::optional<Value> get(const Key& key) {
        auto it = map_.find(key);
        if (it == map_.end()) return std::nullopt;
        items_.splice(items_.begin(), items_, it->second);
        return it->second->second;
    }

    void put(const Key& key, const Value& value) {
        auto it = map_.find(key);
        if (it != map_.end()) {
            it->second->second = value;
            items_.splice(items_.begin(), items_, it->second);
            return;
        }
        if (items_.size() >= capacity_) {
            map_.erase(items_.back().first);
            items_.pop_back();
        }
        items_.emplace_front(key, value);
        map_[key] = items_.begin();
    }

    size_t size() const { return items_.size(); }
};

template<typename... Ts>
class TypeRegistry {
    using Variant = std::variant<Ts...>;
    std::vector<Variant> items_;
public:
    template<typename T>
    void add(const T& item) { items_.push_back(item); }

    template<typename T>
    size_t count() const {
        return std::count_if(items_.begin(), items_.end(),
            [](const Variant& v) { return std::holds_alternative<T>(v); });
    }

    size_t total() const { return items_.size(); }
};

template<typename T>
class TreeNode {
public:
    T value;
    std::unique_ptr<TreeNode> left, right;
    TreeNode(T v) : value(v) {}

    void insert(T v) {
        if (v < value) {
            if (left) left->insert(v); else left = std::make_unique<TreeNode>(v);
        } else {
            if (right) right->insert(v); else right = std::make_unique<TreeNode>(v);
        }
    }

    bool find(T v) const {
        if (v == value) return true;
        if (v < value) return left ? left->find(v) : false;
        return right ? right->find(v) : false;
    }

    size_t depth() const {
        size_t l = left ? left->depth() : 0;
        size_t r = right ? right->depth() : 0;
        return 1 + std::max(l, r);
    }
};

void run_container_benchmarks();
