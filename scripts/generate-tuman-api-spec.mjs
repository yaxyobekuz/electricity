/*
 * Tuman darajasidagi API uchun ma'lumot so'rovi spetsifikatsiyasini yaratadi.
 *
 * Har bir obyekt turi (Podstansiya, Fider, TP, Transformator, Abonent
 * hisoblagichi, Iste'molchi, Tarmoq, Ma'muriy) uchun ALOHIDA .xlsx fayl.
 * Har bir maydon: birligi, davriyligi (SOATLIK/kunlik/oylik/statik), manba
 * tizimi va «olish mumkinmi?» belgisi bilan.
 *
 *   node scripts/generate-tuman-api-spec.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'Tuman-API-spetsifikatsiya');
mkdirSync(OUT_DIR, { recursive: true });

// ─── Ranglar ────────────────────────────────────────────────────────────────
const C = {
  title: '1F3B4D',
  titleText: 'FFFFFF',
  header: '2E5E4E',
  headerText: 'FFFFFF',
  section: 'CFE0DB',
  band: 'F5F8F7',
  yes: 'C6EFCE', yesText: '10643B',
  part: 'FFE8A3', partText: '8A5A00',
  no: 'F8CBCF', noText: '9C1420',
  soatlik: 'FBE2D5',
  kunlik: 'FFF3CC',
  oylik: 'DCEBF7',
  statik: 'E4EFDD',
  hodisa: 'EAEAEA',
};

const FEAS = {
  y: { t: '✓ Ha', fill: C.yes, font: C.yesText },
  p: { t: '~ Qisman', fill: C.part, font: C.partText },
  n: { t: '✗ Yo’q', fill: C.no, font: C.noText },
};
const FREQ_FILL = {
  Soatlik: C.soatlik, Kunlik: C.kunlik, Oylik: C.oylik, Statik: C.statik, Hodisa: C.hodisa,
};

// Maydon yozuvi: [label, key, unit, freq, type, source, feas, priority, note]
const F = (label, key, unit, freq, type, source, feas, priority, note) =>
  [label, key, unit, freq, type, source, feas, priority, note];

// ─── OBYEKTLAR SPETSIFIKATSIYASI ─────────────────────────────────────────────
const FILES = [];

// ═══ 01. PODSTANSIYA / NIMSTANSIYA ═══════════════════════════════════════════
FILES.push({
  id: '01',
  file: '01_PODSTANSIYA.xlsx',
  title: 'PODSTANSIYA (NIMSTANSIYA) — ma’lumot so’rovi',
  entity: 'Podstansiya / Nimstansiya (35/10 yoki 110/35/10 kV)',
  info: {
    what: 'Tuman tarmog’ining kirish nuqtasi. Yuqori kuchlanishni 10 kV ga tushiradi. Har birida 1–3 kuch transformatori bo’lib, ulardan bir nechta 10 kV fider chiqadi. Tarmoqdagi ENG YAXSHI jihozlangan (SCADA/telemetriya) nuqta — soatlik ma’lumot shu yerda deyarli to’liq mavjud.',
    parent: 'Elektroset (RES)',
    children: 'Fider, Kuch transformatori',
    idKey: 'substation_id (barqaror, o’zgarmas unikal ID)',
    cardinality: 'Tumanda odatda 3–10 ta nimstansiya',
    delivery: 'Statik ma’lumot — bir marta + o’zgarganda. Soatlik telemetriya — uzluksiz oqim yoki har soatda.',
  },
  sections: [
    { title: 'A. STATIK / PASPORT (bir marta beriladi, o’zgarganda yangilanadi)', rows: [
      F('Nimstansiya ID', 'substation_id', '—', 'Statik', 'int/text', 'Registr', 'y', 'Yuqori', 'Barqaror unikal identifikator. Barcha jadvallar shu ID orqali bog’lanadi.'),
      F('Nomi', 'name', '—', 'Statik', 'text', 'Registr', 'y', 'Yuqori', '«Chinobod nimstansiyasi»'),
      F('Kodi', 'code', '—', 'Statik', 'text', 'Registr', 'y', 'O’rta', 'Dispetcher/hujjatlardagi qisqa kod'),
      F('Kuchlanish klassi', 'voltage_class', 'kV', 'Statik', 'text', 'Registr', 'y', 'Yuqori', '«110/35/10», «35/10». Pasportning nimstansiya qatori uchun.'),
      F('Tuman / hudud', 'district', '—', 'Statik', 'text', 'Registr', 'y', 'O’rta', 'Baliqchi tumani'),
      F('Koordinatalar', 'lat, lon', 'geo', 'Statik', 'number', 'GIS', 'p', 'Past', 'Xaritada ko’rsatish uchun (dashboard hozir xaritasiz, kelajak uchun).'),
      F('Transformatorlar soni', 'transformer_count', 'ta', 'Statik', 'int', 'Registr', 'y', 'Yuqori', 'Nimstansiyadagi kuch transformatorlari soni'),
      F('Umumiy quvvat', 'total_capacity_mva', 'MVA', 'Statik', 'number', 'Registr', 'y', 'Yuqori', 'Barcha transformatorlar nominal quvvati yig’indisi'),
      F('Fiderlar soni', 'feeder_count', 'ta', 'Statik', 'int', 'Registr', 'y', 'Yuqori', 'Chiquvchi 10 kV fiderlar soni'),
      F('Shina seksiyalari', 'busbar_count', 'ta', 'Statik', 'int', 'Registr', 'p', 'Past', '10 kV shinalar soni'),
      F('Ishga tushgan sana', 'commissioned_on', 'sana', 'Statik', 'date', 'Registr', 'p', 'Past', ''),
      F('Holati', 'status', '—', 'Statik', 'enum', 'Registr', 'y', 'O’rta', 'ishlayapti / zaxira / ta’mirda'),
    ] },
    { title: 'B. SOATLIK TELEMETRIYA (SCADA / АСКУЭ) — ASOSIY MAQSAD', rows: [
      F('Vaqt belgisi (soat)', 'ts', 'ISO 8601', 'Soatlik', 'timestamp', 'SCADA/АСКУЭ', 'y', 'Yuqori', 'Har o’lchov soati, mintaqa vaqti +05:00. Soatlik profilning kaliti.'),
      F('Kirgan energiya (soatlik)', 'energy_in_kwh', 'kWh', 'Soatlik', 'number', 'АСКУЭ', 'y', 'Yuqori', 'Nimstansiyaga kirgan energiyaning soatlik o’sishi (balans hisoblagichi).'),
      F('Chiqqan energiya (soatlik)', 'energy_out_kwh', 'kWh', 'Soatlik', 'number', 'АСКУЭ', 'y', 'Yuqori', 'Fiderlarga chiqqan energiya yig’indisi. Nimstansiya yo’qotishini beradi.'),
      F('Aktiv quvvat P', 'active_power_mw', 'MW', 'Soatlik', 'number', 'SCADA', 'y', 'Yuqori', 'Joriy yuklanma. Dashboarddagi max/o’rtacha yuklanma uchun.'),
      F('Reaktiv quvvat Q', 'reactive_power_mvar', 'MVAr', 'Soatlik', 'number', 'SCADA', 'p', 'O’rta', 'cosφ hisoblash uchun'),
      F('Quvvat koeffitsienti', 'power_factor', 'cosφ', 'Soatlik', 'number', 'SCADA', 'p', 'O’rta', 'Q/P dan yoki bevosita'),
      F('Tok (fazalar)', 'current_a', 'A', 'Soatlik', 'number', 'SCADA', 'p', 'O’rta', 'Ia / Ib / Ic — fazalar nomutanosibligi'),
      F('Kuchlanish (YuK shina)', 'voltage_kv_hv', 'kV', 'Soatlik', 'number', 'SCADA', 'y', 'O’rta', 'Yuqori kuchlanish shinasi'),
      F('Kuchlanish (10 kV shina)', 'voltage_kv_mv', 'kV', 'Soatlik', 'number', 'SCADA', 'y', 'Yuqori', '10 kV shina kuchlanishi — sifat nazorati'),
      F('Chastota', 'frequency_hz', 'Hz', 'Soatlik', 'number', 'SCADA', 'p', 'Past', '50 Hz atrofida'),
      F('Yuklanish darajasi', 'load_pct', '%', 'Soatlik', 'number', 'SCADA/hisob', 'y', 'Yuqori', 'P / o’rnatilgan quvvat. Ortiqcha yuklanma signali.'),
      F('Vyklyuchatel holati', 'breaker_status', '—', 'Soatlik/Hodisa', 'enum', 'SCADA', 'p', 'O’rta', 'yoniq / o’chiq — uzilishni aniqlash'),
    ] },
    { title: 'C. KUNLIK / OYLIK AGREGAT (soatlikdan hisoblanadi)', rows: [
      F('Sutkalik maksimal yuklanma', 'peak_load_mw', 'MW', 'Kunlik', 'number', 'SCADA/hisob', 'y', 'Yuqori', ''),
      F('Sutkalik minimal yuklanma', 'min_load_mw', 'MW', 'Kunlik', 'number', 'SCADA/hisob', 'y', 'O’rta', ''),
      F('Kunlik kirgan energiya', 'energy_in_day_kwh', 'kWh', 'Kunlik', 'number', 'АСКУЭ', 'y', 'Yuqori', 'Soatlikdan yig’iladi'),
      F('Uzilishlar soni', 'outage_count', 'ta', 'Kunlik', 'int', 'SCADA', 'p', 'O’rta', 'Ishonchlilik (SAIFI)'),
      F('Uzilish davomiyligi', 'outage_minutes', 'min', 'Kunlik', 'int', 'SCADA', 'p', 'O’rta', 'Ishonchlilik (SAIDI)'),
    ] },
  ],
  sample: {
    note: 'Soatlik telemetriya namunasi (bitta nimstansiya, bitta sutkaning bir necha soati):',
    columns: ['substation_id', 'ts', 'energy_in_kwh', 'active_power_mw', 'voltage_kv_mv', 'load_pct'],
    rows: [
      ['SS-CHINOBOD', '2026-08-07T00:00:00+05:00', 8420, 8.1, 10.4, 41],
      ['SS-CHINOBOD', '2026-08-07T01:00:00+05:00', 7980, 7.6, 10.5, 38],
      ['SS-CHINOBOD', '2026-08-07T19:00:00+05:00', 15230, 15.9, 9.9, 79],
      ['SS-CHINOBOD', '2026-08-07T20:00:00+05:00', 16010, 16.4, 9.8, 82],
    ],
  },
});

// ═══ 02. FIDER ═══════════════════════════════════════════════════════════════
FILES.push({
  id: '02',
  file: '02_FIDER.xlsx',
  title: 'FIDER — ma’lumot so’rovi',
  entity: 'Fider (10 yoki 6 kV chiquvchi liniya)',
  info: {
    what: 'Nimstansiyadan chiquvchi 10 kV liniya; o’nlab TP ni oziqlantiradi. TIZIMNING ASOSIY HISOB BIRLIGI — hozirgi dashboard aynan shu darajada ishlaydi (Xaqulobod fideri, 51 TP). Fider boshida balans hisoblagichi va koeffitsient bor; energiya balansi shu yerdan quriladi.',
    parent: 'Podstansiya (substation_id)',
    children: 'TP',
    idKey: 'feeder_id',
    cardinality: 'Har nimstansiyada bir nechta fider; tumanda o’nlab',
    delivery: 'Statik — bir marta. Soatlik bosh hisoblagich — uzluksiz. Balans (kwh_in, TP yig’indisi, yo’qotish) — kunlik/oylik.',
  },
  sections: [
    { title: 'A. STATIK / PASPORT', rows: [
      F('Fider ID', 'feeder_id', '—', 'Statik', 'int/text', 'Registr', 'y', 'Yuqori', 'Barqaror unikal ID'),
      F('Fider nomi / kodi', 'feeder_code, name', '—', 'Statik', 'text', 'Registr', 'y', 'Yuqori', '«Xaqulobod», «Kamoliy»'),
      F('Ona nimstansiya', 'substation_id', '—', 'Statik', 'FK', 'Registr', 'y', 'Yuqori', 'Qaysi nimstansiyadan chiqadi (bog’lash kaliti)'),
      F('Kirish nomi', 'input_name', '—', 'Statik', 'text', 'Registr', 'y', 'O’rta', '«ВВОД Т2 40 000 кВА»'),
      F('Kuchlanish', 'voltage_kv', 'kV', 'Statik', 'number', 'Registr', 'y', 'Yuqori', '10 yoki 6'),
      F('Nominal tok', 'rated_current_a', 'A', 'Statik', 'number', 'Registr', 'p', 'Past', ''),
      F('Bosh hisoblagich raqami', 'head_meter_no', '—', 'Statik', 'text', 'АСКУЭ', 'y', 'O’rta', ''),
      F('Hisoblagich koeffitsienti', 'meter_coef', '—', 'Statik', 'number', 'АСКУЭ', 'y', 'Yuqori', 'kWh = (curr−prev)×coef. Balans uchun majburiy.'),
      F('Liniya uzunligi', 'length_km', 'km', 'Statik', 'number', 'GIS', 'p', 'O’rta', 'Pasport 4-qatori (tarmoq uzunligi)'),
      F('TP lar soni', 'tp_count', 'ta', 'Statik', 'int', 'Registr', 'y', 'Yuqori', ''),
      F('Iste’molchilar soni', 'consumer_count', 'ta', 'Statik/Oylik', 'int', 'Billing', 'y', 'Yuqori', ''),
      F('Mas’ul shaxs', 'responsible_name, phone', '—', 'Statik', 'text', 'Registr', 'p', 'Past', 'Dashboarddagi «Mas’ul» paneli'),
      F('Ishga tushgan sana', 'commissioned_on', 'sana', 'Statik', 'date', 'Registr', 'p', 'Past', ''),
      F('Holati', 'status', '—', 'Statik', 'enum', 'Registr', 'y', 'O’rta', 'ishlayapti / o’chirilgan'),
    ] },
    { title: 'B. SOATLIK (АСКУЭ bosh hisoblagich + SCADA) — ASOSIY MAQSAD', rows: [
      F('Vaqt belgisi (soat)', 'ts', 'ISO 8601', 'Soatlik', 'timestamp', 'АСКУЭ', 'y', 'Yuqori', 'Soatlik profil'),
      F('Fiderga kirgan energiya', 'energy_in_kwh', 'kWh', 'Soatlik', 'number', 'АСКУЭ', 'y', 'Yuqori', 'Hozirgi oylik kwh_in ning soatlik varianti'),
      F('Hisoblagich ko’rsatkichi', 'meter_reading', 'kWh', 'Soatlik', 'number', 'АСКУЭ', 'y', 'O’rta', 'Kumulyativ registr + koeffitsient'),
      F('Aktiv quvvat P', 'active_power_kw', 'kW', 'Soatlik', 'number', 'SCADA/АСКУЭ', 'y', 'Yuqori', 'Yuklanma'),
      F('Reaktiv quvvat Q', 'reactive_power_kvar', 'kVAr', 'Soatlik', 'number', 'SCADA/АСКУЭ', 'p', 'O’rta', ''),
      F('Quvvat koeffitsienti', 'power_factor', 'cosφ', 'Soatlik', 'number', 'SCADA', 'p', 'Past', ''),
      F('Tok (fazalar)', 'current_a', 'A', 'Soatlik', 'number', 'SCADA', 'p', 'O’rta', 'Ia / Ib / Ic'),
      F('Kuchlanish', 'voltage_v', 'V/kV', 'Soatlik', 'number', 'SCADA/АСКУЭ', 'y', 'Yuqori', '10 kV shina kuchlanishi'),
      F('Yuklanish darajasi', 'load_pct', '%', 'Soatlik', 'number', 'hisob', 'y', 'O’rta', ''),
      F('Holati (yoniq/o’chiq)', 'status', '—', 'Soatlik/Hodisa', 'enum', 'SCADA', 'p', 'O’rta', 'Uzilishni aniqlash'),
    ] },
    { title: 'C. KUNLIK / OYLIK BALANS (dashboardning yuragi)', rows: [
      F('Kirgan energiya', 'kwh_in', 'kWh', 'Kunlik/Oylik', 'number', 'АСКУЭ', 'y', 'Yuqori', 'Fider balansi kirim tomoni'),
      F('TP lar o’lchagani yig’indisi', 'kwh_tp_sum', 'kWh', 'Oylik', 'number', 'АСКУЭ/hisob', 'p', 'Yuqori', 'Barcha TP hisoblagichlari yig’indisi — sotilganning tekshiriladigan qiymati'),
      F('Texnologik yo’qotish', 'kwh_tech_loss', 'kWh', 'Oylik', 'number', 'hisob', 'p', 'Yuqori', 'Kirgan energiyaning normativ ~12% i (yoki transformator Pxx/Pkz asosida)'),
      F('Tijoriy yo’qotish', 'kwh_commercial_loss', 'kWh', 'Oylik', 'number', 'hisob', 'p', 'Yuqori', 'Qoldiq: kirgan − sotilgan − texnologik'),
      F('Yo’qotish foizi', 'loss_pct', '%', 'Kunlik/Oylik', 'number', 'hisob', 'y', 'Yuqori', '100×(kirgan−sotilgan)/kirgan'),
      F('Pik / o’rtacha yuklanma', 'peak_load_kw, avg_load_kw', 'kW', 'Kunlik', 'number', 'SCADA/hisob', 'y', 'O’rta', ''),
      F('Max / min / o’rtacha kuchlanish', 'v_max, v_min, v_avg', 'V', 'Kunlik', 'number', 'SCADA', 'p', 'O’rta', 'Kuchlanish sifati'),
      F('Uzilishlar soni / davomiyligi', 'outage_count, outage_minutes', 'ta / min', 'Kunlik', 'int', 'SCADA', 'p', 'O’rta', ''),
    ] },
  ],
  sample: {
    note: 'Soatlik fider bosh hisoblagichi namunasi:',
    columns: ['feeder_id', 'ts', 'energy_in_kwh', 'active_power_kw', 'voltage_v', 'load_pct'],
    rows: [
      ['FDR-XAQULOBOD', '2026-08-07T00:00:00+05:00', 1180, 1140, 10250, 44],
      ['FDR-XAQULOBOD', '2026-08-07T01:00:00+05:00', 1090, 1055, 10310, 41],
      ['FDR-XAQULOBOD', '2026-08-07T19:00:00+05:00', 2260, 2210, 9820, 85],
      ['FDR-XAQULOBOD', '2026-08-07T20:00:00+05:00', 2340, 2290, 9760, 88],
    ],
  },
});

// ═══ 03. TP ══════════════════════════════════════════════════════════════════
FILES.push({
  id: '03',
  file: '03_TP.xlsx',
  title: 'TP (TRANSFORMATOR PUNKTI) — ma’lumot so’rovi',
  entity: 'TP — taqsimlash punkti (10/0.4 yoki 6/0.4 kV, KTP/MTP)',
  info: {
    what: '10 kV ni 0.4 kV ga tushiruvchi taqsimlash punkti. Odatda bitta transformatorli. Fiderda o’nlab TP bor (hozirgi tizimda 51 ta). MUHIM CHEKLOV: TP larning FAQAT BIR QISMIDA balans hisoblagichi ishlaydi — soatlik/kunlik yo’qotish faqat o’sha TP lar uchun mavjud. has_balance_meter maydoni buni belgilaydi.',
    parent: 'Fider (feeder_id)',
    children: 'Transformator, Abonent hisoblagichi',
    idKey: 'tp_id (kod: TP-001 …)',
    cardinality: 'Har fiderda o’nlab TP',
    delivery: 'Statik/pasport — bir marta. Balans hisoblagichi bo’lsa — soatlik/kunlik. Iste’molchi kesimi — oylik.',
  },
  sections: [
    { title: 'A. STATIK / PASPORT', rows: [
      F('TP ID', 'tp_id', '—', 'Statik', 'int/text', 'Registr', 'y', 'Yuqori', 'Barqaror unikal ID'),
      F('TP kodi', 'tp_code', '—', 'Statik', 'text', 'Registr', 'y', 'Yuqori', '«TP-001»'),
      F('Ona fider', 'feeder_id', '—', 'Statik', 'FK', 'Registr', 'y', 'Yuqori', 'Bog’lash kaliti'),
      F('Bobo nimstansiya', 'substation_id', '—', 'Statik', 'FK', 'Registr', 'p', 'Past', 'Ixtiyoriy denormalizatsiya'),
      F('Nomi / manzil (MFY)', 'name, address', '—', 'Statik', 'text', 'Registr', 'p', 'O’rta', ''),
      F('Kuchlanish klassi', 'voltage_class', 'kV', 'Statik', 'text', 'Registr', 'y', 'Yuqori', '«10/0.4», «6/0.4»'),
      F('Nominal quvvat', 'rated_kva', 'kVA', 'Statik', 'number', 'Registr', 'p', 'Yuqori', 'HOZIR YO’Q — kerak. Yuklanish % ni shusiz hisoblab bo’lmaydi.'),
      F('Transformatorlar soni', 'transformer_count', 'ta', 'Statik', 'int', 'Registr', 'y', 'O’rta', 'Odatda 1'),
      F('TP turi', 'tp_type', '—', 'Statik', 'enum', 'Registr', 'p', 'Past', 'KTP / MTP / GTP / ustunli'),
      F('Balans hisoblagichi bormi', 'has_balance_meter', '—', 'Statik', 'bool', 'Registr/АСКУЭ', 'y', 'Yuqori', 'KALIT: soatlik/kunlik yo’qotish shunga bog’liq'),
      F('Balans hisoblagich raqami', 'balance_meter_no', '—', 'Statik', 'text', 'АСКУЭ', 'p', 'O’rta', ''),
      F('Hisoblagich koeffitsienti', 'meter_coef', '—', 'Statik', 'number', 'АСКУЭ', 'p', 'O’rta', ''),
      F('O’rtacha masofa (iste’molchigacha)', 'avg_distance_m', 'm', 'Statik', 'number', 'GIS/o’lchov', 'n', 'Past', 'Pasport normasi ≤300 m. Aniq o’lchov/GIS kerak — odatda mavjud emas.'),
      F('Iste’molchilar soni', 'consumer_count', 'ta', 'Statik/Oylik', 'int', 'Billing', 'y', 'O’rta', ''),
      F('Koordinatalar', 'lat, lon', 'geo', 'Statik', 'number', 'GIS', 'p', 'Past', ''),
    ] },
    { title: 'B. SOATLIK (balans hisoblagichi — FAQAT jihozlangan TP)', rows: [
      F('Vaqt belgisi (soat)', 'ts', 'ISO 8601', 'Soatlik', 'timestamp', 'АСКУЭ', 'p', 'Yuqori', 'Faqat has_balance_meter=true TP lar'),
      F('Balans hisoblagichi (soatlik)', 'energy_kwh', 'kWh', 'Soatlik', 'number', 'АСКУЭ', 'p', 'Yuqori', 'TP ga kirgan energiya'),
      F('Aktiv quvvat P (yuklanma)', 'active_power_kw', 'kW', 'Soatlik', 'number', 'АСКУЭ', 'p', 'Yuqori', 'Dashboarddagi TP yuklanmasi'),
      F('Reaktiv quvvat Q', 'reactive_power_kvar', 'kVAr', 'Soatlik', 'number', 'АСКУЭ', 'p', 'Past', ''),
      F('Quvvat koeffitsienti', 'power_factor', 'cosφ', 'Soatlik', 'number', 'АСКУЭ', 'p', 'Past', ''),
      F('Tok (fazalar)', 'current_a', 'A', 'Soatlik', 'number', 'АСКУЭ', 'p', 'O’rta', 'Ia/Ib/Ic — 0.4 kV fazalar nomutanosibligi'),
      F('Kuchlanish (fazalar)', 'voltage_v', 'V', 'Soatlik', 'number', 'АСКУЭ', 'p', 'O’rta', 'Ua/Ub/Uc — 0.4 kV kuchlanish sifati'),
      F('Yuklanish darajasi', 'load_pct', '%', 'Soatlik', 'number', 'hisob', 'p', 'Yuqori', 'rated_kva ga nisbatan'),
      F('Holati (yoniq/o’chiq)', 'status', '—', 'Soatlik/Hodisa', 'enum', 'АСКУЭ', 'p', 'O’rta', ''),
    ] },
    { title: 'C. KUNLIK (yuklanma va chiziqli yo’qotish)', rows: [
      F('Sutkalik max/min yuklanma', 'max_load_kw, min_load_kw', 'kW', 'Kunlik', 'number', 'АСКУЭ', 'p', 'O’rta', 'Hozir tp_reading_daily'),
      F('O’rtacha kuchlanish', 'avg_voltage_v', 'V', 'Kunlik', 'number', 'АСКУЭ', 'p', 'O’rta', ''),
      F('Uzilishlar soni / davomiyligi', 'outage_count, outage_minutes', 'ta / min', 'Kunlik', 'int', 'АСКУЭ/SCADA', 'p', 'O’rta', ''),
      F('Balans hisoblagichi (kunlik)', 'kwh_balance_meter', 'kWh', 'Kunlik', 'number', 'АСКУЭ', 'p', 'Yuqori', 'Hozir tp_loss_daily'),
      F('Biriktirilgan iste’molchilar (kunlik)', 'kwh_consumers_attached', 'kWh', 'Kunlik', 'number', 'АСКУЭ/Billing', 'p', 'Yuqori', 'TP ga ulangan hisoblagichlar yig’indisi'),
      F('Chiziqli yo’qotish / foizi', 'kwh_loss, loss_pct', 'kWh / %', 'Kunlik', 'number', 'hisob', 'p', 'Yuqori', 'balans − iste’molchilar. MANFIY = anomaliya signali (taqiqlanmaydi).'),
    ] },
    { title: 'D. OYLIK (iste’molchi kesimi va holat — tp_monthly / tp_status)', rows: [
      F('Iste’molchilar (jami/faol/uzilgan)', 'consumers_total, active, disconnected', 'ta', 'Oylik', 'int', 'Billing', 'y', 'Yuqori', 'Dashboarddagi TP jadvali'),
      F('Ko’rsatkichlar (oldingi/joriy)', 'reading_prev, reading_curr', 'kWh', 'Oylik', 'number', 'АСКУЭ/Billing', 'p', 'O’rta', ''),
      F('Oylik iste’mol', 'kwh_month', 'kWh', 'Oylik', 'number', 'Billing', 'y', 'Yuqori', ''),
      F('Oylik o’rtacha yuklanish', 'load_pct', '%', 'Oylik', 'number', 'hisob', 'p', 'O’rta', ''),
      F('Pik quvvat', 'peak_kva', 'kVA', 'Oylik', 'number', 'АСКУЭ', 'p', 'O’rta', ''),
      F('Texnik holati', 'condition', '—', 'Oylik', 'enum', 'Qo’lda', 'n', 'O’rta', 'GOOD/ATTENTION/OVERLOAD/FAULT — qo’lda baholanadi, telemetriyadan avto EMAS.'),
      F('Kam yuklangan', 'under_load', '—', 'Oylik', 'bool', 'Qo’lda/hisob', 'p', 'Past', ''),
      F('Ta’mir kerak', 'repair_needed', '—', 'Oylik', 'bool', 'Qo’lda', 'n', 'O’rta', 'Pasport 11-qatori — qo’lda kiritiladi'),
    ] },
  ],
  sample: {
    note: 'TP balans hisoblagichi soatlik namunasi (faqat jihozlangan TP):',
    columns: ['tp_id', 'ts', 'energy_kwh', 'active_power_kw', 'load_pct', 'voltage_v'],
    rows: [
      ['TP-014', '2026-08-07T19:00:00+05:00', 268, 262, 66, 231],
      ['TP-014', '2026-08-07T20:00:00+05:00', 279, 274, 69, 228],
      ['TP-037', '2026-08-07T19:00:00+05:00', 141, 138, 55, 235],
      ['TP-037', '2026-08-07T20:00:00+05:00', 149, 146, 58, 233],
    ],
  },
});

// ═══ 04. TRANSFORMATOR ═══════════════════════════════════════════════════════
FILES.push({
  id: '04',
  file: '04_TRANSFORMATOR.xlsx',
  title: 'TRANSFORMATOR — ma’lumot so’rovi',
  entity: 'Kuch / taqsimlash transformatori (fizik qurilma)',
  info: {
    what: 'Fizik transformator qurilmasi. Nimstansiyada kuch transformatori (35/10), TP da taqsimlash transformatori (10/0.4). Zavod (pasport) ma’lumotlari — ayniqsa salt yurish (Pxx) va qisqa tutashuv (Pkz) yo’qotishlari — texnik yo’qotishni ANIQ hisoblash uchun muhim. Soatlik telemetriya asosan yirik (nimstansiya) transformatorlarda bor; TP transformatorida odatda yo’q.',
    parent: 'Podstansiya YOKI TP (parent_type + parent_id)',
    children: '—',
    idKey: 'transformer_id',
    cardinality: 'Nimstansiyada 1–3; har TP da odatda 1',
    delivery: 'Pasport — bir marta (registrdan). Telemetriya — faqat monitoring qilinadigan qurilmalar uchun.',
  },
  sections: [
    { title: 'A. STATIK / PASPORT (zavod ma’lumoti)', rows: [
      F('Transformator ID', 'transformer_id', '—', 'Statik', 'int/text', 'Registr', 'y', 'Yuqori', ''),
      F('Egalik turi', 'parent_type', '—', 'Statik', 'enum', 'Registr', 'y', 'Yuqori', 'SUBSTATION / TP'),
      F('Ega ID', 'parent_id', '—', 'Statik', 'FK', 'Registr', 'y', 'Yuqori', 'substation_id yoki tp_id'),
      F('Zavod / inventar raqami', 'serial_no, inventory_no', '—', 'Statik', 'text', 'Registr', 'p', 'O’rta', ''),
      F('Rusumi', 'model', '—', 'Statik', 'text', 'Registr', 'p', 'O’rta', '«ТМ-400/10», «ТМГ-630»'),
      F('Nominal quvvat', 'rated_kva', 'kVA', 'Statik', 'number', 'Registr', 'y', 'Yuqori', 'Yuklanish % va quvvat zaxirasi uchun'),
      F('Kuchlanish (YuK/PK)', 'voltage_hv_kv, voltage_lv_kv', 'kV', 'Statik', 'number', 'Registr', 'y', 'Yuqori', '35/10 yoki 10/0.4'),
      F('Ulanish guruhi', 'vector_group', '—', 'Statik', 'text', 'Registr', 'p', 'Past', '«Yzn», «Dyn11»'),
      F('Ishlab chiqaruvchi', 'manufacturer', '—', 'Statik', 'text', 'Registr', 'p', 'Past', ''),
      F('Ishlab chiqarilgan yili', 'year_made', 'yil', 'Statik', 'int', 'Registr', 'p', 'Past', 'Eskirish tahlili'),
      F('O’rnatilgan sana', 'commissioned_on', 'sana', 'Statik', 'date', 'Registr', 'p', 'Past', ''),
      F('Salt yurish yo’qotishi (Pxx)', 'no_load_loss_kw', 'kW', 'Statik', 'number', 'Registr/pasport', 'p', 'O’rta', 'TEMIR yo’qotish (doimiy). Texnik yo’qotishni aniq hisoblash uchun.'),
      F('Qisqa tutashuv yo’qotishi (Pkz)', 'load_loss_kw', 'kW', 'Statik', 'number', 'Registr/pasport', 'p', 'O’rta', 'MIS yo’qotish (yuklanma² ga proportsional)'),
      F('Qisqa tutashuv kuchlanishi (Uk)', 'impedance_pct', '%', 'Statik', 'number', 'Registr/pasport', 'p', 'Past', ''),
      F('Sovitish turi', 'cooling_type', '—', 'Statik', 'text', 'Registr', 'p', 'Past', 'ONAN va h.k.'),
      F('Holati', 'status', '—', 'Statik', 'enum', 'Registr', 'y', 'O’rta', 'ishlaydi / zaxira / nosoz'),
    ] },
    { title: 'B. SOATLIK (asosan nimstansiya transformatorlari monitoringi)', rows: [
      F('Vaqt belgisi (soat)', 'ts', 'ISO 8601', 'Soatlik', 'timestamp', 'SCADA/RTU', 'p', 'O’rta', ''),
      F('Yuklanma (kVA / %)', 'load_kva, load_pct', 'kVA / %', 'Soatlik', 'number', 'SCADA', 'p', 'Yuqori', ''),
      F('Aktiv quvvat P', 'active_power_kw', 'kW', 'Soatlik', 'number', 'SCADA', 'p', 'O’rta', ''),
      F('Tok', 'current_a', 'A', 'Soatlik', 'number', 'SCADA', 'p', 'Past', ''),
      F('Moy harorati', 'oil_temperature_c', '°C', 'Soatlik', 'number', 'RTU', 'n', 'Past', 'Faqat yirik transformatorlarda datchik bor; TP da YO’Q.'),
      F('Chulg’am harorati', 'winding_temperature_c', '°C', 'Soatlik', 'number', 'RTU', 'n', 'Past', 'Juda kam holatda'),
      F('RPN pog’onasi', 'tap_position', '—', 'Soatlik/Hodisa', 'int', 'SCADA', 'n', 'Past', 'Faqat RPN li transformatorlarda'),
    ] },
    { title: 'C. KUNLIK / OYLIK', rows: [
      F('Pik yuklanma', 'peak_load_kva', 'kVA', 'Kunlik/Oylik', 'number', 'SCADA/hisob', 'p', 'O’rta', ''),
      F('Foydalanish darajasi', 'utilization_pct', '%', 'Oylik', 'number', 'hisob', 'p', 'O’rta', ''),
      F('O’tkazilgan energiya', 'energy_throughput_kwh', 'kWh', 'Oylik', 'number', 'АСКУЭ', 'p', 'O’rta', ''),
      F('Hisoblangan yo’qotish', 'estimated_loss_kwh', 'kWh', 'Oylik', 'number', 'hisob', 'p', 'O’rta', 'Pxx×soat + Pkz×(yuklanma)²'),
    ] },
  ],
});

// ═══ 05. ABONENT HISOBLAGICHI ════════════════════════════════════════════════
FILES.push({
  id: '05',
  file: '05_ABONENT_HISOBLAGICHI.xlsx',
  title: 'ABONENT HISOBLAGICHI — ma’lumot so’rovi',
  entity: 'Iste’molchi hisoblagichi (elektr hisoblagich)',
  info: {
    what: 'Har bir iste’molchida o’rnatilgan hisoblagich. SOATLIK ISTE’MOL ayni shu yerdan keladi — lekin FAQAT aqlli / АСКУЭ ga ulangan hisoblagichlardan. Oddiy (aqlli bo’lmagan) hisoblagichdan faqat oylik ko’rsatkich olinadi. is_smart/is_amr maydoni har bir hisoblagich uchun buni belgilaydi.',
    parent: 'Iste’molchi (consumer_id), TP (tp_id)',
    children: '—',
    idKey: 'meter_id (zavod raqami: meter_no)',
    cardinality: 'Har iste’molchida 1 (ba’zan ko’p)',
    delivery: 'Registr — bir marta. Aqlli hisoblagich — soatlik profil. Aks holda — oylik ko’rsatkich (billing).',
  },
  sections: [
    { title: 'A. STATIK / REGISTR', rows: [
      F('Hisoblagich ID', 'meter_id', '—', 'Statik', 'int/text', 'Registr', 'y', 'Yuqori', ''),
      F('Zavod raqami', 'meter_no', '—', 'Statik', 'text', 'Registr/АСКУЭ', 'y', 'Yuqori', ''),
      F('Egasi (iste’molchi)', 'consumer_id', '—', 'Statik', 'FK', 'Billing', 'y', 'Yuqori', 'Bog’lash kaliti'),
      F('Qaysi TP oziqlantiradi', 'tp_id', '—', 'Statik', 'FK', 'Registr', 'y', 'Yuqori', 'Pasport «biriktirilgan iste’molchilar» va TP yo’qotishi uchun'),
      F('Fider', 'feeder_id', '—', 'Statik', 'FK', 'Registr', 'p', 'O’rta', ''),
      F('Rusumi', 'model', '—', 'Statik', 'text', 'Registr', 'p', 'Past', '«Mercury 230», «ЭЭ8005»'),
      F('Faza turi', 'phase_type', '—', 'Statik', 'enum', 'Registr', 'p', 'Past', '1 yoki 3 fazali'),
      F('Koeffitsient', 'meter_coef', '—', 'Statik', 'number', 'Registr', 'y', 'O’rta', 'Odatda 1'),
      F('Aniqlik klassi', 'accuracy_class', '—', 'Statik', 'number', 'Registr', 'p', 'Past', '1.0 / 2.0'),
      F('Aqlli / АСКУЭ ulangan', 'is_smart, is_amr', '—', 'Statik', 'bool', 'АСКУЭ', 'y', 'Yuqori', 'KALIT: soatlik profil faqat shu hisoblagichlardan'),
      F('Tarif turi', 'tariff_type', '—', 'Statik', 'enum', 'Billing', 'y', 'Past', 'bir zonali / ko’p zonali (kunduzgi-tungi)'),
      F('O’rnatilgan sana', 'installed_on', 'sana', 'Statik', 'date', 'Registr', 'p', 'Past', ''),
      F('Keyingi tekshiruv (kalibrovka)', 'verification_next', 'sana', 'Statik', 'date', 'Registr', 'p', 'O’rta', 'Pasport 13-qator — almashtirish kerak'),
      F('Holati', 'status', '—', 'Statik/Oylik', 'enum', 'АСКУЭ/Billing', 'y', 'Yuqori', 'ishlaydi / aloqasiz / nosoz / olib tashlangan — pasport 6-qator'),
    ] },
    { title: 'B. SOATLIK (aqlli hisoblagich / АСКУЭ) — ASOSIY MAQSAD', rows: [
      F('Vaqt belgisi (soat)', 'ts', 'ISO 8601', 'Soatlik', 'timestamp', 'АСКУЭ', 'p', 'Yuqori', 'Faqat aqlli hisoblagichlar'),
      F('Soatlik iste’mol', 'energy_kwh', 'kWh', 'Soatlik', 'number', 'АСКУЭ', 'p', 'Yuqori', 'Soatlik iste’mol profili'),
      F('Ko’rsatkich (kumulyativ)', 'register_reading', 'kWh', 'Soatlik', 'number', 'АСКУЭ', 'p', 'O’rta', ''),
      F('Aktiv quvvat P', 'active_power_kw', 'kW', 'Soatlik', 'number', 'АСКУЭ', 'p', 'O’rta', ''),
      F('Kuchlanish', 'voltage_v', 'V', 'Soatlik', 'number', 'АСКУЭ', 'p', 'O’rta', 'Iste’molchidagi kuchlanish sifati'),
      F('Tok', 'current_a', 'A', 'Soatlik', 'number', 'АСКУЭ', 'p', 'Past', ''),
      F('Kunduzgi / tungi iste’mol', 'energy_day_kwh, energy_night_kwh', 'kWh', 'Soatlik/Kunlik', 'number', 'АСКУЭ', 'p', 'Past', 'Ko’p tarifli hisoblagichlar'),
      F('Aloqa holati / oxirgi bog’lanish', 'comm_status, last_seen', '—', 'Soatlik', 'timestamp', 'АСКУЭ', 'p', 'O’rta', 'Aloqasiz hisoblagichlarni aniqlash'),
    ] },
    { title: 'C. OYLIK (billing — barcha hisoblagichlar)', rows: [
      F('Ko’rsatkich (oldingi/joriy)', 'reading_prev, reading_curr', 'kWh', 'Oylik', 'number', 'Billing', 'y', 'Yuqori', ''),
      F('Oylik iste’mol', 'kwh_month', 'kWh', 'Oylik', 'number', 'Billing', 'y', 'Yuqori', ''),
      F('Kam iste’mol (0 yoki <50 kWh)', 'is_low_consumption', '—', 'Oylik', 'bool', 'Billing/hisob', 'y', 'O’rta', 'Pasport 7-qator'),
      F('Aloqasiz kunlar', 'days_no_comm', 'kun', 'Oylik', 'int', 'АСКУЭ', 'p', 'O’rta', ''),
      F('Almashtirish kerak', 'needs_replacement', '—', 'Oylik', 'bool', 'Registr/Qo’lda', 'p', 'O’rta', 'Pasport 13-qator'),
    ] },
  ],
  sample: {
    note: 'Aqlli hisoblagich soatlik namunasi:',
    columns: ['meter_id', 'consumer_id', 'tp_id', 'ts', 'energy_kwh', 'voltage_v'],
    rows: [
      ['M-100238', 'C-55021', 'TP-014', '2026-08-07T19:00:00+05:00', 0.84, 229],
      ['M-100238', 'C-55021', 'TP-014', '2026-08-07T20:00:00+05:00', 1.12, 227],
      ['M-100239', 'C-55022', 'TP-014', '2026-08-07T19:00:00+05:00', 0.31, 231],
      ['M-100239', 'C-55022', 'TP-014', '2026-08-07T20:00:00+05:00', 0.29, 230],
    ],
  },
});

// ═══ 06. ISTE'MOLCHI ═════════════════════════════════════════════════════════
FILES.push({
  id: '06',
  file: '06_ISTEMOLCHI.xlsx',
  title: 'ISTE’MOLCHI (ABONENT) — ma’lumot so’rovi',
  entity: 'Iste’molchi / shartnoma (shaxsiy hisob)',
  info: {
    what: 'Mijoz/shartnoma (лицевой счёт). Uy xo’jaligi yoki yuridik shaxs. Billing tizimidan keladi. Dashboarddagi BARCHA iste’molchi soni, toifasi va qarzdorlik ko’rsatkichlari shu yerdan hisoblanadi. Soatlik iste’mol esa hisoblagich fayli (05) dan olinadi.',
    parent: 'TP (tp_id) / Fider (feeder_id)',
    children: 'Abonent hisoblagichi',
    idKey: 'consumer_id / account_no (shaxsiy hisob raqami)',
    cardinality: 'Tumanda o’n minglab',
    delivery: 'Registr — o’zgarganda. Iste’mol/to’lov/qarz — oylik (billing yopilganda).',
  },
  sections: [
    { title: 'A. STATIK / REGISTR', rows: [
      F('Shaxsiy hisob', 'consumer_id, account_no', '—', 'Statik', 'text', 'Billing', 'y', 'Yuqori', 'Лицевой счёт. Barqaror kalit.'),
      F('F.I.Sh / tashkilot nomi', 'name', '—', 'Statik', 'text', 'Billing', 'y', 'O’rta', 'Maxfiylik: ehtiyojga qarab niqoblanishi mumkin'),
      F('Toifa', 'category', '—', 'Statik', 'enum', 'Billing', 'y', 'Yuqori', 'POPULATION / LEGAL / BUDGET — qarzdorlik va iste’molchi kesimi'),
      F('Kichik toifa', 'subcategory', '—', 'Statik', 'text', 'Billing', 'p', 'Past', 'uy / qishloq xo’jaligi / sanoat / budjet'),
      F('Manzil / MFY', 'address, mfy', '—', 'Statik', 'text', 'Billing', 'y', 'O’rta', ''),
      F('Biriktirilgan TP / fider', 'tp_id, feeder_id', '—', 'Statik', 'FK', 'Registr', 'y', 'Yuqori', 'TP yo’qotishini hisoblash uchun majburiy'),
      F('Hisoblagichi', 'meter_id', '—', 'Statik', 'FK', 'Registr', 'y', 'O’rta', ''),
      F('Shartnoma quvvati', 'contract_power_kw', 'kW', 'Statik', 'number', 'Billing', 'p', 'Past', ''),
      F('Tarif kodi', 'tariff_code', '—', 'Statik', 'text', 'Billing', 'p', 'Past', ''),
      F('Ulanish holati', 'connection_status', '—', 'Statik/Oylik', 'enum', 'Billing', 'y', 'Yuqori', 'active / disconnected — «aloqada / aloqada emas»'),
      F('Ulangan / uzilgan sana', 'connected_on, disconnected_on', 'sana', 'Statik', 'date', 'Billing', 'y', 'O’rta', 'Oqim ko’rsatkichlari uchun'),
    ] },
    { title: 'B. OYLIK / BILLING', rows: [
      F('Oylik iste’mol', 'kwh_month', 'kWh', 'Oylik', 'number', 'Billing', 'y', 'Yuqori', ''),
      F('Hisoblangan summa', 'amount_charged', 'so’m', 'Oylik', 'number', 'Billing', 'y', 'O’rta', ''),
      F('To’langan summa', 'amount_paid', 'so’m', 'Oylik', 'number', 'Billing', 'y', 'O’rta', ''),
      F('Qarzdorlik', 'debt_total', 'so’m', 'Oylik', 'number', 'Billing', 'y', 'Yuqori', 'Dashboard mln so’m da yig’adi — pasport 5-qator'),
      F('Qarz oylari soni', 'debt_months', 'oy', 'Oylik', 'int', 'Billing', 'p', 'O’rta', ''),
      F('Yangi ulangan (davr ichida)', 'is_new', '—', 'Oylik', 'bool', 'Billing', 'y', 'O’rta', 'consumers_new (oqim)'),
      F('Davr ichida uzilgan', 'is_disconnected_new', '—', 'Oylik', 'bool', 'Billing', 'y', 'O’rta', 'consumers_disconnected_new (oqim)'),
      F('Oxirgi to’lov sanasi', 'last_payment_date', 'sana', 'Oylik', 'date', 'Billing', 'p', 'Past', ''),
    ] },
    { title: 'C. AGREGAT (dashboard bevosita ishlatadi — yig’indi qiymatlar)', rows: [
      F('Iste’molchilar (jami/aholi/yuridik/budjet)', 'consumers_total, population, legal, budget', 'ta', 'Oylik', 'int', 'Billing', 'y', 'Yuqori', 'KPI plitkalari va pasport 1-qator'),
      F('Faol / uzilgan / yangi / uzilgan-yangi', 'consumers_active, disconnected, new, disconnected_new', 'ta', 'Oylik', 'int', 'Billing', 'y', 'Yuqori', ''),
      F('Qarzdorlik (toifalar bo’yicha)', 'debt_population_mln, debt_legal_mln, debt_budget_mln', 'mln so’m', 'Oylik', 'number', 'Billing', 'y', 'Yuqori', 'Qarzdorlik doiraviy diagrammasi'),
      F('Top qarzdorlar', 'top_debtors[]', '—', 'Oylik', 'list', 'Billing', 'y', 'O’rta', 'Ism, toifa, summa (mln so’m) — 08-faylga qarang'),
    ] },
  ],
});

// ═══ 07. TARMOQ LINIYALARI ═══════════════════════════════════════════════════
FILES.push({
  id: '07',
  file: '07_TARMOQ_LINIYALARI.xlsx',
  title: 'TARMOQ LINIYALARI — ma’lumot so’rovi',
  entity: 'Elektr tarmog’i segmentlari (havo / kabel liniyalar)',
  info: {
    what: 'Nimstansiyalararo, fider bo’ylab va TP dan keyingi 0.4 kV tarmoqlar. GIS/registrdan keladi. SOATLIK EMAS — statik topologiya + davriy nuqson/ta’mir hisoboti. Pasportning 4-qatori (tarmoq uzunligi), 9-qatori (daraxtlardan tozalash) va 12-qatori (ta’mir kerak bo’lgan tarmoq) manbasi.',
    parent: 'Fider / TP / MFY',
    children: '—',
    idKey: 'segment_id',
    cardinality: 'Ko’p; kuchlanish darajasi bo’yicha guruhlanadi',
    delivery: 'Statik/GIS — o’zgarganda. Nuqson/ta’mir — oylik yoki hodisa.',
  },
  sections: [
    { title: 'A. STATIK / GIS', rows: [
      F('Segment ID', 'segment_id', '—', 'Statik', 'int/text', 'GIS', 'p', 'Yuqori', ''),
      F('Tegishliligi', 'feeder_id, tp_id, mfy', '—', 'Statik', 'FK', 'GIS/Registr', 'p', 'Yuqori', ''),
      F('Kuchlanish', 'voltage_kv', 'kV', 'Statik', 'number', 'GIS', 'y', 'Yuqori', '0.4 / 6 / 10 / 35'),
      F('Liniya turi', 'line_type', '—', 'Statik', 'enum', 'GIS', 'y', 'Yuqori', 'havo (overhead) / kabel (cable)'),
      F('Uzunlik', 'length_km', 'km', 'Statik', 'number', 'GIS', 'p', 'Yuqori', 'Pasport 4-qatori. Registr bo’lsa — bor; GIS bo’lmasa — qo’lda.'),
      F('Sim rusumi / kesimi', 'conductor, cross_section', '— / mm²', 'Statik', 'text', 'GIS', 'p', 'Past', '«AC-50»'),
      F('Tayanch (opora) soni', 'support_count', 'ta', 'Statik', 'int', 'GIS', 'p', 'Past', ''),
      F('O’rnatilgan sana', 'installed_on', 'sana', 'Statik', 'date', 'Registr', 'p', 'Past', ''),
      F('Holati', 'condition', '—', 'Statik', 'enum', 'Qo’lda', 'p', 'O’rta', ''),
    ] },
    { title: 'B. DAVRIY (nuqson / ta’mir)', rows: [
      F('Ta’mir kerak (uzunlik)', 'repair_needed_km', 'km', 'Oylik', 'number', 'Qo’lda', 'p', 'O’rta', 'Pasport 12-qatori'),
      F('Ta’mirlangan (uzunlik)', 'repaired_km', 'km', 'Oylik', 'number', 'Qo’lda', 'p', 'O’rta', ''),
      F('Qolgan (backlog)', 'backlog_km', 'km', 'Oylik', 'number', 'hisob', 'p', 'O’rta', 'repair_needed − repaired'),
      F('Daraxtlardan tozalash', 'tree_clearing_km', 'km', 'Oylik', 'number', 'Qo’lda', 'p', 'Past', 'Pasport 9-qatori (ishlar orqali)'),
    ] },
  ],
});

// ═══ 08. MA'MURIY / OPERATSION ═══════════════════════════════════════════════
FILES.push({
  id: '08',
  file: '08_MAMURIY_operatsion.xlsx',
  title: 'MA’MURIY / OPERATSION — ma’lumot so’rovi',
  entity: 'Qarzdorlar, dalolatnomalar, ishlar, uzilishlar',
  info: {
    what: 'Ma’muriy va operatsion yozuvlar: top qarzdorlar, qoidabuzarlik dalolatnomalari, ta’mir/qurilish ishlari va uzilish hodisalari. SOATLIK EMAS — hodisa yoki oylik. Dashboarddagi qarzdorlik, dalolatnoma, ishlar (natijadorlik) va ishonchlilik panellarini oziqlantiradi.',
    parent: 'MFY / Fider / TP / Iste’molchi',
    children: '—',
    idKey: 'har bo’lim uchun alohida (rank / act_no / work_id / outage_id)',
    cardinality: 'Hodisaga bog’liq',
    delivery: 'Hodisa yuz berganda yoki oylik hisobotda.',
  },
  sections: [
    { title: 'A. TOP QARZDORLAR', rows: [
      F('O’rin', 'rank', '—', 'Oylik', 'int', 'Billing', 'y', 'O’rta', '1–20'),
      F('Qarzdor nomi', 'debtor_name', '—', 'Oylik', 'text', 'Billing', 'y', 'O’rta', ''),
      F('Toifa', 'category', '—', 'Oylik', 'enum', 'Billing', 'y', 'O’rta', 'POPULATION / LEGAL / BUDGET'),
      F('Qarz summasi', 'amount_mln', 'mln so’m', 'Oylik', 'number', 'Billing', 'y', 'O’rta', ''),
      F('MFY / TP', 'mfy, tp_code', '—', 'Oylik', 'text', 'Billing', 'y', 'Past', ''),
    ] },
    { title: 'B. DALOLATNOMALAR (qoidabuzarlik)', rows: [
      F('Dalolatnoma raqami', 'act_no', '—', 'Hodisa', 'text', 'Reyd/hujjat', 'y', 'O’rta', ''),
      F('Sanasi', 'act_date', 'sana', 'Hodisa', 'date', 'Reyd/hujjat', 'y', 'O’rta', ''),
      F('MFY / TP', 'mfy_id, tp_id', '—', 'Hodisa', 'FK', 'Reyd', 'y', 'O’rta', ''),
      F('Iste’molchi', 'consumer_ref', '—', 'Hodisa', 'text', 'Reyd', 'p', 'Past', ''),
      F('Holat toifasi', 'case_type', '—', 'Hodisa', 'enum', 'Reyd', 'y', 'O’rta', 'ADMINISTRATIVE / CRIMINAL / NO_FAULT'),
      F('Aniqlangan energiya', 'kwh_identified', 'kWh', 'Hodisa', 'number', 'Reyd/hisob', 'y', 'O’rta', 'Pasport 10b — noqonuniy iste’mol'),
      F('Jarima', 'fine_mln', 'mln so’m', 'Hodisa', 'number', 'Reyd', 'y', 'O’rta', ''),
      F('Holati', 'status', '—', 'Hodisa', 'enum', 'Hujjat', 'y', 'Past', 'DRAFT / ISSUED / PAID / COURT / CLOSED'),
    ] },
    { title: 'C. ISHLAR (ta’mir / qurilish)', rows: [
      F('Ish turi', 'work_type', '—', 'Hodisa', 'enum', 'Ichki', 'y', 'O’rta', 'CABLE_REPLACEMENT / TP_INSTALL / TP_MODERNIZATION / OVERHEAD_LINE_RENEWAL / METER_REPLACEMENT / TREE_CLEARING / ILLEGAL_DISCONNECT / SUPPORT_REPLACEMENT / OTHER'),
      F('Sarlavha', 'title_uz', '—', 'Hodisa', 'text', 'Ichki', 'y', 'O’rta', ''),
      F('Holati', 'status', '—', 'Hodisa', 'enum', 'Ichki', 'y', 'O’rta', 'PLANNED / IN_PROGRESS / COMPLETED / CANCELLED'),
      F('Reja boshi / oxiri', 'planned_start, planned_end', 'sana', 'Hodisa', 'date', 'Ichki', 'y', 'Past', ''),
      F('Haqiqiy tugash', 'actual_end', 'sana', 'Hodisa', 'date', 'Ichki', 'y', 'Past', ''),
      F('Bajarilish', 'progress_pct', '%', 'Hodisa', 'int', 'Ichki', 'y', 'Past', ''),
      F('Hajmi / birligi', 'quantity, unit', '—', 'Hodisa', 'number', 'Ichki', 'y', 'Past', 'km / ta / m'),
      F('Qiymati', 'cost_mln', 'mln so’m', 'Hodisa', 'number', 'Ichki', 'p', 'Past', ''),
      F('Samara: yo’qotish (oldin/keyin)', 'effect_loss_pct_before, effect_loss_pct_after', '%', 'Hodisa', 'number', 'hisob', 'p', 'Past', 'Natijadorlik paneli'),
      F('Samara: oylik tejash', 'effect_saving_kwh_month', 'kWh', 'Hodisa', 'number', 'hisob', 'p', 'Past', ''),
    ] },
    { title: 'D. UZILISH HODISALARI (ishonchlilik — SAIDI / SAIFI)', rows: [
      F('Uzilish ID', 'outage_id', '—', 'Hodisa', 'int/text', 'SCADA/dispetcher', 'p', 'O’rta', ''),
      F('Qamrovi', 'scope', '—', 'Hodisa', 'enum', 'SCADA', 'p', 'O’rta', 'substation / feeder / tp'),
      F('Boshlanish / tugash', 'start_ts, end_ts', 'timestamp', 'Hodisa', 'timestamp', 'SCADA/dispetcher', 'p', 'O’rta', ''),
      F('Davomiyligi', 'duration_min', 'min', 'Hodisa', 'int', 'hisob', 'p', 'O’rta', ''),
      F('Sababi', 'cause', '—', 'Hodisa', 'text', 'Dispetcher', 'p', 'Past', ''),
      F('Ta’sirlangan iste’molchilar', 'affected_consumers', 'ta', 'Hodisa', 'int', 'hisob', 'p', 'O’rta', 'SAIFI hisoblash uchun'),
    ] },
  ],
});

// ─── RENDERER ─────────────────────────────────────────────────────────────────
const HEADERS = ['№', 'Ko’rsatkich', 'Maydon nomi (API)', 'Birlik', 'Davriylik', 'Turi', 'Manba tizimi', 'Olinadimi?', 'Muhimligi', 'Izoh / dashboardda ishlatilishi'];
const WIDTHS = [5, 34, 30, 11, 15, 11, 18, 12, 12, 62];

const thin = { style: 'thin', color: { argb: 'FFB8C4C0' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function styleTitle(ws, title, subtitle, meta) {
  ws.mergeCells('A1:J1');
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { bold: true, size: 15, color: { argb: 'FF' + C.titleText } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.title } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:J2');
  const s = ws.getCell('A2');
  s.value = subtitle;
  s.font = { italic: true, size: 11, color: { argb: 'FF33413E' } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  ws.mergeCells('A3:J3');
  const m = ws.getCell('A3');
  m.value = meta;
  m.font = { size: 10, color: { argb: 'FF5A6b67' } };
  m.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(3).height = 18;
}

function addHeaderRow(ws, rowNo) {
  const r = ws.getRow(rowNo);
  HEADERS.forEach((h, i) => {
    const cell = r.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10.5, color: { argb: 'FF' + C.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.header } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = border;
  });
  r.height = 30;
}

function buildFieldsSheet(wb, spec) {
  const ws = wb.addWorksheet('Maydonlar', {
    views: [{ state: 'frozen', ySplit: 5, xSplit: 2 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  styleTitle(ws, spec.title, spec.entity,
    'Davriylik ranglari: Soatlik / Kunlik / Oylik / Statik / Hodisa   •   Olinadimi: ✓ Ha  ~ Qisman  ✗ Yo’q');
  addHeaderRow(ws, 5);

  let n = 0;
  const counts = { Soatlik: 0, Kunlik: 0, Oylik: 0, Statik: 0, Hodisa: 0, y: 0, p: 0, no: 0 };

  for (const section of spec.sections) {
    const sr = ws.addRow([section.title]);
    ws.mergeCells(`A${sr.number}:J${sr.number}`);
    const sc = sr.getCell(1);
    sc.font = { bold: true, size: 11, color: { argb: 'FF1F3B4D' } };
    sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.section } };
    sc.alignment = { vertical: 'middle', indent: 1 };
    sr.height = 22;
    for (let c = 1; c <= 10; c += 1) sr.getCell(c).border = border;

    for (const row of section.rows) {
      n += 1;
      const [label, key, unit, freq, type, source, feas, priority, note] = row;
      const feasInfo = FEAS[feas];
      const dataRow = ws.addRow([n, label, key, unit, freq, type, source, feasInfo.t, priority, note]);
      dataRow.alignment = { vertical: 'top', wrapText: true };
      dataRow.font = { size: 10 };
      for (let c = 1; c <= 10; c += 1) dataRow.getCell(c).border = border;
      // zebra
      if (n % 2 === 0) {
        for (let c = 1; c <= 10; c += 1) {
          dataRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.band } };
        }
      }
      // key monospace-ish
      dataRow.getCell(3).font = { size: 9.5, color: { argb: 'FF334E45' }, name: 'Consolas' };
      dataRow.getCell(2).font = { size: 10, bold: true };
      // freq color
      const ff = FREQ_FILL[freq] || 'FFFFFF';
      dataRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ff } };
      dataRow.getCell(5).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      // feasibility color
      const fc = dataRow.getCell(8);
      fc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + feasInfo.fill } };
      fc.font = { size: 10, bold: true, color: { argb: 'FF' + feasInfo.font } };
      fc.alignment = { vertical: 'middle', horizontal: 'center' };
      // priority + unit centered
      dataRow.getCell(4).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      dataRow.getCell(9).alignment = { vertical: 'middle', horizontal: 'center' };
      dataRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

      // tally
      if (counts[freq] !== undefined) counts[freq] += 1;
      counts[feas === 'n' ? 'no' : feas] += 1;
    }
  }

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 10 } };
  return counts;
}

function buildInfoSheet(wb, spec, counts) {
  const ws = wb.addWorksheet('Ma’lumot', { pageSetup: { orientation: 'portrait' } });
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 96;

  ws.mergeCells('A1:B1');
  const t = ws.getCell('A1');
  t.value = spec.title;
  t.font = { bold: true, size: 15, color: { argb: 'FF' + C.titleText } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.title } };
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;

  const kv = [
    ['Obyekt turi', spec.entity],
    ['Ta’rifi', spec.info.what],
    ['Ota obyekt', spec.info.parent],
    ['Bola obyekt(lar)', spec.info.children],
    ['Bog’lash kaliti (ID)', spec.info.idKey],
    ['Soni (taxminan)', spec.info.cardinality],
    ['Yetkazish tartibi', spec.info.delivery],
  ];
  for (const [k, v] of kv) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true, size: 10.5, color: { argb: 'FF1F3B4D' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.section } };
    r.getCell(1).alignment = { vertical: 'top', wrapText: true, indent: 1 };
    r.getCell(2).font = { size: 10.5 };
    r.getCell(2).alignment = { vertical: 'top', wrapText: true, indent: 1 };
    r.getCell(1).border = border; r.getCell(2).border = border;
  }

  ws.addRow([]);
  const h = ws.addRow(['Qamrov', '']);
  h.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF1F3B4D' } };
  ws.mergeCells(`A${h.number}:B${h.number}`);

  const total = counts.y + counts.p + counts.no;
  const stat = [
    ['Jami maydonlar', String(total)],
    ['  ✓ Olinadi (Ha)', `${counts.y} ta`],
    ['  ~ Qisman', `${counts.p} ta`],
    ['  ✗ Olish qiyin', `${counts.no} ta`],
    ['Soatlik maydonlar', `${counts.Soatlik} ta`],
    ['Kunlik / Oylik', `${counts.Kunlik} / ${counts.Oylik} ta`],
    ['Statik / Hodisa', `${counts.Statik} / ${counts.Hodisa} ta`],
  ];
  for (const [k, v] of stat) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { size: 10.5, bold: k.indexOf(' ') !== 0 };
    r.getCell(2).font = { size: 10.5 };
    r.getCell(1).border = border; r.getCell(2).border = border;
  }
  return ws;
}

function buildSampleSheet(wb, spec) {
  if (!spec.sample) return;
  const ws = wb.addWorksheet('Namuna', { pageSetup: { orientation: 'landscape' } });
  ws.mergeCells(`A1:${String.fromCharCode(64 + spec.sample.columns.length)}1`);
  const t = ws.getCell('A1');
  t.value = spec.sample.note;
  t.font = { italic: true, size: 11, color: { argb: 'FF33413E' } };
  ws.getRow(1).height = 22;
  ws.addRow([]);

  const hr = ws.addRow(spec.sample.columns);
  hr.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FF' + C.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.header } };
    cell.alignment = { horizontal: 'center' };
    cell.border = border;
  });
  for (const row of spec.sample.rows) {
    const r = ws.addRow(row);
    r.eachCell((cell) => { cell.border = border; cell.font = { size: 10 }; });
  }
  spec.sample.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(14, c.length + 4); });
}

// Pure hisob: maydonlarni sanaydi (varaq yaratmasdan) — Info varag'i birinchi
// kelishi uchun kerak.
function tally(spec) {
  const counts = { Soatlik: 0, Kunlik: 0, Oylik: 0, Statik: 0, Hodisa: 0, y: 0, p: 0, no: 0 };
  for (const section of spec.sections) {
    for (const row of section.rows) {
      const freq = row[3];
      const feas = row[6];
      if (counts[freq] !== undefined) counts[freq] += 1;
      counts[feas === 'n' ? 'no' : feas] += 1;
    }
  }
  return counts;
}

async function buildEntityWorkbook(spec) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BEAP';
  wb.created = new Date('2026-08-07T00:00:00Z');

  const counts = tally(spec);
  buildInfoSheet(wb, spec, counts);   // 1-varaq: Ma'lumot
  buildFieldsSheet(wb, spec);         // 2-varaq: Maydonlar
  buildSampleSheet(wb, spec);         // 3-varaq: Namuna (bo'lsa)

  const path = join(OUT_DIR, spec.file);
  await wb.xlsx.writeFile(path);
  return { path, counts };
}

// ─── 00. INDEX / YO'RIQNOMA ──────────────────────────────────────────────────
async function buildIndex(summaries) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BEAP';

  // Boshlash
  const ws = wb.addWorksheet('Boshlash', { pageSetup: { orientation: 'portrait' } });
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 95;
  ws.mergeCells('A1:B1');
  const t = ws.getCell('A1');
  t.value = 'TUMAN DARAJASIDAGI API — MA’LUMOT SO’ROVI SPETSIFIKATSIYASI';
  t.font = { bold: true, size: 15, color: { argb: 'FF' + C.titleText } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.title } };
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 32;

  const intro = [
    ['Maqsad', 'BEAP dashboardi hozir BITTA fider (Xaqulobod, 51 TP) ma’lumotini OYLIK ko’rinishda ko’rsatadi. Endi BUTUN TUMAN darajasidagi ma’lumot SOATLIK (soatlik) tarzda API orqali olinishi kerak. Ushbu hujjatlar to’plami — API taqdim etuvchiga beriladigan aniq maydonlar ro’yxati.'],
    ['Asosiy talab', 'Ma’lumot iloji boricha SOATLIK bo’lsin (yuklanma, oqim, kuchlanish, iste’mol). Registr/pasport ma’lumoti bir marta, ma’muriy ma’lumot oylik/hodisa tarzida.'],
    ['Har fayl', 'Har bir obyekt turi — alohida .xlsx fayl. Ichida 3 varaq: «Ma’lumot» (ta’rif), «Maydonlar» (asosiy ro’yxat), «Namuna» (soatlik format misoli).'],
    ['«Olinadimi?» ustuni', 'Har maydon uchun: ✓ Ha — standart tizimda bor; ~ Qisman — faqat jihozlangan nuqtalarda yoki qo’polroq davriylikda; ✗ Yo’q — odatda mavjud emas (o’lchov/qo’lda kerak). API taqdim etuvchi IMKONI BORLARINI bersa kifoya.'],
    ['Davriylik', 'Soatlik — har soat; Kunlik / Oylik — agregat; Statik — pasport (o’zgarganda); Hodisa — yuz berganda (uzilish, dalolatnoma).'],
    ['Manba tizimlari', 'АСКУЭ/AMR — avtomatlashtirilgan hisoblash; SCADA/RTU — dispetcher telemetriyasi; Billing — hisob-kitob; GIS/Registr — topologiya/pasport; Qo’lda/Reyd — inson kiritadi.'],
    ['Vaqt formati', 'ISO 8601, mintaqa vaqti +05:00 (Asia/Tashkent). Masalan: 2026-08-07T19:00:00+05:00.'],
    ['Birliklar', 'Energiya — kWh; quvvat — kW/MW (aktiv), kVAr/MVAr (reaktiv), kVA/MVA (to’liq); kuchlanish — V/kV; tok — A; pul — so’m (dashboard mln so’m da yig’adi).'],
    ['Bo’sh qiymat', 'Ma’lumot yo’q bo’lsa — null (0 yoki bo’sh satr EMAS). Ayniqsa TP yo’qotishi va yuklanish % uchun muhim.'],
    ['Identifikatorlar', 'substation_id → feeder_id → tp_id → meter_id → consumer_id zanjiri orqali obyektlar bog’lanadi. ID lar BARQAROR bo’lishi shart.'],
    ['Yetkazish formati', 'REST/JSON API afzal (soatlik oqim uchun sahifalash yoki since-parametr bilan). Excel/CSV eksport — boshlang’ich yuklash uchun maqbul.'],
  ];
  for (const [k, v] of intro) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true, size: 10.5, color: { argb: 'FF1F3B4D' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.section } };
    r.getCell(1).alignment = { vertical: 'top', wrapText: true, indent: 1 };
    r.getCell(2).font = { size: 10.5 };
    r.getCell(2).alignment = { vertical: 'top', wrapText: true, indent: 1 };
    r.getCell(1).border = border; r.getCell(2).border = border;
  }

  // Ierarxiya
  const hs = wb.addWorksheet('Ierarxiya');
  const hcols = [6, 26, 20, 22, 26, 16];
  hcols.forEach((w, i) => { hs.getColumn(i + 1).width = w; });
  hs.mergeCells('A1:F1');
  const ht = hs.getCell('A1');
  ht.value = 'OBYEKTLAR IERARXIYASI VA BOG’LANISHI';
  ht.font = { bold: true, size: 14, color: { argb: 'FF' + C.titleText } };
  ht.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.title } };
  ht.alignment = { vertical: 'middle', indent: 1 };
  hs.getRow(1).height = 28;
  const hh = hs.addRow(['Fayl', 'Obyekt', 'Bog’lash kaliti', 'Ota obyekt', 'Asosiy davriylik', 'Kuchlanish']);
  hh.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FF' + C.headerText }, size: 10.5 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.header } };
    c.alignment = { horizontal: 'center', wrapText: true }; c.border = border;
  });
  const hier = [
    ['01', 'Podstansiya / Nimstansiya', 'substation_id', 'Elektroset', 'Soatlik (SCADA)', '110/35/10 kV'],
    ['02', 'Fider', 'feeder_id', 'Podstansiya', 'Soatlik + Oylik balans', '10 / 6 kV'],
    ['03', 'TP', 'tp_id', 'Fider', 'Soatlik (jihozlangan) + Oylik', '10/0.4 kV'],
    ['04', 'Transformator', 'transformer_id', 'Podstansiya / TP', 'Statik + qisman soatlik', '35/10 · 10/0.4'],
    ['05', 'Abonent hisoblagichi', 'meter_id', 'Iste’molchi / TP', 'Soatlik (aqlli) + Oylik', '0.4 kV'],
    ['06', 'Iste’molchi', 'consumer_id', 'TP / Fider', 'Oylik (billing)', '0.4 kV'],
    ['07', 'Tarmoq liniyalari', 'segment_id', 'Fider / TP', 'Statik + Davriy', '0.4–35 kV'],
    ['08', 'Ma’muriy / operatsion', 'act_no / work_id …', 'MFY / TP / Iste’molchi', 'Hodisa / Oylik', '—'],
  ];
  for (const row of hier) {
    const r = hs.addRow(row);
    r.eachCell((c) => { c.border = border; c.font = { size: 10 }; c.alignment = { vertical: 'middle', wrapText: true }; });
    r.getCell(1).alignment = { horizontal: 'center' };
    r.getCell(2).font = { size: 10, bold: true };
    r.getCell(3).font = { name: 'Consolas', size: 9.5, color: { argb: 'FF334E45' } };
  }
  hs.addRow([]);
  const chain = hs.addRow(['Zanjir:', 'substation_id → feeder_id → tp_id → meter_id → consumer_id']);
  hs.mergeCells(`B${chain.number}:F${chain.number}`);
  chain.getCell(1).font = { bold: true };
  chain.getCell(2).font = { name: 'Consolas', size: 10, color: { argb: 'FF1F3B4D' } };

  // Fayllar ro'yxati + qamrov
  const fs2 = wb.addWorksheet('Fayllar va qamrov');
  const fcols = [6, 32, 10, 10, 10, 10, 12, 12, 12];
  fcols.forEach((w, i) => { fs2.getColumn(i + 1).width = w; });
  fs2.mergeCells('A1:I1');
  const ft = fs2.getCell('A1');
  ft.value = 'FAYLLAR RO’YXATI VA MAYDONLAR QAMROVI';
  ft.font = { bold: true, size: 14, color: { argb: 'FF' + C.titleText } };
  ft.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.title } };
  ft.alignment = { vertical: 'middle', indent: 1 };
  fs2.getRow(1).height = 28;
  const fh = fs2.addRow(['Fayl', 'Obyekt', 'Jami', '✓ Ha', '~ Qism', '✗ Yo’q', 'Soatlik', 'Oylik', 'Statik']);
  fh.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FF' + C.headerText }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.header } };
    c.alignment = { horizontal: 'center', wrapText: true }; c.border = border;
  });
  let tot = { total: 0, y: 0, p: 0, no: 0, Soatlik: 0, Oylik: 0, Statik: 0 };
  for (const s of summaries) {
    const c = s.counts;
    const total = c.y + c.p + c.no;
    const r = fs2.addRow([s.id, s.entity, total, c.y, c.p, c.no, c.Soatlik, c.Oylik, c.Statik]);
    r.eachCell((cell, i) => {
      cell.border = border; cell.font = { size: 10 };
      if (i > 2) cell.alignment = { horizontal: 'center' };
    });
    r.getCell(1).alignment = { horizontal: 'center' };
    r.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.yes } };
    r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.part } };
    r.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.no } };
    r.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.soatlik } };
    tot.total += total; tot.y += c.y; tot.p += c.p; tot.no += c.no;
    tot.Soatlik += c.Soatlik; tot.Oylik += c.Oylik; tot.Statik += c.Statik;
  }
  const tr = fs2.addRow(['', 'JAMI', tot.total, tot.y, tot.p, tot.no, tot.Soatlik, tot.Oylik, tot.Statik]);
  tr.eachCell((c, i) => {
    c.border = border; c.font = { bold: true, size: 10 };
    if (i > 2) c.alignment = { horizontal: 'center' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4EFDD' } };
  });

  // Ustuvorlik
  const ps = wb.addWorksheet('Ustuvorlik');
  ps.getColumn(1).width = 10;
  ps.getColumn(2).width = 100;
  ps.mergeCells('A1:B1');
  const pt = ps.getCell('A1');
  pt.value = 'YETKAZISH USTUVORLIGI (nimadan boshlash)';
  pt.font = { bold: true, size: 14, color: { argb: 'FF' + C.titleText } };
  pt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + C.title } };
  pt.alignment = { vertical: 'middle', indent: 1 };
  ps.getRow(1).height = 28;
  const prio = [
    ['1-bosqich', 'Registr/pasport: nimstansiya, fider, TP ro’yxati va bog’lanishi (ID zanjiri), TP rated_kva. Busiz boshqa hech narsa joyiga tushmaydi.'],
    ['2-bosqich', 'Fider bosh hisoblagichi SOATLIK energiya + kuchlanish (АСКУЭ). Bu dashboardning yuragi — energiya balansi va yo’qotish.'],
    ['3-bosqich', 'Nimstansiya SCADA soatlik yuklanma (P), kuchlanish. Kirim/chiqim balansi.'],
    ['4-bosqich', 'Iste’molchi + billing: soni (toifa bo’yicha), oylik iste’mol, qarzdorlik, ulanish holati. Pasport 1,5,6,7-qatorlar.'],
    ['5-bosqich', 'TP balans hisoblagichi (jihozlangan TP) soatlik/kunlik + biriktirilgan iste’molchilar — TP darajasidagi yo’qotish va anomaliya.'],
    ['6-bosqich', 'Aqlli abonent hisoblagichlari soatlik profili (mavjud bo’lganlaridan).'],
    ['7-bosqich', 'Tarmoq (GIS uzunliklari), ma’muriy (dalolatnoma, ishlar), uzilish hodisalari, transformator pasport yo’qotishlari (Pxx/Pkz).'],
  ];
  for (const [k, v] of prio) {
    const r = ps.addRow([k, v]);
    r.getCell(1).font = { bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5E4E' } };
    r.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    r.getCell(2).font = { size: 10.5 };
    r.getCell(2).alignment = { vertical: 'top', wrapText: true, indent: 1 };
    r.getCell(1).border = border; r.getCell(2).border = border;
    r.height = 34;
  }

  const path = join(OUT_DIR, '00_UMUMIY_YORIQNOMA.xlsx');
  await wb.xlsx.writeFile(path);
  return path;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const summaries = [];
for (const spec of FILES) {
  const res = await buildEntityWorkbook(spec);
  summaries.push({ id: spec.id, entity: spec.entity, counts: res.counts, file: spec.file });
  console.log(`✓ ${spec.file}`);
}
const indexPath = await buildIndex(summaries);
console.log(`✓ 00_UMUMIY_YORIQNOMA.xlsx`);
console.log(`\nJami ${FILES.length + 1} fayl: ${OUT_DIR}`);
