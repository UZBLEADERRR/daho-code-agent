// Daho miya — HTTP server. Barcha API kalitlari faqat shu yerda saqlanadi.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { load, db, save, maskKey } from './lib/store.js';
import { providerList, refreshModels, refreshAll, searchModels, allModels } from './lib/providers.js';
import { TASK_TYPES, approvedModels } from './lib/router.js';
import * as tools from './lib/tools.js';
import * as brain from './lib/brain.js';
import * as tg from './lib/telegram.js';
import { subscribe, clientCount } from './lib/bus.js';

const PORT = Number(process.env.PORT || 8080);
const APP_TOKEN = (process.env.APP_TOKEN || '').trim();
const ROOT = resolve(process.cwd());
const WEB_DIRS = [join(ROOT, 'dist'), ROOT];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 4 * 1024 * 1024) throw new Error('So\'rov juda katta');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON noto\'g\'ri'); }
}

function snapshot() {
  const s = db();
  return {
    providers: providerList().map((p) => ({
      ...p,
      hasKey: Boolean(s.keys[p.id]),
      keyPreview: maskKey(s.keys[p.id]),
      modelCount: (s.models.cache[p.id] || []).length,
      fetchedAt: s.models.fetchedAt[p.id] || null,
    })),
    approved: s.approved,
    approvedCount: approvedModels().length,
    modelCount: allModels().length,
    routing: s.routing,
    taskTypes: TASK_TYPES,
    settings: {
      ...s.settings,
      telegram: {
        enabled: s.settings.telegram.enabled,
        chatId: s.settings.telegram.chatId,
        hasToken: Boolean(s.settings.telegram.botToken),
      },
    },
    tools: tools.list(),
    missions: brain.listMissions().slice(0, 20),
    blockers: brain.openBlockers(),
    workspace: tools.WORKSPACE,
    liveClients: clientCount(),
  };
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (rel.includes('..')) return json(res, 400, { error: 'bad path' });
  for (const dir of WEB_DIRS) {
    const file = join(dir, rel);
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
  }
  const fallback = WEB_DIRS.map((d) => join(d, 'index.html')).find((f) => existsSync(f));
  if (fallback) {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(readFileSync(fallback));
    return;
  }
  json(res, 404, { error: 'topilmadi' });
}

const routes = {
  'GET /api/health': async () => ({ ok: true, brain: 'daho', uptime: Math.round(process.uptime()), models: allModels().length, approved: approvedModels().length }),
  'GET /api/state': async () => snapshot(),

  'POST /api/keys': async (body) => {
    const { provider, apiKey } = body;
    if (!provider || !apiKey) throw new Error('provider va apiKey majburiy');
    const s = db();
    s.keys[provider] = String(apiKey).trim();
    save();
    let models = [];
    try {
      models = await refreshModels(provider);
    } catch (e) {
      delete s.keys[provider];
      save();
      throw new Error(`Kalit tekshiruvdan o'tmadi: ${e.message}`);
    }
    if (!s.approved.some((id) => id.startsWith(provider + ':'))) {
      s.approved.push(...models.slice(0, 6).map((m) => m.id));
      save();
    }
    return { ok: true, provider, models: models.length, state: snapshot() };
  },

  'DELETE /api/keys': async (body, url) => {
    const provider = body.provider || url.searchParams.get('provider');
    const s = db();
    delete s.keys[provider];
    delete s.models.cache[provider];
    s.approved = s.approved.filter((id) => !id.startsWith(provider + ':'));
    save();
    return { ok: true, state: snapshot() };
  },

  'GET /api/models': async (_b, url) =>
    ({
      models: searchModels({
        q: url.searchParams.get('q') || '',
        provider: url.searchParams.get('provider') || '',
        onlyApproved: url.searchParams.get('approved') === '1',
      }),
      approved: db().approved,
    }),

  'POST /api/models/refresh': async () => ({ ...(await refreshAll()), state: snapshot() }),

  'POST /api/models/approve': async (body) => {
    const s = db();
    const ids = body.ids || (body.id ? [body.id] : []);
    if (!ids.length) throw new Error('id majburiy');
    if (body.approved === false) s.approved = s.approved.filter((x) => !ids.includes(x));
    else s.approved = [...new Set([...s.approved, ...ids])];
    save();
    return { ok: true, approved: s.approved };
  },

  'POST /api/models/route': async (body) => {
    const s = db();
    if (!TASK_TYPES.includes(body.taskType)) throw new Error('taskType noto\'g\'ri');
    if (body.modelId) s.routing[body.taskType] = body.modelId;
    else delete s.routing[body.taskType];
    save();
    return { ok: true, routing: s.routing };
  },

  'GET /api/tools': async () => ({ tools: tools.list(), workspace: tools.WORKSPACE }),

  'POST /api/tools': async (body) => {
    if (body.code) return { tool: tools.createTool(body) };
    if (body.request) return { tool: await brain.forgeTool(body.request) };
    throw new Error('code yoki request majburiy');
  },

  'POST /api/tools/run': async (body) => tools.runTool(body.name, body.input || {}),
  'DELETE /api/tools': async (body, url) => ({ ok: tools.removeTool(body.name || url.searchParams.get('name')) }),

  'GET /api/missions': async () => ({ missions: brain.listMissions() }),

  'POST /api/missions': async (body) => {
    const goal = String(body.goal || body.message || '').trim();
    if (!goal) throw new Error('goal majburiy');
    return { mission: brain.startMission(goal, { source: body.source || 'app' }) };
  },

  'GET /api/mission': async (_b, url) => {
    const m = brain.getMission(url.searchParams.get('id'));
    if (!m) throw new Error('Topshiriq topilmadi');
    return { mission: m };
  },

  'POST /api/mission/retry': async (body) => {
    const m = brain.getMission(body.id);
    if (!m) throw new Error('Topshiriq topilmadi');
    if (body.replan) m.steps = [];
    brain.runMission(m).catch(() => {});
    return { mission: m };
  },

  'GET /api/blockers': async () => ({ blockers: brain.openBlockers() }),
  'POST /api/blockers/answer': async (body) =>
    brain.resolveBlocker({ blockerId: body.id, provider: body.provider, value: body.value }),

  'POST /api/telegram': async (body) => ({ telegram: tg.setConfig(body) }),
  'POST /api/telegram/test': async () => {
    await tg.test();
    return { ok: true };
  },

  'POST /api/settings': async (body) => {
    const s = db();
    s.settings = { ...s.settings, ...body, telegram: s.settings.telegram };
    save();
    return { settings: snapshot().settings };
  },

  // Eski APK bilan moslik.
  'POST /api/chat': async (body) => {
    const goal = String(body.message || body.goal || '').trim();
    if (!goal) throw new Error('message majburiy');
    const mission = brain.startMission(goal, { source: 'chat' });
    return {
      reply: `Topshiriq qabul qilindi. Miya ishga tushdi — tugagach xabar beraman.`,
      taskId: mission.id,
      status: 'running',
      logs: [],
    };
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Daho-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const isApi = url.pathname.startsWith('/api/');
  if (isApi && APP_TOKEN && url.pathname !== '/api/health') {
    const token = req.headers['x-daho-token'] || url.searchParams.get('token');
    if (token !== APP_TOKEN) return json(res, 401, { error: 'Token noto\'g\'ri' });
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const off = subscribe(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      off();
    });
    return;
  }

  if (!isApi) return serveStatic(req, res, url.pathname);

  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: `Yo'l topilmadi: ${key}` });

  try {
    const body = req.method === 'GET' ? {} : await readBody(req);
    const result = await handler(body, url);
    json(res, 200, result ?? { ok: true });
  } catch (e) {
    json(res, e.status || 400, { error: String(e.message || e) });
  }
});

load();
tools.ensureSetup();
brain.wireTelegram();

server.listen(PORT, () => {
  console.log(`🧠 Daho miya ${PORT}-portda. Toollar: ${tools.list().length}, modellar: ${allModels().length}`);
  if (APP_TOKEN) console.log('🔒 APP_TOKEN yoqilgan — ilova sozlamalarida ham shu tokenni kiriting.');
});
