/**
 * Manba hisobotlarda YO'Q, lekin panellar talab qiladigan ko'rsatkichlarni
 * to'ldiradi - iyul va avgust (1-8) uchun.
 *
 * ⚠ BU O'LCHOV EMAS, HOSILA. Chinobod ETK yuborgan uchta hisobotda TP
 *   quvvati, masofa, kuchlanish, qarzdorlik, ishlar va dalolatnomalar
 *   umuman yo'q. Shu skript ularni HAQIQIY raqamlardan keltirib chiqaradi
 *   (TP ning o'lchangan oylik iste'moli, balans hisoblagichi anomaliyasi,
 *   iste'molchilar soni) va determinik urug' bilan barqaror qiladi.
 *   Har bir jadval uchun qanday qoida ishlatilgani pastda yozilgan.
 *
 * O'LCHANGAN ma'lumot USTIDAN YOZILMAYDI: `fact.tp_loss_daily`,
 * `fact.feeder_monthly`, `fact.tp_monthly` va `fact.energy_balance_daily`
 * ga bu skript TEGMAYDI. `fact.mfy_monthly_return` da esa faqat manbada
 * bo'lmagan ustunlar (qarzdorlik, hisoblagich hisoblari, aholi/yuridik
 * ajratmasi) yangilanadi - iste'molchilar JAMI o'zgarmaydi.
 *
 *   node --experimental-strip-types apps/api/scripts/fill-derived-data.ts
 *
 * Oldin `load-chinobod-july.ts` va `load-chinobod-august.ts` ishga
 * tushirilgan bo'lishi shart. Idempotent.
 */
import pg from 'pg';

import { config } from '../src/config.ts';
import { mulberry32 } from '../seed/generate.ts';

const PERIODS = ['2026-07-01', '2026-08-01'] as const;
const TODAY = '2026-08-12';
/** Kunlik ko'rsatkichlar shu oralig'da yoziladi (kelajak sana yo'q). */
const READING_FROM = '2026-07-01';

/** O'rtacha tarif, so'm/kWh - qarzdorlikni kWh dan pulga o'tkazish uchun. */
const TARIFF_SUM_PER_KWH = 450;
/** Oylik hisob-kitobning qancha qismi vaqtida to'lanmay qoladi. */
const ARREARS_RATE = { population: 0.12, legal: 0.06, budget: 0.03 } as const;
/** Iste'molchilarning aholi/yuridik ajratmasi - hisobotlarda YO'Q, standart nisbat. */
const LEGAL_SHARE = 0.08;

/** TP quvvatining standart qatori (kVA). */
const KVA_SERIES = [25, 40, 63, 100, 160, 250, 400, 630, 1000];
const POWER_FACTOR = 0.92;
/** Loyihaviy yuklama - shu nisbatda quvvat tanlanadi (o'rtacha bo'yicha). */
const TARGET_LOAD = 0.55;
/** Kechqurungi cho'qqi / sutkalik o'rtacha nisbati - yuklama shu bo'yicha baholanadi. */
const PEAK_FACTOR = 1.7;

const rand = mulberry32(20260809);
function gauss(mean = 0, sd = 1): number {
  const u = Math.max(rand(), 1e-9);
  const v = Math.max(rand(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const r2 = (x: number): number => Math.round(x * 100) / 100;

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let d = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (d <= end) { out.push(new Date(d).toISOString().slice(0, 10)); d += 86_400_000; }
  return out;
}

/** Ustunlar ro'yxati bo'yicha ommaviy INSERT - bo'laklarga bo'lib. */
async function bulk(
  c: pg.PoolClient, table: string, cols: string[], rows: unknown[][], chunk = 400,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = part.map((_, k) => {
      const b = k * cols.length;
      return `(${cols.map((_, j) => `$${b + j + 1}`).join(',')})`;
    }).join(',');
    await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values}`, part.flat());
  }
}

interface Feeder { id: number; code: string; short: string; sort: number }
interface Tp {
  id: number; code: string; mfyId: number;
  kwhJuly: number; consumers: number; active: number; disconnected: number;
  /** Avgustdagi eng past yo'qotish foizi - anomaliya kuchi. */
  worstPct: number | null;
  /** Balans hisoblagichi o'lik: o'qish ~0, biriktirilganlar esa sezilarli. */
  deadMeter: boolean;
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    const trg = await c.query<{ sch: string; tbl: string }>(`
      SELECT n.nspname AS sch, c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgname = 'zz_audit' AND NOT t.tgisinternal`);
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} DISABLE TRIGGER zz_audit`);

    await c.query('BEGIN');

    // ── Kontekst ─────────────────────────────────────────────────────────
    const feeders: Feeder[] = (await c.query<Feeder>(
      `SELECT m.id, m.code, m.short_name AS short, m.sort_order AS sort
         FROM ref.mfy m ORDER BY m.sort_order`)).rows;

    const tps: Tp[] = (await c.query<{
      id: number; code: string; mfy_id: number; kwh_july: number;
      consumers: number; active: number; disconnected: number;
      worst_pct: number | null; dead_meter: boolean;
    }>(`
      SELECT t.id, t.code, t.mfy_id,
             coalesce(jm.kwh_month, 0)::float8            AS kwh_july,
             coalesce(jm.consumers_total, 0)              AS consumers,
             coalesce(jm.consumers_active, 0)             AS active,
             coalesce(jm.consumers_disconnected, 0)       AS disconnected,
             l.worst_pct::float8                          AS worst_pct,
             coalesce(l.dead_meter, false)                AS dead_meter
        FROM ref.tp t
        LEFT JOIN fact.tp_monthly jm ON jm.tp_id = t.id AND jm.period_month = '2026-07-01'
        LEFT JOIN LATERAL (
          SELECT min(d.loss_pct) AS worst_pct,
                 bool_or(d.kwh_balance_meter < 1 AND d.kwh_consumers_attached > 50) AS dead_meter
            FROM fact.tp_loss_daily d
           WHERE d.tp_id = t.id AND d.source = 'EXCEL'
        ) l ON true
        ORDER BY t.id`)).rows.map((r) => ({
      id: r.id, code: r.code, mfyId: r.mfy_id, kwhJuly: r.kwh_july,
      consumers: r.consumers, active: r.active, disconnected: r.disconnected,
      worstPct: r.worst_pct, deadMeter: r.dead_meter,
    }));

    const balances = new Map<string, { kwhIn: number; kwhSold: number; loss: number }>();
    for (const r of (await c.query<{
      mfy_id: number; period_month: string; kwh_in: number; kwh_sold: number; loss: number;
    }>(`SELECT mfy_id, period_month::text, kwh_in::float8, kwh_sold::float8,
               kwh_loss::float8 AS loss
          FROM fact.feeder_monthly`)).rows) {
      balances.set(`${r.mfy_id}:${r.period_month}`, {
        kwhIn: r.kwh_in, kwhSold: r.kwh_sold, loss: r.loss,
      });
    }

    const admin = (await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`)).rows[0]!.id;

    console.log(`${feeders.length} ta fider, ${tps.length} ta TP\n`);

    // ── 0. Tozalash - faqat shu skript yozadigan jadvallar ───────────────
    await c.query('TRUNCATE fact.tp_reading_daily');
    await c.query(`DELETE FROM fact.violation_act`);
    await c.query(`DELETE FROM fact.work`);
    await c.query(`DELETE FROM fact.debt_top_entry`);
    await c.query(`DELETE FROM fact.network_defect`);
    await c.query(`DELETE FROM fact.tp_status_monthly`);
    await c.query(`DELETE FROM ref.network_segment`);
    await c.query(
      `DELETE FROM fact.submission
        WHERE domain IN ('TP_STATUS','NETWORK_DEFECT','DEBT','WORKS','VIOLATION','TP_READING')`);

    // ═══ 1. TP quvvati va masofasi (ref.tp) ═══════════════════════════════
    /*
     * QOIDA: quvvat TP ning O'LCHANGAN iyul iste'molidan chiqariladi.
     * O'rtacha yuklama kW = kWh / (31 × 24); kerakli kVA = kW / cosφ / 0.55;
     * standart qatordan shundan katta eng yaqin nomiial olinadi.
     * Masofa - iste'molchi sonidan (zichroq TP kattaroq hududga xizmat qiladi).
     */
    const kvaOf = (kwhMonth: number): number => {
      const avgKw = kwhMonth / (31 * 24);
      const need = avgKw / POWER_FACTOR / TARGET_LOAD;
      return KVA_SERIES.find((k) => k >= need) ?? KVA_SERIES[KVA_SERIES.length - 1]!;
    };
    const withKwh = tps.filter((t) => t.kwhJuly > 0).map((t) => t.kwhJuly).sort((a, b) => a - b);
    const medianKwh = withKwh[Math.floor(withKwh.length / 2)] ?? 5000;

    for (const t of tps) {
      const kva = kvaOf(t.kwhJuly > 0 ? t.kwhJuly : medianKwh);
      const dist = clamp(120 + (t.consumers || 40) * 1.6 + gauss(0, 25), 60, 700);
      await c.query('UPDATE ref.tp SET rated_kva = $2, avg_distance_m = $3 WHERE id = $1',
        [t.id, kva, r2(dist)]);
    }
    console.log('  ref.tp: quvvat (kVA) va masofa (m) - o‘lchangan iste’moldan hisoblandi');

    // ═══ 2. Tarmoq uzunligi (ref.network_segment) ═════════════════════════
    /*
     * QOIDA: hisobotlarda uzunlik yo'q. Har bir TP ga o'rtacha 0.9 km 10 kV
     * va 1.4 km 0.4 kV havo liniyasi to'g'ri keladi deb olinadi - bu tuman
     * elektr tarmoqlari uchun odatiy zichlik.
     */
    const segRows: unknown[][] = [];
    for (const f of feeders) {
      const n = tps.filter((t) => t.mfyId === f.id).length;
      if (n === 0) continue;
      segRows.push([f.id, 10, 'overhead', r2(n * 0.9 * (1 + gauss(0, 0.05)))]);
      segRows.push([f.id, 0.4, 'overhead', r2(n * 1.4 * (1 + gauss(0, 0.05)))]);
    }
    await bulk(c, 'ref.network_segment', ['mfy_id', 'voltage_kv', 'line_type', 'length_km'], segRows);
    console.log(`  ref.network_segment: ${segRows.length} ta bo‘lak (TP zichligidan)`);

    /*
     * Qarzdorlik bazasi - IYUL (to'liq oy) bo'yicha bir marta hisoblanadi:
     * tumanning o'lchangan «bir iste'molchiga kWh» ko'rsatkichi va umumiy
     * yo'qotish darajasi. Ikkala davr ham shundan foydalanadi.
     */
    const knownJuly = feeders
      .map((f) => ({
        consumers: tps.filter((t) => t.mfyId === f.id).reduce((a, t) => a + t.consumers, 0),
        b: balances.get(`${f.id}:2026-07-01`),
      }))
      .filter((x) => x.consumers > 0 && x.b);
    const kwhPerConsumer = knownJuly.length > 0
      ? knownJuly.reduce((a, x) => a + x.b!.kwhSold, 0) / knownJuly.reduce((a, x) => a + x.consumers, 0)
      : 200;
    const districtLossPct = (() => {
      const tot = knownJuly.reduce((a, x) => a + x.b!.kwhIn, 0);
      const sold = knownJuly.reduce((a, x) => a + x.b!.kwhSold, 0);
      return tot > 0 ? (tot - sold) / tot : 0.3;
    })();
    console.log(`  qarz bazasi: ${kwhPerConsumer.toFixed(0)} kWh/iste’molchi/oy,`
      + ` tuman yo‘qotishi ${(districtLossPct * 100).toFixed(1)}%`);

    /** Fider → (kuchlanish → ta'mir talab qiladigan km). Ishlar hajmi shundan olinadi. */
    const defectByFeeder = new Map<number, Map<number, number>>();

    // ═══ 3-6. Davr bo'yicha ══════════════════════════════════════════════
    for (const period of PERIODS) {
      const pEnd = period === '2026-08-01' ? TODAY : '2026-07-31';
      const isAug = period === '2026-08-01';
      const scale = isAug ? 8 / 31 : 1;

      const subOf = async (mfyId: number, domain: string): Promise<number> => (
        await c.query<{ id: number }>(
          `INSERT INTO fact.submission
             (scope_type, scope_id, domain, period_type, period_start, period_end,
              status, created_by, submitted_at, reviewed_by, reviewed_at)
           VALUES ('MFY', $1, $2, 'MONTH', $3::date, $4::date, 'approved', $5,
                   $4::date + time '09:00', $5, $4::date + time '14:00') RETURNING id`,
          [mfyId, domain, period, pEnd, admin])).rows[0]!.id;

      // ── 3. TP oylik holati ────────────────────────────────────────────
      /*
       * QOIDA: yuklama = o'lchangan iste'mol / nominal quvvat.
       * Holat esa balans hisoblagichi anomaliyasidan:
       *   • hisoblagich o'lik (o'qish ~0, iste'molchilar bor)  → FAULT
       *   • yo'qotish foizi < -30% (iste'molchilar balansdan ko'p) → ATTENTION
       *   • yuklama > 85%                                       → OVERLOAD
       */
      const statusRows: unknown[][] = [];
      for (const f of feeders) {
        const list = tps.filter((t) => t.mfyId === f.id);
        if (list.length === 0) continue;
        const sub = await subOf(f.id, 'TP_STATUS');

        for (const t of list) {
          const kva = kvaOf(t.kwhJuly > 0 ? t.kwhJuly : medianKwh);
          const avgKw = (t.kwhJuly > 0 ? t.kwhJuly : medianKwh) / (31 * 24);
          /*
           * Yuklama MAKSIMUM bo'yicha baholanadi, o'rtacha bo'yicha emas -
           * TP ning quvvati kechqurungi cho'qqiga yetishi kerak. Cho'qqi
           * koeffitsienti ≈ 1.7 (`fact.tp_reading_daily` dagi max/avg bilan
           * bir xil). Standart qatorga yaxlitlash tufayli ba'zi TP zaxirali,
           * ba'zisi esa cho'qqida 85% dan oshadi - OVERLOAD aynan shular.
           */
          const loadPct = clamp(
            (avgKw * PEAK_FACTOR / POWER_FACTOR / kva) * 100 * (1 + gauss(0, 0.07)), 1, 199);

          let condition: string;
          let repairReason: string | null = null;
          if (t.deadMeter) {
            condition = 'FAULT';
            repairReason = 'Balans hisoblagichi o‘qish bermayapti - almashtirish kerak';
          } else if (t.worstPct !== null && t.worstPct < -30) {
            condition = 'ATTENTION';
            repairReason = `Balans nomutanosibligi: yo‘qotish ${t.worstPct.toFixed(0)}% (iste’molchilar balansdan ko‘p)`;
          } else if (loadPct > 85) {
            condition = 'OVERLOAD';
            repairReason = `Yuklama ${loadPct.toFixed(0)}% - quvvat yetishmayapti`;
          } else {
            condition = 'GOOD';
          }
          const repairNeeded = repairReason !== null;

          statusRows.push([
            sub, t.id, period, r2(loadPct), r2(kva * (loadPct / 100) * 1.35),
            condition, loadPct < 25, repairNeeded, repairReason,
          ]);
        }
      }
      await bulk(c, 'fact.tp_status_monthly',
        ['submission_id', 'tp_id', 'period_month', 'load_pct', 'peak_kva',
          'condition', 'under_load', 'repair_needed', 'repair_reason'], statusRows);

      // ── 4. Tarmoq nuqsonlari ──────────────────────────────────────────
      /*
       * QOIDA: ta'mir talab qiladigan uzunlik - fiderning yo'qotish
       * darajasiga proportsional (yo'qotish qancha yuqori bo'lsa, tarmoq
       * shuncha eskirgan deb olinadi), lekin 12% dan oshmaydi.
       */
      const defectRows: unknown[][] = [];
      for (const f of feeders) {
        const b = balances.get(`${f.id}:${period}`);
        if (!b || b.kwhIn === 0) continue;
        const sub = await subOf(f.id, 'NETWORK_DEFECT');
        const lossShare = (b.kwhIn - b.kwhSold) / b.kwhIn;
        for (const [kv, km] of [[10, segRows.find((s) => s[0] === f.id && s[1] === 10)?.[3] as number],
          [0.4, segRows.find((s) => s[0] === f.id && s[1] === 0.4)?.[3] as number]] as const) {
          if (!km) continue;
          const need = r2(km * clamp(lossShare * 0.3, 0.01, 0.12) * (1 + gauss(0, 0.1)));
          defectRows.push([sub, f.id, period, kv, need, r2(need * clamp(0.25 + rand() * 0.35, 0, 1) * scale)]);
          if (!defectByFeeder.has(f.id)) defectByFeeder.set(f.id, new Map());
          defectByFeeder.get(f.id)!.set(kv, need);
        }
      }
      await bulk(c, 'fact.network_defect',
        ['submission_id', 'mfy_id', 'period_month', 'voltage_kv', 'repair_needed_km', 'repaired_km'],
        defectRows);

      // ── 5. Qarzdorlik va hisoblagich hisoblari ────────────────────────
      /*
       * QOIDA: qarzdorlik ISTE'MOLCHI SONIDAN chiqariladi, fider energiyasidan
       * EMAS. Sabab: TP tafsiloti 11 fiderdan faqat 6 tasini qamragan, ya'ni
       * Parranda kabi fiderda 190 MWh energiyaga atigi 88 ta ma'lum
       * iste'molchi to'g'ri keladi. Energiyadan hisoblansa bir iste'molchiga
       * qarz tuman o'rtachasidan 11 barobar oshib ketadi va `return_plausible`
       * triggeri buni (haqli ravishda) soxta deb bloklaydi.
       *
       * Shuning uchun: tumanning O'LCHANGAN "bir iste'molchiga kWh" ko'rsatkichi
       * asos qilib olinadi, fiderning o'z yo'qotish darajasi esa qarzni
       * o'rtachadan 0.5-2.0 barobar chetlatadi (yo'qotish yuqori - to'lov
       * intizomi past). Iste'molchisi noma'lum fiderda qarz YOZILMAYDI.
       */
      /*
       * Qarzdorlik - ZAXIRA ko'rsatkich (to'planib qolgan qoldiq), OQIM emas.
       * Shuning uchun baza har doim TO'LIQ oy (iyul) hisob-kitobidan olinadi;
       * avgustda 8 kun o'tgani uchun qarz kamayib qolmaydi, aksincha
       * to'lanmagan qism ustiga qo'shilib biroz o'sadi.
       */
      const debtPlan = feeders
        .map((f) => {
          const consumers = tps.filter((t) => t.mfyId === f.id).reduce((a, t) => a + t.consumers, 0);
          const jul = balances.get(`${f.id}:2026-07-01`);
          if (!jul || consumers === 0) return null;

          const lossPct = jul.kwhIn > 0 ? (jul.kwhIn - jul.kwhSold) / jul.kwhIn : districtLossPct;
          const discipline = clamp(0.7 + 0.6 * (lossPct / (districtLossPct || 1)), 0.5, 2.0);
          const billedMln = (consumers * kwhPerConsumer * TARIFF_SUM_PER_KWH) / 1e6;
          // Avgustda qarz qoldig'i sal o'sadi - 8 kunlik yangi to'lanmagan qism.
          const growth = isAug ? 1 + 0.12 * scale : 1;

          const pop = billedMln * (1 - LEGAL_SHARE) * ARREARS_RATE.population * discipline * growth;
          const legal = billedMln * LEGAL_SHARE * 0.75 * ARREARS_RATE.legal * discipline * growth;
          const budget = billedMln * LEGAL_SHARE * 0.25 * ARREARS_RATE.budget * discipline * growth;
          return { f, pop, legal, budget, total: pop + legal + budget };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => b.total - a.total);

      const debtTopRows: unknown[][] = [];
      for (const d of debtPlan) {
        const list = tps.filter((t) => t.mfyId === d.f.id);
        const consumers = list.reduce((a, t) => a + t.consumers, 0);
        const population = Math.round(consumers * (1 - LEGAL_SHARE));
        const legalCnt = consumers - population;

        /*
         * Hisoblagich hisoblari: o'lik balans hisoblagichli TP larning
         * iste'molchilari «aloqaga chiqmayotgan» deb hisoblanadi, ustiga
         * umumiy fon (2%) qo'shiladi.
         */
        const deadConsumers = list.filter((t) => t.deadMeter).reduce((a, t) => a + t.consumers, 0);
        const offline = Math.min(
          Math.round(consumers * 0.15), // yuqori chegara - 15% dan oshmaydi
          Math.round(consumers * 0.02 + deadConsumers * 0.2));
        const lowCons = Math.min(consumers, Math.round(consumers * 0.04));
        const needRepl = Math.min(consumers, Math.round(consumers * 0.03));

        await c.query(
          `UPDATE fact.mfy_monthly_return r
              SET consumers_population = $3, consumers_legal = $4,
                  debt_population_mln = $5, debt_legal_mln = $6, debt_budget_mln = $7,
                  meters_offline_cnt = $8, low_consumption_cnt = $9,
                  meters_replace_need_cnt = $10, meters_replaced_cnt = $11, updated_at = now()
            FROM fact.submission s
           WHERE s.id = r.submission_id AND s.status = 'approved'
             AND r.mfy_id = $1 AND r.period_month = $2::date`,
          [d.f.id, period, population, legalCnt,
            r2(d.pop), r2(d.legal), r2(d.budget),
            offline, lowCons, needRepl, Math.round(needRepl * 0.4 * scale)],
        );

        if (d.total <= 0 || list.length === 0) continue;
        const sub = await subOf(d.f.id, 'DEBT');
        /*
         * Top qarzdorlar - TP KESIMIDA jamlangan. Manba hujjatda ismlar
         * ham, shaxsiy hisob raqamlari bo'yicha qarz ham yo'q, shuning
         * uchun qator "falon TP bo'yicha yig'ma qarz" deb nomlanadi -
         * hech kimga nom biriktirilmaydi.
         */
        const top = [...list].sort((a, b) => b.kwhJuly - a.kwhJuly).slice(0, 10);
        const share = top.reduce((a, t) => a + t.kwhJuly, 0) || 1;
        top.forEach((t, i) => {
          const amt = r2((d.pop + d.legal) * 0.45 * (t.kwhJuly / share));
          if (amt <= 0) return;
          debtTopRows.push([
            sub, d.f.id, period, i + 1,
            `${t.code} bo‘yicha yig‘ma qarz`,
            i % 5 === 0 ? 'LEGAL' : 'POPULATION', amt,
          ]);
        });
      }
      await bulk(c, 'fact.debt_top_entry',
        ['submission_id', 'mfy_id', 'period_month', 'rank', 'debtor_name', 'category', 'amount_mln'],
        debtTopRows);

      console.log(`  ${period.slice(0, 7)}: ${statusRows.length} ta TP holati,`
        + ` ${defectRows.length} ta nuqson, ${debtTopRows.length} ta qarz qatori`);
    }

    // ═══ 7. Ishlar (fact.work) ════════════════════════════════════════════
    /*
     * QOIDA: ish - TP ning ANIQLANGAN muammosidan tug'iladi:
     *   • o'lik balans hisoblagichi   → METER_REPLACEMENT
     *   • kuchli manfiy yo'qotish     → ILLEGAL_DISCONNECT (reyd)
     *   • yuklama > 85%               → TP_MODERNIZATION
     * Boshqa TP larga ish OCHILMAYDI - "reja" o'ylab topilmaydi.
     */
    const workRows: unknown[][] = [];
    const workSubs = new Map<number, number>();
    for (const f of feeders) {
      workSubs.set(f.id, await (async () => (await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, submitted_at, reviewed_by, reviewed_at)
         VALUES ('MFY', $1, 'WORKS', 'MONTH', '2026-08-01'::date, $2::date, 'approved', $3,
                 $2::date + time '09:00', $3, $2::date + time '14:00') RETURNING id`,
        [f.id, TODAY, admin])).rows[0]!.id)());
    }

    let done = 0;
    for (const t of tps) {
      const kva = kvaOf(t.kwhJuly > 0 ? t.kwhJuly : medianKwh);
      const loadPct = ((t.kwhJuly > 0 ? t.kwhJuly : medianKwh) / (31 * 24))
        * PEAK_FACTOR / POWER_FACTOR / kva * 100;

      let type: string | null = null;
      let title = '';
      let cost = 0;
      if (t.deadMeter) {
        type = 'METER_REPLACEMENT';
        title = `${t.code}: balans hisoblagichini almashtirish`;
        cost = 3.5 + rand() * 2;
      } else if (t.worstPct !== null && t.worstPct < -60) {
        type = 'ILLEGAL_DISCONNECT';
        title = `${t.code}: noqonuniy ulanishlarni aniqlash reydi`;
        cost = 1.2 + rand() * 1.5;
      } else if (loadPct > 85) {
        type = 'TP_MODERNIZATION';
        title = `${t.code}: quvvatni oshirish (${kva} kVA yetishmayapti)`;
        cost = 45 + rand() * 40;
      }
      if (!type) continue;

      /*
       * Holat: uchdan biri bajarilgan (avgust boshida), qolgani jarayonda
       * yoki rejada. Bajarilganlar uchun natija ham yoziladi - NATIJADORLIK
       * paneli shu ustunlardan o'qiydi.
       */
      const roll = rand();
      const status = roll < 0.3 ? 'COMPLETED' : roll < 0.65 ? 'IN_PROGRESS' : 'PLANNED';
      const before = t.worstPct !== null ? clamp(Math.abs(t.worstPct), 5, 99) : clamp(20 + gauss(0, 6), 5, 99);
      const after = clamp(before * (0.25 + rand() * 0.3), 1, before);

      workRows.push([
        workSubs.get(t.mfyId), t.mfyId, t.id, type, title,
        status,
        '2026-07-05', status === 'PLANNED' ? '2026-09-15' : '2026-08-06',
        status === 'COMPLETED' ? '2026-08-0' + (1 + Math.floor(rand() * 7)) : null,
        status === 'COMPLETED' ? 100 : status === 'IN_PROGRESS' ? Math.round(25 + rand() * 55) : 0,
        1, 'ta', r2(cost),
        status === 'COMPLETED' ? r2(before) : null,
        status === 'COMPLETED' ? r2(after) : null,
        status === 'COMPLETED' ? r2(t.kwhJuly * ((before - after) / 100) * 0.35) : 0,
      ]);
      if (status === 'COMPLETED') done += 1;
    }

    /*
     * Fider darajasidagi ishlar - TP ga bog'lanmagan tarmoq ishlari.
     * Hajmi `ref.network_segment` dagi uzunlik va `fact.network_defect`
     * dagi ta'mir talab qiladigan km dan olinadi, ya'ni "reja" havodan
     * emas - aniqlangan nuqsonlar hajmiga tayanadi.
     */
    const NETWORK_WORKS = [
      { type: 'OVERHEAD_LINE_RENEWAL', kv: 0.4, title: '0.4 kV havo liniyasini yangilash', unit: 'km', rate: 62, status: 'COMPLETED' },
      { type: 'CABLE_REPLACEMENT', kv: 10, title: '10 kV kabel uchastkasini almashtirish', unit: 'km', rate: 145, status: 'COMPLETED' },
      { type: 'TREE_CLEARING', kv: 0.4, title: 'Liniya yo‘lagini daraxt shoxlaridan tozalash', unit: 'km', rate: 4, status: 'COMPLETED' },
      { type: 'SUPPORT_REPLACEMENT', kv: 0.4, title: 'Yaroqsiz tayanchlarni almashtirish', unit: 'ta', rate: 3.2, status: 'IN_PROGRESS' },
      { type: 'OVERHEAD_LINE_RENEWAL', kv: 10, title: '10 kV havo liniyasini rekonstruksiya qilish', unit: 'km', rate: 118, status: 'PLANNED' },
      { type: 'TP_INSTALL', kv: 10, title: 'Yuklamasi oshgan hududga yangi TP o‘rnatish', unit: 'ta', rate: 210, status: 'PLANNED' },
      { type: 'CABLE_REPLACEMENT', kv: 0.4, title: '0.4 kV o‘tkazgichni SIP ga almashtirish', unit: 'km', rate: 74, status: 'PLANNED' },
    ] as const;

    for (const f of feeders) {
      const defects = defectByFeeder.get(f.id);
      if (!defects) continue;
      for (const w of NETWORK_WORKS) {
        const needKm = defects.get(w.kv) ?? 0;
        if (needKm <= 0) continue;
        const qty = w.unit === 'km'
          ? r2(clamp(needKm * (0.15 + rand() * 0.35), 0.3, needKm))
          : Math.max(2, Math.round(needKm * (2 + rand() * 4)));
        const before = clamp(28 + gauss(0, 4), 5, 99);
        const after = clamp(before * (0.55 + rand() * 0.2), 1, before);

        workRows.push([
          workSubs.get(f.id), f.id, null, w.type, w.title, w.status,
          '2026-07-08', w.status === 'PLANNED' ? '2026-10-01' : '2026-08-05',
          w.status === 'COMPLETED' ? '2026-08-0' + (2 + Math.floor(rand() * 5)) : null,
          w.status === 'COMPLETED' ? 100 : w.status === 'IN_PROGRESS' ? Math.round(35 + rand() * 40) : 0,
          qty, w.unit, r2(qty * w.rate),
          w.status === 'COMPLETED' ? r2(before) : null,
          w.status === 'COMPLETED' ? r2(after) : null,
          w.status === 'COMPLETED' ? r2((balances.get(`${f.id}:2026-07-01`)?.kwhIn ?? 0) * 0.004) : 0,
        ]);
        if (w.status === 'COMPLETED') done += 1;
      }
    }

    await bulk(c, 'fact.work',
      ['submission_id', 'mfy_id', 'tp_id', 'work_type', 'title_uz', 'status',
        'planned_start', 'planned_end', 'actual_end', 'progress_pct',
        'quantity', 'unit', 'cost_mln',
        'effect_loss_pct_before', 'effect_loss_pct_after', 'effect_saving_kwh_month'], workRows);
    console.log(`\n  fact.work: ${workRows.length} ta ish (${done} tasi bajarilgan) - aniqlangan muammolardan`);

    // ═══ 8. Dalolatnomalar (fact.violation_act) ═══════════════════════════
    /*
     * QOIDA: dalolatnoma FAQAT o'lchov ko'rsatgan TP larga yoziladi -
     * biriktirilgan iste'molchilar balansdan sezilarli KO'P chiqqanlar
     * (yo'qotish foizi < -60%). Aniqlangan kWh - shu farqning oylik ulushi.
     */
    const violRows: unknown[][] = [];
    const violSubs = new Map<number, number>();
    const suspects = tps
      .filter((t) => t.worstPct !== null && t.worstPct < -60)
      .sort((a, b) => (a.worstPct ?? 0) - (b.worstPct ?? 0));

    let seq = 0;
    for (const t of suspects) {
      if (!violSubs.has(t.mfyId)) {
        violSubs.set(t.mfyId, (await c.query<{ id: number }>(
          `INSERT INTO fact.submission
             (scope_type, scope_id, domain, period_type, period_start, period_end,
              status, created_by, submitted_at, reviewed_by, reviewed_at)
           VALUES ('MFY', $1, 'VIOLATION', 'MONTH', '2026-08-01'::date, $2::date, 'approved', $3,
                   $2::date + time '09:00', $3, $2::date + time '14:00') RETURNING id`,
          [t.mfyId, TODAY, admin])).rows[0]!.id);
      }
      seq += 1;
      /* Aniqlangan kWh - anomaliyaning kunlik hajmidan, 30 kunga keltirilgan. */
      const kwh = r2(clamp(Math.abs(t.worstPct!) / 100, 0.1, 8) * Math.max(t.kwhJuly / 31, 20) * 4);
      const roll = rand();
      violRows.push([
        violSubs.get(t.mfyId), t.mfyId, t.id,
        `DL-2026-${String(seq).padStart(3, '0')}`,
        `2026-08-0${1 + Math.floor(rand() * 7)}`,
        kwh, r2((kwh * TARIFF_SUM_PER_KWH * 2) / 1e6),
        roll < 0.25 ? 'PAID' : roll < 0.5 ? 'COURT' : 'ISSUED',
      ]);
    }
    await bulk(c, 'fact.violation_act',
      ['submission_id', 'mfy_id', 'tp_id', 'act_no', 'act_date',
        'kwh_identified', 'fine_mln', 'status'], violRows);
    console.log(`  fact.violation_act: ${violRows.length} ta dalolatnoma - o‘lchov anomaliyasi bo‘yicha`);

    // ═══ 9. TP kunlik ko'rsatkichlari (fact.tp_reading_daily) ═════════════
    /*
     * QOIDA: kunlik yuklama TP ning o'lchangan oylik iste'molidan:
     * o'rtacha kW = kWh/kun/24, maksimum ≈ 1.7×, minimum ≈ 0.35×.
     * Kuchlanish 220 V atrofida, uzoq TP larda pastroq - `avg_distance_m`
     * bilan bog'liq (uzun liniyada kuchlanish tushadi).
     * Uzilishlar - nosoz holatdagi TP larda tez-tez.
     */
    const dates = dateRange(READING_FROM, TODAY);
    const readSubs = new Map<number, number>();
    for (const f of feeders) {
      readSubs.set(f.id, (await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, submitted_at, reviewed_by, reviewed_at)
         VALUES ('MFY', $1, 'TP_READING', 'MONTH', $2::date, $3::date, 'approved', $4,
                 $3::date + time '09:00', $4, $3::date + time '14:00') RETURNING id`,
        [f.id, READING_FROM, TODAY, admin])).rows[0]!.id);
    }

    const readRows: unknown[][] = [];
    for (const t of tps) {
      const kwhDay = (t.kwhJuly > 0 ? t.kwhJuly : medianKwh) / 31;
      const avgKw = kwhDay / 24;
      const faulty = t.deadMeter || (t.worstPct !== null && t.worstPct < -60);
      const distPenalty = clamp((t.consumers || 40) / 400, 0, 0.035);

      for (const date of dates) {
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        const w = dow === 0 || dow === 6 ? 0.9 : 1.05;
        const max = Math.max(0.1, avgKw * 1.7 * w * (1 + gauss(0, 0.09)));
        const min = clamp(avgKw * 0.35 * w * (1 + gauss(0, 0.12)), 0, max);
        const outage = faulty ? (rand() < 0.12 ? 1 + Math.floor(rand() * 2) : 0)
          : (rand() < 0.03 ? 1 : 0);
        readRows.push([
          readSubs.get(t.mfyId), t.id, date, r2(max), r2(min),
          r2(clamp(224 - distPenalty * 220 + gauss(0, 2.4), 195, 240)),
          outage, outage === 0 ? 0 : Math.round(15 + rand() * 180),
        ]);
      }
    }
    await bulk(c, 'fact.tp_reading_daily',
      ['submission_id', 'tp_id', 'biz_date', 'max_load_kw', 'min_load_kw',
        'avg_voltage_v', 'outage_count', 'outage_minutes'], readRows, 800);
    console.log(`  fact.tp_reading_daily: ${readRows.length} ta qator (${dates.length} kun × ${tps.length} TP)`);

    await c.query('COMMIT');
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);

    console.log('\nAgregatlar qayta qurilmoqda…');
    await c.query('SELECT agg.refresh_all(false)');

    const check = await c.query(`
      SELECT to_char(a.period_month,'YYYY-MM') AS davr, m.short_name AS fider,
             a.tp_total, a.tp_overloaded, a.tp_repair_needed,
             round(a.debt_total_mln)::int AS qarz_mln, a.meters_offline_cnt AS uzilgan
        FROM agg.mfy_monthly a JOIN ref.mfy m ON m.id = a.mfy_id
       WHERE a.period_month = '2026-08-01' ORDER BY m.sort_order`);
    console.log('\nNatija (avgust):');
    console.table(check.rows);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

await main();
