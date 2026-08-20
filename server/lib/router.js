// Topshiriqni ruxsat berilgan modellar orasidan mosiga yo'naltiradi.
import { db } from './store.js';
import { allModels } from './providers.js';

export const TASK_TYPES = ['code', 'reasoning', 'research', 'write', 'data', 'ops', 'quick'];

const PREFERRED = {
  code: ['code', 'reasoning', 'general'],
  reasoning: ['reasoning', 'general', 'code'],
  research: ['reasoning', 'general', 'fast'],
  write: ['general', 'reasoning'],
  data: ['reasoning', 'code', 'general'],
  ops: ['code', 'general', 'fast'],
  quick: ['fast', 'cheap', 'general'],
};

export function approvedModels() {
  const s = db();
  const known = new Map(allModels().map((m) => [m.id, m]));
  return s.approved
    .map((id) => known.get(id) || { id, provider: id.split(':')[0], model: id.split(':').slice(1).join(':'), label: id, tags: ['general'] })
    .filter((m) => s.keys?.[m.provider]);
}

/** Topshiriq turi uchun eng mos ruxsat etilgan modelni tanlaydi. */
export function pickModel(taskType = 'reasoning', { exclude = [] } = {}) {
  const s = db();
  const pool = approvedModels().filter((m) => !exclude.includes(m.id));
  if (!pool.length) return null;

  const forced = s.routing?.[taskType];
  if (forced && !exclude.includes(forced)) {
    const hit = pool.find((m) => m.id === forced);
    if (hit) return hit;
  }
  for (const tag of PREFERRED[taskType] || ['general']) {
    const hit = pool.find((m) => m.tags?.includes(tag));
    if (hit) return hit;
  }
  return pool[0];
}

/** Matn asosida topshiriq turini taxmin qiladi (model chaqirmasdan, tez yo'l). */
export function classify(text = '') {
  const t = text.toLowerCase();
  if (/(kod|code|bug|fix|refactor|api|funksiya|function|deploy|build|script|test)/.test(t)) return 'code';
  if (/(qidir|search|izla|research|tahlil qil.*bozor|market|manba)/.test(t)) return 'research';
  if (/(hisobla|jadval|data|csv|json|statistik|hisobot)/.test(t)) return 'data';
  if (/(yoz|matn|maqola|post|xat|tarjima|write|translate)/.test(t)) return 'write';
  if (/(server|railway|docker|log|monitor|cron|deploy)/.test(t)) return 'ops';
  if (/(nima|kim|qachon|qisqa|tez)\b/.test(t) && t.length < 80) return 'quick';
  return 'reasoning';
}
