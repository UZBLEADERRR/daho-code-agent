/** HTTP so'rov yuboradi va javobni qaytaradi. input: {url, method?, headers?, body?} */
export default async function run(input) {
  const { url, method = 'GET', headers = {}, body } = input;
  if (!url) throw new Error('url majburiy');
  const res = await fetch(url, {
    method,
    headers,
    body: body && method !== 'GET' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* matn */ }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 20000) };
}
