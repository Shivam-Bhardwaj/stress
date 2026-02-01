#pragma once
#include <cmath>
#include <array>
#include <numeric>
#include <type_traits>

template<typename T, size_t N>
class Matrix {
    std::array<std::array<T, N>, N> data_{};
public:
    Matrix() = default;

    T& at(size_t r, size_t c) { return data_[r][c]; }
    const T& at(size_t r, size_t c) const { return data_[r][c]; }

    Matrix operator+(const Matrix& other) const {
        Matrix result;
        for (size_t i = 0; i < N; i++)
            for (size_t j = 0; j < N; j++)
                result.at(i, j) = at(i, j) + other.at(i, j);
        return result;
    }

    Matrix operator*(const Matrix& other) const {
        Matrix result;
        for (size_t i = 0; i < N; i++)
            for (size_t k = 0; k < N; k++)
                for (size_t j = 0; j < N; j++)
                    result.at(i, j) += at(i, k) * other.at(k, j);
        return result;
    }

    T trace() const {
        T sum = T{};
        for (size_t i = 0; i < N; i++) sum += at(i, i);
        return sum;
    }

    T determinant() const requires (N <= 3) {
        if constexpr (N == 1) return at(0, 0);
        else if constexpr (N == 2) return at(0,0)*at(1,1) - at(0,1)*at(1,0);
        else {
            T det = T{};
            for (size_t j = 0; j < N; j++) {
                Matrix<T, N-1> sub;
                for (size_t r = 1; r < N; r++)
                    for (size_t c = 0, sc = 0; c < N; c++)
                        if (c != j) sub.at(r-1, sc++) = at(r, c);
                det += (j % 2 == 0 ? 1 : -1) * at(0, j) * sub.determinant();
            }
            return det;
        }
    }
};

template<typename T>
class Vec3T {
public:
    T x, y, z;
    Vec3T(T x=0, T y=0, T z=0) : x(x), y(y), z(z) {}
    Vec3T operator+(const Vec3T& b) const { return {x+b.x, y+b.y, z+b.z}; }
    Vec3T operator-(const Vec3T& b) const { return {x-b.x, y-b.y, z-b.z}; }
    Vec3T operator*(T t) const { return {x*t, y*t, z*t}; }
    T dot(const Vec3T& b) const { return x*b.x + y*b.y + z*b.z; }
    Vec3T cross(const Vec3T& b) const { return {y*b.z-z*b.y, z*b.x-x*b.z, x*b.y-y*b.x}; }
    T length() const { return std::sqrt(x*x + y*y + z*z); }
    Vec3T normalized() const { T l = length(); return {x/l, y/l, z/l}; }
};

template<typename T, size_t Degree>
class Polynomial {
    std::array<T, Degree+1> coeffs_{};
public:
    Polynomial() = default;
    T& coeff(size_t i) { return coeffs_[i]; }
    const T& coeff(size_t i) const { return coeffs_[i]; }

    T evaluate(T x) const {
        T result = T{};
        T power = T{1};
        for (size_t i = 0; i <= Degree; i++) {
            result += coeffs_[i] * power;
            power *= x;
        }
        return result;
    }

    template<size_t D2>
    Polynomial<T, Degree+D2> operator*(const Polynomial<T, D2>& other) const {
        Polynomial<T, Degree+D2> result;
        for (size_t i = 0; i <= Degree; i++)
            for (size_t j = 0; j <= D2; j++)
                result.coeff(i+j) += coeffs_[i] * other.coeff(j);
        return result;
    }
};

void run_math_benchmarks();
