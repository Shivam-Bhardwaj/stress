const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');

class SSHRunner {
  constructor(machineConfig) {
    this.config = machineConfig;
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
    } else if (this.config.privateKeyPath) {
      opts.privateKey = fs.readFileSync(this.config.privateKeyPath, 'utf8');
    } else if (this.config.password) {
      opts.password = this.config.password;
    }
    return opts;
  }

  /** Test SSH connection and return machine info */
  testConnection() {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const startTime = Date.now();
      conn
        .on('ready', () => {
          const connectTime = Date.now() - startTime;
          // Gather machine info
          const infoCmd = `echo "CPU: $(nproc) cores, $(lscpu 2>/dev/null | grep 'Model name' | sed 's/.*: *//' || echo 'unknown')" && echo "RAM: $(free -h 2>/dev/null | awk '/Mem:/{print $2}' || echo 'unknown')" && echo "OS: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2 || uname -s)" && echo "Kernel: $(uname -r)" && echo "ConnectTime: ${connectTime}ms"`;
          conn.exec(infoCmd, (err, stream) => {
            if (err) { conn.end(); return reject(err); }
            let output = '';
            stream.on('data', (d) => { output += d.toString(); });
            stream.stderr.on('data', (d) => { output += d.toString(); });
            stream.on('close', () => {
              conn.end();
              resolve({ success: true, info: output.trim(), connectTimeMs: connectTime });
            });
          });
        })
        .on('error', (err) => reject(err))
        .connect(this._connOpts());
    });
  }

  /** Deploy benchmarks folder to remote machine via SCP */
  deployBenchmarks(onOutput) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn
        .on('ready', () => {
          onOutput && onOutput('[deploy] Connected, uploading benchmarks...\n');
          conn.sftp((err, sftp) => {
            if (err) { conn.end(); return reject(err); }
            // Use tar to transfer the benchmarks directory
            const benchmarksDir = path.resolve(__dirname, '..', 'benchmarks');
            const tarCmd = `tar cf - -C "${path.dirname(benchmarksDir)}" "${path.basename(benchmarksDir)}"`;
            const { execSync } = require('child_process');
            let tarData;
            try {
              tarData = execSync(tarCmd, { maxBuffer: 100 * 1024 * 1024 });
            } catch (e) {
              conn.end();
              return reject(new Error('Failed to create tar: ' + e.message));
            }

            // Extract on remote
            conn.exec('mkdir -p ~/stress-benchmarks && tar xf - -C ~/ --transform "s/^benchmarks/stress-benchmarks/"', (err2, stream) => {
              if (err2) { conn.end(); return reject(err2); }
              stream.on('close', (code) => {
                if (code !== 0) {
                  // Try without --transform (macOS tar doesn't support it)
                  conn.exec('rm -rf ~/stress-benchmarks && mkdir -p ~/stress-benchmarks && tar xf - -C ~/ && mv ~/benchmarks ~/stress-benchmarks 2>/dev/null; true', (err3, stream2) => {
                    if (err3) { conn.end(); return reject(err3); }
                    stream2.on('close', () => {
                      onOutput && onOutput('[deploy] Benchmarks uploaded.\n');
                      conn.end();
                      resolve();
                    });
                    stream2.stdin.write(tarData);
                    stream2.stdin.end();
                  });
                } else {
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
        .on('error', (err) => reject(err))
        .connect(this._connOpts());
    });
  }

  /** Run setup.sh on remote machine */
  runSetup(onOutput) {
    return this.execCommand('cd ~/stress-benchmarks && bash setup.sh 2>&1', onOutput);
  }

  /** Execute a single command over SSH, streaming output */
  execCommand(command, onOutput, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let output = '';
      let timer = null;

      conn
        .on('ready', () => {
          timer = setTimeout(() => {
            onOutput && onOutput('\n[timeout] Command exceeded time limit, killing...\n');
            conn.end();
            reject(new Error('Command timed out'));
          }, timeoutMs);

          conn.exec(command, { pty: false }, (err, stream) => {
            if (err) {
              clearTimeout(timer);
              conn.end();
              return reject(err);
            }
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
              conn.end();
              resolve({ output, exitCode: code });
            });
          });
        })
        .on('error', (err) => {
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
      conn
        .on('ready', () => {
          conn.exec('echo ok', (err, stream) => {
            if (err) { conn.end(); return reject(err); }
            stream.on('close', () => {
              const elapsed = (Date.now() - start) / 1000;
              conn.end();
              resolve(elapsed);
            });
            stream.resume();
          });
        })
        .on('error', reject)
        .connect(this._connOpts());
    });
  }
}

module.exports = SSHRunner;
