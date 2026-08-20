// Telegram: topshiriq tugaganda xabar beradi, API kalit yoki qaror kerak bo'lsa so'raydi.
import { db, save } from './store.js';
import { emit } from './bus.js';

let polling = false;
let offset = 0;
const answerHandlers = new Set();

export const onAnswer = (fn) => answerHandlers.add(fn);

function cfg() {
  return db().settings.telegram || {};
}

export function telegramReady() {
  const c = cfg();
  return Boolean(c.enabled && c.botToken && c.chatId);
}

async function api(method, body) {
  const c = cfg();
  if (!c.botToken) throw new Error('Telegram bot token yo\'q');
  const res = await fetch(`https://api.telegram.org/bot${c.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `Telegram ${method} xatosi`);
  return data.result;
}

export async function send(text, { silent = false } = {}) {
  if (!telegramReady()) return { sent: false, reason: 'telegram-off' };
  try {
    await api('sendMessage', {
      chat_id: cfg().chatId,
      text: text.slice(0, 3900),
      parse_mode: 'HTML',
      disable_notification: silent,
    });
    return { sent: true };
  } catch (e) {
    emit('log', { level: 'error', text: `Telegram xato: ${e.message}` });
    return { sent: false, reason: String(e.message || e) };
  }
}

export async function test() {
  const r = await send('✅ <b>Daho miya</b> Telegram bilan bog\'landi. Endi topshiriq natijalari shu yerga tushadi.');
  if (!r.sent) throw new Error(r.reason === 'telegram-off' ? 'Telegram sozlanmagan' : r.reason);
  return r;
}

/** Miya biror narsaga tiqilib qolganda — kalit yoki javob so'raydi. */
export async function askFor(blocker) {
  const lines = [
    '🔐 <b>Daho miyaga ruxsat kerak</b>',
    '',
    `<b>Topshiriq:</b> ${escapeHtml(blocker.missionGoal || '-')}`,
    `<b>Kerak:</b> ${escapeHtml(blocker.title)}`,
    blocker.why ? `<b>Sabab:</b> ${escapeHtml(blocker.why)}` : '',
    '',
    'Javobni shu yerga yozing:',
    blocker.kind === 'api_key'
      ? `<code>key ${blocker.provider || 'provider'} QIYMAT</code>`
      : `<code>javob ${blocker.id} MATN</code>`,
  ].filter(Boolean);
  return send(lines.join('\n'));
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function parseAnswer(text) {
  const t = (text || '').trim();
  let m = t.match(/^key\s+(\w+)\s+(.+)$/is);
  if (m) return { kind: 'api_key', provider: m[1].toLowerCase(), value: m[2].trim() };
  m = t.match(/^javob\s+(\S+)\s+([\s\S]+)$/i) || t.match(/^answer\s+(\S+)\s+([\s\S]+)$/i);
  if (m) return { kind: 'answer', blockerId: m[1], value: m[2].trim() };
  m = t.match(/^(?:topshiriq|task)\s+([\s\S]+)$/i);
  if (m) return { kind: 'mission', value: m[1].trim() };
  return { kind: 'free', value: t };
}

/** Telegram'dan javoblarni kutadi (long polling). */
export function startPolling() {
  if (polling) return;
  polling = true;
  const loop = async () => {
    while (polling) {
      if (!telegramReady()) {
        await sleep(5000);
        continue;
      }
      try {
        const updates = await api('getUpdates', { offset: offset + 1, timeout: 25, allowed_updates: ['message'] });
        for (const u of updates || []) {
          offset = Math.max(offset, u.update_id);
          const msg = u.message;
          if (!msg?.text) continue;
          if (String(msg.chat?.id) !== String(cfg().chatId)) continue;
          const parsed = parseAnswer(msg.text);
          for (const fn of answerHandlers) {
            try { await fn(parsed, msg); } catch (e) { emit('log', { level: 'error', text: `Telegram handler: ${e.message}` }); }
          }
        }
      } catch (e) {
        await sleep(4000);
      }
    }
  };
  loop();
}

export function stopPolling() {
  polling = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function setConfig({ botToken, chatId, enabled }) {
  const s = db();
  const t = s.settings.telegram;
  if (botToken !== undefined) t.botToken = botToken.trim();
  if (chatId !== undefined) t.chatId = String(chatId).trim();
  t.enabled = enabled !== undefined ? Boolean(enabled) : Boolean(t.botToken && t.chatId);
  save();
  if (t.enabled) startPolling();
  return { ...t, botToken: t.botToken ? 'saqlangan' : '' };
}
