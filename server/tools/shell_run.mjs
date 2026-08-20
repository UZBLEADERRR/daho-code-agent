/** Workspace ichida buyruq bajaradi. input: {command, timeout?} — ALLOW_SHELL=false bo'lsa o'chadi. */
import { execSync } from 'node:child_process';

export default async function run(input, ctx) {
  if (String(ctx.env.ALLOW_SHELL ?? process.env.ALLOW_SHELL ?? 'true') === 'false') {
    throw new Error('shell_run o\'chirilgan (ALLOW_SHELL=false)');
  }
  if (!input.command) throw new Error('command majburiy');
  try {
    const stdout = execSync(input.command, {
      cwd: ctx.workspace || process.cwd(),
      timeout: input.timeout || 60000,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout.slice(-20000) };
  } catch (e) {
    return { ok: false, code: e.status ?? null, stdout: String(e.stdout || '').slice(-10000), stderr: String(e.stderr || e.message).slice(-10000) };
  }
}
