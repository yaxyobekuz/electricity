/**
 * Ogohlantirishlar — tizimdagi 5 xil mustaqil manbani BITTA ro'yxatga yig'adi.
 *
 * Bu fayl o'zi HECH QANDAY yangi SQL yozmaydi — faqat mavjud
 * `services/analytics.ts` va `db/queries/*` funksiyalarini chaqiradi va
 * natijalarni bitta umumiy shaklga ("severity/code/messageUz") keltiradi.
 * Sabab oddiy: har bir manba (anomaliya, qoidabuzarlik, muddati o'tgan ish,
 * to'ldirilmagan hisobot, pasport nomuvofiqligi) allaqachon o'z joyida to'g'ri
 * hisoblanadi — bu yerda faqat "buni ogohlantirish deb hisoblaymizmi va qanday
 * darajada" degan qoida qo'shiladi.
 *
 * KIM CHAQIRADI: keyingi bosqichda qo'shiladigan CRON job (har kuni bir marta,
 * `SYSTEM_CONTEXT` bilan — foydalanuvchi sessiyasi yo'q) va AI agentning
 * o'z asbobi (so'ragan foydalanuvchi konteksti bilan). Shuning uchun
 * `AppContext` chaqiruvchidan PARAMETR sifatida keladi, bu yerda
 * qattiq yozilmaydi.
 *
 * KESHLASH BU YERDA YO'Q: natijani keshlash chaqiruvchining ishi (cron o'z
 * natijasini saqlaydi, AI asbobi esa har safar joriy holatni ko'rishi kerak).
 */
import { DOMAIN_LABEL_UZ, DOMAINS, type Domain } from '@beap/shared';

import { type AppContext, queryOne } from '../db/pool.ts';
import * as q from '../db/queries/dashboard.ts';
import * as entry from '../db/queries/entry.ts';
import * as passport from '../db/queries/passport.ts';
import { detectAnomalies } from './analytics.ts';

// ─── Natija turlari ─────────────────────────────────────────────────────────

export type AlertSeverity = 'high' | 'medium' | 'low';

export interface AlertItem {
  severity: AlertSeverity;
  /** Barqaror qoida kodi — UI yoki Telegram xabarida filtr/ikonka uchun. */
  code: string;
  messageUz: string;
  /** Bosilganda qayerga o'tish kerakligini bildiradi ('tp', 'work', 'day' ...). */
  refType?: string;
  refId?: string | number;
}

export interface AlertsReport {
  period: string;
  generatedAt: string;
  items: AlertItem[];
  summaryText: string;
}

// ─── Yordamchilar ───────────────────────────────────────────────────────────

/** 1048000 → "1 048 000" — Telegram xabarida ham, AI javobida ham bir xil ko'rinsin. */
function n(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).replace(/,/g, ' ');
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Ish muddatidan shuncha kun o'tgan bo'lsa — 'medium' emas, 'high'. */
const WORK_OVERDUE_HIGH_DAYS = 30;

// ─── Asosiy funksiya ────────────────────────────────────────────────────────

export async function computeAlerts(
  ctx: AppContext, feederId: number | null, period?: string,
): Promise<AlertsReport> {
  const resolvedPeriod = period ?? (await q.latestPeriod(ctx));
  if (!resolvedPeriod) {
    return {
      period: '',
      generatedAt: new Date().toISOString(),
      items: [],
      summaryText: 'Tizimda hali ma\'lumot yo\'q — ogohlantirishlarni tekshirib bo\'lmadi.',
    };
  }

  /*
   * Fider berilmagan bo'lsa — AI yordamchisi (`ai.ts` `buildSnapshot`) bilan
   * AYNAN BIR XIL qoidada yagona faol fiderni olamiz. Hozircha tizimda
   * amalda faqat bitta fider bor; kelajakda ko'payganda ikkala joy ham
   * birga o'zgaradi (izlash oson: bitta so'rov shakli).
   */
  let resolvedFeederId = feederId;
  if (resolvedFeederId === null) {
    const feeder = await queryOne<{ id: number }>(
      `SELECT m.id
         FROM ref.mfy m
        WHERE m.valid_to IS NULL
        ORDER BY m.sort_order, m.id
        LIMIT 1`,
      [], ctx,
    );
    resolvedFeederId = feeder?.id ?? null;
  }

  const [anomalies, violationSummary, plannedWorks, completenessCells, reconcileRows] = await Promise.all([
    detectAnomalies(ctx, resolvedFeederId, resolvedPeriod),
    q.violations(ctx, resolvedPeriod, resolvedFeederId),
    q.works(ctx, resolvedFeederId, 'PLANNED', 100),
    entry.completeness(ctx, resolvedPeriod),
    passport.reconcile(ctx, resolvedPeriod),
  ]);

  const items: AlertItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // 1. Statistik anomaliyalar (kunlik yo'qotish + TP holati) — `analytics.ts`.
  for (const a of anomalies.dailyAnomalies) {
    items.push({
      severity: a.severity, code: 'daily_loss_anomaly', messageUz: a.messageUz,
      refType: 'day', refId: a.date,
    });
  }
  for (const a of anomalies.tpAnomalies) {
    items.push({
      severity: a.severity,
      code: a.condition === 'FAULT' ? 'tp_fault' : 'tp_overload',
      messageUz: a.messageUz,
      refType: 'tp', refId: a.tpId,
    });
  }

  // 2. Qoidabuzarliklar — jinoiy/ma'muriy holat 'high', iste'molchi aybsiz 'medium'.
  for (const row of violationSummary.rows) {
    if (row.count === 0) continue;
    const severity: AlertSeverity = row.caseType === 'NO_FAULT' ? 'medium' : 'high';
    items.push({
      severity,
      code: `violation_${row.caseType.toLowerCase()}`,
      messageUz: `${row.labelUz}: ${row.count} ta dalolatnoma (${violationSummary.from} … `
        + `${violationSummary.to}), jarima ${n(row.fineMln)} mln so'm, aniqlangan `
        + `${n(row.kwhIdentified, 0)} kWh.`,
      refType: 'violation_case', refId: row.caseType,
    });
  }

  // 3. Muddati o'tgan rejalashtirilgan ishlar — `planned_end` o'tmishda bo'lsa.
  for (const w of plannedWorks) {
    if (!w.plannedEnd || w.plannedEnd >= today) continue;
    const overdueDays = Math.floor(
      (Date.parse(today) - Date.parse(w.plannedEnd)) / 86_400_000,
    );
    items.push({
      severity: overdueDays > WORK_OVERDUE_HIGH_DAYS ? 'high' : 'medium',
      code: 'work_overdue',
      messageUz: `"${w.titleUz}" (${w.mfyName}${w.tpCode ? `, ${w.tpCode}` : ''}) ishi `
        + `muddati ${w.plannedEnd} da tugagan, ${overdueDays} kun kechikmoqda — hali `
        + `"${w.status}" holatida.`,
      refType: 'work', refId: w.id,
    });
  }

  // 4. Ma'lumot bo'shliqlari — domen bo'yicha guruhlanadi, aks holda 51 MFY x
  //    8 domen bo'lganda ro'yxat o'qib bo'lmas darajada uzun bo'lib ketardi.
  const missingByDomain = new Map<Domain, number>();
  for (const cell of completenessCells) {
    if (cell.status !== 'missing') continue;
    missingByDomain.set(cell.domain, (missingByDomain.get(cell.domain) ?? 0) + 1);
  }
  for (const domain of DOMAINS) {
    const missing = missingByDomain.get(domain);
    if (!missing) continue;
    const total = completenessCells.filter((c) => c.domain === domain).length;
    items.push({
      severity: missing >= total ? 'high' : 'medium',
      code: 'data_gap',
      messageUz: `${DOMAIN_LABEL_UZ[domain]}: ${resolvedPeriod} uchun ${missing}/${total} `
        + `MFY hali hisobot topshirmagan.`,
      refType: 'domain', refId: domain,
    });
  }

  // 5. Pasport nomuvofiqligi — MFY yig'indisi tuman pasportiga mos kelmasa.
  for (const row of reconcileRows) {
    if (row.ok) continue;
    items.push({
      severity: 'medium',
      code: 'passport_mismatch',
      messageUz: `"${row.labelUz}": MFY lar yig'indisi ${n(row.sumOfMfy)} — tuman `
        + `pasportidagi ${n(row.frozenValue)} qiymatdan farq qiladi (Δ ${n(row.diff)}).`,
      refType: 'passport_row', refId: row.no,
    });
  }

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    period: resolvedPeriod,
    generatedAt: new Date().toISOString(),
    items,
    summaryText: buildSummary(items, resolvedPeriod),
  };
}

// ─── Kunlik cron uchun kesh ─────────────────────────────────────────────────

/*
 * Kunlik push cron (`server.ts`) natijasini shu yerda saqlaydi, `routes/ai.ts`
 * GET `/alerts` esa shundan o'qiydi — har bir HTTP so'rovda qayta
 * hisoblanmasin. Modul darajasidagi oddiy o'zgaruvchi yetarli: bitta
 * jarayon (process), yangi DB jadvali shart emas. `server.ts` dan bu yerga
 * import qilingani uchun `routes/ai.ts` ni `server.ts` ga bog'lab qo'ymaydi
 * (aylanma import bo'lmasin).
 */
let cachedDigest: AlertsReport | null = null;

export function setCachedDigest(report: AlertsReport): void {
  cachedDigest = report;
}

export function getCachedDigest(): AlertsReport | null {
  return cachedDigest;
}

// ─── Qisqa matn xulosasi ────────────────────────────────────────────────────

/** Ko'rsatiladigan misollar soni — Telegram xabari ekranga sig'ishi kerak. */
const SUMMARY_EXAMPLES = 5;

/**
 * Uzbek tilida QISQA xulosa — AI chat javobi VA Telegram push matni sifatida
 * ishlatiladi, shuning uchun markdown yo'q, faqat oddiy matn va "·" belgisi
 * (xuddi `ai.ts` dagi `systemPrompt()` qoidasidagi kabi).
 */
function buildSummary(items: AlertItem[], period: string): string {
  if (items.length === 0) {
    return `✅ ${period}: ogohlantirish yo'q, barcha ko'rsatkichlar me'yorida.`;
  }

  const high = items.filter((i) => i.severity === 'high').length;
  const medium = items.filter((i) => i.severity === 'medium').length;
  const low = items.filter((i) => i.severity === 'low').length;

  const lines: string[] = [`⚠️ ${period}: ${items.length} ta muammo aniqlandi.`];
  const counts = [
    high > 0 ? `yuqori — ${high} ta` : null,
    medium > 0 ? `o'rta — ${medium} ta` : null,
    low > 0 ? `past — ${low} ta` : null,
  ].filter((s): s is string => s !== null);
  if (counts.length > 0) lines.push(counts.join(', ') + '.');

  const examples = items.slice(0, SUMMARY_EXAMPLES);
  for (const it of examples) lines.push(`· ${it.messageUz}`);
  if (items.length > examples.length) {
    lines.push(`... va yana ${items.length - examples.length} ta.`);
  }

  return lines.join('\n');
}
