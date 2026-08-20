# Daho miya — server hujjati

Miya `server/` papkasida, tashqi npm paketlarsiz (faqat Node 20+ standart kutubxonasi).
API kalitlari **faqat serverda** saqlanadi — APK ichida hech qachon emas.

```
server/
  index.js            HTTP server, marshrutlar, statik fayllar, SSE
  lib/store.js        state.json (kalitlar, modellar, toollar, topshiriqlar)
  lib/providers.js    OpenAI / Anthropic / Gemini / OpenRouter adapterlari
  lib/router.js       topshiriq turi → ruxsat berilgan model
  lib/brain.js        orkestrator: reja → qadam → tool yozish → tuzatish → hisobot
  lib/tools.js        tool registri va versiyalari
  lib/sandbox.js      toolni alohida protsessda, timeout bilan bajarish
  lib/telegram.js     xabar berish, kalit so'rash, javob va topshiriq qabul qilish
  tools/              builtin toollar (http_request, fs_read, fs_write, shell_run, telegram_notify)
```

## Topshiriq oqimi

1. **Reja** — miya topshiriqni tahlil qiladi, qadamlarga bo'ladi, turini aniqlaydi (`code`, `research`, `data`, ...).
2. **Model tanlash** — shu tur uchun ruxsat berilgan modellar orasidan mosi olinadi (`routing` bo'lsa — o'sha).
3. **Qadam bajarish** — mavjud tool ishlatiladi; yo'q bo'lsa miya tool kodini yozadi, `node --check` bilan tekshiradi, registrga qo'shadi va ishlatadi.
4. **O'z-o'zini tuzatish** — tool xato bersa xato matni + kod modelga beriladi, yangi versiya chiqariladi va qayta uriniladi (`maxSelfRepair`, standart 3).
5. **Alternativ yo'l** — tuzatish ham yordam bermasa miya boshqa strategiya tanlaydi; oxirgi holatda qadam model bilimi bilan bajarilib, nimasi to'liq emasligi aytiladi. Rad javob qaytarilmaydi.
6. **Bloker** — faqat tashqi resurs (API kalit, parol) kerak bo'lganda to'xtaydi: Telegram'ga so'rov ketadi, javob kelishi bilan **avtomatik davom etadi**.
7. **Yakun** — hisobot yoziladi, ilovaga SSE orqali uzatiladi va Telegram'ga yuboriladi.

## HTTP API

`APP_TOKEN` o'rnatilgan bo'lsa, `/api/health` dan tashqari hamma so'rovda
`X-Daho-Token` sarlavhasi (yoki SSE uchun `?token=`) talab qilinadi.

| Metod | Yo'l | Vazifa |
|---|---|---|
| GET | `/api/health` | tiriklik tekshiruvi |
| GET | `/api/state` | to'liq snapshot (kalitlar maskalangan) |
| GET | `/api/events` | SSE: `mission`, `tool`, `blocker` hodisalari |
| POST | `/api/keys` | `{provider, apiKey}` — kalit tekshiriladi va modellar yuklanadi |
| DELETE | `/api/keys` | `{provider}` — kalit va uning modellarini o'chiradi |
| GET | `/api/models` | `?q=&provider=&approved=1` — qidiruv bilan ro'yxat |
| POST | `/api/models/refresh` | barcha provayderlardan modellarni qayta yuklash |
| POST | `/api/models/approve` | `{id \| ids, approved}` — ruxsat berish/olib tashlash |
| POST | `/api/models/route` | `{taskType, modelId}` — qo'lda yo'naltirish |
| GET | `/api/tools` | registr |
| POST | `/api/tools` | `{code,...}` yoki `{request}` — miya kodini o'zi yozadi |
| POST | `/api/tools/run` | `{name, input}` — sandbox'da bajarish |
| DELETE | `/api/tools` | `{name}` |
| GET/POST | `/api/missions` | ro'yxat / `{goal}` bilan yangi topshiriq |
| GET | `/api/mission?id=` | bitta topshiriq (barcha qadam va loglar) |
| POST | `/api/mission/retry` | `{id, replan?}` |
| GET | `/api/blockers` | ochiq so'rovlar |
| POST | `/api/blockers/answer` | `{id \| provider, value}` — javob berish va davom ettirish |
| POST | `/api/telegram` | `{botToken, chatId, enabled}` |
| POST | `/api/telegram/test` | test xabari |
| POST | `/api/settings` | `{autoImprove, notifyOnFinish, maxSelfRepair}` |
| POST | `/api/chat` | eski APK bilan moslik: topshiriq ochadi, `taskId` qaytaradi |

## Telegram buyruqlari

| Xabar | Natija |
|---|---|
| `key openai sk-...` | kalit saqlanadi, modellar yuklanadi, to'xtagan topshiriq davom etadi |
| `javob <blocker_id> matn` | ochiq so'rovga javob |
| `topshiriq <matn>` | yangi topshiriq ochiladi |
| oddiy matn | ochiq so'rov bo'lsa — javob, aks holda yangi topshiriq |

## Toollar

Builtin: `http_request`, `fs_read`, `fs_write`, `shell_run`, `telegram_notify`.

Miya yozgan toollar `DATA_DIR/tools/<nom>.v<N>.mjs` fayllarida versiyalanadi va shu shaklda bo'ladi:

```js
export default async function run(input, ctx) {
  // ctx = { env, workspace, log }
  return { natija: '...' };
}
```

Har bir tool alohida Node protsessida, `cwd = ALLOWED_WORKSPACE` va timeout bilan ishlaydi;
sintaksis xatosi bo'lgan kod registrga umuman qo'shilmaydi.

## Xavfsizlik

- Kalitlar `state.json` da, faqat serverda; API javoblarida `sk-••••abcd` ko'rinishida.
- Fayl toollari `ALLOWED_WORKSPACE` dan tashqariga chiqmaydi.
- `shell_run` ni `ALLOW_SHELL=false` bilan butunlay o'chirish mumkin.
- Ochiq internetga qo'yilgan serverda `APP_TOKEN` ni albatta o'rnating.
- Volume ulanmasa, deploydan keyin holat (kalitlar, toollar, tarix) yo'qoladi.
