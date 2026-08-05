/**
 * AI yordamchi - OpenAI (ChatGPT) API ga ko'prik.
 *
 * IKKI VAZIFA:
 *   1. Tizimdagi HAQIQIY raqamlardan ixcham "ma'lumot surati" yig'ish;
 *   2. Foydalanuvchi savolini shu surat bilan birga modelga yuborib,
 *      javobni bo'lak-bo'lak (oqim) qaytarish.
 *
 * NEGA SURAT: modelga fider ma'lumotlari berilmasa, u umumiy gaplar aytadi
 * yoki raqam O'YLAB TOPADI. Surat bilan esa javob tizimdagi qiymatga
 * bog'lanadi va uni panelda tekshirib ko'rish mumkin.
 *
 * NEGA SERVERDA: kalit brauzerga tushmasligi kerak. Klient faqat o'z API
 * serveriga murojaat qiladi (CSP `connect-src 'self'` buni majburlaydi),
 * tashqi so'rovni esa shu modul qiladi.
 *
 * Kalit berilmasa modul o'chgan holatda qoladi - tizim avvalgidek offline.
 */
import { config } from '../config.ts';
import { type AppContext, queryOne } from '../db/pool.ts';
import * as q from '../db/queries/dashboard.ts';
import { getMfyResponsible } from '../db/queries/ref.ts';
import * as tq from '../db/queries/tpLoss.ts';
import {
  TOOL_LABELS, TOOL_SPECS, type ClientAction, type ToolContext, type ToolOutcome, runTool,
} from './ai-tools.ts';
import { detectTpLossAnomalies } from './analytics.ts';

export const aiEnabled = (): boolean => config.ai.apiKey.length > 0;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Raqamlarni o'qiladigan ko'rinishga keltirish ───────────────────────────

/** 1048000 → "1 048 000". Model ham, foydalanuvchi ham bir xil ko'radi. */
function n(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).replace(/,/g, ' ');
}

const p = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : `${v.toFixed(1)}%`;

// ─── Ma'lumot surati ────────────────────────────────────────────────────────

export interface Snapshot {
  text: string;
  period: string;
  feederName: string;
  /** Asboblar qaysi fider doirasida ishlashini bilishi uchun. */
  feederId: number;
}

/*
 * Surat 60 soniya keshlanadi.
 *
 * Chat oynasida savollar ketma-ket keladi va har biri uchun 5 ta SQL
 * so'rovini qayta yugurtirish keraksiz - ma'lumot kunlik yangilanadi.
 */
const cache = new Map<string, { at: number; value: Snapshot }>();
const CACHE_MS = 60_000;

export async function buildSnapshot(ctx: AppContext, period?: string): Promise<Snapshot | null> {
  const resolved = period ?? (await q.latestPeriod(ctx));
  if (!resolved) return null;

  const hit = cache.get(resolved);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const feeder = await queryOne<{ id: number; name_uz: string; elektroset: string }>(
    `SELECT m.id, m.name_uz, e.name_uz AS elektroset
       FROM ref.mfy m
       JOIN ref.elektroset e ON e.id = m.elektroset_id
      WHERE m.valid_to IS NULL
      ORDER BY m.sort_order, m.id
      LIMIT 1`,
    [], ctx,
  );
  if (!feeder) return null;

  const [
    overview, feederMonthly, tps, workRows, violationSummary, range, responsible,
    tpLossRows, tpLossAnomalies,
  ] = await Promise.all([
    q.districtOverview(ctx, resolved),
    q.feederMonthly(ctx, resolved, feeder.id),
    q.tpMonthly(ctx, resolved, feeder.id),
    q.works(ctx, feeder.id, null, 40),
    q.violations(ctx, resolved, feeder.id),
    q.dataRange(ctx),
    getMfyResponsible(ctx, feeder.id),
    tq.tpLossLatestByTp(ctx, feeder.id, 100),
    detectTpLossAnomalies(ctx, feeder.id),
  ]);

  const t = overview?.totals;
  const lines: string[] = [];

  lines.push(`FIDER: ${feeder.name_uz} (${feeder.elektroset})`);
  lines.push(`HISOBOT DAVRI: ${resolved}${feederMonthly ? ` (${feederMonthly.days} kun)` : ''}`);
  lines.push(`MA'LUMOT MAVJUD ORALIQ: ${range.minDate ?? '-'} … ${range.maxDate ?? '-'}`);
  lines.push(
    responsible
      ? `MA'SUL SHAXS: ${responsible.fullName}`
        + `${responsible.position ? ` - ${responsible.position}` : ''}`
        + `${responsible.phone ? `, tel: ${responsible.phone}` : ''}`
      : "MA'SUL SHAXS: hozircha belgilanmagan (sozlamalar: /settings/responsible)",
  );
  lines.push('');

  if (overview) {
    /*
     * `q.districtOverview()`dagi bilan AYNAN bir xil manba - dashboard
     * kartalarida ko'ringan solishtirish shu yerda ham takrorlanadi. Joriy
     * oy hali tugamagan bo'lsa, `daysCompared` bor tilslarda oldingi oy ham
     * FAQAT shuncha kunlik qismi bilan solishtirilgan (adolatli taqqoslash) -
     * model buni tushuntirmasa, "keskin kamaydi" kabi noto'g'ri xulosa
     * chiqarishi mumkin.
     */
    lines.push(`OYLIK TAQQOSLASH (${overview.prevPeriod} → ${resolved}):`);
    if (overview.tiles.some((tl) => tl.daysCompared !== null)) {
      lines.push(
        `  Eslatma: "${resolved}" oyi hali to‘liq tugamagan - energiya ko‘rsatkichlari`
        + ' adolatli bo‘lishi uchun oldingi oyning FAQAT mos kunlari bilan solishtirilgan.',
      );
    }
    for (const tl of overview.tiles) {
      const deltaStr = tl.deltaPct === null ? '-' : `${tl.deltaPct > 0 ? '+' : ''}${tl.deltaPct.toFixed(1)}%`;
      const prevLabel = tl.daysCompared ? `${tl.prevPeriod}, dastlabki ${tl.daysCompared} kuni` : tl.prevPeriod;
      lines.push(
        `  ${tl.labelUz}: ${n(tl.value)} ${tl.unit} (oldingi - ${prevLabel}: ${n(tl.prevValue)} ${tl.unit},`
        + ` o‘zgarish: ${deltaStr})`,
      );
    }
    lines.push('');
  }

  if (feederMonthly) {
    lines.push('ENERGIYA BALANSI (fider boshidagi hisoblagich bo‘yicha):');
    lines.push(`  Kirgan energiya: ${n(feederMonthly.kwhIn)} kWh`);
    lines.push(`  Sotilgan (TP hisoblagichlari yig‘indisi): ${n(feederMonthly.kwhTpSum)} kWh`);
    lines.push(`  Texnologik yo‘qotish: ${n(feederMonthly.kwhTechLoss)} kWh`);
    lines.push(`  Tijoriy yo‘qotish: ${n(feederMonthly.kwhCommercialLoss)} kWh`);
    lines.push(
      `  Jami yo‘qotish: ${n(feederMonthly.kwhTechLoss + feederMonthly.kwhCommercialLoss)} kWh`
      + ` (${p(feederMonthly.kwhIn > 0
        ? ((feederMonthly.kwhTechLoss + feederMonthly.kwhCommercialLoss) / feederMonthly.kwhIn) * 100
        : null)})`,
    );
    lines.push(`  Hisoblagich: ${n(feederMonthly.meterPrev, 1)} → ${n(feederMonthly.meterCurr, 1)}, koeffitsient ${feederMonthly.meterCoef}`);
    lines.push(`  O‘rtacha kunlik iste'mol: ${n(feederMonthly.avgDailyKwh)} kWh · o‘rtacha yuklama: ${n(feederMonthly.avgLoadKw)} kW`);
    lines.push(`  Hisoblagich bilan qamrov: ${p(feederMonthly.meteredPct)}`);
    lines.push('');
  }

  if (t) {
    lines.push('ISTE\'MOLCHILAR:');
    lines.push(`  Jami: ${n(t.consumers_total)} · faol: ${n(t.consumers_active)} · uzilgan: ${n(t.consumers_disconnected)}`);
    lines.push(`  Transformator punktlari (TP): ${n(t.tp_total)} ta`);
    if (t.technical_std_pct !== null) {
      lines.push(`  Texnologik yo‘qotish me'yori: ${p(t.technical_std_pct)}`);
    }
    lines.push('');
  }

  if (tps.length > 0) {
    const totalKwh = tps.reduce((a, r) => a + r.kwhMonth, 0);

    /*
     * TAYYOR REYTINGLAR - modelga saralashni topshirib bo'lmaydi.
     *
     * Sinovda ko'rindi: 51 qatorli ro'yxat berilganda model faqat boshidagi
     * bir nechta qatorni ko'radi va "eng ko'p uzilgan abonent" savoliga
     * ro'yxat boshidagi TP ni aytadi. Ro'yxat esa ISTE'MOL bo'yicha
     * saralangan. Shuning uchun kerakli tartiblar shu yerda hisoblanadi.
     */
    const byDisconnected = [...tps]
      .filter((r) => r.consumersDisconnected > 0)
      .sort((a, b) => b.consumersDisconnected - a.consumersDisconnected);

    const byOffShare = [...tps]
      .filter((r) => r.consumersTotal > 0 && r.consumersDisconnected > 0)
      .sort((a, b) =>
        b.consumersDisconnected / b.consumersTotal - a.consumersDisconnected / a.consumersTotal);

    if (byDisconnected.length > 0) {
      lines.push('ENG KO‘P UZILGAN ABONENTLI TP LAR (soni bo‘yicha, birinchisi eng yomoni):');
      for (const r of byDisconnected.slice(0, 8)) {
        lines.push(
          `  ${r.code}: ${r.consumersDisconnected} ta uzilgan / ${r.consumersTotal} ta abonent`
          + ` (${((r.consumersDisconnected / r.consumersTotal) * 100).toFixed(1)}%)`,
        );
      }
      lines.push('');
    }

    if (byOffShare.length > 0) {
      lines.push('UZILGAN ABONENT ULUSHI ENG YUQORI TP LAR (foiz bo‘yicha):');
      for (const r of byOffShare.slice(0, 8)) {
        lines.push(
          `  ${r.code}: ${((r.consumersDisconnected / r.consumersTotal) * 100).toFixed(1)}%`
          + ` (${r.consumersDisconnected}/${r.consumersTotal})`,
        );
      }
      lines.push('');
    }

    lines.push(`TP KESIMI - TO‘LIQ RO‘YXAT (${tps.length} ta).`);
    lines.push('  DIQQAT: ro‘yxat ISTE\'MOL bo‘yicha saralangan. Reyting savollariga');
    lines.push('  javob berishda yuqoridagi tayyor reytinglardan foydalan, bu ro‘yxatning');
    lines.push('  boshidagi qatorlardan xulosa chiqarma.');
    lines.push('  format: kod | abonent jami/faol/uzilgan | oylik kWh | fider ulushi');
    for (const r of tps) {
      const share = totalKwh > 0 ? (r.kwhMonth / totalKwh) * 100 : 0;
      lines.push(
        `  ${r.code} | ${r.consumersTotal}/${r.consumersActive}/${r.consumersDisconnected}`
        + ` | ${n(r.kwhMonth, 1)} | ${share.toFixed(1)}%`,
      );
    }
    lines.push('');
  }

  if (tpLossRows.length > 0) {
    lines.push('TP BALANS HISOBLAGICHI - SO‘NGGI KUNLIK O‘QISH (fider oylik balansidan FARQLI, TP darajasida):');
    for (const r of tpLossRows) {
      lines.push(
        `  ${r.code} (${r.bizDate}): balans ${n(r.kwhBalanceMeter)} kWh, `
        + `iste'molchilar ${n(r.kwhConsumersAttached)} kWh, yo'qotish ${n(r.kwhLoss)} kWh (${p(r.lossPct)})`,
      );
    }
    lines.push('');
  }

  if (tpLossAnomalies.anomalies.length > 0) {
    lines.push('TP BALANS ANOMALIYALARI (mumkin bo‘lgan hisoblagich xatosi/o‘g‘irlik belgisi):');
    for (const a of tpLossAnomalies.anomalies) lines.push(`  · [${a.severity}] ${a.messageUz}`);
    lines.push('');
  }

  if (workRows.length > 0) {
    const byStatus = new Map<string, number>();
    for (const w of workRows) byStatus.set(w.status, (byStatus.get(w.status) ?? 0) + 1);
    lines.push('ISHLAR:');
    lines.push(`  Holati bo‘yicha: ${[...byStatus].map(([s, c]) => `${s}=${c}`).join(', ')}`);
    for (const w of workRows.slice(0, 12)) {
      lines.push(
        `  · ${w.titleUz} (${w.workType}) - ${w.status}, bajarildi ${w.progressPct}%`
        + `${w.tpCode ? `, ${w.tpCode}` : ''}`
        + `${w.effectSavingKwhMonth > 0 ? `, tejamkorlik ${n(w.effectSavingKwhMonth)} kWh/oy` : ''}`,
      );
    }
    lines.push('');
  }

  if (violationSummary.rows.length > 0) {
    lines.push(`ANIQLANGAN QOIDABUZARLIKLAR (${violationSummary.from} … ${violationSummary.to}):`);
    for (const c of violationSummary.rows) {
      lines.push(
        `  ${c.labelUz}: ${c.count} ta, jarima ${n(c.fineMln, 1)} mln so‘m,`
        + ` aniqlangan ${n(c.kwhIdentified)} kWh`,
      );
    }
    lines.push('');
  }

  const value: Snapshot = {
    text: lines.join('\n'),
    period: resolved,
    feederName: feeder.name_uz,
    feederId: feeder.id,
  };
  cache.set(resolved, { at: Date.now(), value });
  return value;
}

// ─── Tizim ko'rsatmasi ──────────────────────────────────────────────────────

const GUIDE = `
PANEL BO'LIMLARI (navigate asbobidagi yo'llar):
  · /dashboard      - KPI kartalari, dinamika, yo'qotish tuzilmasi, TP holati
  · /transformers   - 51 ta TP: hisoblagich, abonentlar, oylik iste'mol
  · /energy-balance - kirgan energiya qayerga ketgani
  · /works          - rejalashtirilgan va bajarilgan ishlar, dalolatnomalar
  · /reports        - Excel/PDF eksport sahifasi
  · /entry          - oylik shakllarni to'ldirish
  · /review         - kiritilgan ma'lumotni tekshirish va tasdiqlash
  · /settings/responsible - fider uchun ma'sul shaxsni belgilash/o'zgartirish
`.trim();

function systemPrompt(snapshot: Snapshot | null): string {
  return [
    'Sen - BEAP (elektr energiya nazorat tizimi) ichidagi AGENTSAN.',
    'Foydalanuvchilar: elektr tarmoqlari xodimlari va rahbarlar.',
    '',
    'ENG MUHIM QOIDA: sen maslahat beruvchi emas, ISH BAJARUVCHISAN.',
    'Foydalanuvchidan biror narsa qilishni SO‘RAMA - asbob bilan O‘ZING bajar.',
    '  ✗ "Hisobotni yuklab olish uchun /reports sahifasiga o‘ting"',
    '  ✓ download_report asbobini chaqirasan, keyin "Oylik hisobot yuklandi" deysan',
    '  ✗ "Transformatorlar sahifasida ko‘rishingiz mumkin"',
    '  ✓ navigate asbobini chaqirasan',
    'Faqat huquqing yetmagan yoki ma’lumot bo‘lmagan holatda uzr so‘ra.',
    '',
    'ASBOBLARDAN FOYDALANISH:',
    '1. Savolga MA’LUMOT SURATIDAGI raqam yetsa - asbob chaqirmasdan javob ber.',
    '   Suratda yo‘q bo‘lsa (boshqa oy, bitta TP tafsiloti, ishlar, aktlar) -',
    '   tegishli asbobni chaqir. Raqamni HECH QACHON o‘ylab topma.',
    '2. Reyting savollarida ("eng ko‘p", "eng yomon") list_tps asbobini ishlat -',
    '   ro‘yxatni o‘zing saralashga urinma.',
    '3. Bir javobda bir nechta asbob chaqirish mumkin va ko‘pincha KERAK:',
    '   "TP-067 ni ko‘rsat" → get_tp (raqamlar uchun) VA navigate("/transformers",',
    '   search:"TP-067") (foydalanuvchi jadvalda ham ko‘rsin).',
    '   "och", "ko‘rsat", "olib bor" so‘zlari - navigate chaqirish signali.',
    '   "iyun oyini ko‘rsat" → set_period("2026-06").',
    '4. "grafik", "diagramma", "chizma" so‘zlari ishlatilsa yoki foydalanuvchi biror',
    '   narsani rasm holida ko‘rishni so‘rasa - mos `kind` bilan show_chart asbobini',
    '   chaqir. Hisobot yuklab berish yoki ko‘rish so‘ralganda ham (masalan davr',
    '   hisobot, TP reytingi) diagramma foydali bo‘lsa - show_chart ni tegishli',
    '   ma’lumot/yuklash asbobi bilan SHU javobda BIRGA chaqir, faqat raqam yoki',
    '   faqat fayl bilan cheklanma.',
    '5. Energiya balansi 31 kunlik jadval - uni chat orqali to‘ldirma.',
    '   Buning o‘rniga navigate bilan /entry sahifasini och.',
    '6. "Muammo bormi", "diqqat talab qiladigan narsa bormi" kabi savollarda',
    '   get_alerts asbobini chaqir - javobni o‘zing taxmin qilma.',
    '7. MONTHLY_RETURN hisobotini chatda BOSQICHMA-BOSQICH to‘ldirish mumkin:',
    '   create_submission → har bir maydonni suhbat orqali so‘rab ol →',
    '   save_monthly_return → submit_submission dan OLDIN validate_submission',
    '   chaqir va xatolarni oddiy tilda tushuntir → shundan keyingina',
    '   submit_submission. Bu qoida ham 31 kunlik energiya balansi jadvaliga',
    '   taalluqli emas - u hech qachon chat orqali to‘ldirilmaydi (yuqoridagi',
    '   5-band).',
    '8. "Qanday ish tavsiya qilasan?", "nima qilish kerak?" kabi savollarda',
    '   recommend_works asbobini chaqir. create_work FAQAT foydalanuvchi',
    '   tavsiyani tasdiqlagach yoki aniq "shuni qo‘sh"/"yoz" desa chaqiriladi -',
    '   so‘ralmasdan turib ish yaratma (bu - yozish amali, boshqa asboblardan',
    '   farqli o‘laroq oldindan tasdiq talab qiladi). Ish holati haqida',
    '   so‘ralganda yoki "TP-067 dagi ish tugadi/boshlandi" kabi xabar',
    '   berilganda update_work_status chaqiriladi.',
    '9. "TP-067 ortiqcha yuklangan", "TP-043 nosoz" kabi TP holati haqida xabar',
    '   berilganda update_tp_status, "N km tarmoq ta’mirlanishi kerak" kabi',
    '   xabarda update_network_defect chaqiriladi (recommend_works aynan shu',
    '   ma’lumotlarga tayanadi - kiritilmasa tavsiya berolmaydi). Ikkalasi ham',
    '   qoralama sifatida saqlaydi: rasman hisoblanishi (jamlanmalarga qo‘shilishi)',
    '   uchun submit_submission KERAK, tasdiqlash esa faqat elektroset menejeri',
    '   yoki administrator uchun (approve_submission) - buni foydalanuvchiga',
    '   ayt yoki agar u shu rolda bo‘lsa o‘zing bajaraver.',
    '',
    'JAVOB USLUBI:',
    '10. O‘ZBEK tilida (lotin yozuvi). Foydalanuvchi rus yoki ingliz tilida yozsa -',
    '   o‘sha tilda javob ber.',
    '11. Qisqa: 2–5 gap yoki qisqa ro‘yxat. Bajargan ishingni bir gapda ayt.',
    '12. Raqam bilan birga birligini yoz (kWh, %, ta, mln so‘m).',
    '13. Markdown sarlavhalari (#) ishlatma; ro‘yxat uchun "·" belgisi.',
    '14. Savol 4 ta tayyor show_chart turiga yoki boshqa asboblarning oddiy matnli javobiga',
    '    sig‘masa, lekin foydalanuvchi javobni RASM/JADVAL holida ko‘rishni xohlasa - avval',
    '    kerakli raqamlarni tegishli ma’lumot asboblari bilan (get_tp, get_series,',
    '    compare_periods va h.k.) ol, keyin render_table yoki render_custom_chart ni O‘SHA',
    '    raqamlar bilan chaqir. Raqamni hech qachon o‘zing o‘ylab topma.',
    '15. "TP balans/hisoblagich anomaliyasi", "bugun qanday muammo bor",',
    '    "o‘g‘irlik" kabi savollarda get_tp_loss_anomalies asbobini yoki',
    '    MA’LUMOT SURATIDAGI "TP BALANS ANOMALIYALARI" bo‘limini ishlat - bu',
    '    ma’lumot fider (oylik) balansidan FARQLI, TP darajasidagi KUNLIK',
    '    hisoblagich ko‘rsatkichi. Manfiy yo‘qotish (iste’molchilar balansdan',
    '    ko‘p) fizik jihatdan mumkin emas - buni har doim aniq tushuntir va',
    '    tekshiruv tavsiya qil, o‘zing "o‘g‘irlik" deb xulosa chiqarma (bu -',
    '    faqat signal, aniqlangan xulosa emas).',
    '16. Foydalanuvchi "o‘tgan oyga nisbatan", "o‘sdimi/tushdimi", "dinamika',
    '    qanday" kabi savol bersa - MA’LUMOT SURATIDAGI "OYLIK TAQQOSLASH"',
    '    bo‘limidan foydalan, o‘zgarish foizini o‘zing qayta hisoblama. Agar u',
    '    yerda "hali to‘liq tugamagan" eslatmasi bo‘lsa - buni albatta ayt',
    '    (masalan, "avgustning dastlabki 5 kuni, iyulning ham shu kunlari',
    '    bilan solishtirilgan"), aks holda qisqa oyni to‘liq oy bilan',
    '    taqqoslab noto‘g‘ri ("keskin kamaydi/o‘sdi") xulosa chiqarish xavfi',
    '    bor. Ketma-ket bo‘lmagan ikkita ixtiyoriy davrni solishtirish uchun',
    '    compare_periods asbobini ishlat - u ham xuddi shu tarzda kun sonini',
    '    moslashtiradi.',
    '',
    GUIDE,
    '',
    '═══ MA\'LUMOT SURATI (joriy davr) ═══',
    snapshot?.text ?? 'Hozircha tizimda ma\'lumot yo‘q.',
  ].join('\n');
}

// ─── OpenAI oqimi ───────────────────────────────────────────────────────────

export class AiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

/** OpenAI xabar formati - asbob chaqiruvlari bilan birga. */
interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

/** Bitta bosqich natijasi: chiqarilgan matn va model so'ragan asboblar. */
interface Turn {
  text: string;
  calls: PendingCall[];
}

/**
 * Modeldan BITTA javobni oqim bilan oladi.
 *
 * Matn bo'laklari darhol `onDelta` ga uzatiladi, asbob chaqiruvlari esa
 * yig'iladi: OpenAI ularni ham bo'lak-bo'lak yuboradi (nom birinchi
 * bo'lakda, argumentlar keyingilarida), shuning uchun `index` bo'yicha
 * to'planadi.
 */
async function* streamTurn(
  messages: WireMessage[], withTools: boolean, signal: AbortSignal,
): AsyncGenerator<AgentEvent, Turn> {
  let res: Response;
  try {
    res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        stream: true,
        temperature: 0.2,
        max_tokens: config.ai.maxTokens,
        messages,
        // Oxirgi bosqichda asboblar berilmaydi - model xulosa yozishi shart.
        ...(withTools ? { tools: TOOL_SPECS, tool_choice: 'auto' } : {}),
      }),
      signal,
    });
  } catch (err) {
    // Tarmoq yo'q / DNS ishlamayapti - offline muhitda odatiy hol.
    throw new AiError(
      502,
      `AI xizmatiga ulanib bo‘lmadi: ${err instanceof Error ? err.message : 'noma’lum xato'}`,
    );
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new AiError(
      502,
      `AI xizmati xatosi (${res.status}): ${detail.slice(0, 300) || res.statusText}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const calls = new Map<number, PendingCall>();

  /** Bitta `data:` bo'lagini o'qiydi: `null` = oqim tugadi. */
  const consume = (payload: string): string | null | undefined => {
    if (payload === '[DONE]') return null;
    try {
      const parsed = JSON.parse(payload) as {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: {
              index: number; id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return undefined;

      for (const tc of delta.tool_calls ?? []) {
        const existing = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        calls.set(tc.index, {
          id: tc.id ?? existing.id,
          name: tc.function?.name ?? existing.name,
          args: existing.args + (tc.function?.arguments ?? ''),
        });
      }

      if (delta.content) {
        text += delta.content;
        return delta.content;
      }
    } catch {
      /* to'liq kelmagan bo'lak - keyingi o'qishda yig'iladi */
    }
    return undefined;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE bo'laklari bo'sh qator bilan ajratiladi.
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');

        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const chunk = consume(line.slice(5).trim());
          if (chunk === null) return { text, calls: [...calls.values()] };
          // Bo'lak KELGAN ZAHOTI chiqariladi - chat oynasida so'zlar
          // yozilib borgani ko'rinadi, bosqich tugashini kutmaydi.
          if (chunk !== undefined) yield { type: 'delta', text: chunk };
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return { text, calls: [...calls.values()] };
}

/**
 * AGENT HALQASI.
 *
 * Model asbob chaqirsa - uni bajaramiz, natijani suhbatga qo'shamiz va
 * modelni QAYTA chaqiramiz. Shu tufayli u ketma-ket ish qila oladi:
 * "davrni almashtir" → "endi TP larni saralab ber" → xulosa yoz.
 *
 * `MAX_ROUNDS` - cheksiz halqadan himoya. Oxirgi bosqichda asboblar
 * BERILMAYDI: shunda model majburan matn bilan javob beradi va suhbat
 * "asbob chaqiraveraman" holatida osilib qolmaydi.
 *
 * 8 (avval 5 edi): tahlil asboblari (anomaliya, prognoz, ogohlantirish) va
 * bosqichma-bosqich hisobot to'ldirish ko'proq ketma-ket chaqiruv talab
 * qiladi - masalan create_submission → save_monthly_return →
 * validate_submission → submit_submission bitta suhbatda.
 */
const MAX_ROUNDS = 8;

export type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; label: string; status: 'running' | 'done'; ok?: boolean }
  | { type: 'action'; action: ClientAction };

export async function* runAgent(
  messages: ChatMessage[],
  snapshot: Snapshot | null,
  tools: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  if (!aiEnabled()) {
    throw new AiError(503, 'AI yordamchi sozlanmagan: OPENAI_API_KEY berilmagan');
  }

  const merged = AbortSignal.any([signal, AbortSignal.timeout(config.ai.timeoutMs)]);

  const wire: WireMessage[] = [
    { role: 'system', content: systemPrompt(snapshot) },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    // `yield*` - ichki generatorning bo'laklari to'g'ridan-to'g'ri o'tadi,
    // qaytish qiymati esa (matn + asbob chaqiruvlari) shu yerda qoladi.
    const turn = yield* streamTurn(wire, round < MAX_ROUNDS, merged);

    if (turn.calls.length === 0) return;

    wire.push({
      role: 'assistant',
      content: turn.text || null,
      tool_calls: turn.calls.map((c) => ({
        id: c.id, type: 'function' as const,
        function: { name: c.name, arguments: c.args || '{}' },
      })),
    });

    for (const call of turn.calls) {
      const label = TOOL_LABELS[call.name] ?? call.name;
      yield { type: 'tool', name: call.name, label, status: 'running' };

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.args || '{}') as Record<string, unknown>;
      } catch {
        /* model buzuq JSON yubordi - bo'sh argument bilan davom etamiz */
      }

      let outcome: ToolOutcome;
      try {
        outcome = await runTool(call.name, args, tools);
      } catch (err) {
        // Asbob yiqilsa butun suhbat yiqilmasin - model xatoni o'qib,
        // foydalanuvchiga tushuntira oladi yoki boshqa yo'l topadi.
        outcome = {
          kind: 'data',
          result: { ok: false, reason: err instanceof Error ? err.message : 'Amal bajarilmadi' },
        };
      }

      if (outcome.kind === 'action') yield { type: 'action', action: outcome.action };

      const ok = !(
        typeof outcome.result === 'object' && outcome.result !== null
        && 'ok' in outcome.result && (outcome.result as { ok: unknown }).ok === false
      );
      yield { type: 'tool', name: call.name, label, status: 'done', ok };

      wire.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(outcome.result),
      });
    }
  }
}

// ─── Keyingi savol takliflari ───────────────────────────────────────────────

/**
 * Yordamchi javob berganidan keyin so'ralishi mumkin bo'lgan 3 ta qisqa
 * savol - Telegram botning "oddiy klaviatura"sida tugma sifatida chiqadi
 * (`bot/src/index.ts`), foydalanuvchi qayta yozmasdan tanlab yubora oladi.
 *
 * ALOHIDA, OQIMSIZ chaqiruv: `runAgent`ning asosiy javobiga aralashtirilsa,
 * model ba'zan takliflarni matn ICHIGA yozib yuboradi (formatni buzadi).
 * Veb chat buni SO'RAMAYDI (`routes/ai.ts`dagi `suggestFollowUps` bayrog'i
 * berilmasa) - u yerda bunday tugmalar yo'q, qo'shimcha chaqiruv behuda
 * xarajat bo'lardi.
 */
export async function suggestFollowUps(
  messages: ChatMessage[], assistantReply: string, snapshot: Snapshot | null,
): Promise<string[]> {
  if (!aiEnabled() || !assistantReply.trim()) return [];

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const prompt = [
    'Quyida BEAP (elektr energiya nazorat tizimi) AI yordamchisi bilan',
    'foydalanuvchi suhbatining oxirgi bosqichi berilgan. Foydalanuvchi keyin',
    'so‘rashi mumkin bo‘lgan 3 ta QISQA (har biri ~6 so‘zdan oshmasin),',
    'TABIIY savol/buyruqni O‘ZBEK tilida (lotin yozuvida) taklif qil - shu',
    'tizimda haqiqatan ham javob topsa bo‘ladigan narsalar haqida (masalan',
    'boshqa transformator, boshqa oy, ishlar ro‘yxati, hisobot, muammolar).',
    'Har birini ALOHIDA qatorga yoz - raqamlash, tire, tirnoq yoki boshqa',
    'izoh QO‘SHMA, faqat 3 ta qator matn.',
    '',
    `Foydalanuvchi savoli: ${lastUser.slice(0, 500)}`,
    `Yordamchi javobi: ${assistantReply.slice(0, 800)}`,
    snapshot ? `\nMavjud ma'lumot mavzulari (qisqacha): ${snapshot.text.slice(0, 400)}` : '',
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
        temperature: 0.7,
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
    if (!res.ok) return [];

    const data = await res.json() as { choices?: { message?: { content?: string | null } }[] };
    const text = data.choices?.[0]?.message?.content ?? '';
    return text
      .split('\n')
      .map((line) => line.replace(/^[\s\-·*\d.)]+/, '').trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    // Takliflar ikkinchi darajali - xato bo'lsa asosiy javobga ta'sir qilmasin.
    return [];
  }
}
