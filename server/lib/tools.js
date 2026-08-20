// Tool registri: builtin toollar + miya o'zi yozgan (generated) toollar, versiyalar bilan.
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { db, save, uid, DATA_DIR } from './store.js';
import { runToolFile } from './sandbox.js';
import { emit } from './bus.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, '..', 'tools');
export const GEN_DIR = join(DATA_DIR, 'tools');
export const WORKSPACE = resolve(process.env.ALLOWED_WORKSPACE || join(DATA_DIR, 'workspace'));

const BUILTINS = [
  { name: 'http_request', description: 'HTTP so\'rov yuboradi (GET/POST/...) va javobni qaytaradi', input: '{url, method?, headers?, body?}', tags: ['net'] },
  { name: 'fs_read', description: 'Workspace ichidagi fayl yoki papkani o\'qiydi', input: '{path}', tags: ['fs'] },
  { name: 'fs_write', description: 'Workspace ichiga fayl yozadi', input: '{path, content, append?}', tags: ['fs'] },
  { name: 'shell_run', description: 'Workspace ichida terminal buyrug\'ini bajaradi', input: '{command, timeout?}', tags: ['ops'] },
  { name: 'telegram_notify', description: 'Egasiga Telegram orqali xabar yuboradi', input: '{text}', tags: ['notify'] },

  // GitHub qo'llari — repo o'qish/yozishdan tortib nashr qilishgacha.
  { name: 'github_read', description: 'GitHub repodagi fayl yoki papkani o\'qiydi', input: '{repo:"owner/repo", path?, branch?}', tags: ['github'] },
  { name: 'github_write', description: 'Fayllarni bitta commit bilan repoga yozadi yoki o\'chiradi', input: '{repo, branch?, message?, files:[{path,content}]}', tags: ['github'] },
  { name: 'github_repo', description: 'Repolarni ko\'radi, yangi repo ochadi, sozlamalarini o\'zgartiradi', input: '{action:"list|get|create|settings", repo?, name?, private?, topics?}', tags: ['github'] },
  { name: 'github_branch', description: 'Tarmoqlarni ko\'radi yoki yangi tarmoq ochadi', input: '{repo, action:"list|create", name?, from?}', tags: ['github'] },
  { name: 'github_pr', description: 'Pull request ochadi, ro\'yxatlaydi yoki merge qiladi', input: '{repo, action:"list|get|create|merge", head?, base?, title?, number?}', tags: ['github'] },
  { name: 'github_issue', description: 'Issue ochadi, izoh yozadi, yopadi', input: '{repo, action:"list|create|comment|close", number?, title?, body?}', tags: ['github'] },
  { name: 'github_release', description: 'Reliz yaratadi yoki ro\'yxatlaydi (APK fayllari shu yerda)', input: '{repo, action:"list|latest|create", tag?, name?}', tags: ['github'] },
  { name: 'github_search', description: 'GitHub bo\'ylab yoki bitta repo ichida kod qidiradi', input: '{q, repo?}', tags: ['github'] },
  { name: 'github_workflow', description: 'GitHub Actions: ish oqimini ishga tushiradi, holatini va yiqilgan job logini o\'qiydi', input: '{repo, action:"list|run|status|logs|artifacts", workflow?, ref?, run_id?}', tags: ['github', 'ci'] },
  { name: 'github_pages', description: 'Loyihani GitHub Pages orqali internetga chiqaradi va jonli havola beradi', input: '{repo, branch?, path?, domain?}', tags: ['github', 'deploy'] },

  { name: 'test_app', description: 'Veb loyihani HAQIQATAN headless brauzerda ishga tushirib sinaydi: JS xatolari, bo\'sh sahifa, chizilgan tugma va matnlar. Veb kodni o\'zgartirgach har safar chaqir', input: '{entry?:"index.html", dir?, wait?}', tags: ['test'] },
];

export function ensureSetup() {
  mkdirSync(GEN_DIR, { recursive: true });
  mkdirSync(WORKSPACE, { recursive: true });
  const s = db();
  for (const b of BUILTINS) {
    if (s.tools.some((t) => t.name === b.name)) continue;
    s.tools.push({
      id: uid('tool'),
      name: b.name,
      kind: 'builtin',
      version: 1,
      description: b.description,
      input: b.input,
      tags: b.tags,
      status: 'active',
      file: join(BUILTIN_DIR, `${b.name}.mjs`),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runs: 0,
      failures: 0,
      history: [{ version: 1, at: Date.now(), reason: 'builtin' }],
    });
  }
  save();
}

export const list = () =>
  db().tools.map((t) => ({ ...t, file: undefined, code: undefined, hasCode: t.kind === 'generated' }));

export const get = (name) => db().tools.find((t) => t.name === name || t.id === name);

export const catalog = () =>
  db()
    .tools.filter((t) => t.status === 'active')
    .map((t) => `- ${t.name}(${t.input || '{...}'}) — ${t.description}`)
    .join('\n');

function validate(code) {
  if (!code || code.length < 20) return 'Kod juda qisqa';
  if (!/export\s+default/.test(code)) return "Kod 'export default async function run(input, ctx)' ni eksport qilishi shart";
  const tmp = join(GEN_DIR, `.check_${Date.now()}.mjs`);
  mkdirSync(GEN_DIR, { recursive: true });
  writeFileSync(tmp, code);
  const res = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  rmSync(tmp, { force: true });
  if (res.status !== 0) return 'Sintaksis xatosi: ' + (res.stderr || '').split('\n').slice(0, 3).join(' ');
  return null;
}

/** Yangi tool yaratadi (miya o'zini kengaytirganda chaqiriladi). */
export function createTool({ name, description, input, code, tags = [], reason = 'yangi capability' }) {
  const clean = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  if (!clean) throw new Error('Tool nomi noto\'g\'ri');
  if (get(clean)) return upgradeTool(clean, { code, description, input, reason });
  const bad = validate(code);
  if (bad) throw new Error(bad);

  const file = join(GEN_DIR, `${clean}.v1.mjs`);
  writeFileSync(file, code);
  const tool = {
    id: uid('tool'),
    name: clean,
    kind: 'generated',
    version: 1,
    description: description || 'Miya yaratgan tool',
    input: input || '{...}',
    tags: tags.length ? tags : ['generated'],
    status: 'active',
    file,
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    runs: 0,
    failures: 0,
    history: [{ version: 1, at: Date.now(), reason }],
  };
  db().tools.push(tool);
  save();
  emit('tool', { action: 'created', tool: { ...tool, file: undefined } });
  return tool;
}

/** Mavjud toolni yangi versiya bilan almashtiradi — self-update. */
export function upgradeTool(name, { code, description, input, reason = 'self-update' }) {
  const tool = get(name);
  if (!tool) throw new Error('Tool topilmadi: ' + name);
  if (tool.kind === 'builtin') {
    // Builtin ustiga yozmaymiz — uning ustidan generated variant yaratamiz.
    tool.status = 'replaced';
    save();
    return createTool({ name: `${tool.name}_v2`, description, input, code, reason });
  }
  const bad = validate(code);
  if (bad) throw new Error(bad);
  tool.version += 1;
  tool.file = join(GEN_DIR, `${tool.name}.v${tool.version}.mjs`);
  writeFileSync(tool.file, code);
  tool.code = code;
  if (description) tool.description = description;
  if (input) tool.input = input;
  tool.status = 'active';
  tool.updatedAt = Date.now();
  tool.lastError = null;
  tool.history.push({ version: tool.version, at: Date.now(), reason });
  save();
  emit('tool', { action: 'upgraded', tool: { ...tool, file: undefined } });
  return tool;
}

export function removeTool(name) {
  const s = db();
  const i = s.tools.findIndex((t) => t.name === name || t.id === name);
  if (i === -1) throw new Error('Tool topilmadi');
  const [tool] = s.tools.splice(i, 1);
  if (tool.kind === 'generated' && tool.file && existsSync(tool.file)) rmSync(tool.file, { force: true });
  save();
  emit('tool', { action: 'removed', name: tool.name });
  return true;
}

/** Toolni sandbox'da ishga tushiradi va statistikani yangilaydi. */
export async function runTool(name, input = {}, { timeout = 90000 } = {}) {
  const tool = get(name);
  if (!tool) return { ok: false, error: `Tool topilmadi: ${name}` };
  if (!existsSync(tool.file)) return { ok: false, error: `Tool fayli yo'q: ${tool.name}` };

  const s = db();
  const env = {
    TELEGRAM_BOT_TOKEN: s.settings.telegram.botToken || '',
    TELEGRAM_CHAT_ID: s.settings.telegram.chatId || '',
    GITHUB_TOKEN: s.settings.github?.token || '',
    GITHUB_REPO_FULL: s.settings.github?.repo || '',
    GITHUB_BRANCH: s.settings.github?.branch || 'main',
    GITHUB_API_URL: process.env.GITHUB_API_URL || '',
    ALLOW_SHELL: process.env.ALLOW_SHELL ?? 'true',
  };
  const started = Date.now();
  const res = await runToolFile(pathToFileURL(tool.file).href, { input, env, workspace: WORKSPACE }, { timeout });
  tool.runs += 1;
  tool.lastRunAt = Date.now();
  if (!res.ok) {
    tool.failures += 1;
    tool.lastError = String(res.error || '').slice(0, 1500);
  }
  save();
  emit('tool', { action: 'run', name: tool.name, ok: res.ok, ms: Date.now() - started });
  return { ...res, tool: tool.name, ms: Date.now() - started };
}
