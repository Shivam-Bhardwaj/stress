// ── State ───────────────────────────────────────────────
let ws = null;
let machines = [];
let benchmarks = [];
let currentRunId = null;
let runStartTime = null;
let elapsedTimer = null;
let terminalBuffers = {}; // machineId -> text

// ── DOM refs ────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  connectWebSocket();
  await loadMachines();
  await loadBenchmarks();
  bindEvents();
});

// ── WebSocket ───────────────────────────────────────────
function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    $('#ws-dot').classList.add('connected');
    $('#ws-status').textContent = 'Connected';
  };

  ws.onclose = () => {
    $('#ws-dot').classList.remove('connected');
    $('#ws-status').textContent = 'Disconnected';
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {};

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleWSMessage(msg);
  };
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'connection_result':
      handleConnectionResult(msg);
      break;
    case 'output':
      appendTerminal(msg.machineId, msg.text);
      break;
    case 'benchmark_start':
      appendTerminal(msg.machineId, `\n--- ${msg.name} ---\n`, 'line-info');
      break;
    case 'benchmark_result':
      if (msg.seconds !== undefined) {
        appendTerminal(msg.machineId, `RESULT: ${msg.seconds.toFixed(3)}s\n`, 'line-result');
      }
      break;
    case 'progress':
      updateProgress(msg.completed, msg.total);
      break;
    case 'run_complete':
      handleRunComplete(msg.results);
      break;
  }
}

// ── Machines ────────────────────────────────────────────
async function loadMachines() {
  const res = await fetch('/api/machines');
  machines = await res.json();
  renderMachines();
}

function renderMachines() {
  const list = $('#machine-list');
  if (machines.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px">No machines configured. Add one to get started.</div>';
    return;
  }

  list.innerHTML = machines.map(m => `
    <div class="machine-card" data-id="${m.id}">
      <div class="machine-card-header">
        <span class="machine-name">${esc(m.name)}</span>
        <span class="status-badge pending" id="status-${m.id}">unknown</span>
      </div>
      <div class="machine-host">${esc(m.username)}@${esc(m.host)}:${m.port}</div>
      <div class="machine-info" id="info-${m.id}"></div>
      <div class="machine-actions">
        <button class="btn btn-sm btn-success" onclick="testConnection('${m.id}')">Test</button>
        <button class="btn btn-sm btn-danger" onclick="removeMachine('${m.id}')">Remove</button>
      </div>
    </div>
  `).join('');

  updateRunButton();
}

window.testConnection = function(id) {
  const badge = $(`#status-${id}`);
  badge.className = 'status-badge pending';
  badge.textContent = 'testing...';
  wsSend({ type: 'test_connection', machineId: id });
};

function handleConnectionResult(msg) {
  const badge = $(`#status-${msg.machineId}`);
  const info = $(`#info-${msg.machineId}`);
  if (msg.success) {
    badge.className = 'status-badge ok';
    badge.textContent = 'connected';
    if (info) info.textContent = msg.info;
  } else {
    badge.className = 'status-badge error';
    badge.textContent = 'error';
    if (info) info.textContent = msg.error;
  }
}

window.removeMachine = async function(id) {
  await fetch(`/api/machines/${id}`, { method: 'DELETE' });
  await loadMachines();
};

// ── Benchmarks ──────────────────────────────────────────
async function loadBenchmarks() {
  const res = await fetch('/api/benchmarks');
  benchmarks = await res.json();
  renderBenchmarks();
}

function renderBenchmarks() {
  const categories = {};
  benchmarks.forEach(b => {
    if (!categories[b.category]) categories[b.category] = [];
    categories[b.category].push(b);
  });

  const categoryNames = { rust: 'Rust', python: 'Python', cpp: 'C++', system: 'System', network: 'Network' };

  let html = '';
  for (const [cat, items] of Object.entries(categories)) {
    html += `
      <div class="benchmark-group">
        <div class="benchmark-group-header" onclick="toggleCategory('${cat}')">
          <span class="benchmark-group-title">
            <span class="category-dot ${cat}"></span>
            ${categoryNames[cat] || cat}
          </span>
          <button class="btn btn-sm" onclick="event.stopPropagation();selectCategory('${cat}')">All</button>
        </div>
        <div class="benchmark-items" id="cat-${cat}">
          ${items.map(b => `
            <div class="benchmark-item">
              <input type="checkbox" id="bench-${b.id}" data-id="${b.id}" class="bench-checkbox" onchange="updateRunButton()">
              <label for="bench-${b.id}">${esc(b.name)}</label>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  $('#benchmark-list').innerHTML = html;
}

window.toggleCategory = function(cat) {
  const el = $(`#cat-${cat}`);
  el.style.display = el.style.display === 'none' ? '' : 'none';
};

window.selectCategory = function(cat) {
  const items = $$(`#cat-${cat} .bench-checkbox`);
  const allChecked = Array.from(items).every(cb => cb.checked);
  items.forEach(cb => cb.checked = !allChecked);
  updateRunButton();
};

function getSelectedBenchmarks() {
  return Array.from($$('.bench-checkbox:checked')).map(cb => cb.dataset.id);
}

function updateRunButton() {
  const hasSelection = getSelectedBenchmarks().length > 0 && machines.length > 0;
  $('#btn-run').disabled = !hasSelection || currentRunId !== null;
}

// ── Run Benchmarks ──────────────────────────────────────
function startRun() {
  const benchmarkIds = getSelectedBenchmarks();
  const machineIds = machines.map(m => m.id);
  if (benchmarkIds.length === 0 || machineIds.length === 0) return;

  currentRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  terminalBuffers = {};

  // Setup terminal panels
  setupTerminals(machineIds);

  // UI state
  $('#btn-run').disabled = true;
  $('#btn-abort').style.display = '';
  $('#progress-text').textContent = 'Starting...';
  $('#progress-fill').style.width = '0%';

  runStartTime = Date.now();
  elapsedTimer = setInterval(() => {
    const sec = ((Date.now() - runStartTime) / 1000).toFixed(1);
    $('#global-elapsed').textContent = sec + 's';
  }, 100);

  wsSend({
    type: 'run_benchmarks',
    machineIds,
    benchmarkIds,
    runId: currentRunId,
  });
}

function setupTerminals(machineIds) {
  const area = $('#terminal-area');

  if (machineIds.length <= 1) {
    const name = machines.length > 0 ? machines[0].name : 'Output';
    const id = machineIds[0] || 'default';
    area.innerHTML = `
      <div class="terminal-panel">
        <div class="terminal-header"><span>${esc(name)}</span></div>
        <div class="terminal-body" id="term-${id}"></div>
      </div>
    `;
  } else {
    area.innerHTML = machineIds.map(id => {
      const m = machines.find(m => m.id === id);
      return `
        <div class="terminal-panel">
          <div class="terminal-header"><span>${esc(m ? m.name : id)}</span></div>
          <div class="terminal-body" id="term-${id}"></div>
        </div>
      `;
    }).join('');
  }
}

function appendTerminal(machineId, text, className) {
  const el = $(`#term-${machineId}`) || $(`#term-${machines[0]?.id}`) || $('.terminal-body');
  if (!el) return;

  if (className) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    el.appendChild(span);
  } else {
    // Colorize RESULT lines
    const parts = text.split(/(RESULT:\w+:[\d.]+)/g);
    parts.forEach(part => {
      if (/^RESULT:/.test(part)) {
        const span = document.createElement('span');
        span.className = 'line-result';
        span.textContent = part;
        el.appendChild(span);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  el.scrollTop = el.scrollHeight;
}

function updateProgress(completed, total) {
  const pct = total > 0 ? (completed / total * 100) : 0;
  $('#progress-fill').style.width = pct + '%';
  $('#progress-text').textContent = `${completed}/${total} benchmarks`;
}

function handleRunComplete(results) {
  currentRunId = null;
  clearInterval(elapsedTimer);

  $('#btn-run').disabled = false;
  $('#btn-abort').style.display = 'none';
  $('#progress-text').textContent = 'Complete';
  $('#progress-fill').style.width = '100%';

  if (results) {
    renderResults(results);
    $('#results-area').classList.add('visible');
  }

  updateRunButton();
}

// ── Results ─────────────────────────────────────────────
function renderResults(results) {
  const machineIds = Object.keys(results.machines);
  const benchIds = new Set();
  for (const mid of machineIds) {
    for (const bid of Object.keys(results.benchmarks[mid] || {})) {
      benchIds.add(bid);
    }
  }

  // Table header
  const thead = $('#results-thead');
  thead.innerHTML = '<th>Benchmark</th>' +
    machineIds.map(mid => `<th>${esc(results.machines[mid].name)}</th>`).join('') +
    (machineIds.length === 2 ? '<th>Diff</th>' : '');

  // Table body
  const tbody = $('#results-tbody');
  tbody.innerHTML = '';

  const chartData = [];

  for (const bid of benchIds) {
    const bench = benchmarks.find(b => b.id === bid);
    const row = document.createElement('tr');

    let cells = `<td style="font-family:var(--font-sans)">${esc(bench ? bench.name : bid)}</td>`;
    const times = [];

    for (const mid of machineIds) {
      const val = results.benchmarks[mid]?.[bid];
      if (val !== undefined && val !== null) {
        cells += `<td>${val.toFixed(3)}s</td>`;
        times.push(val);
      } else {
        cells += `<td style="color:var(--text-muted)">-</td>`;
        times.push(null);
      }
    }

    if (machineIds.length === 2 && times[0] != null && times[1] != null) {
      const diff = ((times[1] - times[0]) / times[0] * 100).toFixed(1);
      const cls = parseFloat(diff) > 0 ? 'slower' : 'faster';
      cells += `<td class="${cls}">${diff > 0 ? '+' : ''}${diff}%</td>`;
    }

    chartData.push({
      name: bench ? bench.name : bid,
      times: times,
    });

    row.innerHTML = cells;
    tbody.appendChild(row);
  }

  // Draw chart
  drawChart(chartData, machineIds.map(mid => results.machines[mid].name));
}

function drawChart(data, machineNames) {
  const canvas = $('#results-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);

  const w = canvas.offsetWidth;
  const h = 200;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  if (data.length === 0) return;

  const maxTime = Math.max(...data.flatMap(d => d.times.filter(t => t != null)));
  const barGroupWidth = chartW / data.length;
  const numMachines = machineNames.length;
  const barWidth = Math.min(30, (barGroupWidth - 8) / numMachines);
  const colors = ['#3b82f6', '#f97316', '#22c55e', '#a855f7'];

  // Y axis
  ctx.strokeStyle = '#1e2d3d';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'right';

  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    const val = maxTime * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(1) + 's', padding.left - 8, y + 4);
  }

  // Bars
  data.forEach((item, i) => {
    const groupX = padding.left + i * barGroupWidth + (barGroupWidth - numMachines * barWidth) / 2;

    item.times.forEach((t, mi) => {
      if (t == null) return;
      const barH = (t / maxTime) * chartH;
      const x = groupX + mi * barWidth;
      const y = padding.top + chartH - barH;

      ctx.fillStyle = colors[mi % colors.length];
      ctx.fillRect(x, y, barWidth - 2, barH);
    });

    // Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const labelX = padding.left + i * barGroupWidth + barGroupWidth / 2;

    // Truncate long names
    let label = item.name;
    if (label.length > 12) label = label.slice(0, 11) + '..';
    ctx.save();
    ctx.translate(labelX, padding.top + chartH + 12);
    ctx.rotate(-0.3);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });

  // Legend
  machineNames.forEach((name, i) => {
    const x = padding.left + i * 120;
    const y = h - 4;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y - 8, 10, 10);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(name, x + 14, y);
  });
}

// ── Export ───────────────────────────────────────────────
async function exportJSON() {
  const res = await fetch('/api/results');
  const data = await res.json();
  download('stress-results.json', JSON.stringify(data, null, 2), 'application/json');
}

async function exportMarkdown() {
  const res = await fetch('/api/results');
  const allResults = await res.json();
  if (allResults.length === 0) return;

  const latest = allResults[allResults.length - 1];
  const machineIds = Object.keys(latest.machines);
  const benchIds = new Set();
  for (const mid of machineIds) {
    for (const bid of Object.keys(latest.benchmarks[mid] || {})) {
      benchIds.add(bid);
    }
  }

  let md = `# Stress Benchmark Results\n\n`;
  md += `**Date:** ${latest.timestamp}\n\n`;
  md += `| Benchmark | ${machineIds.map(mid => latest.machines[mid].name).join(' | ')} |\n`;
  md += `|-----------|${machineIds.map(() => '-------').join('|')}|\n`;

  for (const bid of benchIds) {
    const bench = benchmarks.find(b => b.id === bid);
    const name = bench ? bench.name : bid;
    const vals = machineIds.map(mid => {
      const v = latest.benchmarks[mid]?.[bid];
      return v != null ? v.toFixed(3) + 's' : '-';
    });
    md += `| ${name} | ${vals.join(' | ')} |\n`;
  }

  download('stress-results.md', md, 'text/markdown');
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Events ──────────────────────────────────────────────
function bindEvents() {
  // Add machine
  $('#btn-add-machine').addEventListener('click', () => {
    $('#modal-add-machine').classList.add('visible');
    $('#m-name').focus();
  });

  $('#btn-cancel-machine').addEventListener('click', () => {
    $('#modal-add-machine').classList.remove('visible');
  });

  $('#btn-save-machine').addEventListener('click', async () => {
    const body = {
      name: $('#m-name').value || 'Machine',
      host: $('#m-host').value,
      port: parseInt($('#m-port').value) || 22,
      username: $('#m-username').value || 'root',
      password: $('#m-password').value || undefined,
      privateKeyPath: $('#m-keypath').value || undefined,
    };

    if (!body.host) { alert('Host is required'); return; }

    await fetch('/api/machines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    $('#modal-add-machine').classList.remove('visible');
    // Clear form
    ['m-name', 'm-host', 'm-username', 'm-password', 'm-keypath'].forEach(id => $(`#${id}`).value = '');
    $('#m-port').value = '22';

    await loadMachines();
  });

  // Select all
  $('#btn-select-all').addEventListener('click', () => {
    const boxes = $$('.bench-checkbox');
    const allChecked = Array.from(boxes).every(cb => cb.checked);
    boxes.forEach(cb => cb.checked = !allChecked);
    $('#btn-select-all').textContent = allChecked ? 'Select All' : 'Deselect All';
    updateRunButton();
  });

  // Run / Abort
  $('#btn-run').addEventListener('click', startRun);
  $('#btn-abort').addEventListener('click', () => {
    if (currentRunId) {
      wsSend({ type: 'abort', runId: currentRunId });
    }
  });

  // Terminal
  $('#btn-clear-terminal').addEventListener('click', () => {
    $$('.terminal-body').forEach(el => el.textContent = '');
  });

  // Results
  $('#btn-toggle-results').addEventListener('click', () => {
    $('#results-area').classList.toggle('visible');
  });

  $('#btn-export-json').addEventListener('click', exportJSON);
  $('#btn-export-md').addEventListener('click', exportMarkdown);

  $('#btn-clear-results').addEventListener('click', async () => {
    await fetch('/api/results', { method: 'DELETE' });
    $('#results-tbody').innerHTML = '';
  });

  // Modal close on backdrop click
  $('#modal-add-machine').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      $('#modal-add-machine').classList.remove('visible');
    }
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal-overlay.visible').forEach(m => m.classList.remove('visible'));
    }
  });
}

// ── Util ────────────────────────────────────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
