// Ray Tracer Benchmark: 1920x1080 scene with spheres, reflections, soft shadows
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <vector>
#include <algorithm>
#include <chrono>

struct Vec3 {
    double x, y, z;
    Vec3(double x=0, double y=0, double z=0) : x(x), y(y), z(z) {}
    Vec3 operator+(const Vec3& b) const { return {x+b.x, y+b.y, z+b.z}; }
    Vec3 operator-(const Vec3& b) const { return {x-b.x, y-b.y, z-b.z}; }
    Vec3 operator*(double t) const { return {x*t, y*t, z*t}; }
    Vec3 operator*(const Vec3& b) const { return {x*b.x, y*b.y, z*b.z}; }
    double dot(const Vec3& b) const { return x*b.x + y*b.y + z*b.z; }
    Vec3 cross(const Vec3& b) const { return {y*b.z-z*b.y, z*b.x-x*b.z, x*b.y-y*b.x}; }
    double len() const { return sqrt(x*x + y*y + z*z); }
    Vec3 norm() const { double l = len(); return {x/l, y/l, z/l}; }
};

struct Ray { Vec3 o, d; };

struct Sphere {
    Vec3 center, color;
    double radius, reflectivity;
};

struct Hit {
    double t;
    Vec3 point, normal;
    int sphere_idx;
};

const int W = 1920, H = 1080;
const int MAX_DEPTH = 5;
const int SHADOW_SAMPLES = 4;

std::vector<Sphere> spheres;
Vec3 light_pos(5, 10, -5);
Vec3 light_color(1, 1, 1);
double ambient = 0.1;

bool intersect(const Ray& ray, double t_min, double t_max, Hit& hit) {
    bool found = false;
    hit.t = t_max;
    for (int i = 0; i < (int)spheres.size(); i++) {
        Vec3 oc = ray.o - spheres[i].center;
        double a = ray.d.dot(ray.d);
        double b = oc.dot(ray.d);
        double c = oc.dot(oc) - spheres[i].radius * spheres[i].radius;
        double disc = b*b - a*c;
        if (disc > 0) {
            double t = (-b - sqrt(disc)) / a;
            if (t > t_min && t < hit.t) {
                hit.t = t;
                hit.point = ray.o + ray.d * t;
                hit.normal = (hit.point - spheres[i].center) * (1.0/spheres[i].radius);
                hit.sphere_idx = i;
                found = true;
            }
        }
    }
    return found;
}

// Simple pseudo-random for soft shadows
double rng_state = 1.0;
double rng() {
    rng_state = fmod(rng_state * 1103515245.0 + 12345.0, 2147483648.0);
    return rng_state / 2147483648.0;
}

Vec3 trace(const Ray& ray, int depth) {
    if (depth >= MAX_DEPTH) return {0, 0, 0};

    Hit hit;
    if (!intersect(ray, 0.001, 1e20, hit)) {
        // Sky gradient
        double t = 0.5 * (ray.d.norm().y + 1.0);
        return Vec3(1,1,1)*(1-t) + Vec3(0.5,0.7,1.0)*t;
    }

    const Sphere& sp = spheres[hit.sphere_idx];
    Vec3 color = {0, 0, 0};

    // Soft shadow sampling
    double shadow = 0;
    for (int s = 0; s < SHADOW_SAMPLES; s++) {
        Vec3 jitter(rng()*0.5-0.25, rng()*0.5-0.25, rng()*0.5-0.25);
        Vec3 to_light = (light_pos + jitter) - hit.point;
        double light_dist = to_light.len();
        Ray shadow_ray = {hit.point, to_light.norm()};
        Hit shadow_hit;
        if (!intersect(shadow_ray, 0.001, light_dist, shadow_hit)) {
            shadow += 1.0;
        }
    }
    shadow /= SHADOW_SAMPLES;

    // Diffuse
    Vec3 to_light = (light_pos - hit.point).norm();
    double diff = std::max(0.0, hit.normal.dot(to_light));
    color = sp.color * (ambient + diff * shadow);

    // Specular
    Vec3 reflect_dir = to_light - hit.normal * 2.0 * to_light.dot(hit.normal);
    double spec = pow(std::max(0.0, ray.d.norm().dot(reflect_dir.norm())), 32);
    color = color + light_color * spec * shadow * 0.3;

    // Reflection
    if (sp.reflectivity > 0 && depth < MAX_DEPTH) {
        Vec3 r = ray.d - hit.normal * 2.0 * ray.d.dot(hit.normal);
        Ray reflect_ray = {hit.point, r.norm()};
        Vec3 reflected = trace(reflect_ray, depth + 1);
        color = color * (1 - sp.reflectivity) + reflected * sp.reflectivity;
    }

    return color;
}

int main() {
    printf("Ray Tracer Benchmark: %dx%d\n", W, H);

    // Scene setup
    spheres.push_back({{0, -1000, 0}, {0.5, 0.5, 0.5}, 1000, 0.1});   // ground
    spheres.push_back({{0, 1, 0}, {0.8, 0.2, 0.2}, 1, 0.5});           // center
    spheres.push_back({{-2.5, 1, 0}, {0.2, 0.8, 0.2}, 1, 0.3});        // left
    spheres.push_back({{2.5, 1, 0}, {0.2, 0.2, 0.8}, 1, 0.3});         // right
    spheres.push_back({{0, 0.5, -2}, {0.8, 0.8, 0.2}, 0.5, 0.7});      // small front
    spheres.push_back({{-1.2, 0.5, 2}, {0.8, 0.2, 0.8}, 0.5, 0.2});    // small back-left
    spheres.push_back({{1.2, 0.5, 2}, {0.2, 0.8, 0.8}, 0.5, 0.2});     // small back-right

    // Add more spheres for complexity
    for (int i = 0; i < 20; i++) {
        double x = (i % 5) * 2.0 - 4.0 + (i * 0.1);
        double z = (i / 5) * 2.0 - 2.0;
        spheres.push_back({{x, 0.3, z+4}, {0.3+i*0.03, 0.5, 0.7-i*0.02}, 0.3, 0.1});
    }

    Vec3 cam_pos(0, 3, -8);
    Vec3 cam_target(0, 1, 0);
    Vec3 cam_up(0, 1, 0);

    Vec3 cam_dir = (cam_target - cam_pos).norm();
    Vec3 cam_right = cam_dir.cross(cam_up).norm();
    Vec3 cam_up_actual = cam_right.cross(cam_dir);

    double fov = 60.0 * M_PI / 180.0;
    double aspect = (double)W / H;
    double half_h = tan(fov / 2.0);
    double half_w = half_h * aspect;

    auto start = std::chrono::high_resolution_clock::now();

    std::vector<unsigned char> pixels(W * H * 3);
    long long total_rays = 0;

    for (int y = 0; y < H; y++) {
        if (y % 100 == 0) printf("  Row %d/%d\n", y, H);
        for (int x = 0; x < W; x++) {
            double u = (2.0 * x / W - 1.0) * half_w;
            double v = (1.0 - 2.0 * y / H) * half_h;

            Vec3 dir = (cam_dir + cam_right * u + cam_up_actual * v).norm();
            Ray ray = {cam_pos, dir};
            Vec3 color = trace(ray, 0);
            total_rays++;

            int idx = (y * W + x) * 3;
            pixels[idx]   = (unsigned char)(std::min(1.0, color.x) * 255);
            pixels[idx+1] = (unsigned char)(std::min(1.0, color.y) * 255);
            pixels[idx+2] = (unsigned char)(std::min(1.0, color.z) * 255);
        }
    }

    auto end = std::chrono::high_resolution_clock::now();
    double elapsed = std::chrono::duration<double>(end - start).count();

    printf("Total rays: %lld\n", total_rays);
    printf("Rays/sec: %.0f\n", total_rays / elapsed);
    printf("Time: %.3fs\n", elapsed);
    printf("RESULT:cpp_raytracer:%.4f\n", elapsed);

    return 0;
}
