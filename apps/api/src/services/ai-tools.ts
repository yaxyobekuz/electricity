/**
 * AI agentning ASBOBLARI.
 *
 * Model matn yozish bilan cheklanmaydi — u shu ro'yxatdagi amallarni chaqiradi
 * va tizim ular uchun javob beradi. Uch toifa bor:
 *
 *   A. MA'LUMOT   — serverda bajariladi, natija modelga qaytadi.
 *                   Hammasi MAVJUD `db/queries/*` funksiyalarini chaqiradi;
 *                   bu yerda yangi SQL yozilmaydi.
 *   B. INTERFEYS  — serverda BAJARILMAYDI. Server oqimga `action` hodisasini
 *                   chiqaradi, amalni brauzer bajaradi (sahifa ochish, davrni
 *                   almashtirish, fayl saqlash). Modelga `{ok:true}` qaytadi.
 *   C. YOZISH     — serverda, LEKIN faqat tizimga kirgan foydalanuvchi nomidan.
 *                   Rol va MFY doirasi tekshiruvlari `routes/entry.ts` dagi
 *                   bilan bir xil qoladi; ustidan Postgres RLS ham turadi.
 *
 * Nega asboblar ro'yxati qattiq belgilangan: model ixtiyoriy SQL yoki ixtiyoriy
 * HTTP so'rov yubora olmaydi. U faqat shu funksiyalarni, faqat shu
 * parametrlar bilan chaqira oladi — ya'ni qamrov kod bilan chegaralangan.
 */
import type { AuthUser, Domain, MonthlyReturn } from '@beap/shared';
import { DOMAINS, monthlyReturnSchema } from '@beap/shared';

import type { AppContext } from '../db/pool.ts';
import * as q from '../db/queries/dashboard.ts';
import * as entry from '../db/queries/entry.ts';
import { refreshAggregates } from './aggregates.ts';

export interface ToolContext {
  ctx: AppContext;
  user: AuthUser | null;
  /** Yagona fider — ko'p asboblar uchun standart qamrov. */
  feederId: number | null;
  /** Suhbat boshlangandagi davr — model boshqasini aytmasa shu ishlatiladi. */
  period: string;
  /** Foydalanuvchi berilgan MFY ga yoza oladimi. */
  canWriteMfy: (mfyId: number) => boolean;
}

/** Asbob natijasi: ma'lumot yoki brauzer bajaradigan amal. */
export type ToolOutcome =
  | { kind: 'data'; result: unknown }
  | { kind: 'action'; action: ClientAction; result: unknown };

export interface ClientAction {
  type: 'navigate' | 'set_period' | 'set_as_of_date' | 'download';
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
    + 'savollari uchun SHU asbobni ishlat — ro‘yxatni o‘zing saralama.',
    {
      sort_by: {
        type: 'string', enum: ['kwh', 'disconnected', 'off_share', 'consumers'],
        description: 'kwh — iste’mol; disconnected — uzilgan abonentlar soni; '
          + 'off_share — uzilganlar ulushi (%); consumers — abonentlar soni',
      },
      limit: int('Nechta qator kerak (1–51). Standart 10.'),
    }, ['sort_by']),

  fn('get_period_totals', 'Berilgan OY bo‘yicha umumiy ko‘rsatkichlar: kirgan energiya, '
    + 'sotilgan, yo‘qotish, abonentlar, TP soni.',
    { period: period('Oy, "YYYY-MM" ko‘rinishida') }, ['period']),

  fn('compare_periods', 'Ikki oyni solishtiradi va farqni foizda beradi.',
    { period_a: period('Birinchi oy'), period_b: period('Ikkinchi oy') },
    ['period_a', 'period_b']),

  fn('get_series', 'Kunlik/haftalik/oylik dinamika: kirgan, sotilgan, yo‘qotish.',
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

  // ── B. Interfeys amallari ─────────────────────────────────────────────────
  fn('navigate', 'Foydalanuvchini panelning boshqa sahifasiga OLIB O‘TADI. '
    + 'Sahifani aytish o‘rniga shu asbobni chaqir.',
    {
      path: {
        type: 'string',
        enum: ['/dashboard', '/transformers', '/energy-balance', '/works', '/reports',
          '/entry', '/review'],
        description: 'Qaysi sahifa ochilsin',
      },
      search: str('Sahifadagi qidiruv maydoniga qo‘yiladigan matn, masalan TP kodi. '
        + 'Faqat /transformers va /works uchun.'),
    }, ['path']),

  fn('set_period', 'Butun panelning hisobot OYINI almashtiradi — KPI kartalari, '
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
        description: 'Hisobot turi. passport — fider pasporti.',
      },
      ext: { type: 'string', enum: ['xlsx', 'pdf'], description: 'Fayl formati. Standart xlsx.' },
      period: period('Oy; berilmasa joriy davr'),
    }, ['kind']),

  // ── C. Yozish ─────────────────────────────────────────────────────────────
  fn('create_submission', 'Oylik hisobot uchun QORALAMA ochadi (yoki mavjudini qaytaradi).',
    {
      domain: { type: 'string', enum: [...DOMAINS], description: 'Hisobot turi' },
      period: period('Qaysi oy uchun'),
      mfy_id: int('Fider/MFY raqami; berilmasa yagona fider olinadi'),
    }, ['domain', 'period']),

  fn('save_monthly_return', 'Oylik hisobot raqamlarini SAQLAYDI. Faqat MONTHLY_RETURN '
    + 'qoralamasi uchun. Energiya balansi (31 kunlik jadval) bu asbob orqali '
    + 'kiritilmaydi — buning uchun navigate bilan shaklni och.',
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
];

/** Chat oynasida ko'rsatiladigan qisqa izoh — foydalanuvchi nima bo'layotganini bilsin. */
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
  navigate: 'Sahifa ochilmoqda',
  set_period: 'Davr almashtirilmoqda',
  set_as_of_date: 'Sana o’rnatilmoqda',
  download_report: 'Hisobot tayyorlanmoqda',
  create_submission: 'Qoralama ochilmoqda',
  save_monthly_return: 'Raqamlar saqlanmoqda',
  submit_submission: 'Hisobot yuborilmoqda',
  approve_submission: 'Hisobot tasdiqlanmoqda',
  reject_submission: 'Hisobot rad etilmoqda',
};

// ─── Yordamchilar ───────────────────────────────────────────────────────────

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Ruxsat yo'qligi — xato emas, modelga tushunarli javob. */
const denied = (reason: string): ToolOutcome => ({ kind: 'data', result: { ok: false, reason } });

const PERIOD_RE = /^\d{4}-\d{2}$/;

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
      const delta = (x: number, y: number): number | null =>
        y === 0 ? null : Number((((x - y) / y) * 100).toFixed(1));
      return {
        kind: 'data',
        result: {
          [a]: ra.totals, [b]: rb.totals,
          deltaPct: {
            kwhIn: delta(ra.totals.kwh_in, rb.totals.kwh_in),
            kwhSold: delta(ra.totals.kwh_sold, rb.totals.kwh_sold),
            kwhLossTotal: delta(ra.totals.kwh_loss_total, rb.totals.kwh_loss_total),
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
      if (!tc.user) return denied('Tasdiqlash navbatini ko‘rish uchun tizimga kirish kerak');
      if (tc.user.role !== 'admin' && tc.user.role !== 'elektroset_manager') {
        return denied('Tasdiqlash navbati faqat elektroset menejeri va administrator uchun');
      }
      const rows = await entry.reviewQueue(tc.ctx);
      return { kind: 'data', result: { count: rows.length, rows } };
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
       * Manzil SERVERDA quriladi — model ixtiyoriy URL bera olmasin.
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

    // ── C. Yozish ───────────────────────────────────────────────────────────
    case 'create_submission': {
      if (!tc.user) return denied('Hisobot ochish uchun tizimga kirish kerak');
      const mfyId = asNumber(args['mfy_id']) ?? tc.feederId;
      if (mfyId === null || mfyId === undefined) return denied('Fider aniqlanmadi');
      if (!tc.canWriteMfy(mfyId)) return denied('Bu fiderga yozish huquqingiz yo‘q');

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
      if (!tc.user) return denied('Ma’lumot kiritish uchun tizimga kirish kerak');
      const id = asNumber(args['submission_id']);
      if (id === undefined) return denied('Qoralama raqami kerak');

      const sub = await entry.getSubmission(tc.ctx, id);
      if (!sub) return denied('Qoralama topilmadi');
      if (sub.domain !== 'MONTHLY_RETURN') {
        return denied(`Bu qoralama "${sub.domain}" turida — bu asbob faqat MONTHLY_RETURN uchun`);
      }
      if (!tc.canWriteMfy(sub.scopeId)) return denied('Bu hisobotga yozish huquqingiz yo‘q');

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

      // Shakl bilan BIR XIL tekshiruv — AI orqali chetlab o'tib bo'lmasin.
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
      if (!tc.user) return denied('Bu amal uchun tizimga kirish kerak');
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

      if (tc.user.role !== 'admin' && tc.user.role !== 'elektroset_manager') {
        return denied('Tasdiqlash va rad etish faqat elektroset menejeri va administrator uchun');
      }

      if (name === 'approve_submission') {
        const sub = await entry.changeStatus(tc.ctx, id, 'approved', null);
        // Jamlanmalar fon rejimida — javob kutib qolmasin.
        void refreshAggregates().catch(() => undefined);
        return { kind: 'data', result: { ok: true, submission: sub } };
      }

      const note = asString(args['note']);
      if (!note) return denied('Rad etish sababi majburiy');
      const sub = await entry.changeStatus(tc.ctx, id, 'rejected', note);
      return { kind: 'data', result: { ok: true, submission: sub } };
    }

    default:
      return { kind: 'data', result: { ok: false, reason: `Noma’lum asbob: ${name}` } };
  }
}
