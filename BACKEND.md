# Daho Code backend integratsiyasi

APK backend bilan HTTPS orqali gaplashadi. API kalitlari **hech qachon APK ichiga yozilmaydi**.

## `POST /api/chat`

Request:
```json
{
  "message": "Loyihamni tahlil qil",
  "provider": "openai | anthropic | gemini | openrouter",
  "model": "GPT-4o",
  "history": []
}
```

Response:
```json
{
  "reply": "...",
  "taskId": "task_123",
  "status": "completed | running | failed",
  "logs": []
}
```

APK `reply` yoki `message` maydonini o‘qiydi. Backend URL Sozlamalar → Backend endpoint maydoniga yoziladi.

## Railway Variables namunasi

`railway.env.example` faylidagi qiymatlarni Railway → Variables bo‘limida to‘ldiring. Haqiqiy tokenlarni GitHub’ga yubormang.

## Self-improvement oqimi

1. Request capability registry bilan solishtiriladi.
2. Yetishmayotgan capability uchun alohida branch yaratiladi.
3. Agent faqat ruxsat berilgan workspace fayllarini o‘zgartiradi; `.env`, secret va production konfiguratsiyasi himoyalanadi.
4. Unit/integration testlar sandbox’da ishga tushiriladi.
5. Test muvaffaqiyatsiz bo‘lsa deploy qilinmaydi va log qaytariladi.
6. Test muvaffaqiyatli bo‘lsa commit va push qilinadi.
7. Railway deploy webhook/API ishga tushiriladi.
8. Health-check muvaffaqiyatli bo‘lsa capability registry yangilanadi.

> Avtomatik rejim yoqilgan bo‘lsa ham GitHub tokeniga minimal scope va alohida agent branch siyosati tavsiya qilinadi. Production branch’ga to‘g‘ridan-to‘g‘ri push qilish o‘rniga branch + test + merge mexanizmi ishlatilishi kerak.
