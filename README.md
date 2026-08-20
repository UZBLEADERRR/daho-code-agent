# Daho — o'zini o'zi rivojlantiruvchi miya

Bitta miya. Siz topshiriq berasiz — u rejalashtiradi, kerakli toolni **o'zi yozadi**,
xatoni **o'zi tuzatadi**, tugagach ilovada va **Telegram'da** xabar beradi.

```
APK (Capacitor)  ──HTTPS──►  Miya serveri (Node, dependency'siz)
   Miya · Jarayon                 ├── reja  → qadamlar
   Toollar · Modellar             ├── tool registri (o'zi yozgan + builtin)
   Sozlamalar                     ├── model routeri (ruxsat berilganlar orasidan)
                                  └── Telegram (natija, kalit so'rovi, topshiriq)
```

## Nima qiladi

- **Yagona miya** — bitta topshiriq maydoni, qolganini u boshqaradi.
- **O'z-o'zini kengaytirish** — tool yetishmasa kodini yozadi, sintaksisini tekshiradi, registrga qo'shadi.
- **O'z-o'zini tuzatish** — tool xato bersa sababini tahlil qilib, yangi versiyasini chiqaradi (v2, v3...).
- **"Qilolmayman" yo'q** — imkoni bo'lmasa sababini aytadi, alternativ yo'l topadi yoki aniq nima kerakligini so'raydi.
- **Model tanlash** — API kalit kiritilgach mavjud modellar ro'yxati chiqadi, qidiruv bor; siz ruxsat berganlari orasidan topshiriqqa mosini o'zi tanlaydi.
- **Telegram** — natija shu yerga tushadi; kalit kerak bo'lsa shu yerdan so'raydi; siz ham u yerdan topshiriq bera olasiz.
- **GitHub qo'llari** — repo o'qish/yozish (bitta commit), tarmoq, PR, issue, reliz, kod qidiruv, Actions'ni ishga tushirib yiqilgan job logini o'qish va GitHub Pages'ga chiqarish.
- **O'z ishini sinaydi** — `test_app` veb loyihani headless brauzerda haqiqatan ishga tushiradi: JS xatolari, bo'sh sahifa, chizilgan tugma va matnlar ko'rinadi; xato bo'lsa miya tuzatib qayta sinaydi.

## Ishga tushirish

### Miya serveri (Railway yoki har qanday Node muhiti)

```bash
npm start          # node server/index.js, standart port 8080
```

`railway.env.example` dagi qiymatlarni Railway → Variables ga ko'chiring.
Holat `DATA_DIR` ichidagi `state.json` da saqlanadi — Railway'da **Volume** ulang,
aks holda qayta deploydan keyin kalitlar va toollar yo'qoladi.

### APK

```bash
npm run build      # dist/ tayyorlaydi
npx cap sync android
```

GitHub Actions (`.github/workflows/apk.yml`) har push'da APK yig'ib, Release'ga qo'yadi.

### Ilovada birinchi sozlash

1. **Sozlamalar** → Backend endpoint (Railway URL) → *Ulanish va tekshirish*
2. **Modellar** → API kalit qo'ying → modellar ro'yxati chiqadi → keraklilariga ruxsat bering
3. **Sozlamalar → GitHub** → token (`repo` + `workflow`) + standart repo
4. **Sozlamalar → Telegram** → bot token + chat ID → *Test xabar*
5. **Miya** ekranida topshiriq yozing.

To'liq API va xavfsizlik hujjati: [BACKEND.md](BACKEND.md)
