/**
 * MA'LUMOTLAR BAZASI CHEKLOVLARI TESTI.
 *
 * Prinsip: "Hech narsani rad etganini ko'rmagan cheklov — cheklov emas."
 *
 * Har bir test ATAYLAB noto'g'ri ma'lumot yozishga urinadi va DB uni
 * rad etishini kutadi. Rad etmasa — test yiqiladi.
 *
 * Barcha yozuvlar SAVEPOINT ichida bajariladi va qaytariladi — baza
 * o'zgarmaydi.
 */
import pg from 'pg';
import { config } from '../src/config.ts';
const results = [];
async function run(client, ctx, c) {
    await client.query('SAVEPOINT tc');
    try {
        await c.run(client, ctx);
        await client.query('ROLLBACK TO SAVEPOINT tc');
        results.push({
            name: c.name,
            ok: false,
            detail: `RAD ETILMADI — "${c.expect}" cheklovi ishlamadi`,
        });
    }
    catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT tc');
        const e = err;
        const text = `${e.constraint ?? ''} ${e.message}`;
        const expected = Array.isArray(c.expect) ? c.expect : [c.expect];
        const matched = expected.some((x) => text.includes(x));
        results.push({
            name: c.name,
            ok: matched,
            detail: matched
                ? `rad etildi (${e.constraint ?? e.message.split('\n')[0]?.slice(0, 60)})`
                : `boshqa xato: ${e.message.split('\n')[0]}`,
        });
    }
}
const CASES = [
    {
        // Sotilgan > kirim bo'lganda yo'qotish MANFIY bo'lib qoladi, tarkib esa
        // manfiy bo'la olmaydi — shu sababli qator ikkala cheklovni bir vaqtda
        // buzadi. Muhimi: qator RAD ETILADI.
        name: 'Sotilgan energiya kirimdan ko‘p bo‘la olmaydi',
        expect: ['eb_sold_le_in', 'eb_components'],
        run: (c, x) => c.query(`INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
            kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
         VALUES ($1, $2, CURRENT_DATE - 400, 1000, 1200, 0, 0, 0)`, [x.submissionId, x.mfyId]),
    },
    {
        name: 'Yo‘qotish tarkibi jamiga mos kelishi shart',
        expect: 'eb_components',
        run: (c, x) => c.query(`INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
            kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
         VALUES ($1, $2, CURRENT_DATE - 401, 1000, 900, 10, 10, 10)`, [x.submissionId, x.mfyId]),
    },
    {
        name: 'Kelajakdagi sana kiritib bo‘lmaydi',
        expect: 'eb_no_future',
        run: (c, x) => c.query(`INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
            kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
         VALUES ($1, $2, CURRENT_DATE + 5, 1000, 900, 100, 0, 0)`, [x.submissionId, x.mfyId]),
    },
    {
        // Balans ayniyatini BUZMAYDIGAN manfiy qiymat: kirim = sotilgan = −50,
        // demak yo'qotish 0 va tarkib 0 — faqat "manfiy bo'lmasin" cheklovi qoladi.
        name: 'Manfiy energiya qiymati qabul qilinmaydi',
        expect: ['kwh_in', 'kwh_sold'],
        run: (c, x) => c.query(`INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
            kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
         VALUES ($1, $2, CURRENT_DATE - 402, -50, -50, 0, 0, 0)`, [x.submissionId, x.mfyId]),
    },
    {
        name: 'Aloqaga chiqayotgan istemolchilar jamidan ko‘p bo‘la olmaydi',
        expect: 'mr_active_le_total',
        run: (c, x) => c.query(`INSERT INTO fact.mfy_monthly_return
           (submission_id, mfy_id, period_month, consumers_population,
            consumers_legal, consumers_active)
         VALUES ($1, $2, ($3 || '-01')::date, 100, 10, 500)`, [x.submissionId, x.mfyId2, x.period]),
    },
    {
        name: 'Almashtirilgan hisoblagich kerakli sondan ko‘p bo‘la olmaydi',
        expect: 'mr_replaced_le_need',
        run: (c, x) => c.query(`INSERT INTO fact.mfy_monthly_return
           (submission_id, mfy_id, period_month, consumers_population,
            consumers_legal, consumers_active,
            meters_replace_need_cnt, meters_replaced_cnt)
         VALUES ($1, $2, ($3 || '-01')::date, 100, 10, 100, 5, 20)`, [x.submissionId, x.mfyId2, x.period]),
    },
    {
        name: 'GO‘RAVON HODISASI: tuman qarzdorligini MFY qatoriga yozib bo‘lmaydi',
        expect: 'IMPLAUSIBLE_DEBT',
        run: (c, x) => c.query(`INSERT INTO fact.mfy_monthly_return
           (submission_id, mfy_id, period_month, consumers_population,
            consumers_legal, consumers_active,
            debt_population_mln, debt_legal_mln)
         VALUES ($1, $2, ($3 || '-01')::date, 820, 9, 810, 2449.1, 1816.5)`, [x.submissionId, x.mfyId2, x.period]),
    },
    {
        name: 'Bir davr uchun ikkita tasdiqlangan konvert bo‘la olmaydi',
        expect: 'submission_approved_uq',
        run: async (c, x) => {
            await c.query(`INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, reviewed_at, reviewed_by)
         VALUES ('MFY', $1, 'ENERGY_BALANCE', 'MONTH',
                 ($2 || '-01')::date,
                 (($2 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date,
                 'approved', $3, now(), $3)`, [x.mfyId, x.period, x.userId]);
        },
    },
    {
        name: 'TP yuklamasi 200% dan oshmasligi kerak',
        expect: 'load_pct',
        run: (c, x) => c.query(`INSERT INTO fact.tp_status_monthly
           (submission_id, tp_id, period_month, load_pct)
         VALUES ($1, $2, ($3 || '-01')::date, 350)`, [x.submissionId, x.tpId, x.period]),
    },
    {
        name: 'Ta’mir kerak bo‘lsa sabab ko‘rsatilishi shart',
        expect: 'ts_repair_reason',
        run: (c, x) => c.query(`INSERT INTO fact.tp_status_monthly
           (submission_id, tp_id, period_month, load_pct, repair_needed, repair_reason)
         VALUES ($1, $2, ($3 || '-01')::date, 50, true, NULL)`, [x.submissionId, x.tpId, x.period]),
    },
    {
        name: 'Minimal yuklama maksimaldan katta bo‘la olmaydi',
        expect: 'tr_min_le_max',
        run: (c, x) => c.query(`INSERT INTO fact.tp_reading_daily
           (submission_id, tp_id, biz_date, max_load_kw, min_load_kw)
         VALUES ($1, $2, CURRENT_DATE - 405, 10, 90)`, [x.submissionId, x.tpId]),
    },
    {
        name: 'Ta’mirlangan uzunlik kerakli uzunlikdan ko‘p bo‘la olmaydi',
        expect: 'nd_repaired_le_needed',
        run: (c, x) => c.query(`INSERT INTO fact.network_defect
           (submission_id, mfy_id, period_month, voltage_kv, repair_needed_km, repaired_km)
         VALUES ($1, $2, ($3 || '-01')::date, 0.4, 2, 9)`, [x.submissionId, x.mfyId2, x.period]),
    },
    {
        name: 'Bajarilgan ish 100% va tugash sanasiz bo‘la olmaydi',
        expect: 'work_completed',
        run: (c, x) => c.query(`INSERT INTO fact.work
           (mfy_id, work_type, title_uz, status, progress_pct, actual_end)
         VALUES ($1, 'OTHER', 'Test ishi', 'COMPLETED', 40, NULL)`, [x.mfyId]),
    },
    {
        name: 'Bir metrikaning ikkita qoplashuvchi normasi bo‘la olmaydi',
        expect: 'norm_no_overlap',
        run: (c) => c.query(`INSERT INTO ref.norm
           (scope_type, scope_id, metric, value_num, unit, effective_from)
         VALUES ('TUMAN', NULL, 'NATURAL_LOSS_PCT', 9.9, '%', '2025-01-01')`),
    },
    {
        name: 'Pasport snapshot o‘zgartirib bo‘lmaydi (append-only)',
        expect: 'APPEND_ONLY',
        run: async (c, x) => {
            const { rows } = await c.query(`INSERT INTO fact.passport_snapshot
           (scope_type, scope_id, period_month, payload, content_sha256, frozen_by)
         VALUES ('MFY', $1, ($2 || '-01')::date, '{"t":1}'::jsonb, 'abc', $3)
         RETURNING id`, [x.mfyId, x.period, x.userId]);
            const id = rows[0].id;
            await c.query(`UPDATE fact.passport_snapshot SET content_sha256 = 'HACKED' WHERE id = $1`, [id]);
            const check = await c.query(`SELECT content_sha256 FROM fact.passport_snapshot WHERE id = $1`, [id]);
            // RULE ... DO INSTEAD NOTHING xato bermaydi — o'zgarish sodir BO'LMAYDI.
            if (check.rows[0]?.content_sha256 === 'HACKED') {
                throw new Error('UPDATE_SUCCEEDED — snapshot himoyalanmagan!');
            }
            throw new Error('APPEND_ONLY — UPDATE e‘tiborsiz qoldirildi (kutilgan xatti-harakat)');
        },
    },
];
async function main() {
    const pool = new pg.Pool({ ...config.db, max: 2 });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL app.role = 'system'");
        const ref = await client.query(`
      SELECT
        (SELECT id FROM ref.mfy ORDER BY id LIMIT 1)        AS mfy_id,
        (SELECT id FROM ref.mfy ORDER BY id OFFSET 1 LIMIT 1) AS mfy_id2,
        (SELECT id FROM ref.tp WHERE voltage_class <> '35/10' ORDER BY id LIMIT 1) AS tp_id,
        (SELECT id FROM sec.app_user ORDER BY id LIMIT 1)   AS user_id,
        (SELECT id FROM fact.submission WHERE status = 'approved' ORDER BY id LIMIT 1) AS submission_id,
        (SELECT to_char(max(period_month), 'YYYY-MM') FROM agg.mfy_monthly) AS period
    `);
        const r = ref.rows[0];
        if (!r?.mfy_id || !r.submission_id) {
            throw new Error('Baza bo‘sh — avval `npm run seed` bajaring');
        }
        const ctx = {
            mfyId: r.mfy_id, mfyId2: r.mfy_id2, tpId: r.tp_id,
            userId: r.user_id, submissionId: r.submission_id, period: r.period,
        };
        for (const c of CASES)
            await run(client, ctx, c);
        await client.query('ROLLBACK');
    }
    finally {
        client.release();
        await pool.end();
    }
    const failed = results.filter((r) => !r.ok);
    process.stdout.write('\nMA’LUMOTLAR BAZASI CHEKLOVLARI TESTI\n');
    process.stdout.write('Har bir test ATAYLAB noto‘g‘ri ma’lumot yozishga urinadi.\n');
    process.stdout.write('═'.repeat(84) + '\n');
    for (const r of results) {
        process.stdout.write(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(58)} ${r.detail}\n`);
    }
    process.stdout.write('═'.repeat(84) + '\n');
    process.stdout.write(failed.length === 0
        ? `✓ Barcha ${results.length} ta cheklov ishlayotgani tasdiqlandi.\n\n`
        : `✗ ${failed.length} / ${results.length} ta cheklov ISHLAMADI.\n\n`);
    if (failed.length > 0)
        process.exitCode = 1;
}
main().catch((err) => {
    process.stderr.write(`\n✗ Test xatosi: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
});
