/**
 * AI-yozgan tahliliy xulosa (proza) - hokim uchun haftalik/oylik push.
 *
 * `alerts.ts` dagi ro'yxat/qoida asosidagi xulosadan farqi: bu yerda model
 * o'zi RAQAMLARNI o'qib, ular haqida ODAM TILIDA gapiradi - nima o'zgargani,
 * nega o'zgargani (berilgan ma'lumotga asoslanib) va nima qilish kerakligi.
 * Cron job (haftalik/oylik) buni tayyorlab Telegram'ga (`telegram.ts` orqali)
 * hokim guruhiga yuboradi - shuning uchun natija BITTA tayyor matn, oraliq
 * hodisalar (stream) kerak emas.
 *
 * `ai.ts`dagi `buildSnapshot` va `alerts.ts`dagi `computeAlerts` bu yerda
 * QAYTA ishlatiladi - raqamlarning yagona manbai o'sha yerda, bu fayl faqat
 * ularni birlashtirib modelga beradi va prozaga aylantiradi.
 *
 * Model chaqiruvi `ai.ts`dagi `streamTurn`ga o'xshaydi (fetch + Bearer kalit),
 * lekin OQIMSIZ: cron ichida hech kim bo'lak-bo'lak matnni kutib turmaydi,
 * bitta JSON javob yetarli va soddaroq.
 */
import { config } from '../config.ts';
import { type AppContext } from '../db/pool.ts';
import * as q from '../db/queries/dashboard.ts';
import type { OverviewResult } from '../db/queries/dashboard.ts';
import { aiEnabled, buildSnapshot } from './ai.ts';
import { computeAlerts } from './alerts.ts';

/** 1048000 → "1 048 000" - `ai.ts`/`alerts.ts` dagi bilan bir xil ko'rinish. */
function n(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).replace(/,/g, ' ');
}

/**
 * `dashboard.ts`dagi xususiy `shiftMonth`ning nusxasi.
 *
 * U yerdan eksport qilinmagan - bu yerga alohida ma'lumot manbasi (oldingi
 * kalendar oyi) kerak bo'lgani uchun shu yerda mustaqil hisoblanadi.
 */
function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ─── Davr raqamlarini matnga keltirish ──────────────────────────────────────

function formatTotals(period: string, t: OverviewResult['totals']): string {
  return [
    `  ${period}:`,
    `    Kirgan energiya: ${n(t.kwh_in)} kWh`,
    `    Sotilgan energiya: ${n(t.kwh_sold)} kWh`,
    `    Jami yo‘qotish: ${n(t.kwh_loss_total)} kWh`
    + ` (${t.loss_pct === null ? '-' : `${t.loss_pct.toFixed(1)}%`})`,
    `    Texnologik yo‘qotish: ${n(t.kwh_loss_technical)} kWh`,
    `    Iste'molchilar: jami ${n(t.consumers_total)}, faol ${n(t.consumers_active)},`
    + ` uzilgan ${n(t.consumers_disconnected)}`,
    `    Transformator punktlari: ${n(t.tp_total)} ta`,
  ].join('\n');
}

/**
 * Turga qarab qo'shimcha asoslovchi kontekst yig'adi:
 *   · haftalik - kunlik dinamika (hafta ichidagi harakatni ko'rsatish uchun,
 *     oylik jamlanma buni bermaydi);
 *   · oylik - joriy va oldingi kalendar oyining xom jamlanmasi (model o'zi
 *     taqqoslasin, farqni oldindan hisoblab bermaymiz).
 */
async function gatherContext(
  ctx: AppContext, feederId: number | null, kind: 'weekly' | 'monthly', period: string,
): Promise<string> {
  const alertsReport = await computeAlerts(ctx, feederId, period);
  const parts: string[] = ['═══ OGOHLANTIRISHLAR XULOSASI ═══', alertsReport.summaryText, ''];

  if (kind === 'monthly') {
    const prevPeriod = shiftMonth(period, -1);
    const [cur, prev] = await Promise.all([
      q.districtOverview(ctx, period, feederId),
      q.districtOverview(ctx, prevPeriod, feederId),
    ]);
    parts.push(`═══ OYLIK TAQQOSLASH (${prevPeriod} → ${period}) ═══`);
    if (prev) parts.push(formatTotals(prevPeriod, prev.totals));
    if (cur) parts.push(formatTotals(period, cur.totals));
    parts.push('');
  } else {
    const range = await q.dataRange(ctx);
    if (range.maxDate) {
      const to = range.maxDate;
      const fromDate = new Date(`${to}T00:00:00Z`);
      fromDate.setUTCDate(fromDate.getUTCDate() - 13); // oxirgi ~14 kun
      const from = fromDate.toISOString().slice(0, 10);
      const series = await q.timeSeries(ctx, from, to, 'day', feederId);
      if (series.length > 0) {
        parts.push(`═══ KUNLIK DINAMIKA (${from} … ${to}) ═══`);
        for (const pt of series) {
          parts.push(
            `  ${pt.date}: kirgan ${n(pt.kwhIn)} kWh, sotilgan ${n(pt.kwhSold)} kWh,`
            + ` yo‘qotish ${n(pt.kwhLoss)} kWh (${pt.lossPct.toFixed(1)}%)`,
          );
        }
        parts.push('');
      }
    }
  }

  return parts.join('\n');
}

// ─── Tizim ko'rsatmasi ──────────────────────────────────────────────────────

function systemPrompt(kind: 'weekly' | 'monthly'): string {
  const noun = kind === 'weekly' ? 'haftalik' : 'oylik';
  return [
    'Sen - BEAP (elektr energiya nazorat tizimi) tahlilchisisan.',
    `Vazifang: tuman hokimi uchun ${noun} tahliliy xulosa (bir necha abzatsli`,
    'proza matn, jadval yoki ro‘yxat emas) yozish.',
    '',
    'QATTIQ QOIDALAR:',
    '1. Faqat quyida berilgan raqamlardan foydalan. Hech qanday raqamni',
    '   O‘YLAB TOPMA, taxmin qilma yoki yumaloqlashda xato qilma.',
    '2. Nima o‘zgarganini tushuntir (ko‘tarildimi, tushdimi, qanchaga) va',
    '   berilgan ma’lumotlarga asoslangan ehtimoliy sababni ko‘rsat',
    '   (masalan mavsumiy yuklama, bajarilgan ishlar, qoidabuzarliklar soni,',
    '   ma’lumot bo‘shliqlari).',
    '3. Xulosa oxirida 1–2 ta QISQA, amaliy tavsiya ber.',
    '4. Hajmi taxminan 150–350 so‘z.',
    '5. Uslub - professional, lekin oddiy va tushunarli til: akademik emas,',
    '   quruq hisobot emas, o‘qiladigan qisqa sharh kabi.',
    '6. Muhim raqam yoki xulosalarni **qalin** bilan belgilashing mumkin',
    '   (masalan **12.4%**) - bu keyinroq haqiqiy qalin matnga aylantiriladi,',
    '   hozircha shu belgidan tashqari boshqa markdown ishlatma.',
    '7. Markdown sarlavhalaridan (#, ##, ###) FOYDALANMA.',
    '8. Oy nomlarini, tabiiy bo‘lgan joyda, o‘qiladigan o‘zbekcha shaklda',
    '   yoz ("2026-07" emas - "2026-yil iyul oyi").',
    '9. Javobni O‘ZBEK tilida (lotin yozuvida) yoz.',
  ].join('\n');
}

// ─── Asosiy funksiya ────────────────────────────────────────────────────────

export async function generateNarrative(
  ctx: AppContext, feederId: number | null, kind: 'weekly' | 'monthly',
): Promise<string> {
  const snapshot = await buildSnapshot(ctx);
  if (!snapshot) {
    return 'Hozircha tizimda tahliliy xulosa yozish uchun yetarli ma\'lumot yo\'q.';
  }

  if (!aiEnabled()) {
    return 'AI yordamchi sozlanmagan (OPENAI_API_KEY berilmagan) - tahliliy xulosa yaratilmadi.';
  }

  const grounding = await gatherContext(ctx, feederId, kind, snapshot.period);
  const noun = kind === 'weekly' ? 'haftalik' : 'oylik';

  const userText = [
    `Quyidagi ma'lumotlar asosida "${snapshot.feederName}" fideri uchun ${noun}`,
    'tahliliy xulosa yoz.',
    '',
    '═══ JORIY DAVR SURATI ═══',
    snapshot.text,
    '',
    grounding,
  ].join('\n');

  try {
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        stream: false,
        temperature: 0.3,
        max_tokens: 700,
        messages: [
          { role: 'system', content: systemPrompt(kind) },
          { role: 'user', content: userText },
        ],
      }),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });

    if (!res.ok) {
      return `Tahliliy xulosa yaratilmadi: AI xizmati xatosi (${res.status}).`;
    }

    const data = await res.json() as {
      choices?: { message?: { content?: string | null } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text || !text.trim()) {
      return 'Tahliliy xulosa yaratilmadi: AI xizmati bo\'sh javob qaytardi.';
    }
    return text.trim();
  } catch {
    // Tarmoq yo'q, DNS ishlamayapti, timeout - cron davom etishi kerak,
    // shuning uchun bu yerda log yozilmaydi va istisno tashlanmaydi:
    // chaqiruvchi (cron job) natijani loglaydi.
    return 'Tahliliy xulosa yaratilmadi: AI xizmatiga ulanishda xato yuz berdi.';
  }
}
