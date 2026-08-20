// Oddiy event bus — SSE orqali klientga real vaqt yangiliklarini uzatadi.
const clients = new Set();

export function subscribe(res) {
  clients.add(res);
  return () => clients.delete(res);
}

export function emit(type, payload) {
  const chunk = `event: ${type}\ndata: ${JSON.stringify(payload ?? {})}\n\n`;
  for (const res of clients) {
    try { res.write(chunk); } catch { clients.delete(res); }
  }
}

export const clientCount = () => clients.size;
