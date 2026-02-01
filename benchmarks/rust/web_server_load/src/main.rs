use actix_web::{web, App, HttpServer, HttpResponse};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

static COUNTER: AtomicU64 = AtomicU64::new(0);

async fn handle_request() -> HttpResponse {
    COUNTER.fetch_add(1, Ordering::Relaxed);
    HttpResponse::Ok().body("ok")
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let total_requests: u64 = 10_000;
    let concurrency: usize = 100;
    let port = 18787u16;

    // Start server in background
    let server = HttpServer::new(|| {
        App::new().route("/", web::get().to(handle_request))
    })
    .workers(4)
    .bind(format!("127.0.0.1:{}", port))?
    .run();

    let server_handle = server.handle();
    let server_task = tokio::spawn(server);

    // Wait for server to be ready
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    println!("Server started on port {}", port);
    println!("Sending {} requests with {} concurrency...", total_requests, concurrency);

    let start = Instant::now();
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/", port);
    let completed = Arc::new(AtomicU64::new(0));

    let mut handles = Vec::new();
    let requests_per_worker = total_requests / concurrency as u64;

    for _ in 0..concurrency {
        let client = client.clone();
        let url = url.clone();
        let completed = completed.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..requests_per_worker {
                let _ = client.get(&url).send().await;
                completed.fetch_add(1, Ordering::Relaxed);
            }
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    let elapsed = start.elapsed().as_secs_f64();
    let total = completed.load(Ordering::Relaxed);
    let rps = total as f64 / elapsed;

    println!("Completed: {} requests", total);
    println!("Time: {:.3}s", elapsed);
    println!("Throughput: {:.0} req/s", rps);
    println!("RESULT:rust_web_server_load:{:.4}", elapsed);

    server_handle.stop(true).await;
    let _ = server_task.await;
    Ok(())
}
