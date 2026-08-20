/** Telegram'ga xabar yuboradi. input: {text} */
export default async function run(input, ctx) {
  const token = ctx.env.TELEGRAM_BOT_TOKEN;
  const chatId = ctx.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Telegram sozlanmagan');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(input.text || '').slice(0, 3900) }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram xatosi');
  return { sent: true };
}
