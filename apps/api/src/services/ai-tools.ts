/**
 * AI agentning ASBOBLARI.
 *
 * Model matn yozish bilan cheklanmaydi - u shu ro'yxatdagi amallarni chaqiradi
 * va tizim ular uchun javob beradi. Uch toifa bor:
 *
 *   A. MA'LUMOT   - serverda bajariladi, natija modelga qaytadi.
 *                   Hammasi MAVJUD `db/queries/*` funksiyalarini chaqiradi;
 *                   bu yerda yangi SQL yozilmaydi.
 *   B. INTERFEYS  - serverda BAJARILMAYDI. Server oqimga `action` hodisasini
 *                   chiqaradi, amalni brauzer bajaradi (sahifa ochish, davrni
 *                   almashtirish, fayl saqlash). Modelga `{ok:true}` qaytadi.
 *   C. YOZISH     - serverda, LEKIN faqat tizimga kirgan foydalanuvchi nomidan.
 *                   Rol va MFY doirasi tekshiruvlari `routes/entry.ts` dagi
 *                   bilan bir xil qoladi; ustidan Postgres RLS ham turadi.
 *
 * Nega asboblar ro'yxati qattiq belgilangan: model ixtiyoriy SQL yoki ixtiyoriy
 * HTTP so'rov yubora olmaydi. U faqat shu funksiyalarni, faqat shu
 * parametrlar bilan chaqira oladi - ya'ni qamrov kod bilan chegaralangan.
 */
import type { Domain, MonthlyReturn, Work } from '@beap/shared';
import {
  DOMAINS, monthlyReturnSchema, networkDefectPatchSchema, TP_CONDITIONS, tpStatusPatchSchema,
  WORK_STATUSES, WORK_TYPE_LABEL_UZ, WORK_TYPES, workSchema,
} from '@beap/shared';

import type { AppContext } from '../db/pool.ts';
import * as q from '../db/queries/dashboard.ts';
import * as entry from '../db/queries/entry.ts';
import * as passport from '../db/queries/passport.ts';
import { refreshAggregates } from './aggregates.ts';
import * as alerts from './alerts.ts';
import * as analytics from './analytics.ts';
import { renderCustomChart, renderTable } from './charts.ts';

export interface ToolContext {
  ctx: AppContext;
  /** Yagona fider - ko'p asboblar uchun standart qamrov. */
  feederId: number | null;
  /** Suhbat boshlangandagi davr - model boshqasini aytmasa shu ishlatiladi. */
  period: string;
}

/** Asbob natijasi: ma'lumot yoki brauzer bajaradigan amal. */
export type ToolOutcome =
  | { kind: 'data'; result: unknown }
  | { kind: 'action'; action: ClientAction; result: unknown };

export interface ClientAction {
  type: 'navigate' | 'set_period' | 'set_as_of_date' | 'download' | 'chart';
  payload: Record<string, unknown>;
}

// ─── OpenAI uchun asbob ta'riflari ──────────────────────────────────────────

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const period = (description: string) => ({
  type: 'string', pattern: '^\\d{4}-\\d{2}$', description,
});

interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] };
  };
}

const fn = (
  name: string, description: string,
  properties: Record<string, unknown> = {}, required: string[] = [],
): ToolSpec => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const TOOL_SPECS: ToolSpec[] = [
  // ── A. Ma'lumot ───────────────────────────────────────────────────────────
  fn('get_tp', 'Bitta transformator punkti (TP) haqida to‘liq ma’lumot: abonentlar, '
    + 'hisoblagich, oylik iste’mol, holati va yuklamasi.',
    { code: str('TP kodi, masalan "TP-067". Katta-kichik harf farq qilmaydi.') }, ['code']),

  fn('list_tps', 'Transformatorlarni tanlangan tartibda saralab beradi. Reyting '
    + 'savollari uchun SHU asbobni ishlat - ro‘yxatni o‘zing saralama.',
    {
      sort_by: {
        type: 'string', enum: ['kwh', 'disconnected', 'off_share', 'consumers'],
        description: 'kwh - iste’mol; disconnected - uzilgan abonentlar soni; '
          + 'off_share - uzilganlar ulushi (%); consumers - abonentlar soni',
      },
      limit: int('Nechta qator kerak (1–51). Standart 10.'),
    }, ['sort_by']),

  fn('get_period_totals', 'Berilgan OY bo‘yicha umumiy ko‘rsatkichlar: kirgan energiya, '
    + 'foydali oqim, yo‘qotish, abonentlar, TP soni.',
    { period: period('Oy, "YYYY-MM" ko‘rinishida') }, ['period']),

  fn('compare_periods', 'Ikki oyni solishtiradi va farqni foizda beradi.',
    { period_a: period('Birinchi oy'), period_b: period('Ikkinchi oy') },
    ['period_a', 'period_b']),

  fn('get_series', 'Kunlik/haftalik/oylik dinamika: kirgan, foydali oqim, yo‘qotish.',
    {
      bucket: { type: 'string', enum: ['day', 'week', 'month'], description: 'Qadam' },
      last: int('Oxirgi nechta nuqta (2–365). Standart 30.'),
    }),

  fn('list_works', 'Rejalashtirilgan va bajarilgan ishlar ro‘yxati.',
    {
      status: {
        type: 'string', enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
        description: 'Holat bo‘yicha filtr; berilmasa hammasi',
      },
    }),

  fn('get_work', 'Bitta ishning dalolatnomasi: tavsif, muddat, xarajat, rasmlar.',
    { id: int('Ish raqami') }, ['id']),

  fn('get_violations', 'Aniqlangan qoidabuzarliklar: toifa bo‘yicha soni, jarima summasi '
    + 'va dalolatnomalar ro‘yxati.',
    { period: period('Oy; berilmasa joriy davr') }),

  fn('list_review_queue', 'Tasdiqlash navbati: yuborilgan, lekin hali tasdiqlanmagan '
    + 'hisobotlar. Tizimga kirish talab qilinadi.'),

  fn('get_completeness', 'Berilgan OY uchun qaysi MFY/hisobot turi hali kiritilmagani '
    + 'yoki tasdiqlanmaganini ko‘rsatadi.',
    { period: period('Oy; berilmasa joriy davr') }),

  fn('reconcile_passport', 'Fider pasportidagi (muzlatilgan) raqamlar bilan joriy '
    + 'hisoblangan yig‘indi orasidagi farqni tekshiradi.',
    { period: period('Oy; berilmasa joriy davr') }),

  fn('search_debtor', 'Qarzdorni ism bo‘yicha qidiradi (aniq yozilmagan bo‘lsa ham topadi).',
    {
      query: str('Qarzdor ismi yoki ismning bir qismi'),
      limit: int('Nechta natija kerak. Standart 10.'),
    }, ['query']),

  fn('get_anomalies', 'Kunlik ko‘rsatkichlarda va TP holatida g‘ayrioddiy og‘ishlarni '
    + 'aniqlaydi (yo‘qotish sakrashi, ortiqcha yuklama).',
    { period: period('Oy; berilmasa joriy davr') }),

  fn('get_tp_loss_anomalies', 'TP darajasidagi KUNLIK balans hisoblagichi va '
    + 'bириктирилган iste’molchilar ko‘rsatkichi orasidagi anomaliyalarni ko‘rsatadi - '
    + 'manfiy yo‘qotish (iste’molchilar balansdan ko‘p - fizik jihatdan mumkin emas, '
    + 'ehtimoliy o‘g‘irlik/hisoblagich xatosi belgisi) va normadan sezilarli oshgan '
    + 'yo‘qotish foizini aniqlaydi. Bu - fider (oylik) balansidan FARQLI, TP darajasidagi '
    + 'kunlik ma’lumot.'),

  fn('forecast_losses', 'Kelgusi oylar uchun yo‘qotish foizi prognozini beradi.',
    { months_ahead: int('Nechta oy oldinga; standart 3') }),

  fn('get_alerts', 'Tizimda hozir diqqat talab qiladigan barcha muammolar ro‘yxati: '
    + 'qoidabuzarlik, muddati o‘tgan ish, kiritilmagan ma’lumot, pasport nomuvofiqligi, '
    + 'anomaliya.'),

  fn('validate_submission', 'Qoralamani YUBORMASDAN oldin xatolarni tekshiradi va '
    + 'tushuntiradi.',
    { id: int('Qoralama raqami') }, ['id']),

  fn('recommend_works', 'Muammolarni (ortiqcha yuklangan/nosoz/masofasi me’yordan uzoq TP, '
    + 'ta’mirlanmagan tarmoq) tahlil qilib, qanday YANGI ish (ta’mirlash, modernizatsiya, '
    + 'o‘rnatish) qilish tavsiya etilishini ko‘rsatadi. «Qanday ish tavsiya qilasan?», «nima '
    + 'qilish kerak?», «muammolarni qanday hal qilaman?» kabi savollarda SHU asbobni chaqir - '
    + 'javobni o‘zing o‘ylab topma. Allaqachon reja/jarayondagi ishlar bilan qoplangan '
    + 'muammolar qayta tavsiya etilmaydi.',
    { period: period('Oy; berilmasa joriy davr') }),

  // ── B. Interfeys amallari ─────────────────────────────────────────────────
  fn('navigate', 'Foydalanuvchini panelning boshqa sahifasiga OLIB O‘TADI. '
    + 'Sahifani aytish o‘rniga shu asbobni chaqir.',
    {
      path: {
        type: 'string',
        enum: ['/dashboard', '/transformers', '/energy-balance', '/works', '/reports',
          '/entry', '/review', '/settings/responsible'],
        description: 'Qaysi sahifa ochilsin. /settings/responsible - ma’sul shaxsni '
          + 'belgilash/o‘zgartirish sahifasi.',
      },
      search: str('Sahifadagi qidiruv maydoniga qo‘yiladigan matn, masalan TP kodi. '
        + 'Faqat /transformers va /works uchun.'),
    }, ['path']),

  fn('set_period', 'Butun panelning hisobot OYINI almashtiradi - KPI kartalari, '
    + 'diagrammalar va jadvallar shu oyga o‘tadi.',
    { period: period('Oy, "YYYY-MM"') }, ['period']),

  fn('set_as_of_date', 'Hisobot SANASINI o‘rnatadi (kunlik grafiklar shunga bo‘ysunadi). '
    + 'Oy ham avtomatik shu sanaga ko‘chadi.',
    { date: str('Sana, "YYYY-MM-DD"') }, ['date']),

  fn('download_report', 'Hisobot faylini foydalanuvchining kompyuteriga YUKLAB BERADI. '
    + '«Hisobotni yuklab ber» so‘ralganda sahifani aytish emas, SHU asbobni chaqir.',
    {
      kind: {
        type: 'string',
        enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'passport'],
        description: 'Hisobot turi. passport - fider pasporti.',
      },
      ext: { type: 'string', enum: ['xlsx', 'pdf'], description: 'Fayl formati. Standart xlsx.' },
      period: period('Oy; berilmasa joriy davr'),
    }, ['kind']),

  fn('show_chart', 'Ma’lumotni DIAGRAMMA/RASM ko‘rinishida (PNG grafik) ko‘rsatadi. '
    + 'Foydalanuvchi «grafik», «diagramma» so‘zlarini ishlatganda, biror narsani «rasm» '
    + 'holida ko‘rishni so‘raganda yoki hisobot vizual holda tushunarliroq bo‘ladigan '
    + 'bo‘lsa SHU asbobni chaqir.',
    {
      kind: {
        type: 'string',
        enum: ['energy_trend', 'tp_ranking', 'loss_breakdown', 'loss_forecast'],
        description: 'Diagramma turi. energy_trend - kirgan energiya/foydali oqim dinamikasi '
          + '(vaqt bo‘yicha); tp_ranking - list_tps asbobidagi bilan bir xil TP reytingi, '
          + 'lekin rasm shaklida; loss_breakdown - foydali oqim va yo‘qotish taqsimoti; '
          + 'loss_forecast - yo‘qotish foizi prognozi.',
      },
      period: period('Oy, "YYYY-MM". Faqat energy_trend va loss_breakdown uchun ma’noli; '
        + 'berilmasa joriy davr'),
      sort_by: {
        type: 'string', enum: ['kwh', 'disconnected', 'off_share', 'consumers'],
        description: 'Faqat tp_ranking uchun. kwh - iste’mol; disconnected - uzilgan '
          + 'abonentlar soni; off_share - uzilganlar ulushi (%); consumers - abonentlar soni',
      },
      limit: int('Faqat tp_ranking uchun, nechta qator (1–20). Standart 10.'),
      months_ahead: int('Faqat loss_forecast uchun, nechta oy oldinga. Standart 3.'),
    }, ['kind']),

  fn('render_table', 'Ma’lumotni JADVAL rasmi (PNG) ko‘rinishida ko‘rsatadi - savol 4 ta '
    + 'tayyor show_chart turiga yoki boshqa asboblarning oddiy matnli javobiga sig‘masa '
    + '(masalan bitta TP ni bir necha oy bo‘yicha solishtirish yoki har qanday kichik '
    + 'moslashuvchan taqqoslash) SHU asbobni chaqir. Avval kerakli raqamlarni boshqa asboblar '
    + 'bilan ol (get_tp, get_series, compare_periods va h.k.), keyin shu bilan jadval qilib '
    + 'ko‘rsat. Raqamni hech qachon o‘ylab topma.',
    {
      title: str('Jadval sarlavhasi'),
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ustun sarlavhalari (kamida 1, ko‘pi bilan 8 ta)',
      },
      rows: {
        type: 'array',
        items: { type: 'array', items: {} },
        description: 'Jadval qatorlari - har bir ichki massiv BITTA qator, unda '
          + '`columns` soniga mos qiymatlar (matn yoki raqam). Ko‘pi bilan 30 qator.',
      },
    }, ['title', 'columns', 'rows']),

  fn('render_custom_chart', 'Ma’lumotni CHIZIQLI, USTUNLI yoki DONUT diagramma rasmi (PNG) '
    + 'ko‘rinishida ko‘rsatadi - 4 ta tayyor show_chart turi qamrab olmaydigan ixtiyoriy '
    + 'taqqoslash/dinamika uchun. Avval kerakli raqamlarni boshqa asboblar bilan ol (get_tp, '
    + 'get_series, compare_periods va h.k.), keyin shu bilan diagramma qil. Raqamni hech qachon '
    + 'o‘ylab topma.',
    {
      title: str('Diagramma sarlavhasi'),
      chart_type: {
        type: 'string',
        enum: ['line', 'bar', 'donut'],
        description: 'Diagramma turi: line - chiziqli, bar - ustunli, donut - doiraviy',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            series: str('Faqat chart_type="line" uchun: nuqtalarni alohida nomli chiziqlarga '
              + 'guruhlash uchun seriya nomi. Boshqa turlarda kerak emas.'),
            label: str('Nuqta/ustun/tilim yorlig‘i'),
            value: { type: 'number', description: 'Son qiymati' },
          },
          required: ['label', 'value'],
        },
        description: 'Chizish kerak bo‘lgan qiymatlar ro‘yxati, har birida yorliq va son '
          + '(ko‘pi bilan 60 ta)',
      },
    }, ['title', 'chart_type', 'items']),

  // ── C. Yozish ─────────────────────────────────────────────────────────────
  fn('create_submission', 'Oylik hisobot uchun QORALAMA ochadi (yoki mavjudini qaytaradi).',
    {
      domain: { type: 'string', enum: [...DOMAINS], description: 'Hisobot turi' },
      period: period('Qaysi oy uchun'),
      mfy_id: int('Fider/MFY raqami; berilmasa yagona fider olinadi'),
    }, ['domain', 'period']),

  fn('save_monthly_return', 'Oylik hisobot raqamlarini SAQLAYDI. Faqat MONTHLY_RETURN '
    + 'qoralamasi uchun. Energiya balansi (31 kunlik jadval) bu asbob orqali '
    + 'kiritilmaydi - buning uchun navigate bilan shaklni och.',
    {
      submission_id: int('Qoralama raqami'),
      consumers_population: int('Aholi abonentlari'),
      consumers_legal: int('Yuridik shaxslar'),
      consumers_active: int('Aloqaga chiqayotgan'),
      consumers_disconnected: int('Aloqaga chiqmayotgan'),
      consumers_new: int('Yangi ulangan'),
      debt_population_mln: { type: 'number', description: 'Aholi qarzi, mln so‘m' },
      debt_legal_mln: { type: 'number', description: 'Yuridik qarz, mln so‘m' },
      debt_budget_mln: { type: 'number', description: 'Budjet tashkilotlari qarzi, mln so‘m' },
      meters_offline_cnt: int('Aloqasiz hisoblagichlar'),
      low_consumption_cnt: int('Kam iste’mol qilayotganlar'),
      meters_replace_need_cnt: int('Almashtirish kerak bo‘lgan hisoblagichlar'),
      meters_replaced_cnt: int('Almashtirilgan hisoblagichlar'),
    }, ['submission_id']),

  fn('submit_submission', 'Qoralamani tasdiqlashga YUBORADI.',
    { id: int('Qoralama raqami') }, ['id']),

  fn('approve_submission', 'Yuborilgan hisobotni TASDIQLAYDI va jamlanmalarni yangilaydi. '
    + 'Faqat elektroset menejeri yoki administrator.',
    { id: int('Hisobot raqami') }, ['id']),

  fn('reject_submission', 'Yuborilgan hisobotni RAD ETADI. Sabab majburiy.',
    { id: int('Hisobot raqami'), note: str('Rad etish sababi') }, ['id', 'note']),

  fn('create_work', 'YANGI ish yozadi (fact.work) - masalan recommend_works taklif qilgan '
    + 'ishni qo‘shish uchun. FAQAT foydalanuvchi aniq tasdiqlagach yoki «qo‘sh»/«yoz»/«ha» '
    + 'kabi ravshan buyruq bersa chaqir - so‘ralmasdan turib ish yaratma.',
    {
      mfy_id: int('Fider/MFY ICHKI raqami (get_tp/recommend_works natijasidagi mfyId, TP kodi '
        + 'EMAS). Ko‘pincha BERMASLIK kerak - berilmasa yagona fider avtomatik olinadi. '
        + 'Aniq bilmasangiz hech qachon o‘ylab topma - bo‘sh qoldir.'),
      work_type: {
        type: 'string', enum: [...WORK_TYPES],
        description: 'Ish turi: CABLE_REPLACEMENT, TP_INSTALL, TP_MODERNIZATION, '
          + 'OVERHEAD_LINE_RENEWAL, METER_REPLACEMENT, TREE_CLEARING, ILLEGAL_DISCONNECT, '
          + 'SUPPORT_REPLACEMENT, OTHER',
      },
      title: str('Ish nomi (kamida 3 belgidan)'),
      description: str('Qo‘shimcha tavsif (ixtiyoriy)'),
      tp_id: int('Tegishli transformatorning ICHKI raqami (masalan recommend_works '
        + 'natijasidagi tpId) - "TP-067" kabi KODNING O‘ZI EMAS. Foydalanuvchi TP kodini '
        + 'aytgan bo‘lsa, avval get_tp bilan shu kodni qidirib ID\'sini top; ID\'ni hech '
        + 'qachon kod raqamidan (masalan "067"dan) o‘ylab topma. Bilmasangiz bo‘sh qoldir.'),
      status: {
        type: 'string', enum: [...WORK_STATUSES],
        description: 'Boshlang‘ich holat. Standart - Reja (PLANNED).',
      },
      planned_start: str('Reja boshlanish sanasi, "YYYY-MM-DD"'),
      planned_end: str('Reja tugash sanasi, "YYYY-MM-DD"'),
      actual_end: str('Haqiqiy tugash sanasi - status=COMPLETED bo‘lsa majburiy, "YYYY-MM-DD"'),
      progress_pct: int('Bajarilish foizi (0-100). COMPLETED uchun 100 bo‘lishi shart.'),
      quantity: { type: 'number', description: 'Hajm (masalan km yoki dona soni)' },
      unit: str('O‘lchov birligi, masalan "km" yoki "ta"'),
      cost_mln: { type: 'number', description: 'Taxminiy qiymati, mln so‘m' },
    }, ['work_type', 'title']),

  fn('update_work_status', 'Mavjud ishning holatini o‘zgartiradi (masalan Reja → Jarayonda, '
    + 'yoki Jarayonda → Bajarildi).',
    {
      id: int('Ish raqami'),
      status: {
        type: 'string', enum: [...WORK_STATUSES],
        description: 'Yangi holat',
      },
      progress_pct: int('Bajarilish foizi (0-100). Bajarildi uchun 100 bo‘lishi shart.'),
      actual_end: str('Haqiqiy tugash sanasi - Bajarildi uchun majburiy, "YYYY-MM-DD"'),
    }, ['id', 'status']),

  fn('update_tp_status', 'Bitta TP ning oylik holatini (yuklama %, holati: yaxshi/diqqat/'
    + 'ortiqcha yuklama/nosozlik) belgilaydi yoki yangilaydi. «TP-067 ortiqcha yuklangan», '
    + '«TP-043 nosoz» kabi xabarlarda SHU asbobni chaqir - bu ma’lumot recommend_works, '
    + 'get_alerts va TP monitoring jadvalining barchasiga ta’sir qiladi. Qoralama '
    + 'sifatida saqlaydi (`draft`); rasman ko‘rinishi uchun keyin submit_submission, '
    + 'kerak bo‘lsa approve_submission ham chaqirilishi kerak - buni foydalanuvchiga ayt '
    + 'yoki ruxsating bo‘lsa o‘zing bajar.',
    {
      tp_code: str('TP kodi, masalan "TP-067"'),
      condition: {
        type: 'string', enum: [...TP_CONDITIONS],
        description: 'Holati: GOOD (yaxshi), ATTENTION (diqqat talab qiladi), '
          + 'OVERLOAD (ortiqcha yuklama), FAULT (nosozlik)',
      },
      load_pct: { type: 'number', description: 'Yuklama foizi (0-200)' },
      peak_kva: { type: 'number', description: 'Eng yuqori yuklama, kVA' },
      under_load: { type: 'boolean', description: 'Kam yuklangan (past foydalanish)' },
      repair_needed: { type: 'boolean', description: 'Ta’mirlash kerakmi' },
      repair_reason: str('Ta’mirlash sababi - repair_needed=true bo‘lsa majburiy'),
      period: period('Oy; berilmasa joriy davr'),
    }, ['tp_code']),

  fn('update_network_defect', 'Ta’mirlanishi kerak bo‘lgan va ta’mirlangan tarmoq '
    + 'uzunligini (km), kuchlanish klassi bo‘yicha, belgilaydi/yangilaydi. Foydalanuvchi '
    + '«N km tarmoq ta’mirlanishi kerak» kabi ma’lumot bersa SHU asbobni chaqir - '
    + 'recommend_works shu ma’lumotdan foydalanadi. Qoralama sifatida saqlaydi; rasman '
    + 'ko‘rinishi uchun submit_submission (va kerak bo‘lsa approve_submission) kerak.',
    {
      mfy_id: int('Fider/MFY ICHKI raqami; berilmasa yagona fider olinadi'),
      voltage_kv: {
        type: 'number', enum: [0.4, 6, 10, 35],
        description: 'Kuchlanish klassi, kV',
      },
      repair_needed_km: { type: 'number', description: 'Ta’mirlanishi kerak bo‘lgan uzunlik, km' },
      repaired_km: { type: 'number', description: 'Ta’mirlangan uzunlik, km (ixtiyoriy, standart 0)' },
      period: period('Oy; berilmasa joriy davr'),
    }, ['voltage_kv', 'repair_needed_km']),
];

/** Chat oynasida ko'rsatiladigan qisqa izoh - foydalanuvchi nima bo'layotganini bilsin. */
export const TOOL_LABELS: Record<string, string> = {
  get_tp: 'Transformator ma’lumoti olinmoqda',
  list_tps: 'Transformatorlar saralanmoqda',
  get_period_totals: 'Davr ko’rsatkichlari olinmoqda',
  compare_periods: 'Davrlar solishtirilmoqda',
  get_series: 'Dinamika olinmoqda',
  list_works: 'Ishlar ro’yxati olinmoqda',
  get_work: 'Dalolatnoma ochilmoqda',
  get_violations: 'Qoidabuzarliklar olinmoqda',
  list_review_queue: 'Tasdiqlash navbati olinmoqda',
  get_completeness: 'To’liqlik tekshirilmoqda',
  reconcile_passport: 'Pasport solishtirilmoqda',
  search_debtor: 'Qarzdor qidirilmoqda',
  get_anomalies: 'Anomaliyalar qidirilmoqda',
  get_tp_loss_anomalies: 'TP balans anomaliyalari tekshirilmoqda',
  forecast_losses: 'Prognoz hisoblanmoqda',
  get_alerts: 'Ogohlantirishlar olinmoqda',
  validate_submission: 'Qoralama tekshirilmoqda',
  recommend_works: 'Tavsiyalar tayyorlanmoqda',
  navigate: 'Sahifa ochilmoqda',
  set_period: 'Davr almashtirilmoqda',
  set_as_of_date: 'Sana o’rnatilmoqda',
  download_report: 'Hisobot tayyorlanmoqda',
  show_chart: 'Diagramma tayyorlanmoqda',
  render_table: 'Jadval tayyorlanmoqda',
  render_custom_chart: 'Diagramma tayyorlanmoqda',
  create_submission: 'Qoralama ochilmoqda',
  save_monthly_return: 'Raqamlar saqlanmoqda',
  submit_submission: 'Hisobot yuborilmoqda',
  approve_submission: 'Hisobot tasdiqlanmoqda',
  reject_submission: 'Hisobot rad etilmoqda',
  create_work: 'Ish qo’shilmoqda',
  update_work_status: 'Holat yangilanmoqda',
  update_tp_status: 'TP holati yangilanmoqda',
  update_network_defect: 'Tarmoq nuqsoni yangilanmoqda',
};

// ─── Yordamchilar ───────────────────────────────────────────────────────────

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Ruxsat yo'qligi - xato emas, modelga tushunarli javob. */
const denied = (reason: string): ToolOutcome => ({ kind: 'data', result: { ok: false, reason } });

const PERIOD_RE = /^\d{4}-\d{2}$/;

interface WorkSuggestion {
  workType: string; workTypeLabel: string;
  mfyId: number; mfyName: string;
  tpId?: number; tpCode?: string;
  suggestedTitle: string; rationale: string;
  priority: number;
}

/** Tavsiyalar orasida ko'rsatiladigan eng ko'p qator soni - chatda o'qib bo'lmas uzun ro'yxat bo'lmasin. */
const MAX_RECOMMENDATIONS = 8;

/** `TpMonitorPanel.tsx`dagi bilan BIR XIL bo'sag'a - "5%+/10%+ uzilgan ulush" ikki joyda ikki xil son bo'lmasin. */
const OFF_SHARE_WARNING_PCT = 5;
const OFF_SHARE_CRITICAL_PCT = 10;
/** Yo'qotish maqsaddan shuncha foiz punktidan ko'p oshsa - tavsiya beriladi. */
const LOSS_GAP_THRESHOLD_PP = 3;

/**
 * "Qanday ish tavsiya qilasan?" savoliga javob.
 *
 * BESH MUSTAQIL, MAVJUD signal manbasidan foydalanadi - yangi tahlil/anomaliya
 * qoidasi deyarli yozilmaydi, faqat allaqachon boshqa joyda hisoblangan
 * ko'rsatkichlar "bu ishga aylantirilsinmi" nuqtai nazaridan qayta o'qiladi:
 *   · `q.tpMonitoring()` - `condition`/`loadPct`/`distanceCompliant` maydonlari
 *     hozirgacha frontendda ham ishlatilmagan (masofa/ATTENTION signali
 *     `detectAnomalies()`da ham yo'q - u faqat OVERLOAD/FAULT ni ko'radi).
 *     Bu manba `fact.tp_status_monthly` TASDIQLANGANDA to'ladi - hozircha
 *     hech kim to'ldirmagan bo'lsa BO'SH bo'ladi, bu XATO EMAS.
 *   · `q.networkDefectBacklog()` - `fact.network_defect` ilgari HECH QAYERDA
 *     o'qilmagan, ta'mirlanmagan km miqdorini ko'rsatadi. Xuddi shu - hech kim
 *     to'ldirmagan bo'lsa bo'sh.
 *   · `q.tpMonthly()` - uzilgan abonent ULUSHI, `TpMonitorPanel.tsx`da
 *     allaqachon "muammo" deb rangli ko'rsatiladigan, lekin ishga
 *     ulanmaydigan signal ("uzilgan hisoblagich - to'g'ridan-to'g'ri
 *     yo'qotish manbai", o'sha faylning izohi). Bu manba HAR DOIM to'ldirilgan
 *     (oylik hisobot bilan birga keladi) - shuning uchun yuqoridagi ikkitasi
 *     bo'sh bo'lsa ham odatda kamida shu yerdan tavsiya chiqadi.
 *   · `q.efficiency()` - feeder darajasidagi yo'qotish % maqsad darajadan
 *     qanchaga oshganini allaqachon hisoblaydi (bosh sahifadagi "AI tavsiya"
 *     kartasi shundan o'qiydi). Katta farq bo'lsa - aniq TP ko'rsatilmasa ham
 *     feeder darajasida umumiy tekshiruv/ta'mirlash tavsiya etiladi.
 *   · Mavjud REJA/JARAYONDAGI ishlar - xuddi shu muammo uchun ish
 *     allaqachon bor bo'lsa, qayta tavsiya qilinmaydi.
 */
async function recommendWorks(tc: ToolContext, period: string): Promise<{
  period: string; count: number; totalFound: number; suggestions: WorkSuggestion[];
}> {
  const [
    tpRows, tpMonthlyRows, backlog, efficiencyInfo, plannedWorks, inProgressWorks, tpLossReport,
  ] = await Promise.all([
    q.tpMonitoring(tc.ctx, period, tc.feederId, 500),
    q.tpMonthly(tc.ctx, period, tc.feederId),
    q.networkDefectBacklog(tc.ctx, period, tc.feederId),
    q.efficiency(tc.ctx, period, tc.feederId),
    q.works(tc.ctx, tc.feederId, 'PLANNED', 200),
    q.works(tc.ctx, tc.feederId, 'IN_PROGRESS', 200),
    analytics.detectTpLossAnomalies(tc.ctx, tc.feederId),
  ]);

  const existingWorks = [...plannedWorks, ...inProgressWorks];
  const coveredTpCodes = new Set(existingWorks.map((w) => w.tpCode).filter((c): c is string => c !== null));
  const coveredMfyType = new Set(existingWorks.map((w) => `${w.mfyId}:${w.workType}`));

  const suggestions: WorkSuggestion[] = [];

  for (const t of tpRows) {
    if (coveredTpCodes.has(t.code)) continue;

    if (t.condition === 'FAULT') {
      suggestions.push({
        workType: 'TP_MODERNIZATION', workTypeLabel: WORK_TYPE_LABEL_UZ.TP_MODERNIZATION,
        mfyId: t.mfyId, mfyName: t.mfyName, tpId: t.tpId, tpCode: t.code,
        suggestedTitle: `${t.code} transformatorini almashtirish/ta’mirlash`,
        rationale: `${t.code} (${t.mfyName}) hozir NOSOZ holatda.`,
        priority: 100,
      });
    } else if (t.condition === 'OVERLOAD') {
      suggestions.push({
        workType: 'TP_INSTALL', workTypeLabel: WORK_TYPE_LABEL_UZ.TP_INSTALL,
        mfyId: t.mfyId, mfyName: t.mfyName, tpId: t.tpId, tpCode: t.code,
        suggestedTitle: `${t.code} hududida qo’shimcha transformator quvvati`,
        rationale: `${t.code} (${t.mfyName}) ortiqcha yuklangan`
          + `${t.loadPct !== null ? ` (yuklama ${t.loadPct}%)` : ''}.`,
        priority: 80,
      });
    } else if (t.distanceCompliant === false) {
      suggestions.push({
        workType: 'TP_INSTALL', workTypeLabel: WORK_TYPE_LABEL_UZ.TP_INSTALL,
        mfyId: t.mfyId, mfyName: t.mfyName, tpId: t.tpId, tpCode: t.code,
        suggestedTitle: `${t.code} hududida masofani qisqartirish uchun yangi TP`,
        rationale: `${t.code} (${t.mfyName}) dagi o’rtacha abonent masofasi me’yordan uzoq.`,
        priority: 50,
      });
    } else if (t.condition === 'ATTENTION') {
      suggestions.push({
        workType: 'TP_MODERNIZATION', workTypeLabel: WORK_TYPE_LABEL_UZ.TP_MODERNIZATION,
        mfyId: t.mfyId, mfyName: t.mfyName, tpId: t.tpId, tpCode: t.code,
        suggestedTitle: `${t.code} holatini tekshirish`,
        rationale: `${t.code} (${t.mfyName}) diqqat talab qiladi.`,
        priority: 40,
      });
    }
  }

  // Kuchlanish klassiga qarab taxminiy ish turi - aniq nuqson tafsiloti
  // `fact.network_defect`da yo'q (faqat km jamlanmasi), shuning uchun bu
  // qoida-taxmin, qat'iy xarita emas.
  for (const b of backlog) {
    const workType = b.voltageKv >= 35 ? 'OVERHEAD_LINE_RENEWAL' : 'CABLE_REPLACEMENT';
    if (coveredMfyType.has(`${b.mfyId}:${workType}`)) continue;
    suggestions.push({
      workType, workTypeLabel: WORK_TYPE_LABEL_UZ[workType as keyof typeof WORK_TYPE_LABEL_UZ],
      mfyId: b.mfyId, mfyName: b.mfyName,
      suggestedTitle: `${b.mfyName}: ${b.voltageKv} kV tarmog‘ini ta’mirlash (${b.backlogKm} km)`,
      rationale: `${b.mfyName}da ${b.voltageKv} kV tarmoqning ${b.backlogKm} km qismi `
        + `hali ta’mirlanmagan.`,
      priority: Math.min(70, 30 + b.backlogKm),
    });
  }

  /*
   * Uzilgan/aloqasiz abonent ULUSHI - `TpMonitorPanel.tsx` da AYNAN shu
   * bo'sag'a (5%/10%) bilan "muammo" deb rangli ko'rsatiladi, lekin hech
   * qanday ishga ulanmaydi. Bu manba (oylik hisobot) HAR DOIM to'ldirilgan
   * bo'ladi - TP holati hali kiritilmagan bo'lsa ham tavsiya chiqishi mumkin.
   */
  const tpInfoByCode = new Map(tpRows.map((t) => [t.code, t]));
  for (const m of tpMonthlyRows) {
    if (coveredTpCodes.has(m.code) || m.consumersTotal <= 0) continue;
    const offSharePct = (m.consumersDisconnected / m.consumersTotal) * 100;
    if (offSharePct < OFF_SHARE_WARNING_PCT) continue;

    const info = tpInfoByCode.get(m.code);
    if (!info) continue;
    suggestions.push({
      workType: 'METER_REPLACEMENT', workTypeLabel: WORK_TYPE_LABEL_UZ.METER_REPLACEMENT,
      mfyId: info.mfyId, mfyName: info.mfyName, tpId: info.tpId, tpCode: m.code,
      suggestedTitle: `${m.code} dagi uzilgan/aloqasiz hisoblagichlarni tekshirish`,
      rationale: `${m.code} da ${m.consumersDisconnected}/${m.consumersTotal} abonent aloqada `
        + `emas (${offSharePct.toFixed(1)}%) - to‘g‘ridan-to‘g‘ri yo‘qotish manbai bo‘lishi mumkin.`,
      priority: offSharePct >= OFF_SHARE_CRITICAL_PCT ? 75 : 45,
    });
  }

  /*
   * Feeder darajasidagi yo'qotish % - maqsaddan sezilarli oshgan bo'lsa,
   * aniq TP ko'rsatilmagan bo'lsa ham umumiy tekshiruv tavsiya etiladi.
   * `efficiency()`ning `advice` maydoni bosh sahifadagi "AI tavsiya"
   * kartasi (`AdviceCard`, deterministik, AI emas) bilan BIR XIL hisob-kitob
   * - shu yerda esa "demak qanday ish kerak" savoliga javob beriladi.
   */
  if (efficiencyInfo?.advice) {
    const { targetLossPct, currentLossPct } = efficiencyInfo.advice;
    const gap = currentLossPct - targetLossPct;
    if (gap > LOSS_GAP_THRESHOLD_PP) {
      /*
       * Yo'qotish endi toifalarga bo'linmaydi, shuning uchun ish turi
       * TARKIBDAN emas, MAVJUD DALILDAN chiqariladi: TP balans hisoblagichi
       * anomaliyalari bo'lsa - hisobga olinmagan iste'mol belgisi, ya'ni
       * tekshiruv; aks holda muammo tarmoqning o'zida deb qaraladi.
       */
      const meteringSignals = tpLossReport.anomalies.length;
      const workType = meteringSignals > 0 ? 'ILLEGAL_DISCONNECT' : 'TP_MODERNIZATION';
      const mfyId = tc.feederId ?? tpRows[0]?.mfyId ?? null;
      const mfyName = tpRows[0]?.mfyName ?? 'Fider';

      if (mfyId !== null && !coveredMfyType.has(`${mfyId}:${workType}`)) {
        suggestions.push({
          workType, workTypeLabel: WORK_TYPE_LABEL_UZ[workType],
          mfyId, mfyName,
          suggestedTitle: `${mfyName}: yo‘qotishni maqsad darajaga tushirish bo‘yicha tekshiruv`,
          rationale: `Joriy yo‘qotish ${currentLossPct.toFixed(1)}% - maqsad `
            + `${targetLossPct.toFixed(1)}% dan ${gap.toFixed(1)} f.p. yuqori`
            + (meteringSignals > 0
              ? ` (${meteringSignals} ta TP da hisoblagich balansi anomaliyasi qayd etilgan).`
              : ' (TP hisoblagichlarida anomaliya yo‘q - muammo tarmoq tomonida).'),
          priority: Math.min(95, 60 + gap),
        });
      }
    }
  }

  /*
   * TP balans hisoblagichi anomaliyasi - `analytics.detectTpLossAnomalies()`.
   * Faqat 'high' (fizik jihatdan mumkin emas - manfiy yo'qotish) signal
   * ishga aylantiriladi; kunlik kron (`alerts.autoDraftHighSeverityTpLossWorks`)
   * xuddi shu signaldan xuddi shu tarzda ish yaratadi - ikkalasi ham BIR XIL
   * `coveredTpCodes` bilan tekshiriladi, shuning uchun ikki marta tavsiya
   * qilinmaydi.
   */
  for (const a of tpLossReport.anomalies) {
    if (a.severity !== 'high' || coveredTpCodes.has(a.code)) continue;
    suggestions.push({
      workType: 'METER_REPLACEMENT', workTypeLabel: WORK_TYPE_LABEL_UZ.METER_REPLACEMENT,
      mfyId: a.mfyId, mfyName: a.mfyName, tpId: a.tpId, tpCode: a.code,
      suggestedTitle: `${a.code} balans hisoblagichini tekshirish`,
      rationale: a.messageUz,
      priority: 90,
    });
  }

  suggestions.sort((a, b) => b.priority - a.priority);
  const top = suggestions.slice(0, MAX_RECOMMENDATIONS);
  return { period, count: top.length, totalFound: suggestions.length, suggestions: top };
}

/**
 * TP kodini ("TP-067") ichki ID/MFY'ga aylantiradi - `get_tp`dagi bilan bir
 * xil qidiruv. `update_tp_status` shu orqali ishlaydi, model hech qachon
 * ID'ni kod raqamidan o'ylab topmasin deb (`create_work`da bir marta shu
 * xato ko'rilgan - bu yerda boshidanoq oldi olingan).
 */
async function resolveTpByCode(
  tc: ToolContext, code: string, period: string,
): Promise<{ tpId: number; mfyId: number; mfyName: string; code: string } | null> {
  const rows = await q.tpMonitoring(tc.ctx, period, tc.feederId, 500);
  const found = rows.find((r) => r.code.toUpperCase() === code.trim().toUpperCase());
  return found ? { tpId: found.tpId, mfyId: found.mfyId, mfyName: found.mfyName, code: found.code } : null;
}

// ─── Bajaruvchi ─────────────────────────────────────────────────────────────

export async function runTool(
  name: string, args: Record<string, unknown>, tc: ToolContext,
): Promise<ToolOutcome> {
  const period = (() => {
    const p = asString(args['period']);
    return p && PERIOD_RE.test(p) ? p : tc.period;
  })();

  switch (name) {
    // ── A. Ma'lumot ─────────────────────────────────────────────────────────
    case 'get_tp': {
      const code = (asString(args['code']) ?? '').trim().toUpperCase();
      const [monthly, monitoring] = await Promise.all([
        q.tpMonthly(tc.ctx, period, tc.feederId),
        q.tpMonitoring(tc.ctx, period, tc.feederId, 500),
      ]);
      const m = monthly.find((r) => r.code.toUpperCase() === code);
      const mon = monitoring.find((r) => r.code.toUpperCase() === code);
      if (!m && !mon) {
        return {
          kind: 'data',
          result: {
            found: false,
            hint: `"${code}" topilmadi. Mavjud kodlar: ${monthly.slice(0, 8).map((r) => r.code).join(', ')}…`,
          },
        };
      }
      return { kind: 'data', result: { found: true, period, monthly: m ?? null, status: mon ?? null } };
    }

    case 'list_tps': {
      const sortBy = asString(args['sort_by']) ?? 'kwh';
      const limit = Math.min(Math.max(asNumber(args['limit']) ?? 10, 1), 51);
      const rows = await q.tpMonthly(tc.ctx, period, tc.feederId);
      const share = (r: (typeof rows)[number]): number =>
        r.consumersTotal > 0 ? r.consumersDisconnected / r.consumersTotal : 0;

      const sorted = [...rows].sort((a, b) => {
        if (sortBy === 'disconnected') return b.consumersDisconnected - a.consumersDisconnected;
        if (sortBy === 'off_share') return share(b) - share(a);
        if (sortBy === 'consumers') return b.consumersTotal - a.consumersTotal;
        return b.kwhMonth - a.kwhMonth;
      });

      return {
        kind: 'data',
        result: {
          period, sortBy, total: rows.length,
          rows: sorted.slice(0, limit).map((r) => ({
            code: r.code,
            consumersTotal: r.consumersTotal,
            consumersDisconnected: r.consumersDisconnected,
            offSharePct: Number((share(r) * 100).toFixed(1)),
            kwhMonth: r.kwhMonth,
          })),
        },
      };
    }

    case 'get_period_totals': {
      const res = await q.districtOverview(tc.ctx, period);
      if (!res) return { kind: 'data', result: { found: false, period } };
      return { kind: 'data', result: { found: true, period, totals: res.totals } };
    }

    case 'compare_periods': {
      const a = asString(args['period_a']);
      const b = asString(args['period_b']);
      if (!a || !b || !PERIOD_RE.test(a) || !PERIOD_RE.test(b)) {
        return { kind: 'data', result: { ok: false, reason: 'Davrlar "YYYY-MM" ko‘rinishida bo‘lishi kerak' } };
      }
      const [ra, rb] = await Promise.all([
        q.districtOverview(tc.ctx, a), q.districtOverview(tc.ctx, b),
      ]);
      if (!ra || !rb) {
        return {
          kind: 'data',
          result: { ok: false, reason: `Ma’lumot yo‘q: ${!ra ? a : b}` },
        };
      }

      /*
       * Ikkala davr ham TO'LIQ oy bo'lmasligi mumkin (masalan, biri joriy,
       * hali tugamagan oy) - bunday holda energiya ko'rsatkichlari har
       * ikkala davrning ham FAQAT boshidan bir xil kunlar soni bilan
       * solishtiriladi, aks holda qisqaroq davr doim "keskin kamaydi"
       * ko'rsatadi (`districtOverview`dagi bilan bir xil mantiq).
       */
      const alignDays = Math.min(
        ra.totals.days_filled || q.daysInMonth(a), q.daysInMonth(a),
        rb.totals.days_filled || q.daysInMonth(b), q.daysInMonth(b),
      );
      const needsAlign = alignDays < q.daysInMonth(a) || alignDays < q.daysInMonth(b);
      const [alignedA, alignedB] = needsAlign
        ? await Promise.all([
          q.dayAlignedEnergyTotals(tc.ctx, a, alignDays, null, null),
          q.dayAlignedEnergyTotals(tc.ctx, b, alignDays, null, null),
        ])
        : [null, null];

      const kwhInA = alignedA?.kwh_in ?? ra.totals.kwh_in;
      const kwhInB = alignedB?.kwh_in ?? rb.totals.kwh_in;
      const kwhSoldA = alignedA?.kwh_sold ?? ra.totals.kwh_sold;
      const kwhSoldB = alignedB?.kwh_sold ?? rb.totals.kwh_sold;
      const kwhLossA = alignedA?.kwh_loss_total ?? ra.totals.kwh_loss_total;
      const kwhLossB = alignedB?.kwh_loss_total ?? rb.totals.kwh_loss_total;

      const delta = (x: number, y: number): number | null =>
        y === 0 ? null : Number((((x - y) / y) * 100).toFixed(1));
      return {
        kind: 'data',
        result: {
          [a]: ra.totals, [b]: rb.totals,
          daysCompared: needsAlign ? alignDays : null,
          note: needsAlign
            ? `Energiya ko‘rsatkichlari (kwhIn/kwhSold/kwhLossTotal) har ikkala davrning ham`
              + ` dastlabki ${alignDays} kuni bo‘yicha solishtirildi - biri to‘liq tugamagan.`
            : null,
          deltaPct: {
            kwhIn: delta(kwhInA, kwhInB),
            kwhSold: delta(kwhSoldA, kwhSoldB),
            kwhLossTotal: delta(kwhLossA, kwhLossB),
            consumersTotal: delta(ra.totals.consumers_total, rb.totals.consumers_total),
          },
        },
      };
    }

    case 'get_series': {
      const bucket = (asString(args['bucket']) ?? 'day') as 'day' | 'week' | 'month';
      const last = Math.min(Math.max(asNumber(args['last']) ?? 30, 2), 365);
      const range = await q.dataRange(tc.ctx);
      if (!range.maxDate) return { kind: 'data', result: { rows: [] } };
      const rows = await q.timeSeries(tc.ctx, range.minDate ?? range.maxDate, range.maxDate, bucket, tc.feederId);
      return { kind: 'data', result: { bucket, rows: rows.slice(-last) } };
    }

    case 'list_works': {
      const status = asString(args['status']) ?? null;
      const rows = await q.works(tc.ctx, tc.feederId, status, 40);
      return { kind: 'data', result: { count: rows.length, rows } };
    }

    case 'get_work': {
      const id = asNumber(args['id']);
      if (id === undefined) return { kind: 'data', result: { found: false } };
      const work = await q.workDetail(tc.ctx, id);
      return { kind: 'data', result: work ? { found: true, work } : { found: false } };
    }

    case 'get_violations': {
      const res = await q.violations(tc.ctx, period, tc.feederId);
      return { kind: 'data', result: res };
    }

    case 'list_review_queue': {
      const rows = await entry.reviewQueue(tc.ctx);
      return { kind: 'data', result: { count: rows.length, rows } };
    }

    case 'get_completeness': {
      const rows = await entry.completeness(tc.ctx, period);
      const missing = rows.filter((r) => r.status === 'missing');
      return { kind: 'data', result: { period, total: rows.length, missingCount: missing.length, rows } };
    }

    case 'reconcile_passport': {
      const rows = await passport.reconcile(tc.ctx, period);
      const mismatches = rows.filter((r) => !r.ok);
      return { kind: 'data', result: { period, mismatchCount: mismatches.length, rows } };
    }

    case 'search_debtor': {
      const text = asString(args['query']);
      if (!text) return denied('Qidiruv matni kerak');
      const limit = Math.min(Math.max(asNumber(args['limit']) ?? 10, 1), 50);
      const rows = await q.searchDebtor(tc.ctx, text, limit);
      return { kind: 'data', result: { count: rows.length, rows } };
    }

    case 'get_anomalies': {
      const report = await analytics.detectAnomalies(tc.ctx, tc.feederId, period);
      return { kind: 'data', result: report };
    }

    case 'get_tp_loss_anomalies': {
      const report = await analytics.detectTpLossAnomalies(tc.ctx, tc.feederId);
      return { kind: 'data', result: report };
    }

    case 'forecast_losses': {
      const monthsAhead = Math.min(Math.max(asNumber(args['months_ahead']) ?? 3, 1), 12);
      const report = await analytics.forecastLosses(tc.ctx, tc.feederId, monthsAhead);
      return { kind: 'data', result: report };
    }

    case 'get_alerts': {
      const report = await alerts.computeAlerts(tc.ctx, tc.feederId, period);
      return { kind: 'data', result: report };
    }

    case 'validate_submission': {
      const id = asNumber(args['id']);
      if (id === undefined) return denied('Qoralama raqami kerak');
      // Faqat tekshiradi - holatni o'zgartirmaydi, `submit_submission` ichida shu chaqiriladi.
      const report = await entry.validateSubmission(tc.ctx, id);
      return { kind: 'data', result: report };
    }

    case 'recommend_works': {
      return { kind: 'data', result: await recommendWorks(tc, period) };
    }

    // ── B. Interfeys ────────────────────────────────────────────────────────
    case 'navigate': {
      const path = asString(args['path']);
      if (!path?.startsWith('/')) {
        return { kind: 'data', result: { ok: false, reason: 'Noto‘g‘ri sahifa manzili' } };
      }
      const search = asString(args['search']) ?? null;
      return {
        kind: 'action',
        action: { type: 'navigate', payload: { path, search } },
        result: { ok: true, opened: path },
      };
    }

    case 'set_period': {
      const p = asString(args['period']);
      if (!p || !PERIOD_RE.test(p)) {
        return { kind: 'data', result: { ok: false, reason: 'Davr "YYYY-MM" ko‘rinishida bo‘lishi kerak' } };
      }
      return {
        kind: 'action',
        action: { type: 'set_period', payload: { period: p } },
        result: { ok: true, period: p },
      };
    }

    case 'set_as_of_date': {
      const d = asString(args['date']);
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return { kind: 'data', result: { ok: false, reason: 'Sana "YYYY-MM-DD" ko‘rinishida bo‘lishi kerak' } };
      }
      return {
        kind: 'action',
        action: { type: 'set_as_of_date', payload: { date: d } },
        result: { ok: true, date: d },
      };
    }

    case 'download_report': {
      const kind = asString(args['kind']) ?? 'monthly';
      const ext = asString(args['ext']) === 'pdf' ? 'pdf' : 'xlsx';
      /*
       * Manzil SERVERDA quriladi - model ixtiyoriy URL bera olmasin.
       * `/api` prefiksi qo'shilmaydi: klient uni `apiUrl()` bilan qo'shadi.
       */
      const url = kind === 'passport'
        ? (tc.feederId === null
            ? `/report/passport/tuman.${ext}?period=${period}`
            : `/report/passport/mfy/${tc.feederId}.${ext}?period=${period}`)
        : `/report/period/${kind}.${ext}?period=${period}`;

      return {
        kind: 'action',
        action: { type: 'download', payload: { url, ext, kind, period } },
        result: { ok: true, note: 'Fayl foydalanuvchining brauzeriga yuklanmoqda', kind, ext, period },
      };
    }

    case 'show_chart': {
      const kind = asString(args['kind']) ?? '';
      const allowedKinds = ['energy_trend', 'tp_ranking', 'loss_breakdown', 'loss_forecast'];
      if (!allowedKinds.includes(kind)) {
        return denied(`Noma’lum diagramma turi. Mumkin: ${allowedKinds.join(', ')}`);
      }

      /*
       * Manzil SERVERDA quriladi - model ixtiyoriy URL bera olmasin, xuddi
       * `download_report` dagidek. `/api` prefiksi qo'shilmaydi: klient uni
       * o'zi qo'shadi. Rasmning o'zi bu yerda EMAS - brauzer/bot shu URL ni
       * chaqirganda serverda tayyorlanadi.
       */
      const qs = new URLSearchParams({ period });
      const sortBy = asString(args['sort_by']);
      if (sortBy) qs.set('sort_by', sortBy);
      const limit = asNumber(args['limit']);
      if (limit !== undefined) qs.set('limit', String(limit));
      const monthsAhead = asNumber(args['months_ahead']);
      if (monthsAhead !== undefined) qs.set('months_ahead', String(monthsAhead));
      const url = `/report/chart/${kind}.png?${qs.toString()}`;

      return {
        kind: 'action',
        action: { type: 'chart', payload: { url, kind, period } },
        result: { ok: true, note: `Diagramma tayyorlandi: ${kind}`, kind },
      };
    }

    case 'render_table': {
      const title = asString(args['title']);
      if (!title) return denied('Jadval uchun sarlavha (title) kerak');

      const columnsRaw = args['columns'];
      if (!Array.isArray(columnsRaw) || columnsRaw.length === 0) {
        return denied('columns - ustun sarlavhalari massivi bo‘lishi kerak (kamida 1 ta)');
      }
      const rowsRaw = args['rows'];
      if (!Array.isArray(rowsRaw) || rowsRaw.length === 0 || !rowsRaw.every((r) => Array.isArray(r))) {
        return denied('rows - massivlar massivi bo‘lishi kerak, har biri bitta jadval qatori');
      }

      // Model buzuq/keraksiz katta ma'lumot yubormasin - tavsifda aytilgan chegaralar shu yerda majburlanadi.
      const columns = columnsRaw.slice(0, 8).map((c) => String(c));
      const rows: (string | number)[][] = rowsRaw.slice(0, 30).map((r) =>
        (r as unknown[]).map((cell) => (typeof cell === 'string' || typeof cell === 'number' ? cell : String(cell))));

      /*
       * Rasm to'g'ridan-to'g'ri shu yerda, SINXRON tayyorlanadi - `show_chart`
       * dagidek keyinroq alohida HTTP marshrut orqali emas: bu ma'lumotlar
       * fayl sifatida saqlanmagan, faqat shu chaqiruvda mavjud (model o'zi
       * bergan raqamlar), shuning uchun manzil emas, tayyor rasm qaytariladi.
       */
      const buffer = renderTable(title, columns, rows);
      const url = `data:image/png;base64,${buffer.toString('base64')}`;

      return {
        kind: 'action',
        action: { type: 'chart', payload: { url, kind: 'custom_table', period } },
        result: { ok: true, note: `Jadval tayyorlandi: ${title}` },
      };
    }

    case 'render_custom_chart': {
      const title = asString(args['title']);
      if (!title) return denied('Diagramma uchun sarlavha (title) kerak');

      const chartType = asString(args['chart_type']) ?? '';
      const allowedTypes = ['line', 'bar', 'donut'];
      if (!allowedTypes.includes(chartType)) {
        return denied(`Noma’lum diagramma turi. Mumkin: ${allowedTypes.join(', ')}`);
      }

      const itemsRaw = args['items'];
      if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
        return denied('items - kamida bitta {label, value} elementidan iborat massiv bo‘lishi kerak');
      }
      const items: { series?: string; label: string; value: number }[] = [];
      for (const raw of itemsRaw.slice(0, 60)) {
        if (typeof raw !== 'object' || raw === null) continue;
        const rec = raw as Record<string, unknown>;
        const label = asString(rec['label']);
        const value = asNumber(rec['value']);
        if (label === undefined || value === undefined) continue;
        const series = asString(rec['series']);
        items.push(series ? { series, label, value } : { label, value });
      }
      if (items.length === 0) {
        return denied('items ichida to‘g‘ri {label, value} elementi topilmadi');
      }

      const buffer = renderCustomChart(title, chartType as 'line' | 'bar' | 'donut', items);
      const url = `data:image/png;base64,${buffer.toString('base64')}`;

      return {
        kind: 'action',
        action: { type: 'chart', payload: { url, kind: 'custom_chart', period } },
        result: { ok: true, note: `Diagramma tayyorlandi: ${title}` },
      };
    }

    // ── C. Yozish ───────────────────────────────────────────────────────────
    case 'create_submission': {
      const mfyId = asNumber(args['mfy_id']) ?? tc.feederId;
      if (mfyId === null || mfyId === undefined) return denied('Fider aniqlanmadi');

      const domain = asString(args['domain']);
      if (!domain || !(DOMAINS as readonly string[]).includes(domain)) {
        return denied(`Noma’lum hisobot turi. Mumkin: ${DOMAINS.join(', ')}`);
      }
      const p = asString(args['period']);
      if (!p || !PERIOD_RE.test(p)) return denied('Davr "YYYY-MM" ko‘rinishida bo‘lishi kerak');

      const sub = await entry.openDraft(tc.ctx, mfyId, domain as Domain, p);
      return { kind: 'data', result: { ok: true, submission: sub } };
    }

    case 'save_monthly_return': {
      const id = asNumber(args['submission_id']);
      if (id === undefined) return denied('Qoralama raqami kerak');

      const sub = await entry.getSubmission(tc.ctx, id);
      if (!sub) return denied('Qoralama topilmadi');
      if (sub.domain !== 'MONTHLY_RETURN') {
        return denied(`Bu qoralama "${sub.domain}" turida - bu asbob faqat MONTHLY_RETURN uchun`);
      }
      /*
       * Mavjud qiymatlar ustiga yoziladi: model odatda faqat o'zgargan
       * maydonlarni beradi, `saveMonthlyReturn` esa TO'LIQ qatorni kutadi.
       * Aks holda aytilmagan maydonlar nolga tushib ketardi.
       */
      const current = await entry.monthlyReturnRow(tc.ctx, id);
      const merged = {
        consumersPopulation: asNumber(args['consumers_population']) ?? current?.consumersPopulation ?? 0,
        consumersLegal: asNumber(args['consumers_legal']) ?? current?.consumersLegal ?? 0,
        consumersActive: asNumber(args['consumers_active']) ?? current?.consumersActive ?? 0,
        consumersDisconnected: asNumber(args['consumers_disconnected']) ?? current?.consumersDisconnected ?? 0,
        consumersNew: asNumber(args['consumers_new']) ?? current?.consumersNew ?? 0,
        debtPopulationMln: asNumber(args['debt_population_mln']) ?? current?.debtPopulationMln ?? 0,
        debtLegalMln: asNumber(args['debt_legal_mln']) ?? current?.debtLegalMln ?? 0,
        debtBudgetMln: asNumber(args['debt_budget_mln']) ?? current?.debtBudgetMln ?? 0,
        metersOfflineCnt: asNumber(args['meters_offline_cnt']) ?? current?.metersOfflineCnt ?? 0,
        lowConsumptionCnt: asNumber(args['low_consumption_cnt']) ?? current?.lowConsumptionCnt ?? 0,
        metersReplaceNeedCnt: asNumber(args['meters_replace_need_cnt']) ?? current?.metersReplaceNeedCnt ?? 0,
        metersReplacedCnt: asNumber(args['meters_replaced_cnt']) ?? current?.metersReplacedCnt ?? 0,
      };

      // Shakl bilan BIR XIL tekshiruv - AI orqali chetlab o'tib bo'lmasin.
      const parsed = monthlyReturnSchema.safeParse(merged);
      if (!parsed.success) {
        return denied(
          'Raqamlar mantiqan mos emas: '
          + parsed.error.issues.map((i) => i.message).join('; '),
        );
      }

      await entry.saveMonthlyReturn(tc.ctx, id, parsed.data as MonthlyReturn);
      return { kind: 'data', result: { ok: true, saved: parsed.data } };
    }

    case 'submit_submission':
    case 'approve_submission':
    case 'reject_submission': {
      const id = asNumber(args['id']);
      if (id === undefined) return denied('Hisobot raqami kerak');

      if (name === 'submit_submission') {
        const report = await entry.validateSubmission(tc.ctx, id);
        if (!report.ok) {
          return denied(
            'Hisobotda xatolar bor, yuborib bo‘lmaydi: '
            + report.issues.slice(0, 5).map((i) => i.message).join('; '),
          );
        }
        const sub = await entry.changeStatus(tc.ctx, id, 'submitted', null);
        return { kind: 'data', result: { ok: true, submission: sub } };
      }

      if (name === 'approve_submission') {
        const sub = await entry.changeStatus(tc.ctx, id, 'approved', null);
        // Jamlanmalar fon rejimida - javob kutib qolmasin.
        void refreshAggregates().catch(() => undefined);
        return { kind: 'data', result: { ok: true, submission: sub } };
      }

      const note = asString(args['note']);
      if (!note) return denied('Rad etish sababi majburiy');
      const sub = await entry.changeStatus(tc.ctx, id, 'rejected', note);
      return { kind: 'data', result: { ok: true, submission: sub } };
    }

    case 'create_work': {
      const mfyId = asNumber(args['mfy_id']) ?? tc.feederId;
      if (mfyId === null || mfyId === undefined) return denied('Fider/MFY aniqlanmadi');

      const workType = asString(args['work_type']);
      if (!workType || !(WORK_TYPES as readonly string[]).includes(workType)) {
        return denied(`Noma’lum ish turi. Mumkin: ${WORK_TYPES.join(', ')}`);
      }
      const titleRaw = asString(args['title']);
      if (!titleRaw) return denied('Ish nomi (title) kerak');
      /*
       * AI yaratgan ishlarni mavjud UI'da (dalolatnoma, ishlar ro'yxati)
       * vizual ajratib turish uchun - yangi DB ustuni qo'shmasdan eng arzon
       * yechim, xuddi rasm izohlaridagi kabi oddiy matn belgisi.
       */
      const AI_PREFIX = 'AI tavsiyasi: ';
      const titleUz = titleRaw.startsWith(AI_PREFIX) ? titleRaw : `${AI_PREFIX}${titleRaw}`;

      const candidate = {
        mfyId, tpId: asNumber(args['tp_id']) ?? null, workType, titleUz,
        description: asString(args['description']) ?? null,
        status: asString(args['status']) ?? 'PLANNED',
        plannedStart: asString(args['planned_start']) ?? null,
        plannedEnd: asString(args['planned_end']) ?? null,
        actualEnd: asString(args['actual_end']) ?? null,
        progressPct: asNumber(args['progress_pct']) ?? 0,
        quantity: asNumber(args['quantity']) ?? 0,
        unit: asString(args['unit']) ?? 'ta',
        costMln: asNumber(args['cost_mln']) ?? 0,
        effectLossPctBefore: null, effectLossPctAfter: null, effectSavingKwhMonth: 0,
      };

      // `workSchema` - forma bilan BIR XIL tekshiruv, AI orqali chetlab o'tib bo'lmasin.
      const parsed = workSchema.safeParse(candidate);
      if (!parsed.success) {
        return denied(
          'Ma’lumotlar mos emas: ' + parsed.error.issues.map((i) => i.message).join('; '),
        );
      }

      const work = await q.createWork(tc.ctx, parsed.data as Work);
      return { kind: 'data', result: { ok: true, work } };
    }

    case 'update_work_status': {
      const id = asNumber(args['id']);
      if (id === undefined) return denied('Ish raqami kerak');

      const current = await q.workDetail(tc.ctx, id);
      if (!current) return denied('Ish topilmadi');

      const status = asString(args['status']);
      if (!status || !(WORK_STATUSES as readonly string[]).includes(status)) {
        return denied(`Noma’lum holat. Mumkin: ${WORK_STATUSES.join(', ')}`);
      }

      /*
       * Berilmagan maydonlar MAVJUD qiymatdan olinadi va TO'LIQ obyekt
       * sifatida qayta tekshiriladi - `routes/dash.ts`dagi PATCH marshruti
       * bilan BIR XIL naqsh (status/progressPct/actualEnd birga mos kelishi
       * shart, DB CHECK shuni talab qiladi).
       */
      const merged = workSchema.safeParse({
        mfyId: current.mfyId, tpId: null, workType: current.workType,
        titleUz: current.titleUz, description: current.description,
        status,
        plannedStart: current.plannedStart, plannedEnd: current.plannedEnd,
        actualEnd: asString(args['actual_end']) ?? current.actualEnd,
        progressPct: asNumber(args['progress_pct']) ?? current.progressPct,
        quantity: current.quantity, unit: current.unit, costMln: current.costMln,
        effectLossPctBefore: current.effectLossPctBefore,
        effectLossPctAfter: current.effectLossPctAfter,
        effectSavingKwhMonth: current.effectSavingKwhMonth,
      });
      if (!merged.success) {
        return denied(
          'Holat mos emas: ' + merged.error.issues.map((i) => i.message).join('; '),
        );
      }

      const work = await q.updateWorkStatus(tc.ctx, id, {
        status: merged.data.status,
        progressPct: merged.data.progressPct,
        actualEnd: merged.data.actualEnd ?? null,
      });
      return { kind: 'data', result: { ok: true, work } };
    }

    case 'update_tp_status': {
      const code = asString(args['tp_code']);
      if (!code) return denied('TP kodi (tp_code) kerak');

      const tp = await resolveTpByCode(tc, code, period);
      if (!tp) return denied(`"${code}" nomli TP topilmadi`);

      const sub = await entry.openDraft(tc.ctx, tp.mfyId, 'TP_STATUS', period);
      const existing = await entry.tpStatusRows(tc.ctx, sub.id);
      const current = existing.find((r) => r.tpId === tp.tpId);

      /*
       * Bitta TP ni yangilash uchun BUTUN ro'yxat qayta yuboriladi
       * (`saveTpStatus` hammasini o'chirib qayta yozadi) - shuning uchun
       * boshqa TP larning MAVJUD qatorlari saqlanadi, faqat shu birining
       * qatori yangilanadi/qo'shiladi.
       */
      const candidate = {
        tpId: tp.tpId,
        loadPct: asNumber(args['load_pct']) ?? current?.loadPct ?? 0,
        peakKva: asNumber(args['peak_kva']) ?? current?.peakKva ?? 0,
        condition: asString(args['condition']) ?? current?.condition ?? 'GOOD',
        underLoad: typeof args['under_load'] === 'boolean' ? args['under_load'] : current?.underLoad ?? false,
        repairNeeded: typeof args['repair_needed'] === 'boolean'
          ? args['repair_needed'] : current?.repairNeeded ?? false,
        repairReason: asString(args['repair_reason']) ?? current?.repairReason ?? null,
      };
      const merged = [...existing.filter((r) => r.tpId !== tp.tpId), candidate];

      const parsed = tpStatusPatchSchema.safeParse({ rows: merged });
      if (!parsed.success) {
        return denied(
          'Ma’lumotlar mos emas: ' + parsed.error.issues.map((i) => i.message).join('; '),
        );
      }

      await entry.saveTpStatus(tc.ctx, sub.id, parsed.data.rows);
      return {
        kind: 'data',
        result: { ok: true, submissionId: sub.id, tpCode: tp.code, saved: candidate },
      };
    }

    case 'update_network_defect': {
      const mfyId = asNumber(args['mfy_id']) ?? tc.feederId;
      if (mfyId === null || mfyId === undefined) return denied('Fider/MFY aniqlanmadi');


      const voltageKv = asNumber(args['voltage_kv']);
      if (voltageKv === undefined) return denied('Kuchlanish klassi (voltage_kv) kerak');
      const repairNeededKm = asNumber(args['repair_needed_km']);
      if (repairNeededKm === undefined) return denied('repair_needed_km kerak');

      const sub = await entry.openDraft(tc.ctx, mfyId, 'NETWORK_DEFECT', period);
      const existing = await entry.networkDefectRows(tc.ctx, sub.id);
      const current = existing.find((r) => r.voltageKv === voltageKv);

      const candidate = {
        voltageKv, repairNeededKm,
        repairedKm: asNumber(args['repaired_km']) ?? current?.repairedKm ?? 0,
      };
      const merged = [...existing.filter((r) => r.voltageKv !== voltageKv), candidate];

      const parsed = networkDefectPatchSchema.safeParse({ rows: merged });
      if (!parsed.success) {
        return denied(
          'Ma’lumotlar mos emas: ' + parsed.error.issues.map((i) => i.message).join('; '),
        );
      }

      await entry.saveNetworkDefect(tc.ctx, sub.id, parsed.data.rows);
      return { kind: 'data', result: { ok: true, submissionId: sub.id, saved: candidate } };
    }

    default:
      return { kind: 'data', result: { ok: false, reason: `Noma’lum asbob: ${name}` } };
  }
}
