# BEAP - Baliqchi tumani Elektr energiya Analitik Platformasi

Mahalla (MFY) kesimida elektr energiya iste'moli, yo'qotishlari, qarzdorlik va
tarmoq holatini kuzatish tizimi. Ikki qismdan iborat:

| Qism | Kim uchun | Nima qiladi |
|---|---|---|
| **Boshqaruv paneli** | Hokimiyat | Tuman va MFY kesimida ko'rsatkichlar, reyting, ogohlantirishlar |
| **Ma'lumot kiritish paneli** | Elektroset xodimlari | Kunlik va oylik ma'lumotlarni kiritish, tekshirish, tasdiqlatish |

> **Tizim ODATIY holatda TO'LIQ OFFLINE ishlaydi.** Xarita, CDN, tashqi shrift
> va telemetriya umuman ishlatilmaydi, ma'lumot ichki tarmoqdan chiqmaydi.
> Ikkita ATAYLAB qo'shilgan, IXTIYORIY va faqat serverda ishlaydigan istisno
> bor - AI yordamchi (`OPENAI_API_KEY`) va Telegram bot (`TELEGRAM_BOT_TOKEN`)
> - kalit/token bo'sh bo'lsa ikkalasi ham butunlay o'chiq turadi, brauzer esa
> hech qachon o'zi tashqariga so'rov yubormaydi (`CSP connect-src 'self'`).
> Bu va'da `npm run verify:offline` bilan mashina tomonidan tekshiriladi.

---

## Tez ishga tushirish

```bash
# 1. Bog'liqliklar
npm install

# 2. Ma'lumotlar bazasi
psql -U postgres -c "CREATE DATABASE elektr_dev ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"
cp .env.example .env          # kerak bo'lsa PGUSER/PGPASSWORD ni to'g'rilang

# 3. Sxema va demo ma'lumot (24 oy)
npm run migrate
npm run seed

# 4. Ishga tushirish
npm run dev
```

Brauzerda: **http://localhost:5173**

> Windows'da Vite IPv6 (`::1`) ga bog'lanadi - `127.0.0.1:5173` emas,
> **`localhost:5173`** manzilidan foydalaning.

### Kirish

Tizimda **login yo'q** - platforma to'liq demo rejimida ishlaydi va har bir
amal (ko'rish, kiritish, tasdiqlash, pasportni muzlatish) hech qanday kirish
ekransiz mumkin. Server tomonida har bir so'rov administrator konteksti bilan
bajariladi (`apps/api/src/plugins/context.ts`), shuning uchun audit jurnali va
Postgres RLS avvalgidek ishlaydi - aktor doim bazadagi birinchi `admin` hisobi.

---

## Prezentatsiya uchun ssenariy

1. **`/dashboard`** - tuman paneli. 8 ta KPI, hududiy yo'qotish taqsimoti
   (treemap), energiya balansi (sankey), samaradorlik indeksi.
2. **Har bir KPI kartasidagi «i» tugmasi** - raqamning MANBASINI ko'rsatadi:
   qo'lda kiritiladimi yoki hisoblanadimi.
3. **Samaradorlik indeksi «i»** - «nega 90.9?» degan savolga javob: 5 komponent
   va ularning vaznlari.
4. **Treemapdagi eng katta qizil plitka** (Chinobod) → bosing → MFY paneli
   ochiladi, yorug' temada.
5. **`/passport`** → *Solishtirish* tabi - MFY pasportlari yig'indisi tuman
   pasporti bilan qator-baqator solishtiriladi. **Tuman pasporti qo'lda
   kiritilmaydi.**
6. **`/entry`** - to'liqlik matritsasi. Gulshan MFY joriy oyda qoralamada
   (sariq katak), Obod MFY tasdiqlashga yuborilgan (ko'k).
7. **`operator1` bilan kiring** → `/entry` → Sarnaul → Energiya balansi →
   bir kunga noto'g'ri raqam kiriting → pastdagi **nazorat qatori** darhol
   qizaradi va aniq farqni ko'rsatadi.
8. **Eng ishonarli 20 soniya** - terminalda:

   ```bash
   npm run seed
   ```

   Chiqishda: *«Trigger bloklandi: IMPLAUSIBLE_DEBT …»*
   Bu - Go'ravon MFY pasportida tuman qarzdorligi MFY qatoriga ko'chirib
   qo'yilgan haqiqiy xato. Tizim uni **texnik jihatdan imkonsiz** qiladi.

---

## Nima uchun shunday qurilgan

### Manba hujjatlaridagi xatolar dizaynni belgiladi

Mijoz bergan PASPORT hujjatlarida **4 ta arifmetik nomuvofiqlik** topildi:

| Hujjat | Qator | Yozilgan | Bo'laklar yig'indisi |
|---|---|---|---|
| Tuman | 1. Iste'molchilar | 44,884 | 43,318 + 1,564 = **44,882** |
| Tuman | 4. Tarmoq km | 1,255.7 | 789.2 + 4,665.0 = **5,454.2** |
| Sarnaul | 12. Ta'mir km | 3.2 | 1.2 + 1.0 = **2.2** |
| Tuman | 10. Tijoriy yo'qotish | 12,642 | 8-qatordagi oqim 11,200 dan katta |

Va **Go'ravon MFY pasportiga tumanning qarzdorlik raqamlari ko'chirib
qo'yilgan**.

**Natijaviy qaror:** tizimda har qanday «jami» va «shundan» qiymati -
`GENERATED ALWAYS AS ... STORED` ustun yoki view ifodasi. **Hech qachon input
maydoni emas.** Xodim faqat bo'laklarni kiritadi.

Bu uch qatlamda majburlanadi:

| Qatlam | Qanday |
|---|---|
| Ma'lumotlar bazasi | `CHECK` cheklovlari + `IMPLAUSIBLE_DEBT` trigger |
| API | `packages/shared` dagi zod sxemalari (DB bilan bir xil qoidalar) |
| UI | Jonli nazorat qatori, faqat o'qiladigan «jami» ustunlari |

### Xarita o'rniga treemap

Mijoz talabi: ma'lumot tashqariga chiqmasin. Shu sababli xarita yo'q - tile
server, geokodlash va geo-ma'lumot ishlatilmaydi.

O'rnida **`@nivo/treemap`**: plitka **maydoni** = tarmoqqa kirgan energiya,
plitka **rangi** = amaldagi yo'qotish % − norma %. Xarita bir vaqtda hajm va
darajani ko'rsata olmaydi - treemap ko'rsatadi.

### «AI Agent» paneli - keyin ixtiyoriy istisno sifatida qo'shildi

Boshida mijoz AI hozircha kerak emas dedi. Uning o'rnida **«Diqqat talab
qiladigan holatlar»** paneli qurildi - deterministik SQL qoidalari (yo'qotish
normadan oshgan, TP ortiqcha yuklangan, MFY ma'lumot yubormagan, qarzdorlik
keskin o'sgan). Bu qoidalar hozir ham ishlaydi, LLM'siz.

Keyinroq **ixtiyoriy** AI yordamchi qo'shildi: `OPENAI_API_KEY` bo'sh bo'lsa
xususiyat butunlay o'chiq turadi (panelda tugma ham chiqmaydi) va tizim
avvalgidek to'liq offline ishlaydi. Xuddi shu tamoyilda **ixtiyoriy** Telegram
bot ham bor (`TELEGRAM_BOT_TOKEN`) - foydalanuvchilar bir xil yordamchidan
Telegram orqali savol so'rashi va kunlik ogohlantirish digestini olishi
mumkin, veb panelga qo'shimcha yoki o'rniga. Ikkalasi ham faqat serverda
ishlaydi; kalit/token berilmasa - tashqi xizmatga birorta so'rov ketmaydi.

---

## Arxitektura

```
electricity/
├─ packages/shared/        zod sxemalar + tiplar + formatlash + metrika manbasi
│                          → API va Web AYNAN shu modulni import qiladi
├─ apps/api/               Fastify 5 + pg (qo'lda yozilgan SQL)
│  ├─ migrations/          0001…0007 - sha256 bilan qulflangan
│  ├─ seed/                mfy.seed.json + generate.ts
│  ├─ scripts/             migrate · seed · verify-passport · test-constraints
│  └─ src/db/queries/      barcha analitik SQL shu yerda
└─ apps/web/               Vite 8 + React 19 + Tailwind 4 + HeroUI 3.2.2
   ├─ styles/theme-gov.css ikki tema + tekshirilgan diagramma palitrasi
   ├─ lib/chart-theme.ts   CSS o'zgaruvchilari → Nivo va ECharts temasi
   ├─ components/charts/   ChartFrame (jadval-egizak bilan) + diagrammalar
   └─ features/            district · mfy · passport · entry · review
```

Ierarxiya: **Tuman → Elektroset → MFY → TP → Abonent**

### Ma'lumotlar bazasi sxemalari

| Sxema | Vazifasi |
|---|---|
| `ref` | Spravochniklar: elektroset, MFY, TP, tarmoq, **normalar** (vaqt bo'yicha versiyalanadi) |
| `fact` | Qo'lda kiritiladigan faktlar. Har biri `fact.submission` konvertiga tegishli |
| `agg` | Materialized view'lar va pasport. **Bu yerda hech narsa kiritilmaydi** |
| `sec` | Foydalanuvchi (audit aktori uchun), hudud, audit jurnali |

### Tasdiqlash oqimi

```
qoralama → yuborilgan → tasdiqlangan
              ↓
          rad etilgan → qoralama
                            ↓
                   tuzatish revisiyasi (eskisi «superseded» bo'ladi)
```

Tasdiqlangan fakt **hech qachon `UPDATE` qilinmaydi**. O'qish `status='approved'`
filtri bilan view orqali boradi, shuning uchun tarix buzilmaydi.

---

## Tekshirish

```bash
npm run verify:passport   # pasport yaxlitligi - 19 ta tekshiruv
npm run verify:offline    # offline (air-gap) kafolati
npm run migrate           # sxema dolzarbligi
npm run typecheck         # TypeScript
cd apps/api && node --experimental-strip-types scripts/test-constraints.ts
```

Joriy holat:

| Tekshiruv | Natija |
|---|---|
| Pasport roll-up (24 oy × 19 qator = 456 ta) | ✅ 19/19 |
| DB cheklovlari (har biri ATAYLAB buziladi) | ✅ 15/15 |
| Offline / air-gap | ✅ tashqi murojaat yo'q |
| TypeScript (web + api) | ✅ xatosiz |

**`test-constraints.ts` haqida:** har bir test ataylab noto'g'ri ma'lumot
yozishga urinadi va DB uni rad etishini kutadi. *Hech narsani rad etganini
ko'rmagan cheklov - cheklov emas.*

### Kalibrovka

Seed tuman jamlarini **haqiqiy pasport raqamlariga** moslaydi
(largest-remainder yaxlitlash bilan, shuning uchun yig'indi **aniq** mos keladi):

| Ko'rsatkich | Pasport | Tizim |
|---|---|---|
| Iste'molchilar | 43,318 + 1,564 | ✅ aynan |
| Transformatorlar | 574 | ✅ |
| Tarmoq (0.4 / 10 kV) | 789.2 / 466.5 km | ✅ |
| Qarzdorlik | 2,449.1 + 1,816.5 mln | ✅ |
| Aloqasiz hisoblagichlar | 1,456 | ✅ |
| Ta'mir kerak TP / tarmoq | 179 ta / 205.5 km | ✅ |

---

## Texnologiyalar

Frontend: React **19.2.8** · Tailwind CSS **4.3.3** · HeroUI **3.2.2** ·
Vite **8.2.0** · Nivo **0.99.0** · ECharts **6.1.0** (faqat gauge) ·
TanStack Query **5.101.4** · react-router **8.3.0** ·
Inter **5.3.0** (`@fontsource-variable/inter`)

### Shrift

**Inter Variable**, lokal bundle qilingan - Google Fonts ISHLATILMAYDI.
`.woff2` fayllari npm paketidan keladi va Vite ularni `dist/assets/` ga
nusxalaydi, ya'ni air-gap muhitda ham ishlaydi.

`unicode-range` tufayli brauzer faqat kerakli subsetni yuklaydi:

Interfeys faqat lotin yozuvida, shuning uchun brauzer `latin` subsetini
(~47 KB) yuklaydi. Qamrov tekshirildi: `oʻ gʻ` (U+02BB–02BC) `latin`
subsetining ichida.

Ikki nozik joy:

1. **ECharts canvas'ga chizadi va CSS shriftini meros qilib olmaydi** -
   `fontFamily` aniq beriladi (`lib/chart-theme.ts` dagi `CHART_FONT`).
   Aks holda gauge'dagi katta raqam boshqa shriftda chiqardi.
2. Inter'ning `cv05`/`cv08` belgi-farqlash to'plami yoqilgan - `1 / l / I`
   ajraladi, TP kodlari (`TR-0102`) va abonent raqamlari aniq o'qiladi.

Backend: Node **24** · Fastify **5.11** · pg **8.22** · zod **4.4.3** ·
jose **6.2.5** · argon2 **0.45.1** · PostgreSQL **17+**

**Ataylab ishlatilmagan:** `xlsx` (npm nusxasi CVE-2023-30533 bilan qotgan -
`exceljs` ishlatiladi) · `@tremor/react` (React 18 only) · `react-leaflet`
(Hippocratic litsenziya, OSI emas) · TimescaleDB (TSL litsenziya) ·
har qanday xarita, CDN, telemetriya va LLM kutubxonasi.

### HeroUI v3 haqida ikki eslatma

1. Brend rangi **`--accent`**, `--primary` **mavjud emas**.
2. `NumberField` da **`locale` propi yo'q** - hujjatlar jadvalidagi yozuv
   haqiqiy tiplarga mos kelmaydi. Lokal `<I18nProvider locale="uz-Latn-UZ">`
   orqali butun ilova uchun bir marta beriladi (`app.tsx`).

---

## Til

O'zbek **lotin** - YAGONA ko'rinish. Tarjima qatlami (i18next), kirill
transliteratsiyasi va til almashtirgich olib tashlangan: interfeys matnlari
to'g'ridan-to'g'ri komponentlar ichida yozilgan.

`<I18nProvider locale="uz-Latn-UZ">` qoladi, lekin u tarjima uchun emas -
React Aria sana/raqam formatlash uchun ishlatadi.

---

## Mijoz bilan aniqlanishi kerak

Bular ishni bloklamaydi (seed'dan ishlaydi), lekin ishlatishdan oldin
tasdiqlanishi kerak:

1. **MFY ro'yxati** - hozir 22 ta. Sarnaul va Go'ravon PDF'dan tasdiqlangan,
   8 tasi mockupdan, 12 tasi generatsiya qilingan.
   → `apps/api/seed/mfy.seed.json` da bitta fayl o'zgaradi.
2. **10-qator birligi** - tijoriy yo'qotish «12,642» kWh mi yoki ming kWh?
   Yozilganicha oylik oqimdan oshib ketadi.
3. **«Tijoriy yo'qotish» va «jami yo'qotish»** - Sarnaulda 20.7%, dashboardda
   6.4%. Bir xil o'lchovmi? Samaradorlik indeksi shunga bog'liq.
4. **4-qator** - 10 kV tarmoq 466.5 km ekanini tasdiqlash.
5. **Kunlik energiya manbasi** - Elektrosetlarda billing/SCADA dan eksport
   qilish imkoni bormi, yoki operator kuniga 22 qator yozadimi?
   *Ro'yxatdagi eng ta'sirli savol* - fayl bo'lsa Excel import asosiy yo'lga
   aylanadi.
6. **Qarzdorlik birligi** - saqlash uchun mln so'm deb olindi.
7. **Abonent darajasidagi yozuvlar** kiradimi? (44,884 qator)
8. **Deploy** - Windows server yoki Linux VM?
9. **E-IMZO** - muzlatilgan pasportga elektron imzo kerakmi?
   (`content_sha256` ustuni shuning uchun qo'yilgan.)

---

## Keyingi bosqichlar

Tayyor: DB + API + dashboardlar + pasport + kiritish paneli (energiya balansi
va oylik hisobot) + tasdiqlash oqimi + AI yordamchi va Telegram
bot (ikkalasi ham ixtiyoriy, faqat serverda).

Qolgan:

- Kiritish formalari: TP holati, tarmoq nuqsonlari, ishlar, dalolatnomalar
  *(DB va API tayyor - faqat UI kerak)*
- Excel import/eksport (`exceljs`) va PDF (`pdfmake` + DejaVu shrifti)
- Postgres RLS'ni ishlatish uchun API'ni `beap_app` roli ostida ulash
  *(siyosatlar yozilgan, hozir superuser sifatida ulanadi)*
- Heks-kartogramma (MFY ro'yxati tasdiqlangach)
- Playwright E2E to'plami
