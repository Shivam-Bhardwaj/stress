const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const SSHRunner = require('./ssh-runner');
const BENCHMARKS = require('./benchmarks');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const MACHINES_FILE = path.join(__dirname, '..', 'machines.json');
const RESULTS_FILE = path.join(__dirname, '..', 'results.json');

function log(tag, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}]`, ...args);
}

// ── Middleware ───────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));

// ── Machine storage ─────────────────────────────────────
function loadMachines() {
  if (fs.existsSync(MACHINES_FILE)) {
    return JSON.parse(fs.readFileSync(MACHINES_FILE, 'utf8'));
  }
  return [];
}

function saveMachines(machines) {
  fs.writeFileSync(MACHINES_FILE, JSON.stringify(machines, null, 2));
}

function loadResults() {
  if (fs.existsSync(RESULTS_FILE)) {
    return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  }
  return [];
}

function saveResults(results) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// ── REST API ────────────────────────────────────────────
app.get('/api/machines', (req, res) => {
  log('API', 'GET /api/machines');
  const machines = loadMachines().map(m => ({
    ...m,
    password: m.password ? '***' : undefined,
    privateKey: m.privateKey ? '***' : undefined,
  }));
  log('API', `Returning ${machines.length} machine(s)`);
  res.json(machines);
});

app.post('/api/machines', (req, res) => {
  const machines = loadMachines();
  const machine = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: req.body.name,
    host: req.body.host,
    port: req.body.port || 22,
    username: req.body.username,
    password: req.body.password || undefined,
    privateKeyPath: req.body.privateKeyPath || undefined,
  };
  machines.push(machine);
  saveMachines(machines);
  log('API', `Machine added: "${machine.name}" (${machine.username}@${machine.host}:${machine.port}) [id=${machine.id}]`);
  res.json({ ...machine, password: machine.password ? '***' : undefined });
});

app.delete('/api/machines/:id', (req, res) => {
  let machines = loadMachines();
  const removed = machines.find(m => m.id === req.params.id);
  machines = machines.filter(m => m.id !== req.params.id);
  saveMachines(machines);
  log('API', `Machine removed: "${removed?.name || req.params.id}"`);
  res.json({ ok: true });
});

app.get('/api/benchmarks', (req, res) => {
  log('API', 'GET /api/benchmarks');
  const list = Object.entries(BENCHMARKS).map(([id, b]) => ({
    id,
    name: b.name,
    category: b.category,
    description: b.description,
    needsTarget: b.needsTarget || false,
  }));
  res.json(list);
});

app.get('/api/results', (req, res) => {
  log('API', 'GET /api/results');
  res.json(loadResults());
});

app.delete('/api/results', (req, res) => {
  log('API', 'DELETE /api/results — clearing history');
  saveResults([]);
  res.json({ ok: true });
});

// ── WebSocket ───────────────────────────────────────────
const activeRuns = new Map(); // runId -> { aborted, abortController }

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  log('WS', `Client connected from ${clientIp}`);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    log('WS', `Received message: type=${msg.type}${msg.runId ? ` runId=${msg.runId}` : ''}${msg.machineId ? ` machineId=${msg.machineId}` : ''}`);

    if (msg.type === 'test_connection') {
      await handleTestConnection(ws, msg);
    } else if (msg.type === 'run_benchmarks') {
      await handleRunBenchmarks(ws, msg);
    } else if (msg.type === 'abort') {
      const run = activeRuns.get(msg.runId);
      if (run) {
        log('RUN', `Abort requested for run ${msg.runId}`);
        run.aborted = true;
        if (run.abortController) run.abortController.abort();
      } else {
        log('RUN', `Abort requested but run ${msg.runId} not found`);
      }
    }
  });

  ws.on('close', () => {
    log('WS', `Client disconnected: ${clientIp}`);
  });
});

async function handleTestConnection(ws, msg) {
  const machines = loadMachines();
  const machine = machines.find(m => m.id === msg.machineId);
  if (!machine) {
    log('CONN', `Test connection: machine ${msg.machineId} not found in config`);
    ws.send(JSON.stringify({ type: 'connection_result', machineId: msg.machineId, success: false, error: 'Machine not found' }));
    return;
  }
  log('CONN', `Testing connection to "${machine.name}" (${machine.username}@${machine.host}:${machine.port})...`);
  try {
    const runner = new SSHRunner(machine);
    const result = await runner.testConnection();
    log('CONN', `Connection to "${machine.name}" succeeded in ${result.connectTimeMs}ms`);
    ws.send(JSON.stringify({ type: 'connection_result', machineId: msg.machineId, success: true, info: result.info, connectTimeMs: result.connectTimeMs }));
  } catch (err) {
    log('CONN', `Connection to "${machine.name}" FAILED: ${err.message}`);
    ws.send(JSON.stringify({ type: 'connection_result', machineId: msg.machineId, success: false, error: err.message }));
  }
}

async function handleRunBenchmarks(ws, msg) {
  const { machineIds, benchmarkIds, runId } = msg;
  const machines = loadMachines();
  const abortController = new AbortController();
  const runState = { aborted: false, abortController };
  activeRuns.set(runId, runState);

  const send = (payload) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  };

  const selectedMachines = machines.filter(m => machineIds.includes(m.id));
  const totalBenchmarks = benchmarkIds.length * selectedMachines.length;
  let completed = 0;

  log('RUN', `=== Starting run ${runId} ===`);
  log('RUN', `Machines: ${selectedMachines.map(m => `"${m.name}" (${m.host})`).join(', ')}`);
  log('RUN', `Benchmarks (${benchmarkIds.length}): ${benchmarkIds.join(', ')}`);
  log('RUN', `Total tasks: ${totalBenchmarks}`);

  const runResults = {
    id: runId,
    timestamp: new Date().toISOString(),
    machines: {},
    benchmarks: {},
  };

  // Run benchmarks on each machine in parallel
  const machinePromises = selectedMachines.map(async (machine) => {
    const runner = new SSHRunner(machine);
    runResults.machines[machine.id] = { name: machine.name, host: machine.host };
    runResults.benchmarks[machine.id] = {};

    // Deploy benchmarks first
    log('RUN', `[${machine.name}] Phase 1: Deploying benchmarks to remote...`);
    send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] Phase 1: Deploying benchmarks...\n` });
    try {
      await runner.deployBenchmarks((text) => {
        send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] ${text}` });
      });
      log('RUN', `[${machine.name}] Deploy complete`);
    } catch (err) {
      log('RUN', `[${machine.name}] Deploy FAILED: ${err.message}`);
      send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] Deploy failed: ${err.message}\n` });
      return;
    }

    // Run setup
    log('RUN', `[${machine.name}] Phase 2: Running setup.sh (installing dependencies)...`);
    send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] Phase 2: Running setup.sh (installing dependencies)...\n` });
    try {
      const { exitCode } = await runner.execCommand('cd ~/stress-benchmarks && bash setup.sh 2>&1', (text) => {
        send({ type: 'output', runId, machineId: machine.id, text });
      }, 300000, { signal: abortController.signal });
      log('RUN', `[${machine.name}] Setup finished (exit=${exitCode})`);
    } catch (err) {
      if (runState.aborted) return;
      log('RUN', `[${machine.name}] Setup warning: ${err.message}`);
      send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] Setup warning: ${err.message}\n` });
    }

    // Run each benchmark sequentially on this machine
    log('RUN', `[${machine.name}] Phase 3: Running ${benchmarkIds.length} benchmark(s)...`);
    send({ type: 'output', runId, machineId: machine.id, text: `\n[${machine.name}] Phase 3: Running ${benchmarkIds.length} benchmark(s)...\n` });

    for (let bi = 0; bi < benchmarkIds.length; bi++) {
      const benchId = benchmarkIds[bi];

      if (runState.aborted) {
        log('RUN', `[${machine.name}] Run aborted, skipping remaining benchmarks`);
        send({ type: 'output', runId, machineId: machine.id, text: `\n[${machine.name}] Run aborted by user.\n` });
        break;
      }

      const bench = BENCHMARKS[benchId];
      if (!bench) {
        log('RUN', `[${machine.name}] Unknown benchmark "${benchId}", skipping`);
        continue;
      }

      const benchNum = `[${bi + 1}/${benchmarkIds.length}]`;

      // Network benchmarks need a target
      if (bench.needsTarget) {
        const otherMachines = selectedMachines.filter(m => m.id !== machine.id);
        if (otherMachines.length === 0) {
          log('RUN', `[${machine.name}] ${benchNum} Skipping "${bench.name}" — needs another machine as target`);
          send({ type: 'output', runId, machineId: machine.id, text: `\n${benchNum} Skipping ${bench.name} — needs another machine as target.\n` });
          completed++;
          send({ type: 'progress', runId, completed, total: totalBenchmarks });
          continue;
        }
        // Run against first other machine
        const target = otherMachines[0];
        log('RUN', `[${machine.name}] ${benchNum} "${bench.name}" targeting ${target.name} (${target.host})`);

        if (benchId === 'network_ssh_overhead') {
          // Measure from server side
          send({ type: 'benchmark_start', runId, machineId: machine.id, benchmarkId: benchId, name: bench.name });
          send({ type: 'output', runId, machineId: machine.id, text: `\n${benchNum} ${bench.name} — measuring SSH overhead to ${machine.host}...\n` });
          try {
            const sshTime = await runner.measureSSHOverhead();
            const resultLine = `SSH connection + trivial command: ${sshTime.toFixed(3)}s\nRESULT:network_ssh_overhead:${sshTime.toFixed(4)}`;
            send({ type: 'output', runId, machineId: machine.id, text: resultLine + '\n' });
            runResults.benchmarks[machine.id][benchId] = sshTime;
            send({ type: 'benchmark_result', runId, machineId: machine.id, benchmarkId: benchId, seconds: sshTime });
            log('RUN', `[${machine.name}] ${benchNum} "${bench.name}" result: ${sshTime.toFixed(3)}s`);
          } catch (err) {
            log('RUN', `[${machine.name}] ${benchNum} "${bench.name}" FAILED: ${err.message}`);
            send({ type: 'output', runId, machineId: machine.id, text: `Error: ${err.message}\n` });
          }
          completed++;
          send({ type: 'progress', runId, completed, total: totalBenchmarks });
          continue;
        }

        const cmd = bench.buildRun(target.host);
        send({ type: 'benchmark_start', runId, machineId: machine.id, benchmarkId: benchId, name: bench.name });
        send({ type: 'output', runId, machineId: machine.id, text: `\n${benchNum} ${bench.name} (target: ${target.name})...\n` });
        const startTime = Date.now();
        try {
          const { output } = await runner.execCommand(cmd, (text) => {
            send({ type: 'output', runId, machineId: machine.id, text });
          }, 120000, { signal: abortController.signal });
          const seconds = parseResult(output, benchId) || (Date.now() - startTime) / 1000;
          runResults.benchmarks[machine.id][benchId] = seconds;
          send({ type: 'benchmark_result', runId, machineId: machine.id, benchmarkId: benchId, seconds });
          log('RUN', `[${machine.name}] ${benchNum} "${bench.name}" result: ${seconds.toFixed(3)}s`);
        } catch (err) {
          if (runState.aborted) break;
          log('RUN', `[${machine.name}] ${benchNum} "${bench.name}" FAILED: ${err.message}`);
          send({ type: 'output', runId, machineId: machine.id, text: `Error: ${err.message}\n` });
        }
        completed++;
        send({ type: 'progress', runId, completed, total: totalBenchmarks });
        continue;
      }

      // Setup step if benchmark has one
      if (bench.setup) {
        log('RUN', `[${machine.name}] ${benchNum} Setting up "${bench.name}"...`);
        send({ type: 'output', runId, machineId: machine.id, text: `\n${benchNum} Setting up ${bench.name}...\n` });
        try {
          await runner.execCommand(bench.setup, (text) => {
            send({ type: 'output', runId, machineId: machine.id, text });
          }, 300000, { signal: abortController.signal });
          log('RUN', `[${machine.name}] ${benchNum} Setup for "${bench.name}" complete`);
        } catch (err) {
          if (runState.aborted) break;
          log('RUN', `[${machine.name}] ${benchNum} Setup for "${bench.name}" error: ${err.message}`);
          send({ type: 'output', runId, machineId: machine.id, text: `Setup error: ${err.message}\n` });
        }
      }

      log('RUN', `[${machine.name}] ${benchNum} Running "${bench.name}"...`);
      send({ type: 'output', runId, machineId: machine.id, text: `\n${benchNum} ▶ Running ${bench.name}...\n` });
      send({ type: 'benchmark_start', runId, machineId: machine.id, benchmarkId: benchId, name: bench.name });

      const startTime = Date.now();
      try {
        const { output, exitCode } = await runner.execCommand(bench.run, (text) => {
          send({ type: 'output', runId, machineId: machine.id, text });
        }, 600000, { signal: abortController.signal });

        const elapsed = (Date.now() - startTime) / 1000;
        const seconds = parseResult(output, benchId) || elapsed;
        runResults.benchmarks[machine.id][benchId] = seconds;
        send({ type: 'benchmark_result', runId, machineId: machine.id, benchmarkId: benchId, seconds, elapsed });
        log('RUN', `[${machine.name}] ${benchNum} ✓ "${bench.name}": ${seconds.toFixed(3)}s (exit=${exitCode}, wall=${elapsed.toFixed(1)}s)`);
        send({ type: 'output', runId, machineId: machine.id, text: `${benchNum} ✓ ${bench.name}: ${seconds.toFixed(3)}s\n` });
      } catch (err) {
        if (runState.aborted) {
          log('RUN', `[${machine.name}] ${benchNum} "${bench.name}" aborted`);
          send({ type: 'output', runId, machineId: machine.id, text: `${benchNum} ✗ ${bench.name} aborted\n` });
          break;
        }
        log('RUN', `[${machine.name}] ${benchNum} ✗ "${bench.name}" FAILED: ${err.message}`);
        send({ type: 'output', runId, machineId: machine.id, text: `${benchNum} ✗ ${bench.name} failed: ${err.message}\n` });
        send({ type: 'benchmark_result', runId, machineId: machine.id, benchmarkId: benchId, error: err.message });
      }

      completed++;
      send({ type: 'progress', runId, completed, total: totalBenchmarks });
    }
  });

  await Promise.all(machinePromises);

  // Save results
  const allResults = loadResults();
  allResults.push(runResults);
  saveResults(allResults);

  log('RUN', `=== Run ${runId} complete (aborted=${runState.aborted}) ===`);
  send({ type: 'run_complete', runId, results: runResults });
  activeRuns.delete(runId);
}

function parseResult(output, benchId) {
  const regex = new RegExp(`RESULT:${benchId}:([\\d.]+)`);
  const match = output.match(regex);
  if (match) return parseFloat(match[1]);
  // Also try generic RESULT line
  const generic = output.match(/RESULT:\w+:([\d.]+)/);
  if (generic) return parseFloat(generic[1]);
  return null;
}

// ── Start ───────────────────────────────────────────────
server.listen(PORT, () => {
  log('SERVER', `==============================================`);
  log('SERVER', `  Stress Benchmark Suite v1.0`);
  log('SERVER', `  HTTP + WebSocket on http://localhost:${PORT}`);
  log('SERVER', `  Machines config: ${MACHINES_FILE}`);
  log('SERVER', `  Results storage: ${RESULTS_FILE}`);
  log('SERVER', `==============================================`);
  const existingMachines = loadMachines();
  if (existingMachines.length > 0) {
    log('SERVER', `Loaded ${existingMachines.length} machine(s):`);
    existingMachines.forEach(m => log('SERVER', `  - "${m.name}" (${m.username}@${m.host}:${m.port})`));
  } else {
    log('SERVER', 'No machines configured yet. Add one via the web UI.');
  }
});
