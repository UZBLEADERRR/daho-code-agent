// Provayder adapterlari: model ro'yxati + chat chaqiruvi. Har bir model id = "provider:model".
import { db, save } from './store.js';

const TIMEOUT = Number(process.env.PROVIDER_TIMEOUT_MS || 120000);

// Bazaviy manzillar: o'z proxy yoki mahalliy gateway ishlatilsa env orqali almashtiriladi.
const BASE = {
  openai: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  anthropic: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, ''),
  gemini: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
  openrouter: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
};

async function req(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), options.timeout || TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* matn qaytdi */ }
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || text.slice(0, 300) || res.statusText;
      const err = new Error(`${res.status} ${msg}`);
      err.status = res.status;
      throw err;
    }
    return json ?? {};
  } finally {
    clearTimeout(t);
  }
}

const guess = (id) => {
  const s = id.toLowerCase();
  const tags = [];
  if (/(code|coder|codex|devstral)/.test(s)) tags.push('code');
  if (/(o[134]|reason|think|deepseek-r|opus|pro)/.test(s)) tags.push('reasoning');
  if (/(mini|flash|haiku|lite|small|8b|nano)/.test(s)) tags.push('fast', 'cheap');
  if (/(vision|image|4o|gemini|omni)/.test(s)) tags.push('vision');
  if (/(embed|whisper|tts|dall|moderation|audio|realtime|imagen|veo)/.test(s)) tags.push('non-chat');
  if (!tags.length) tags.push('general');
  return tags;
};

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    docs: 'https://platform.openai.com/api-keys',
    async models(key) {
      const d = await req(`${BASE.openai}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      return (d.data || []).map((m) => ({ model: m.id, label: m.id }));
    },
    async chat(key, model, messages, opts = {}) {
      const d = await req(`${BASE.openai}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.2,
          max_completion_tokens: opts.maxTokens ?? 4000,
        }),
      });
      return d.choices?.[0]?.message?.content || '';
    },
  },

  anthropic: {
    label: 'Anthropic',
    docs: 'https://console.anthropic.com/settings/keys',
    async models(key) {
      const d = await req(`${BASE.anthropic}/models?limit=200`, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      return (d.data || []).map((m) => ({ model: m.id, label: m.display_name || m.id }));
    },
    async chat(key, model, messages, opts = {}) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const rest = messages.filter((m) => m.role !== 'system');
      const d = await req(`${BASE.anthropic}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          system: system || undefined,
          messages: rest.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
          max_tokens: opts.maxTokens ?? 4000,
          temperature: opts.temperature ?? 0.2,
        }),
      });
      return (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    },
  },

  gemini: {
    label: 'Google Gemini',
    docs: 'https://aistudio.google.com/app/apikey',
    async models(key) {
      const d = await req(
        `${BASE.gemini}/models?key=${encodeURIComponent(key)}&pageSize=200`
      );
      return (d.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => ({ model: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
    },
    async chat(key, model, messages, opts = {}) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const d = await req(
        `${BASE.gemini}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            generationConfig: { temperature: opts.temperature ?? 0.2, maxOutputTokens: opts.maxTokens ?? 4000 },
          }),
        }
      );
      return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n');
    },
  },

  openrouter: {
    label: 'OpenRouter',
    docs: 'https://openrouter.ai/keys',
    async models(key) {
      const d = await req(`${BASE.openrouter}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      return (d.data || []).map((m) => ({ model: m.id, label: m.name || m.id }));
    },
    async chat(key, model, messages, opts = {}) {
      const d = await req(`${BASE.openrouter}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'Daho Code Brain',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 4000,
        }),
      });
      return d.choices?.[0]?.message?.content || '';
    },
  },
};

export const providerList = () =>
  Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, docs: p.docs }));

export function hasKey(provider) {
  return Boolean(db().keys?.[provider]);
}

/** Provayder modellarini yuklaydi va keshlaydi. */
export async function refreshModels(provider) {
  const s = db();
  const key = s.keys?.[provider];
  if (!key) throw new Error(`${provider} uchun API kalit yo'q`);
  const raw = await PROVIDERS[provider].models(key);
  const models = raw
    .map((m) => ({
      id: `${provider}:${m.model}`,
      provider,
      model: m.model,
      label: m.label,
      tags: guess(m.model),
    }))
    .filter((m) => !m.tags.includes('non-chat'))
    .sort((a, b) => a.model.localeCompare(b.model));
  s.models.cache[provider] = models;
  s.models.fetchedAt[provider] = Date.now();
  save();
  return models;
}

export async function refreshAll() {
  const s = db();
  const out = { ok: [], failed: [] };
  await Promise.all(
    Object.keys(PROVIDERS).map(async (p) => {
      if (!s.keys?.[p]) return;
      try {
        await refreshModels(p);
        out.ok.push(p);
      } catch (e) {
        out.failed.push({ provider: p, error: String(e.message || e) });
      }
    })
  );
  return out;
}

export function allModels() {
  const s = db();
  return Object.values(s.models.cache || {}).flat();
}

/** Model bo'yicha qidiruv: nomi, provayder yoki teg bo'yicha. */
export function searchModels({ q = '', provider = '', onlyApproved = false } = {}) {
  const s = db();
  const term = q.trim().toLowerCase();
  return allModels()
    .filter((m) => (provider ? m.provider === provider : true))
    .filter((m) => (onlyApproved ? s.approved.includes(m.id) : true))
    .filter((m) =>
      term
        ? m.id.toLowerCase().includes(term) ||
          m.label.toLowerCase().includes(term) ||
          m.tags.some((t) => t.includes(term))
        : true
    )
    .map((m) => ({ ...m, approved: s.approved.includes(m.id) }));
}

/** Ruxsat berilgan model bilan chat. */
export async function chat(modelId, messages, opts = {}) {
  const s = db();
  const [provider, ...rest] = String(modelId).split(':');
  const model = rest.join(':');
  const key = s.keys?.[provider];
  if (!key) {
    const err = new Error(`${provider} API kaliti kiritilmagan`);
    err.code = 'NO_KEY';
    err.provider = provider;
    throw err;
  }
  if (!PROVIDERS[provider]) throw new Error(`Noma'lum provayder: ${provider}`);
  return PROVIDERS[provider].chat(key, model, messages, opts);
}
