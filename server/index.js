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
  const machines = loadMachines().map(m => ({
    ...m,
    password: m.password ? '***' : undefined,
    privateKey: m.privateKey ? '***' : undefined,
  }));
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
  res.json({ ...machine, password: machine.password ? '***' : undefined });
});

app.delete('/api/machines/:id', (req, res) => {
  let machines = loadMachines();
  machines = machines.filter(m => m.id !== req.params.id);
  saveMachines(machines);
  res.json({ ok: true });
});

app.get('/api/benchmarks', (req, res) => {
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
  res.json(loadResults());
});

app.delete('/api/results', (req, res) => {
  saveResults([]);
  res.json({ ok: true });
});

// ── WebSocket ───────────────────────────────────────────
const activeRuns = new Map(); // runId -> { aborted }

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'test_connection') {
      await handleTestConnection(ws, msg);
    } else if (msg.type === 'run_benchmarks') {
      await handleRunBenchmarks(ws, msg);
    } else if (msg.type === 'abort') {
      const run = activeRuns.get(msg.runId);
      if (run) run.aborted = true;
    }
  });
});

async function handleTestConnection(ws, msg) {
  const machines = loadMachines();
  const machine = machines.find(m => m.id === msg.machineId);
  if (!machine) {
    ws.send(JSON.stringify({ type: 'connection_result', machineId: msg.machineId, success: false, error: 'Machine not found' }));
    return;
  }
  try {
    const runner = new SSHRunner(machine);
    const result = await runner.testConnection();
    ws.send(JSON.stringify({ type: 'connection_result', machineId: msg.machineId, success: true, info: result.info, connectTimeMs: result.connectTimeMs }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'connection_result', machineId: msg.machineId, success: false, error: err.message }));
  }
}

async function handleRunBenchmarks(ws, msg) {
  const { machineIds, benchmarkIds, runId } = msg;
  const machines = loadMachines();
  const runState = { aborted: false };
  activeRuns.set(runId, runState);

  const send = (payload) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  };

  const selectedMachines = machines.filter(m => machineIds.includes(m.id));
  const totalBenchmarks = benchmarkIds.length * selectedMachines.length;
  let completed = 0;

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
    send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] Deploying benchmarks...\n` });
    try {
      await runner.deployBenchmarks((text) => {
        send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] ${text}` });
      });
    } catch (err) {
      send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] Deploy failed: ${err.message}\n` });
      return;
    }

    // Run setup
    send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] Running setup...\n` });
    try {
      await runner.execCommand('cd ~/stress-benchmarks && bash setup.sh 2>&1', (text) => {
        send({ type: 'output', runId, machineId: machine.id, text });
      }, 300000);
    } catch (err) {
      send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] Setup warning: ${err.message}\n` });
    }

    // Run each benchmark sequentially on this machine
    for (const benchId of benchmarkIds) {
      if (runState.aborted) {
        send({ type: 'output', runId, machineId: machine.id, text: `\n[${machine.name}] Run aborted.\n` });
        break;
      }

      const bench = BENCHMARKS[benchId];
      if (!bench) continue;

      // Network benchmarks need a target
      if (bench.needsTarget) {
        const otherMachines = selectedMachines.filter(m => m.id !== machine.id);
        if (otherMachines.length === 0) {
          send({ type: 'output', runId, machineId: machine.id, text: `\n[${machine.name}] Skipping ${bench.name} — needs another machine.\n` });
          completed++;
          send({ type: 'progress', runId, completed, total: totalBenchmarks });
          continue;
        }
        // Run against first other machine
        const target = otherMachines[0];

        if (benchId === 'network_ssh_overhead') {
          // Measure from server side
          send({ type: 'benchmark_start', runId, machineId: machine.id, benchmarkId: benchId, name: bench.name });
          try {
            const sshTime = await runner.measureSSHOverhead();
            const resultLine = `SSH connection + trivial command: ${sshTime.toFixed(3)}s\nRESULT:network_ssh_overhead:${sshTime.toFixed(4)}`;
            send({ type: 'output', runId, machineId: machine.id, text: resultLine + '\n' });
            runResults.benchmarks[machine.id][benchId] = sshTime;
            send({ type: 'benchmark_result', runId, machineId: machine.id, benchmarkId: benchId, seconds: sshTime });
          } catch (err) {
            send({ type: 'output', runId, machineId: machine.id, text: `Error: ${err.message}\n` });
          }
          completed++;
          send({ type: 'progress', runId, completed, total: totalBenchmarks });
          continue;
        }

        const cmd = bench.buildRun(target.host);
        send({ type: 'benchmark_start', runId, machineId: machine.id, benchmarkId: benchId, name: bench.name });
        const startTime = Date.now();
        try {
          const { output } = await runner.execCommand(cmd, (text) => {
            send({ type: 'output', runId, machineId: machine.id, text });
          }, 120000);
          const seconds = parseResult(output, benchId) || (Date.now() - startTime) / 1000;
          runResults.benchmarks[machine.id][benchId] = seconds;
          send({ type: 'benchmark_result', runId, machineId: machine.id, benchmarkId: benchId, seconds });
        } catch (err) {
          send({ type: 'output', runId, machineId: machine.id, text: `Error: ${err.message}\n` });
        }
        completed++;
        send({ type: 'progress', runId, completed, total: totalBenchmarks });
        continue;
      }

      // Setup step if benchmark has one
      if (bench.setup) {
        send({ type: 'output', runId, machineId: machine.id, text: `\n[${machine.name}] Setting up ${bench.name}...\n` });
        try {
          await runner.execCommand(bench.setup, (text) => {
            send({ type: 'output', runId, machineId: machine.id, text });
          }, 300000);
        } catch (err) {
          send({ type: 'output', runId, machineId: machine.id, text: `Setup error: ${err.message}\n` });
        }
      }

      send({ type: 'output', runId, machineId: machine.id, text: `\n[${machine.name}] ▶ Running ${bench.name}...\n` });
      send({ type: 'benchmark_start', runId, machineId: machine.id, benchmarkId: benchId, name: bench.name });

      const startTime = Date.now();
      try {
        const { output } = await runner.execCommand(bench.run, (text) => {
          send({ type: 'output', runId, machineId: machine.id, text });
        }, 600000);

        const elapsed = (Date.now() - startTime) / 1000;
        const seconds = parseResult(output, benchId) || elapsed;
        runResults.benchmarks[machine.id][benchId] = seconds;
        send({ type: 'benchmark_result', runId, machineId: machine.id, benchmarkId: benchId, seconds, elapsed });
        send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] ✓ ${bench.name}: ${seconds.toFixed(3)}s\n` });
      } catch (err) {
        send({ type: 'output', runId, machineId: machine.id, text: `[${machine.name}] ✗ ${bench.name} failed: ${err.message}\n` });
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
  console.log(`Stress Benchmark Suite running at http://localhost:${PORT}`);
});
