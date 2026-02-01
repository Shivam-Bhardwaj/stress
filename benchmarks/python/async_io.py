#!/usr/bin/env python3
"""Async I/O Benchmark: HTTP server + concurrent aiohttp requests."""
import asyncio
import time
import os
import tempfile
from aiohttp import web, ClientSession, TCPConnector

TOTAL_REQUESTS = 10_000
CONCURRENCY = 100
PORT = 18788

request_count = 0

async def handle(request):
    global request_count
    request_count += 1
    return web.Response(text=f"ok-{request_count}")

async def run_server(app, runner):
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', PORT)
    await site.start()

async def run_clients():
    connector = TCPConnector(limit=CONCURRENCY)
    async with ClientSession(connector=connector) as session:
        sem = asyncio.Semaphore(CONCURRENCY)
        completed = 0

        async def fetch(i):
            nonlocal completed
            async with sem:
                async with session.get(f'http://127.0.0.1:{PORT}/') as resp:
                    await resp.text()
                    completed += 1
                    if completed % 2000 == 0:
                        print(f"  Completed {completed}/{TOTAL_REQUESTS} requests")

        tasks = [fetch(i) for i in range(TOTAL_REQUESTS)]
        await asyncio.gather(*tasks)
        return completed

async def file_io_bench():
    """Concurrent file I/O operations."""
    tmpdir = tempfile.mkdtemp()
    files = 1000
    data = b"x" * 4096

    async def write_file(i):
        path = os.path.join(tmpdir, f"file_{i}.dat")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: open(path, 'wb').write(data))

    async def read_file(i):
        path = os.path.join(tmpdir, f"file_{i}.dat")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: open(path, 'rb').read())

    # Write
    await asyncio.gather(*[write_file(i) for i in range(files)])
    # Read
    await asyncio.gather(*[read_file(i) for i in range(files)])
    # Cleanup
    for i in range(files):
        os.unlink(os.path.join(tmpdir, f"file_{i}.dat"))
    os.rmdir(tmpdir)
    return files

async def main():
    print(f"Async I/O Benchmark: {TOTAL_REQUESTS} HTTP requests + file I/O")

    app = web.Application()
    app.router.add_get('/', handle)
    runner = web.AppRunner(app)

    await run_server(app, runner)
    print(f"Server started on port {PORT}")

    start = time.time()

    # HTTP load test
    print("Running HTTP load test...")
    completed = await run_clients()
    http_time = time.time() - start
    print(f"HTTP: {completed} requests in {http_time:.3f}s ({completed/http_time:.0f} req/s)")

    # File I/O test
    print("Running file I/O test...")
    fio_start = time.time()
    file_count = await file_io_bench()
    fio_time = time.time() - fio_start
    print(f"File I/O: {file_count*2} ops in {fio_time:.3f}s")

    elapsed = time.time() - start
    await runner.cleanup()

    print(f"Total time: {elapsed:.3f}s")
    print(f"RESULT:python_async_io:{elapsed:.4f}")

if __name__ == '__main__':
    asyncio.run(main())
