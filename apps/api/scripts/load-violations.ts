/**
 * XAQULOBOD FIDERI - dalolatnomalar (iyul va avgust 2026).
 *
 * MANBA: operator bergan OYLIK SONLAR. Excel fayl yo'q, shuning uchun
 * ro'yxat shu skriptning o'zida turadi:
 *
 *   iyul    11 ta ma'muriy  ·  10 ta «aybsiz»
 *   avgust   2 ta ma'muriy  ·   5 ta «aybsiz»
 *
 * MA'LUM BO'LGAN NARSA FAQAT SHU: oy, toifa va SONI.
 *
 * Dalolatnoma raqami, sanasi, aniqlangan energiya, jarima summasi, abonent
 * va TP - berilmagan. Shuning uchun:
 *   • `kwh_identified` va `fine_mln` = 0 (o'ylab topilmaydi)
 *   • `consumer_ref`, `tp_id` = NULL
 *   • `status` = 'ISSUED' - dalolatnoma rasmiylashtirilgani ma'lum, undan
 *     keyingi harakat (to'landi / sudda / yopildi) ma'lum emas
 *   • `act_no` tartib raqami bilan quriladi: `XQ-2026-07-001`
 *   • `act_date` oy ichida TEKIS taqsimlanadi - aniq sana manbada yo'q,
 *     lekin ustun NOT NULL va karta sanaga qarab tartiblaydi
 *
 * Aniq raqam va sanalar kelganda shu skriptdagi ro'yxatni almashtiring.
 *
 *   node --experimental-strip-types apps/api/scripts/load-violations.ts [--dry]
 *
 * IDEMPOTENT: shu skript yozgan dalolatnomalar (`act_no` prefiksi bo'yicha)
 * oldin o'chiriladi, boshqa manbadan kelganlariga TEGILMAYDI.
 */
import pg from 'pg';

import { config } from '../src/config.ts';

const FEEDER_CODE = 'FIDER-XAQULOBOD';

/** Faqat shu skript yozgan qatorlarni qayta topish uchun prefiks. */
const ACT_PREFIX = 'XQ-';

interface PeriodSpec {
  period: string;
  label: string;
  administrative: number;
  noFault: number;
  /**
   * Sanalar shu kungacha taqsimlanadi. Avgust hali tugamagan - ma'lumot
   * mavjud oxirgi kuni 10-avgust, `va_no_future` cheklovi esa kelajakdagi
   * sanani umuman qabul qilmaydi.
   */
  lastDay: number;
}

const PERIODS: PeriodSpec[] = [
  { period: '2026-07', label: 'iyul', administrative: 11, noFault: 10, lastDay: 31 },
  { period: '2026-08', label: 'avgust', administrative: 2, noFault: 5, lastDay: 12 },
];

interface ActRow {
  actNo: string;
  actDate: string;
  caseType: 'ADMINISTRATIVE' | 'NO_FAULT';
}

/**
 * Oy ichida tekis taqsimlangan sanalar.
 *
 * `(i + 0.5) / count` - qatorlar oyning boshiga ham, oxiriga ham
 * yopishib qolmaydi: 3 ta dalolatnoma 31 kunlik oyda 6, 16 va 26-kunlarga
 * tushadi.
 */
function spreadDates(period: string, count: number, lastDay: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = Math.min(lastDay, Math.max(1, Math.round(((i + 0.5) / count) * lastDay)));
    out.push(`${period}-${String(day).padStart(2, '0')}`);
  }
  return out;
}

function buildActs(spec: PeriodSpec): ActRow[] {
  const total = spec.administrative + spec.noFault;
  const dates = spreadDates(spec.period, total, spec.lastDay);
  const [yyyy, mm] = spec.period.split('-');

  const types: ActRow['caseType'][] = [
    ...Array<ActRow['caseType']>(spec.administrative).fill('ADMINISTRATIVE'),
    ...Array<ActRow['caseType']>(spec.noFault).fill('NO_FAULT'),
  ];

  return types.map((caseType, i) => ({
    actNo: `${ACT_PREFIX}${yyyy}-${mm}-${String(i + 1).padStart(3, '0')}`,
    actDate: dates[i]!,
    caseType,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');

  const plan = PERIODS.map((p) => ({ spec: p, acts: buildActs(p) }));

  console.log(`Dalolatnomalar${dry ? '  [DRY-RUN - hech narsa yozilmaydi]' : ''}`);
  for (const { spec, acts } of plan) {
    console.log(
      `  ${spec.label.padEnd(7)} ${String(acts.length).padStart(2)} ta`
      + `  ·  ma'muriy ${spec.administrative}  ·  aybsiz ${spec.noFault}`
      + `  ·  ${acts[0]!.actDate} … ${acts[acts.length - 1]!.actDate}`,
    );
  }

  if (dry) {
    console.log('\n[DRY-RUN] Baza o‘zgartirilmadi.');
    return;
  }

  const client = new pg.Client({
    host: config.db.host, port: config.db.port, database: config.db.database,
    user: config.db.user, password: config.db.password,
  });
  await client.connect();

  try {
    const feeder = await client.query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE code = $1 AND valid_to IS NULL`, [FEEDER_CODE]);
    const mfyId = feeder.rows[0]?.id;
    if (!mfyId) throw new Error(`Registrda "${FEEDER_CODE}" fideri topilmadi`);

    await client.query('BEGIN');
    const admin = await client.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1`);
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.role', 'admin', true),
              set_config('app.mfy_ids', '', true), set_config('app.request_id', 'load-violations', true)`,
      [admin.rows[0]?.id === undefined ? '' : String(admin.rows[0].id)]);

    const wiped = await client.query(
      `DELETE FROM fact.violation_act WHERE mfy_id = $1 AND act_no LIKE $2`,
      [mfyId, `${ACT_PREFIX}%`]);
    if (wiped.rowCount) console.log(`\nEski ${wiped.rowCount} ta dalolatnoma o‘chirildi (qayta yozish).`);

    let written = 0;
    for (const { acts } of plan) {
      for (const a of acts) {
        await client.query(
          `INSERT INTO fact.violation_act
             (mfy_id, act_no, act_date, case_type, status, kwh_identified, fine_mln)
           VALUES ($1, $2, $3::date, $4, 'ISSUED', 0, 0)`,
          [mfyId, a.actNo, a.actDate, a.caseType]);
        written += 1;
      }
    }

    await client.query('COMMIT');
    console.log(`\nYozildi: ${written} ta dalolatnoma.`);

    // Nazorat - bazadan qayta o'qib ko'rsatamiz.
    const check = await client.query<{ oy: string; case_type: string; n: number }>(
      `SELECT to_char(act_date, 'YYYY-MM') AS oy, case_type, count(*)::int AS n
         FROM fact.violation_act WHERE mfy_id = $1
        GROUP BY 1, 2 ORDER BY 1, 2`, [mfyId]);
    console.log('\nBAZADAGI HOLAT:');
    for (const r of check.rows) console.log(`  ${r.oy}  ${r.case_type.padEnd(15)} ${r.n} ta`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

await main();
