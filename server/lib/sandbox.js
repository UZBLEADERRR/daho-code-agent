// Tool kodini alohida protsessda, vaqt cheklovi bilan bajaradi.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, '..', 'runtime', 'runner.mjs');

export function runToolFile(toolPath, payload, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER, toolPath], {
      cwd: payload.workspace || process.cwd(),
      env: { ...process.env, ...(payload.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: `Timeout: tool ${timeout}ms ichida tugamadi`, stdout: out, stderr: err });
    }, timeout);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(e.message || e), stdout: out, stderr: err });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const marker = out.lastIndexOf('__DAHO_RESULT__');
      if (marker === -1) {
        resolve({ ok: false, error: err.trim() || 'Tool natija qaytarmadi', stdout: out, stderr: err });
        return;
      }
      const logs = out.slice(0, marker).trim();
      try {
        const parsed = JSON.parse(out.slice(marker + '__DAHO_RESULT__'.length));
        resolve({ ...parsed, logs, stderr: err });
      } catch (e) {
        resolve({ ok: false, error: 'Natijani o\'qib bo\'lmadi: ' + e.message, stdout: out, stderr: err });
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
