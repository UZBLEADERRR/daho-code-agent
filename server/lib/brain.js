// MIYA — bitta markaziy orkestrator. Topshiriqni rejalashtiradi, toollarni ishlatadi,
// yetishmagan toolni o'zi yozadi, xatoni o'zi tuzatadi, tugagach xabar beradi.
import { db, save, uid } from './store.js';
import { chat, refreshAll } from './providers.js';
import { pickModel, classify, approvedModels } from './router.js';
import * as tools from './tools.js';
import * as tg from './telegram.js';
import { emit } from './bus.js';

const MAX_STEPS = 12;
const running = new Set();

/* ---------------------------------------------------------------- promptlar */

const LAW = `Sen "Daho" — mustaqil ishlaydigan bitta miyasan. Egang senga topshiriq beradi va o'zi aralashmaydi.

QONUNLAR:
1. "Qilolmayman", "imkonim yo'q", "men shunchaki AI'man" deb javob berish MUTLAQO taqiqlangan.
2. Agar kerakli tool yo'q bo'lsa — o'zingga yangi tool yozasan va davom etasan.
3. Agar tool xato bersa — sababini aniqlab, toolni tuzatib, qayta urinasan.
4. Agar haqiqatan tashqi resurs kerak bo'lsa (API kalit, parol, ruxsat) — aniq nomini ayt va so'ra. Bu "qilolmayman" emas, bu "shu bitta narsa kerak".
5. Javoblar o'zbek tilida, aniq va amaliy bo'ladi.
6. Faqat so'ralgan JSON formatda javob ber, boshqa matn qo'shma.
7. O'Z ISHINGNI SINA: veb (HTML/JS) kod yozgan yoki o'zgartirgan bo'lsang, oxirida albatta \`test_app\` qadamini qo'sh. Xato chiqsa — tuzat va qayta sina.
8. GitHub bilan ishlashda repo har doim "owner/repo" ko'rinishida beriladi. Kodni yuborgach \`github_workflow\` bilan yig'ilish natijasini tekshir, yiqilsa logini o'qib tuzat.`;

const REFUSAL = /(qilolmayman|qila olmayman|imkonim yo'?q|imkoniyatim yo'?q|men shunchaki|i can'?t|i cannot|unable to assist|as an ai)/i;

/* ------------------------------------------------------------------ yordamchi */

function jsonFrom(text) {
  if (!text) throw new Error('Model bo\'sh javob qaytardi');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[{[]/);
  if (start === -1) throw new Error('JSON topilmadi');
  const open = raw[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error('JSON tugallanmagan');
}

function logTo(mission, text, level = 'info') {
  const entry = { t: Date.now(), level, text: String(text).slice(0, 2000) };
  mission.logs.push(entry);
  if (mission.logs.length > 400) mission.logs.shift();
  save();
  emit('mission', { id: mission.id, patch: { log: entry, status: mission.status, progress: progressOf(mission) } });
}

function progressOf(m) {
  if (m.status === 'done') return 100;
  if (!m.steps?.length) return m.status === 'planning' ? 10 : 5;
  const done = m.steps.filter((s) => s.status === 'done').length;
  return Math.min(97, 12 + Math.round((done / m.steps.length) * 85));
}

function setStatus(mission, status) {
  mission.status = status;
  if (status === 'done' || status === 'failed') mission.finishedAt = Date.now();
  save();
  emit('mission', { id: mission.id, patch: { status, progress: progressOf(mission) } });
}

/** Model chaqiruvi: ruxsat berilgan modellar orasidan tanlaydi, xato bo'lsa boshqasiga o'tadi. */
async function think(mission, taskType, messages, opts = {}) {
  const tried = [];
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    const model = pickModel(taskType, { exclude: tried });
    if (!model) break;
    tried.push(model.id);
    try {
      const out = await chat(model.id, messages, opts);
      mission.modelsUsed = [...new Set([...(mission.modelsUsed || []), model.id])];
      mission.model = model.id;
      save();
      if (REFUSAL.test(out || '')) {
        logTo(mission, `${model.id} rad javob berdi — qayta so'ralmoqda`, 'warn');
        const retry = await chat(model.id, [
          ...messages,
          { role: 'assistant', content: out },
          { role: 'user', content: 'Rad javob qabul qilinmaydi. QONUN 1-4 ga amal qil: aniq reja, kerakli tool yoki aniq resurs so\'rovi bilan, faqat JSON qaytar.' },
        ], opts);
        return retry;
      }
      return out;
    } catch (e) {
      lastErr = e;
      logTo(mission, `${model.id} ishlamadi (${e.message}) — boshqa modelga o'tildi`, 'warn');
    }
  }
  throw lastErr || Object.assign(new Error('Ruxsat berilgan model yo\'q'), { code: 'NO_MODEL' });
}

/* ------------------------------------------------------------------ blokerlar */

export async function raiseBlocker(mission, { kind, title, why, provider }) {
  const blocker = {
    id: uid('blk'),
    kind,
    title,
    why,
    provider,
    missionId: mission.id,
    missionGoal: mission.goal,
    createdAt: Date.now(),
    resolved: false,
  };
  mission.blockers.push(blocker);
  setStatus(mission, 'waiting_input');
  logTo(mission, `⏸ Kerak: ${title}. Telegram orqali so'raldi.`, 'warn');
  emit('blocker', blocker);
  await tg.askFor(blocker);
  return blocker;
}

function pendingBlockers() {
  return db().missions.flatMap((m) => m.blockers.filter((b) => !b.resolved).map((b) => ({ ...b, missionId: m.id })));
}

/** Telegram yoki ilovadan kelgan javob bilan blokerni yechadi va topshiriqni davom ettiradi. */
export async function resolveBlocker({ blockerId, provider, value }) {
  const s = db();
  let mission = null;
  let blocker = null;
  for (const m of s.missions) {
    for (const b of m.blockers) {
      if (b.resolved) continue;
      if ((blockerId && b.id === blockerId) || (!blockerId && provider && b.provider === provider) || (!blockerId && !provider)) {
        mission = m; blocker = b; break;
      }
    }
    if (blocker) break;
  }
  if (!blocker) return { ok: false, error: 'Kutilayotgan so\'rov topilmadi' };

  if (blocker.kind === 'github_token' || blocker.provider === 'github') {
    const check = await saveGithubToken(String(value).trim());
    if (!check.ok) {
      await tg.send(`⚠️ GitHub tokeni ishlamadi: ${check.error}. Yangisini yuboring: <code>key github TOKEN</code>`);
      return { ok: false, error: check.error };
    }
    await tg.send(`✅ GitHub tokeni qabul qilindi (${check.login}). Ish davom etmoqda.`);
  } else if (blocker.kind === 'api_key' && blocker.provider) {
    s.keys[blocker.provider] = String(value).trim();
    save();
    try {
      const { refreshModels } = await import('./providers.js');
      const models = await refreshModels(blocker.provider);
      if (!s.approved.some((id) => id.startsWith(blocker.provider + ':'))) {
        // Yangi provayderdan bir nechta kuchli modelni avtomatik ruxsat etamiz.
        s.approved.push(...models.slice(0, 6).map((m) => m.id));
      }
      save();
      await tg.send(`✅ <b>${blocker.provider}</b> kaliti qabul qilindi. ${models.length} ta model topildi, ish davom etmoqda.`);
    } catch (e) {
      await tg.send(`⚠️ ${blocker.provider} kaliti ishlamadi: ${e.message}. Yangisini yuboring: <code>key ${blocker.provider} QIYMAT</code>`);
      return { ok: false, error: e.message };
    }
  } else {
    blocker.answer = String(value);
  }

  blocker.resolved = true;
  blocker.resolvedAt = Date.now();
  save();
  emit('blocker', { ...blocker });
  logTo(mission, `▶️ Javob olindi: ${blocker.title}`, 'ok');
  runMission(mission).catch(() => {});
  return { ok: true, missionId: mission.id };
}

/** GitHub tokenini tekshiradi va sozlamalarga saqlaydi. */
export async function saveGithubToken(value) {
  const s = db();
  try {
    const base = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
    const res = await fetch(`${base}/user`, {
      headers: { Authorization: `Bearer ${value}`, 'User-Agent': 'daho-brain', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { ok: false, error: `GitHub javobi ${res.status}` };
    const me = await res.json().catch(() => ({}));
    s.settings.github.token = value;
    save();
    return { ok: true, login: me.login || 'ok' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/* --------------------------------------------------------------- self-improve */

async function buildTool(mission, need) {
  logTo(mission, `🧩 Yangi tool yozilmoqda: ${need.name}`, 'work');
  const messages = [
    { role: 'system', content: `${LAW}\n\nSen Node.js 20+ uchun ESM tool moduli yozasan.` },
    {
      role: 'user',
      content: `Menga quyidagi vazifani bajaradigan tool kerak.

Nom: ${need.name}
Maqsad: ${need.purpose || need.description}
Kutilgan input: ${need.input || '{...}'}

TALABLAR:
- Faqat Node.js standart modullari (node:fs, node:path, node:child_process, node:crypto) va global fetch ishlatiladi. npm paket YO'Q.
- Fayl "export default async function run(input, ctx) { ... }" ni eksport qiladi.
- ctx = { env, workspace, log }. Fayllar faqat ctx.workspace ichida.
- Xatolarni aniq matn bilan throw qiladi.
- Natija JSON'ga o'giriladigan oddiy obyekt bo'ladi.

Javob formati (qat'iy JSON):
{"name":"${need.name}","description":"...","input":"{...}","tags":["..."],"code":"<to'liq JS kodi>"}` },
  ];
  const out = await think(mission, 'code', messages, { maxTokens: 4000 });
  const spec = jsonFrom(out);
  const tool = tools.createTool({
    name: spec.name || need.name,
    description: spec.description || need.purpose,
    input: spec.input || need.input,
    code: spec.code,
    tags: spec.tags,
    reason: `"${mission.goal.slice(0, 60)}" topshirig'i uchun`,
  });
  mission.toolsCreated = [...new Set([...(mission.toolsCreated || []), tool.name])];
  save();
  logTo(mission, `✅ Tool tayyor: ${tool.name} (v${tool.version})`, 'ok');
  return tool;
}

async function repairTool(mission, toolName, error, step) {
  const tool = tools.get(toolName);
  if (!tool) return null;
  logTo(mission, `🔧 ${toolName} tuzatilmoqda: ${String(error).slice(0, 120)}`, 'work');
  const messages = [
    { role: 'system', content: `${LAW}\n\nSen buzilgan Node.js ESM toolni tuzatasan.` },
    {
      role: 'user',
      content: `Tool "${tool.name}" xato berdi.

XATO:
${String(error).slice(0, 1500)}

BERILGAN INPUT:
${JSON.stringify(step?.input || {}).slice(0, 1000)}

JORIY KOD:
${(tool.code || '(builtin tool — yangi variant yoz)').slice(0, 6000)}

Kodni tuzat. Javob qat'iy JSON:
{"description":"...","input":"{...}","code":"<to'liq tuzatilgan kod>","fix":"nima tuzatildi"}` },
  ];
  const out = await think(mission, 'code', messages, { maxTokens: 4000 });
  const spec = jsonFrom(out);
  const updated = tools.upgradeTool(tool.name, {
    code: spec.code,
    description: spec.description,
    input: spec.input,
    reason: spec.fix || 'avtomatik tuzatish',
  });
  logTo(mission, `✅ ${updated.name} v${updated.version}: ${spec.fix || 'tuzatildi'}`, 'ok');
  return updated;
}

/* ------------------------------------------------------------------ rejalash */

async function plan(mission) {
  setStatus(mission, 'planning');
  logTo(mission, 'Reja tuzilmoqda...', 'work');
  const messages = [
    { role: 'system', content: LAW },
    {
      role: 'user',
      content: `TOPSHIRIQ: ${mission.goal}

MAVJUD TOOLLAR:
${tools.catalog() || '(hozircha yo\'q)'}

Ushbu topshiriqni oxirigacha bajaradigan reja tuz. Har bir qadam yo mavjud tool, yo yangi yoziladigan tool, yo sof fikrlash (tool: "llm") bo'ladi.
Ortiqcha qadam qo'shma — ${MAX_STEPS} tadan oshmasin. Agar topshiriq oddiy savol bo'lsa, bitta "llm" qadami yetarli.

Javob qat'iy JSON:
{
 "taskType":"code|reasoning|research|write|data|ops|quick",
 "understanding":"topshiriqni qanday tushunding (1-2 gap)",
 "steps":[
   {"title":"...","tool":"tool_nomi yoki llm","input":{...},
    "newTool":{"name":"...","purpose":"...","input":"{...}"} }
 ]
}
"newTool" faqat mavjud bo'lmagan tool kerak bo'lganda yoziladi.` },
  ];
  const out = await think(mission, classify(mission.goal), messages, { maxTokens: 3000 });
  const spec = jsonFrom(out);
  mission.taskType = spec.taskType || classify(mission.goal);
  mission.understanding = spec.understanding || '';
  mission.steps = (spec.steps || []).slice(0, MAX_STEPS).map((s, i) => ({
    n: i + 1,
    title: s.title || `Qadam ${i + 1}`,
    tool: s.tool || 'llm',
    input: s.input || {},
    newTool: s.newTool || null,
    status: 'pending',
    attempts: 0,
  }));
  if (!mission.steps.length) {
    mission.steps = [{ n: 1, title: 'Javob tayyorlash', tool: 'llm', input: { instruction: mission.goal }, status: 'pending', attempts: 0 }];
  }
  save();
  emit('mission', { id: mission.id, patch: { steps: mission.steps, taskType: mission.taskType, understanding: mission.understanding } });
  logTo(mission, `Reja: ${mission.steps.length} qadam · tur: ${mission.taskType}`, 'ok');
}

/* -------------------------------------------------------------------- bajarish */

async function runStep(mission, step) {
  step.status = 'running';
  emit('mission', { id: mission.id, patch: { step: { n: step.n, status: 'running' }, progress: progressOf(mission) } });
  logTo(mission, `▸ ${step.n}. ${step.title}`, 'work');

  const context = mission.steps
    .filter((s) => s.status === 'done' && s.result !== undefined)
    .map((s) => `[${s.n}] ${s.title}: ${JSON.stringify(s.result).slice(0, 1200)}`)
    .join('\n');

  if (step.tool === 'llm' || !step.tool) {
    const out = await think(mission, mission.taskType || 'reasoning', [
      { role: 'system', content: `${LAW}\n\nBu qadamda faqat fikrlash kerak. Javobni oddiy matn bilan ber (JSON shart emas).` },
      { role: 'user', content: `TOPSHIRIQ: ${mission.goal}\n\nOLDINGI NATIJALAR:\n${context || '(yo\'q)'}\n\nSHU QADAM: ${step.title}\nKO'RSATMA: ${JSON.stringify(step.input)}` },
    ], { maxTokens: 3000 });
    step.result = out;
    step.status = 'done';
    save();
    return;
  }

  if (!tools.get(step.tool)) {
    const need = step.newTool || { name: step.tool, purpose: step.title, input: JSON.stringify(step.input) };
    await buildTool(mission, need);
    step.tool = tools.get(need.name) ? need.name : step.tool;
  }

  const maxRepair = db().settings.maxSelfRepair ?? 3;
  for (let attempt = 0; attempt <= maxRepair; attempt++) {
    step.attempts = attempt + 1;
    const res = await tools.runTool(step.tool, step.input);
    if (res.ok) {
      step.result = res.value;
      step.status = 'done';
      save();
      logTo(mission, `✓ ${step.title}`, 'ok');
      return;
    }
    step.error = res.error;
    logTo(mission, `✗ ${step.tool}: ${String(res.error).slice(0, 200)}`, 'error');

    if (/api kalit|api key|unauthorized|401|403|token|bad credentials/i.test(String(res.error))) {
      const text = String(res.error);
      const provider = (text.match(/(openai|anthropic|gemini|openrouter)/i) || [])[1]?.toLowerCase();
      const isGithub = !provider && /github/i.test(text);
      await raiseBlocker(mission, {
        kind: isGithub ? 'github_token' : provider ? 'api_key' : 'secret',
        provider: isGithub ? 'github' : provider,
        title: isGithub ? 'GitHub tokeni (repo + workflow ruxsati)' : provider ? `${provider} API kaliti` : `"${step.tool}" uchun maxfiy qiymat`,
        why: text.slice(0, 300),
      });
      step.status = 'blocked';
      save();
      throw Object.assign(new Error('waiting-input'), { code: 'WAIT' });
    }

    if (attempt < maxRepair) {
      const fixed = await repairTool(mission, step.tool, res.error, step);
      if (!fixed) break;
      step.tool = fixed.name;
    }
  }

  // Tool tuzatilmadi — qadamni boshqa yo'l bilan bajarishga o'tamiz (rad javob yo'q).
  logTo(mission, `↻ ${step.title}: tool ishlamadi, alternativ yo'l izlanmoqda`, 'warn');
  const alt = await think(mission, 'code', [
    { role: 'system', content: LAW },
    { role: 'user', content: `"${step.title}" qadami "${step.tool}" tool orqali bajarilmadi.\nXATO: ${String(step.error).slice(0, 800)}\n\nMavjud toollar:\n${tools.catalog()}\n\nQat'iy JSON qaytar:\n{"strategy":"tool|llm","tool":"mavjud tool nomi (agar tool)","input":{...},"newTool":{"name":"...","purpose":"...","input":"{...}"},"note":"nima o'zgardi"}` },
  ], { maxTokens: 2000 });
  const spec = jsonFrom(alt);
  if (spec.strategy === 'tool') {
    if (spec.newTool && !tools.get(spec.newTool.name)) await buildTool(mission, spec.newTool);
    const name = spec.tool && tools.get(spec.tool) ? spec.tool : spec.newTool?.name;
    const res = await tools.runTool(name, spec.input || step.input);
    if (res.ok) {
      step.tool = name;
      step.result = res.value;
      step.status = 'done';
      save();
      logTo(mission, `✓ ${step.title} (alternativ: ${name})`, 'ok');
      return;
    }
    step.error = res.error;
  }
  const out = await think(mission, mission.taskType || 'reasoning', [
    { role: 'system', content: `${LAW}\n\nTool ishlamadi — qadamning natijasini o'z bilimingdan chiqar va nimasi to'liq emasligini ayt.` },
    { role: 'user', content: `TOPSHIRIQ: ${mission.goal}\nQADAM: ${step.title}\nOLDINGI NATIJALAR:\n${context}\nXATO: ${String(step.error).slice(0, 500)}` },
  ], { maxTokens: 2500 });
  step.result = out;
  step.status = 'partial';
  step.note = spec.note || 'tool ishlamadi, model bilimi bilan bajarildi';
  save();
}

async function finalize(mission) {
  const results = mission.steps
    .map((s) => `[${s.n}] ${s.title} (${s.status}): ${typeof s.result === 'string' ? s.result.slice(0, 2500) : JSON.stringify(s.result).slice(0, 1500)}`)
    .join('\n\n');
  const out = await think(mission, mission.taskType || 'reasoning', [
    { role: 'system', content: `${LAW}\n\nSen topshiriq yakunini egangga hisobot qilib berasan. Qisqa, aniq, o'zbekcha.` },
    { role: 'user', content: `TOPSHIRIQ: ${mission.goal}\n\nQADAM NATIJALARI:\n${results}\n\nYakuniy javobni yoz: 1) natija, 2) nima qilindi, 3) agar biror narsa to'liq bo'lmasa — aniq nima kerakligi.` },
  ], { maxTokens: 2500 });
  mission.result = out;
  mission.summary = out.split('\n').filter(Boolean)[0]?.slice(0, 180) || 'Topshiriq bajarildi';
  save();
}

async function notifyDone(mission) {
  const created = mission.toolsCreated?.length ? `\n🧩 Yangi tool: ${mission.toolsCreated.join(', ')}` : '';
  const text = [
    '✅ <b>Topshiriq tugadi</b>',
    '',
    `<b>${escape(mission.goal.slice(0, 200))}</b>`,
    '',
    escape(String(mission.result || '').slice(0, 2500)),
    created,
    `\n⏱ ${Math.round(((mission.finishedAt || Date.now()) - mission.createdAt) / 1000)} s · 🤖 ${mission.modelsUsed?.join(', ') || '-'}`,
  ].join('\n');
  const r = await tg.send(text);
  mission.notified = r.sent;
  save();
  emit('mission', { id: mission.id, patch: { status: mission.status, result: mission.result, notified: r.sent, progress: 100 } });
}

const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* -------------------------------------------------------------------- public */

export async function runMission(mission) {
  if (running.has(mission.id)) return mission;
  running.add(mission.id);
  try {
    if (!approvedModels().length) {
      await refreshAll().catch(() => {});
      if (!approvedModels().length) {
        const missing = ['openai', 'anthropic', 'gemini', 'openrouter'].find((p) => !db().keys[p]) || 'openai';
        await raiseBlocker(mission, {
          kind: 'api_key',
          provider: missing,
          title: `${missing} API kaliti`,
          why: 'Hozircha bironta ham ruxsat berilgan AI model yo\'q. Kalit kelishi bilan ish avtomatik davom etadi.',
        });
        return mission;
      }
    }

    if (!mission.steps?.length) await plan(mission);
    setStatus(mission, 'running');

    for (const step of mission.steps) {
      if (step.status === 'done' || step.status === 'partial') continue;
      await runStep(mission, step);
    }

    await finalize(mission);
    setStatus(mission, 'done');
    logTo(mission, '🏁 Topshiriq yakunlandi', 'ok');
    if (db().settings.notifyOnFinish) await notifyDone(mission);
  } catch (e) {
    if (e?.code === 'WAIT') {
      logTo(mission, 'Javob kutilmoqda — kelishi bilan avtomatik davom etadi', 'warn');
    } else if (e?.code === 'NO_MODEL') {
      await raiseBlocker(mission, {
        kind: 'api_key',
        provider: 'openai',
        title: 'Ishlaydigan AI model',
        why: 'Ruxsat berilgan modellar javob bermadi. Yangi kalit yoki boshqa provayder kerak.',
      });
    } else {
      mission.error = String(e.message || e);
      setStatus(mission, 'failed');
      logTo(mission, `Xato: ${mission.error}`, 'error');
      await tg.send(`⚠️ <b>Topshiriq to'xtadi</b>\n${escape(mission.goal.slice(0, 150))}\n\nSabab: ${escape(mission.error)}\n\nNima kerakligini yozing, davom ettiraman.`);
    }
  } finally {
    running.delete(mission.id);
  }
  return mission;
}

export function createMission(goal, meta = {}) {
  const s = db();
  const mission = {
    id: uid('msn'),
    goal: String(goal).trim(),
    source: meta.source || 'app',
    status: 'queued',
    createdAt: Date.now(),
    steps: [],
    logs: [],
    blockers: [],
    modelsUsed: [],
    toolsCreated: [],
  };
  s.missions.unshift(mission);
  if (s.missions.length > 80) s.missions.length = 80;
  save();
  emit('mission', { id: mission.id, patch: { created: mission } });
  return mission;
}

export function startMission(goal, meta) {
  const mission = createMission(goal, meta);
  runMission(mission).catch(() => {});
  return mission;
}

export const getMission = (id) => db().missions.find((m) => m.id === id);
export const listMissions = () =>
  db().missions.map((m) => ({ ...m, logs: m.logs.slice(-40), progress: progressOf(m) }));
export const openBlockers = pendingBlockers;

/** Telegram'dan kelgan xabarlarni ulash: kalit, javob yoki yangi topshiriq. */
export function wireTelegram() {
  tg.onAnswer(async (parsed) => {
    if (parsed.kind === 'api_key' && parsed.provider === 'github') {
      const r = await resolveBlocker({ provider: 'github', value: parsed.value });
      if (!r.ok) {
        const check = await saveGithubToken(parsed.value.trim());
        await tg.send(check.ok ? `✅ GitHub tokeni saqlandi (${check.login}).` : `⚠️ GitHub tokeni ishlamadi: ${check.error}`);
      }
      return;
    }
    if (parsed.kind === 'api_key') {
      const r = await resolveBlocker({ provider: parsed.provider, value: parsed.value });
      if (!r.ok) {
        const s = db();
        s.keys[parsed.provider] = parsed.value;
        save();
        const { refreshModels } = await import('./providers.js');
        try {
          const models = await refreshModels(parsed.provider);
          if (!s.approved.some((id) => id.startsWith(parsed.provider + ':'))) s.approved.push(...models.slice(0, 6).map((m) => m.id));
          save();
          await tg.send(`✅ ${parsed.provider} kaliti saqlandi. ${models.length} ta model mavjud.`);
        } catch (e) {
          await tg.send(`⚠️ Kalit ishlamadi: ${e.message}`);
        }
      }
      return;
    }
    if (parsed.kind === 'answer') {
      await resolveBlocker({ blockerId: parsed.blockerId, value: parsed.value });
      return;
    }
    if (parsed.kind === 'mission') {
      const m = startMission(parsed.value, { source: 'telegram' });
      await tg.send(`🧠 Qabul qilindi. Ishga tushdim.\n<code>${m.id}</code>`);
      return;
    }
    // Oddiy xabar: ochiq so'rov bo'lsa javob, bo'lmasa yangi topshiriq.
    const pending = pendingBlockers()[0];
    if (pending) {
      await resolveBlocker({ blockerId: pending.id, value: parsed.value });
    } else {
      const m = startMission(parsed.value, { source: 'telegram' });
      await tg.send(`🧠 Qabul qilindi. Ishga tushdim.\n<code>${m.id}</code>`);
    }
  });
  tg.startPolling();
}

/** Ilovadan kelgan "menga shunday tool kerak" so'rovi bo'yicha tool yasaydi. */
export async function forgeTool(request) {
  const holder = {
    id: uid('forge'),
    goal: request,
    status: 'running',
    createdAt: Date.now(),
    steps: [],
    logs: [],
    blockers: [],
    modelsUsed: [],
    toolsCreated: [],
  };
  const name = (String(request).match(/[a-z][a-z0-9_]{2,}/i) || ['custom_tool'])[0].toLowerCase();
  return buildTool(holder, { name, purpose: request, input: '{...}' });
}
