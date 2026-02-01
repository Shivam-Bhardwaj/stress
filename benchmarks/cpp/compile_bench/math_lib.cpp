#include "math_lib.hpp"
#include <cstdio>

void run_math_benchmarks() {
    // Force template instantiation
    Matrix<double, 4> m1, m2;
    for (int i = 0; i < 4; i++)
        for (int j = 0; j < 4; j++) {
            m1.at(i,j) = (i+1.0)*(j+1.0);
            m2.at(i,j) = (i+j)*0.5;
        }
    auto m3 = m1 * m2;
    auto m4 = m1 + m2;
    printf("Matrix trace: %f\n", m3.trace());

    Matrix<float, 3> fm;
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++)
            fm.at(i,j) = (i*3+j+1.0f);
    printf("3x3 det: %f\n", fm.determinant());

    Matrix<double, 2> dm;
    dm.at(0,0)=1; dm.at(0,1)=2; dm.at(1,0)=3; dm.at(1,1)=4;
    printf("2x2 det: %f\n", dm.determinant());

    Vec3T<double> v1(1,2,3), v2(4,5,6);
    auto v3 = v1.cross(v2);
    printf("Cross: %f %f %f\n", v3.x, v3.y, v3.z);

    Polynomial<double, 3> p1;
    p1.coeff(0)=1; p1.coeff(1)=2; p1.coeff(2)=1; p1.coeff(3)=0.5;
    Polynomial<double, 2> p2;
    p2.coeff(0)=1; p2.coeff(1)=-1; p2.coeff(2)=0.5;
    auto p3 = p1 * p2;
    printf("Poly eval: %f\n", p3.evaluate(2.0));
}
