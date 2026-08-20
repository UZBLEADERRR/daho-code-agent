// Doimiy holat: bitta JSON fayl. Kalitlar faqat serverda saqlanadi, klientga maskalangan holda beriladi.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const FILE = join(DATA_DIR, 'state.json');

const EMPTY = {
  version: 2,
  keys: {},                 // { openai: "sk-..." }
  models: { cache: {}, fetchedAt: {} },
  approved: [],             // ["openai:gpt-4o", ...]
  routing: {},              // { code: "anthropic:claude-sonnet-4", research: "..." }
  tools: [],
  missions: [],
  settings: {
    autoImprove: true,
    autoApproveNewTools: true,
    maxSelfRepair: 3,
    telegram: { botToken: '', chatId: '', enabled: false },
    github: { token: '', repo: '', branch: 'main' },
    notifyOnFinish: true,
  },
};

let state = null;
let writeTimer = null;

function seedFromEnv(s) {
  const map = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  for (const [provider, env] of Object.entries(map)) {
    const v = (process.env[env] || '').trim();
    if (v && !s.keys[provider]) s.keys[provider] = v;
  }
  const bt = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const cid = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (bt && !s.settings.telegram.botToken) s.settings.telegram.botToken = bt;
  if (cid && !s.settings.telegram.chatId) s.settings.telegram.chatId = cid;
  if (s.settings.telegram.botToken && s.settings.telegram.chatId) s.settings.telegram.enabled = true;

  const ghToken = (process.env.GITHUB_TOKEN || '').trim();
  if (ghToken && !s.settings.github.token) s.settings.github.token = ghToken;
  const owner = (process.env.GITHUB_OWNER || '').trim();
  const repo = (process.env.GITHUB_REPO || '').trim();
  if (owner && repo && !s.settings.github.repo) s.settings.github.repo = `${owner}/${repo}`;
  const branch = (process.env.GITHUB_BRANCH || '').trim();
  if (branch) s.settings.github.branch = branch;
  return s;
}

export function load() {
  if (state) return state;
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(FILE)) {
    try {
      state = { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(FILE, 'utf8')) };
      state.settings = { ...EMPTY.settings, ...state.settings };
      state.settings.telegram = { ...EMPTY.settings.telegram, ...state.settings.telegram };
      state.settings.github = { ...EMPTY.settings.github, ...state.settings.github };
    } catch {
      state = structuredClone(EMPTY);
    }
  } else {
    state = structuredClone(EMPTY);
  }
  state = seedFromEnv(state);
  flush();
  return state;
}

export function db() {
  return state || load();
}

export function flush() {
  if (!state) return;
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, FILE);
}

/** Tez-tez chaqiriladigan yozuvlar uchun kechiktirilgan saqlash. */
export function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try { flush(); } catch { /* disk xatosi ishni to'xtatmasin */ }
  }, 120);
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return '••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

export const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
