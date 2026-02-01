use std::time::Instant;

const N: usize = 1024;

fn main() {
    println!("Matrix Multiply: {}x{} f64 matrices", N, N);

    let mut a = vec![0.0f64; N * N];
    let mut b = vec![0.0f64; N * N];
    let mut c = vec![0.0f64; N * N];

    // Initialize with pseudo-random values
    for i in 0..N * N {
        a[i] = (i as f64 * 0.001).sin();
        b[i] = (i as f64 * 0.002).cos();
    }

    println!("Matrices initialized, starting multiply...");
    let start = Instant::now();

    // Naive matrix multiply — tests raw CPU + cache behavior
    for i in 0..N {
        for k in 0..N {
            let a_ik = a[i * N + k];
            for j in 0..N {
                c[i * N + j] += a_ik * b[k * N + j];
            }
        }
    }

    let elapsed = start.elapsed().as_secs_f64();

    // Prevent optimizer from removing the computation
    let checksum: f64 = c.iter().sum();
    println!("Checksum: {:.6}", checksum);
    println!("Time: {:.3}s", elapsed);
    println!("RESULT:rust_matrix_multiply:{:.4}", elapsed);
}
