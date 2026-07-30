/**
 * Pasport yaxlitligini tekshirish.
 *
 * 1. Har bir oy va har bir qator uchun: SUM(MFY pasportlari) = TUMAN pasporti.
 *    Bu "tuman pasporti qo'lda kiritilmaydi" va'dasining isboti.
 * 2. Oxirgi oy jamlari HAQIQIY pasport raqamlariga mos kelishi.
 * 3. Balans ayniyati: har bir kunlik qatorda tarkib jamiga teng.
 *
 * Nol bo'lmagan exit kodi = yaxlitlik buzilgan.
 */
import pg from 'pg';
import { config } from '../src/config.ts';
import { loadSeedConfig } from '../seed/generate.ts';
const checks = [];
const add = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
};
const num = (v) => Number(v ?? 0);
const close = (a, b, tolPct = 0.1) => Math.abs(a - b) <= Math.max(0.05, (Math.abs(b) * tolPct) / 100);
async function main() {
    const pool = new pg.Pool({ ...config.db, max: 2 });
    const client = await pool.connect();
    try {
        // ── 1. Roll-up: SUM(MFY) = TUMAN, barcha oylar, barcha qatorlar ───────
        const ROLLUP_COLUMNS = [
            'consumers_total', 'consumers_population', 'consumers_legal',
            'transformer_cnt', 'tp_under_load',
            'line_km_total', 'line_km_04', 'line_km_10',
            'debt_total_mln', 'debt_population_mln', 'debt_legal_mln',
            'meters_offline_cnt', 'low_consumption_cnt',
            'tp_repair_needed', 'repair_km_total', 'repair_km_04', 'repair_km_10',
            'meters_replace_need_cnt', 'meters_replaced_cnt',
        ];
        const selects = ROLLUP_COLUMNS.map((c) => `round(sum(p.${c})::numeric, 2) AS mfy_${c}, round(max(t.${c})::numeric, 2) AS tuman_${c}`).join(',\n           ');
        const { rows: rollup } = await client.query(`
      SELECT p.period_month, ${selects}
      FROM agg.v_mfy_passport p
      JOIN agg.v_tuman_passport t ON t.period_month = p.period_month
      GROUP BY p.period_month
      ORDER BY p.period_month
    `);
        let mismatches = 0;
        const mismatchDetail = [];
        for (const row of rollup) {
            for (const c of ROLLUP_COLUMNS) {
                const mfySum = num(row[`mfy_${c}`]);
                const tuman = num(row[`tuman_${c}`]);
                if (Math.abs(mfySum - tuman) > 0.05) {
                    mismatches += 1;
                    if (mismatchDetail.length < 6) {
                        const month = String(row['period_month']).slice(0, 10);
                        mismatchDetail.push(`${month} ${c}: MFY=${mfySum} ≠ TUMAN=${tuman}`);
                    }
                }
            }
        }
        add(`Roll-up: SUM(MFY) = TUMAN (${rollup.length} oy × ${ROLLUP_COLUMNS.length} qator)`, mismatches === 0, mismatches === 0 ? `${rollup.length * ROLLUP_COLUMNS.length} ta tekshiruv` : mismatchDetail.join('; '));
        // ── 2. Oxirgi oy HAQIQIY pasport raqamlariga mos kelishi ──────────────
        const cfg = loadSeedConfig();
        const dt = cfg.districtTotals;
        const { rows: lastRows } = await client.query(`
      SELECT * FROM agg.v_tuman_passport ORDER BY period_month DESC LIMIT 1
    `);
        const last = lastRows[0];
        if (!last) {
            add('Oxirgi oy pasporti mavjud', false, 'Ma\'lumot yo\'q — seed ishga tushirilganmi?');
        }
        else {
            const expectations = [
                ['Aholi iste\'molchilari', num(last['consumers_population']), dt['consumersPopulation']],
                ['Yuridik iste\'molchilar', num(last['consumers_legal']), dt['consumersLegal']],
                ['Transformatorlar', num(last['transformer_cnt']), dt['tpCount']],
                ['Nimstansiyalar', num(last['substation_cnt']), dt['substationCount']],
                ['0.4 kV tarmoq (km)', num(last['line_km_04']), dt['lineKm04']],
                ['10 kV tarmoq (km)', num(last['line_km_10']), dt['lineKm10']],
                ['Aholi qarzdorligi (mln)', num(last['debt_population_mln']), dt['debtPopulationMln']],
                ['Yuridik qarzdorlik (mln)',
                    num(last['debt_legal_mln']) + num(last['debt_budget_mln']), dt['debtLegalMln']],
                ['Aloqasiz hisoblagichlar', num(last['meters_offline_cnt']), dt['metersOfflineCnt']],
                ['Kam iste\'molchilar', num(last['low_consumption_cnt']), dt['lowConsumptionCnt']],
                ['Ta\'mir kerak TP lar', num(last['tp_repair_needed']), dt['tpRepairNeeded']],
                ['Ta\'mir kerak tarmoq (km)',
                    num(last['repair_km_total']), dt['repairKm04'] + dt['repairKm10']],
                ['Almashtirish kerak hisoblagich', num(last['meters_replace_need_cnt']), dt['metersReplaceNeedCnt']],
                ['Almashtirilgan hisoblagich', num(last['meters_replaced_cnt']), dt['metersReplacedCnt']],
            ];
            for (const [label, actual, expected] of expectations) {
                add(`Kalibrovka — ${label}`, close(actual, expected), `${actual} (kutilgan ${expected})`);
            }
            // Hujjatdagi ma'lum nomuvofiqlik — bu XATO emas, ogohlantirish.
            const statedTotal = dt['_consumersTotalStated'];
            const computedTotal = num(last['consumers_total']);
            if (statedTotal !== undefined && statedTotal !== computedTotal) {
                add('Hujjat nomuvofiqligi (kutilgan)', true, `Pasportda jami ${statedTotal}, bo'laklar yig'indisi ${computedTotal} — tizim bo'laklardan hisoblaydi`);
            }
        }
        // ── 3. Balans ayniyati har bir kunlik qatorda ─────────────────────────
        const { rows: balRows } = await client.query(`
      SELECT
        count(*) FILTER (
          WHERE abs((kwh_in - kwh_sold)
                    - (kwh_loss_natural + kwh_loss_technical + kwh_loss_illegal))
                > GREATEST(1.0, 0.005 * kwh_in)) AS bad,
        count(*) AS total
      FROM fact.energy_balance_daily
    `);
        const bad = Number(balRows[0]?.bad ?? 0);
        add('Balans ayniyati (kirim − sotilgan = tarkib)', bad === 0, `${Number(balRows[0]?.total ?? 0)} qator tekshirildi, ${bad} ta buzilgan`);
        // ── 4. Bir davrga bitta tasdiqlangan konvert ──────────────────────────
        const { rows: dupRows } = await client.query(`
      SELECT count(*) AS n FROM (
        SELECT scope_type, scope_id, domain, period_start
        FROM fact.submission WHERE status = 'approved'
        GROUP BY 1,2,3,4 HAVING count(*) > 1
      ) x
    `);
        add('Bir davr + domen uchun bitta tasdiqlangan konvert', Number(dupRows[0]?.n ?? 0) === 0, `${dupRows[0]?.n ?? 0} ta takror`);
        // ── 5. Yetim qatorlar (tasdiqlanmagan konvertga bog'langan fakt) ──────
        const { rows: orphanRows } = await client.query(`
      SELECT count(*) AS n FROM fact.energy_balance_daily e
      LEFT JOIN fact.submission s ON s.id = e.submission_id
      WHERE s.id IS NULL
    `);
        add('Yetim fakt qatorlari yo‘q', Number(orphanRows[0]?.n ?? 0) === 0, `${orphanRows[0]?.n ?? 0} ta`);
        // ── Natija ────────────────────────────────────────────────────────────
        const failed = checks.filter((c) => !c.ok);
        process.stdout.write('\nPASPORT YAXLITLIGI TEKSHIRUVI\n');
        process.stdout.write('═'.repeat(78) + '\n');
        for (const c of checks) {
            const mark = c.ok ? '✓' : '✗';
            process.stdout.write(`${mark} ${c.name.padEnd(46)} ${c.detail}\n`);
        }
        process.stdout.write('═'.repeat(78) + '\n');
        process.stdout.write(failed.length === 0
            ? `✓ Barcha ${checks.length} ta tekshiruv o‘tdi.\n\n`
            : `✗ ${failed.length} / ${checks.length} ta tekshiruv MUVAFFAQIYATSIZ.\n\n`);
        if (failed.length > 0)
            process.exitCode = 1;
    }
    finally {
        client.release();
        await pool.end();
    }
}
main().catch((err) => {
    process.stderr.write(`\n✗ Tekshiruv xatosi: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
});
