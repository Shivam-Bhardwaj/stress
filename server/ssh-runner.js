const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');

function log(tag, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [SSH:${tag}]`, ...args);
}

class SSHRunner {
  constructor(machineConfig) {
    this.config = machineConfig;
    this.label = `${machineConfig.username}@${machineConfig.host}:${machineConfig.port || 22}`;
  }

  _connOpts() {
    const opts = {
      host: this.config.host,
      port: this.config.port || 22,
      username: this.config.username,
      readyTimeout: 20000,
    };
    if (this.config.privateKey) {
      opts.privateKey = this.config.privateKey;
      log(this.label, 'Auth method: inline private key');
    } else if (this.config.privateKeyPath) {
      const keyPath = this.config.privateKeyPath.replace(/^~/, process.env.HOME || '/root');
      log(this.label, `Auth method: private key file (${keyPath})`);
      opts.privateKey = fs.readFileSync(keyPath, 'utf8');
    } else if (this.config.password) {
      opts.password = this.config.password;
      log(this.label, 'Auth method: password');
    } else {
      log(this.label, 'Auth method: none/agent');
    }
    return opts;
  }

  /** Test SSH connection and return machine info */
  testConnection() {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const startTime = Date.now();
      log(this.label, `Testing connection to ${this.config.host}:${this.config.port || 22}...`);
      conn
        .on('ready', () => {
          const connectTime = Date.now() - startTime;
          log(this.label, `SSH handshake complete in ${connectTime}ms, gathering system info...`);
          // Gather machine info
          const infoCmd = `echo "CPU: $(nproc) cores, $(lscpu 2>/dev/null | grep 'Model name' | sed 's/.*: *//' || echo 'unknown')" && echo "RAM: $(free -h 2>/dev/null | awk '/Mem:/{print $2}' || echo 'unknown')" && echo "OS: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2 || uname -s)" && echo "Kernel: $(uname -r)" && echo "ConnectTime: ${connectTime}ms"`;
          conn.exec(infoCmd, (err, stream) => {
            if (err) { conn.end(); return reject(err); }
            let output = '';
            stream.on('data', (d) => { output += d.toString(); });
            stream.stderr.on('data', (d) => { output += d.toString(); });
            stream.on('close', () => {
              conn.end();
              log(this.label, `System info received:\n${output.trim().split('\n').map(l => '    ' + l).join('\n')}`);
              resolve({ success: true, info: output.trim(), connectTimeMs: connectTime });
            });
          });
        })
        .on('error', (err) => {
          log(this.label, `Connection FAILED: ${err.message}`);
          reject(err);
        })
        .connect(this._connOpts());
    });
  }

  /** Deploy benchmarks folder to remote machine via SCP */
  deployBenchmarks(onOutput) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      log(this.label, 'Opening SSH connection for benchmark deployment...');
      conn
        .on('ready', () => {
          log(this.label, 'SSH connected, starting SFTP session for deploy...');
          onOutput && onOutput('[deploy] Connected, uploading benchmarks...\n');
          conn.sftp((err, sftp) => {
            if (err) {
              log(this.label, `SFTP session failed: ${err.message}`);
              conn.end();
              return reject(err);
            }
            // Use tar to transfer the benchmarks directory
            const benchmarksDir = path.resolve(__dirname, '..', 'benchmarks');
            const tarCmd = `tar cf - -C "${path.dirname(benchmarksDir)}" "${path.basename(benchmarksDir)}"`;
            log(this.label, `Creating local tar archive from ${benchmarksDir}...`);
            const { execSync } = require('child_process');
            let tarData;
            try {
              tarData = execSync(tarCmd, { maxBuffer: 100 * 1024 * 1024 });
              log(this.label, `Tar archive created: ${(tarData.length / 1024).toFixed(1)} KB`);
            } catch (e) {
              log(this.label, `Failed to create tar: ${e.message}`);
              conn.end();
              return reject(new Error('Failed to create tar: ' + e.message));
            }

            // Extract on remote
            log(this.label, 'Streaming tar to remote and extracting to ~/stress-benchmarks...');
            onOutput && onOutput(`[deploy] Uploading ${(tarData.length / 1024).toFixed(1)} KB archive...\n`);
            conn.exec('mkdir -p ~/stress-benchmarks && tar xf - -C ~/ --transform "s/^benchmarks/stress-benchmarks/"', (err2, stream) => {
              if (err2) { conn.end(); return reject(err2); }
              stream.on('close', (code) => {
                if (code !== 0) {
                  log(this.label, 'tar --transform failed (possibly macOS), retrying with mv fallback...');
                  onOutput && onOutput('[deploy] Retrying extract with fallback method...\n');
                  // Try without --transform (macOS tar doesn't support it)
                  conn.exec('rm -rf ~/stress-benchmarks && mkdir -p ~/stress-benchmarks && tar xf - -C ~/ && mv ~/benchmarks ~/stress-benchmarks 2>/dev/null; true', (err3, stream2) => {
                    if (err3) { conn.end(); return reject(err3); }
                    stream2.on('close', () => {
                      log(this.label, 'Benchmarks deployed successfully (fallback method)');
                      onOutput && onOutput('[deploy] Benchmarks uploaded.\n');
                      conn.end();
                      resolve();
                    });
                    stream2.stdin.write(tarData);
                    stream2.stdin.end();
                  });
                } else {
                  log(this.label, 'Benchmarks deployed successfully');
                  onOutput && onOutput('[deploy] Benchmarks uploaded.\n');
                  conn.end();
                  resolve();
                }
              });
              stream.stdin.write(tarData);
              stream.stdin.end();
            });
          });
        })
        .on('error', (err) => {
          log(this.label, `Deploy connection FAILED: ${err.message}`);
          reject(err);
        })
        .connect(this._connOpts());
    });
  }

  /** Run setup.sh on remote machine */
  runSetup(onOutput) {
    return this.execCommand('cd ~/stress-benchmarks && bash setup.sh 2>&1', onOutput);
  }

  /** Execute a single command over SSH, streaming output. Returns { output, exitCode }.
   *  Pass an AbortSignal via opts.signal to allow cancellation. */
  execCommand(command, onOutput, timeoutMs = 600000, opts = {}) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      let timer = null;
      const shortCmd = command.length > 120 ? command.slice(0, 117) + '...' : command;

      log(this.label, `Connecting to execute: ${shortCmd}`);
      const connStart = Date.now();

      // Support abort signal
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          log(this.label, 'Received abort signal, killing SSH connection...');
          onOutput && onOutput('\n[abort] Received abort signal, terminating...\n');
          if (timer) clearTimeout(timer);
          conn.end();
          reject(new Error('Aborted'));
        }, { once: true });
      }

      conn
        .on('ready', () => {
          const connTime = Date.now() - connStart;
          log(this.label, `SSH ready in ${connTime}ms, executing command...`);

          timer = setTimeout(() => {
            log(this.label, `Command TIMED OUT after ${timeoutMs / 1000}s: ${shortCmd}`);
            onOutput && onOutput('\n[timeout] Command exceeded time limit, killing...\n');
            conn.end();
            reject(new Error('Command timed out'));
          }, timeoutMs);

          conn.exec(command, { pty: false }, (err, stream) => {
            if (err) {
              log(this.label, `Exec error: ${err.message}`);
              clearTimeout(timer);
              conn.end();
              return reject(err);
            }
            log(this.label, 'Command started, streaming output...');
            stream.on('data', (data) => {
              const text = data.toString();
              output += text;
              onOutput && onOutput(text);
            });
            stream.stderr.on('data', (data) => {
              const text = data.toString();
              output += text;
              onOutput && onOutput(text);
            });
            stream.on('close', (code) => {
              clearTimeout(timer);
              const elapsed = ((Date.now() - connStart) / 1000).toFixed(2);
              log(this.label, `Command finished (exit=${code}) in ${elapsed}s, output=${output.length} bytes`);
              conn.end();
              resolve({ output, exitCode: code });
            });
          });
        })
        .on('error', (err) => {
          log(this.label, `SSH connection error: ${err.message}`);
          if (timer) clearTimeout(timer);
          reject(err);
        })
        .connect(this._connOpts());
    });
  }

  /** Measure SSH connection overhead */
  measureSSHOverhead() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const conn = new Client();
      log(this.label, 'Measuring SSH overhead (connect + echo ok)...');
      conn
        .on('ready', () => {
          const readyTime = Date.now() - start;
          log(this.label, `SSH handshake: ${readyTime}ms, now running trivial command...`);
          conn.exec('echo ok', (err, stream) => {
            if (err) { conn.end(); return reject(err); }
            stream.on('close', () => {
              const elapsed = (Date.now() - start) / 1000;
              log(this.label, `SSH overhead total: ${elapsed.toFixed(3)}s`);
              conn.end();
              resolve(elapsed);
            });
            stream.resume();
          });
        })
        .on('error', (err) => {
          log(this.label, `SSH overhead measurement failed: ${err.message}`);
          reject(err);
        })
        .connect(this._connOpts());
    });
  }
}

module.exports = SSHRunner;
