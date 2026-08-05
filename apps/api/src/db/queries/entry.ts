/**
 * Input panel — ma'lumot kiritish, tekshirish va tasdiqlash oqimi.
 *
 * Muhim: bu yerdagi hech bir funksiya "jami" qiymatni yozmaydi.
 * Jamilar DB da GENERATED ustunlar sifatida hisoblanadi.
 */
import type {
  CompletenessCell, Domain, EnergyBalanceDay, MonthlyReturn, NetworkDefect, Submission,
  SubmissionDiffRow, SubmissionStatus, TpStatus, ValidationIssue, ValidationReport,
} from '@beap/shared';
import { DOMAINS, balanceTolerance, canTransition } from '@beap/shared';
import type pg from 'pg';

import { type AppContext, isPgError, query, queryOne, withTransaction } from '../pool.ts';

const SUBMISSION_SELECT = `
  s.id, s.scope_type, s.scope_id, s.domain, s.period_start::text, s.period_end::text,
  s.revision, s.status, s.supersedes_id, s.created_by, s.created_at::text,
  s.submitted_at::text, s.reviewed_by, s.reviewed_at::text, s.review_note,
  coalesce(m.name_uz, 'Baliqchi tumani') AS scope_name,
  cu.full_name AS created_by_name,
  ru.full_name AS reviewed_by_name
`;

const SUBMISSION_FROM = `
  FROM fact.submission s
  LEFT JOIN ref.mfy m ON m.id = s.scope_id AND s.scope_type = 'MFY'
  JOIN sec.app_user cu ON cu.id = s.created_by
  LEFT JOIN sec.app_user ru ON ru.id = s.reviewed_by
`;

function mapSubmission(r: Record<string, unknown>): Submission {
  return {
    id: Number(r['id']), scopeType: r['scope_type'] as Submission['scopeType'],
    scopeId: Number(r['scope_id']), scopeName: String(r['scope_name']),
    domain: r['domain'] as Domain,
    periodStart: String(r['period_start']), periodEnd: String(r['period_end']),
    revision: Number(r['revision']), status: r['status'] as SubmissionStatus,
    supersedesId: r['supersedes_id'] === null ? null : Number(r['supersedes_id']),
    createdBy: Number(r['created_by']), createdByName: String(r['created_by_name']),
    createdAt: String(r['created_at']),
    submittedAt: (r['submitted_at'] as string | null) ?? null,
    reviewedBy: r['reviewed_by'] === null ? null : Number(r['reviewed_by']),
    reviewedByName: (r['reviewed_by_name'] as string | null) ?? null,
    reviewedAt: (r['reviewed_at'] as string | null) ?? null,
    reviewNote: (r['review_note'] as string | null) ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// To'liqlik matritsasi — hokim korxonalarni shu panel bilan nazorat qiladi
// ═══════════════════════════════════════════════════════════════════════════

export async function completeness(ctx: AppContext, period: string): Promise<CompletenessCell[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT m.id AS mfy_id, m.name_uz, d.domain,
            s.id AS submission_id, s.status, s.updated_at::text
     FROM ref.mfy m
     CROSS JOIN (SELECT unnest($2::text[]) AS domain) d
     LEFT JOIN LATERAL (
       SELECT s.id, s.status, s.updated_at
       FROM fact.submission s
       WHERE s.scope_type = 'MFY' AND s.scope_id = m.id
         AND s.domain = d.domain AND s.period_start = ($1 || '-01')::date
         AND s.status <> 'superseded'
       ORDER BY CASE s.status WHEN 'approved' THEN 1 WHEN 'submitted' THEN 2
                              WHEN 'rejected' THEN 3 ELSE 4 END
       LIMIT 1
     ) s ON true
     WHERE m.valid_to IS NULL
     ORDER BY m.sort_order, d.domain`,
    [period, DOMAINS], ctx);

  return rows.map((r) => ({
    mfyId: Number(r['mfy_id']), mfyName: String(r['name_uz']),
    domain: r['domain'] as Domain,
    status: (r['status'] as SubmissionStatus | null) ?? 'missing',
    submissionId: r['submission_id'] === null ? null : Number(r['submission_id']),
    updatedAt: (r['updated_at'] as string | null) ?? null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Konvert boshqaruvi
// ═══════════════════════════════════════════════════════════════════════════

export async function getSubmission(ctx: AppContext, id: number): Promise<Submission | null> {
  const r = await queryOne<Record<string, unknown>>(
    `SELECT ${SUBMISSION_SELECT} ${SUBMISSION_FROM} WHERE s.id = $1`, [id], ctx);
  return r ? mapSubmission(r) : null;
}

export async function reviewQueue(ctx: AppContext): Promise<Submission[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${SUBMISSION_SELECT} ${SUBMISSION_FROM}
     WHERE s.status = 'submitted' ORDER BY s.submitted_at`, [], ctx);
  return rows.map(mapSubmission);
}

/**
 * Qoralama ochadi yoki mavjudini qaytaradi.
 * Tasdiqlangan konvert bo'lsa — tuzatish (amendment) revisiyasi ochiladi.
 */
export async function openDraft(
  ctx: AppContext, mfyId: number, domain: Domain, period: string,
): Promise<Submission> {
  return withTransaction(ctx, async (client) => {
    const pStart = `${period}-01`;

    const existing = await client.query<Record<string, unknown>>(
      `SELECT ${SUBMISSION_SELECT} ${SUBMISSION_FROM}
       WHERE s.scope_type = 'MFY' AND s.scope_id = $1 AND s.domain = $2
         AND s.period_start = $3::date AND s.status IN ('draft', 'rejected')
       ORDER BY s.revision DESC LIMIT 1`,
      [mfyId, domain, pStart]);
    if (existing.rows[0]) return mapSubmission(existing.rows[0]);

    const approved = await client.query<{ id: number; revision: number }>(
      `SELECT id, revision FROM fact.submission
       WHERE scope_type = 'MFY' AND scope_id = $1 AND domain = $2
         AND period_start = $3::date AND status = 'approved'`,
      [mfyId, domain, pStart]);

    const prev = approved.rows[0];
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO fact.submission
         (scope_type, scope_id, domain, period_type, period_start, period_end,
          revision, status, supersedes_id, created_by)
       VALUES ('MFY', $1, $2, 'MONTH', $3::date,
               ($3::date + INTERVAL '1 month' - INTERVAL '1 day')::date,
               $4, 'draft', $5, $6)
       RETURNING id`,
      [mfyId, domain, pStart, (prev?.revision ?? 0) + 1, prev?.id ?? null, ctx.userId]);

    const created = await client.query<Record<string, unknown>>(
      `SELECT ${SUBMISSION_SELECT} ${SUBMISSION_FROM} WHERE s.id = $1`, [rows[0]!.id]);
    return mapSubmission(created.rows[0]!);
  });
}

export async function changeStatus(
  ctx: AppContext, id: number, to: SubmissionStatus, note: string | null,
): Promise<Submission> {
  return withTransaction(ctx, async (client) => {
    const cur = await client.query<{ status: SubmissionStatus }>(
      `SELECT status FROM fact.submission WHERE id = $1 FOR UPDATE`, [id]);
    const from = cur.rows[0]?.status;
    if (!from) throw Object.assign(new Error('Konvert topilmadi'), { statusCode: 404 });

    if (!canTransition(from, to)) {
      throw Object.assign(
        new Error(`Holatni "${from}" dan "${to}" ga o‘zgartirib bo‘lmaydi`),
        { statusCode: 409 },
      );
    }

    const isReview = to === 'approved' || to === 'rejected';
    const isSubmit = to === 'submitted';
    // DIQQAT: bitta parametrni ham enum, ham text sifatida ishlatib bo'lmaydi
    // (Postgres 42P08 "inconsistent types deduced"). Shuning uchun holat
    // qiymati va undan kelib chiqadigan bayroqlar ALOHIDA parametrlar bo'ladi.
    await client.query(
      `UPDATE fact.submission
       SET status       = $2::sec.submission_status,
           submitted_at = CASE WHEN $3::boolean THEN now() ELSE submitted_at END,
           reviewed_by  = CASE WHEN $4::boolean THEN $5::int ELSE reviewed_by END,
           reviewed_at  = CASE WHEN $4::boolean THEN now() ELSE reviewed_at END,
           review_note  = coalesce($6::text, review_note)
       WHERE id = $1::bigint`,
      [id, to, isSubmit, isReview, ctx.userId, note]);

    const r = await client.query<Record<string, unknown>>(
      `SELECT ${SUBMISSION_SELECT} ${SUBMISSION_FROM} WHERE s.id = $1`, [id]);
    return mapSubmission(r.rows[0]!);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Ma'lumot o'qish (forma to'ldirish uchun)
// ═══════════════════════════════════════════════════════════════════════════

export async function energyBalanceRows(ctx: AppContext, submissionId: number): Promise<EnergyBalanceDay[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT biz_date::text, kwh_in, kwh_sold, kwh_loss_natural,
            kwh_loss_technical, kwh_loss_illegal, note
     FROM fact.energy_balance_daily
     WHERE submission_id = $1 ORDER BY biz_date`, [submissionId], ctx);

  return rows.map((r) => ({
    bizDate: String(r['biz_date']), kwhIn: Number(r['kwh_in']), kwhSold: Number(r['kwh_sold']),
    kwhLossNatural: Number(r['kwh_loss_natural']),
    kwhLossTechnical: Number(r['kwh_loss_technical']),
    kwhLossIllegal: Number(r['kwh_loss_illegal']),
    note: (r['note'] as string | null) ?? null,
  }));
}

export async function monthlyReturnRow(ctx: AppContext, submissionId: number): Promise<MonthlyReturn | null> {
  const r = await queryOne<Record<string, unknown>>(
    `SELECT consumers_population, consumers_legal, consumers_active,
            consumers_disconnected, consumers_new,
            debt_population_mln, debt_legal_mln, debt_budget_mln,
            meters_offline_cnt, low_consumption_cnt,
            meters_replace_need_cnt, meters_replaced_cnt
     FROM fact.mfy_monthly_return WHERE submission_id = $1`, [submissionId], ctx);
  if (!r) return null;
  return {
    consumersPopulation: Number(r['consumers_population']),
    consumersLegal: Number(r['consumers_legal']),
    consumersActive: Number(r['consumers_active']),
    consumersDisconnected: Number(r['consumers_disconnected']),
    consumersNew: Number(r['consumers_new']),
    debtPopulationMln: Number(r['debt_population_mln']),
    debtLegalMln: Number(r['debt_legal_mln']),
    debtBudgetMln: Number(r['debt_budget_mln']),
    metersOfflineCnt: Number(r['meters_offline_cnt']),
    lowConsumptionCnt: Number(r['low_consumption_cnt']),
    metersReplaceNeedCnt: Number(r['meters_replace_need_cnt']),
    metersReplacedCnt: Number(r['meters_replaced_cnt']),
  };
}

export async function tpStatusRows(ctx: AppContext, submissionId: number): Promise<TpStatus[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT tp_id, load_pct, peak_kva, condition, under_load, repair_needed, repair_reason
     FROM fact.tp_status_monthly WHERE submission_id = $1 ORDER BY tp_id`, [submissionId], ctx);

  return rows.map((r) => ({
    tpId: Number(r['tp_id']), loadPct: Number(r['load_pct']), peakKva: Number(r['peak_kva']),
    condition: r['condition'] as TpStatus['condition'],
    underLoad: Boolean(r['under_load']), repairNeeded: Boolean(r['repair_needed']),
    repairReason: (r['repair_reason'] as string | null) ?? null,
  }));
}

export async function networkDefectRows(ctx: AppContext, submissionId: number): Promise<NetworkDefect[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT voltage_kv, repair_needed_km, repaired_km
     FROM fact.network_defect WHERE submission_id = $1 ORDER BY voltage_kv`, [submissionId], ctx);

  return rows.map((r) => ({
    voltageKv: Number(r['voltage_kv']),
    repairNeededKm: Number(r['repair_needed_km']), repairedKm: Number(r['repaired_km']),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Ma'lumot yozish (autosave)
// ═══════════════════════════════════════════════════════════════════════════

async function assertEditable(client: pg.PoolClient, submissionId: number): Promise<{ mfyId: number; period: string }> {
  const { rows } = await client.query<{ scope_id: number; status: string; period_start: string }>(
    `SELECT scope_id, status, period_start::text FROM fact.submission WHERE id = $1 FOR UPDATE`,
    [submissionId]);
  const s = rows[0];
  if (!s) throw Object.assign(new Error('Konvert topilmadi'), { statusCode: 404 });
  if (s.status !== 'draft' && s.status !== 'rejected') {
    throw Object.assign(
      new Error('Faqat qoralama holatidagi konvertni tahrirlash mumkin'),
      { statusCode: 409 });
  }
  return { mfyId: s.scope_id, period: s.period_start.slice(0, 7) };
}

export async function saveEnergyBalance(
  ctx: AppContext, submissionId: number, rows: EnergyBalanceDay[],
): Promise<number> {
  return withTransaction(ctx, async (client) => {
    const { mfyId } = await assertEditable(client, submissionId);
    await client.query('DELETE FROM fact.energy_balance_daily WHERE submission_id = $1', [submissionId]);
    if (rows.length === 0) return 0;

    const params: unknown[] = [];
    const tuples = rows.map((r) => {
      params.push(submissionId, mfyId, r.bizDate, r.kwhIn, r.kwhSold,
        r.kwhLossNatural, r.kwhLossTechnical, r.kwhLossIllegal, r.note ?? null);
      const base = params.length - 9;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`;
    });
    await client.query(
      `INSERT INTO fact.energy_balance_daily
         (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
          kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal, note)
       VALUES ${tuples.join(',')}`, params);

    await client.query('UPDATE fact.submission SET updated_at = now() WHERE id = $1', [submissionId]);
    return rows.length;
  });
}

export async function saveMonthlyReturn(
  ctx: AppContext, submissionId: number, data: MonthlyReturn,
): Promise<void> {
  await withTransaction(ctx, async (client) => {
    const { mfyId, period } = await assertEditable(client, submissionId);
    await client.query('DELETE FROM fact.mfy_monthly_return WHERE submission_id = $1', [submissionId]);
    await client.query(
      `INSERT INTO fact.mfy_monthly_return
         (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
          consumers_active, consumers_disconnected, consumers_new,
          debt_population_mln, debt_legal_mln, debt_budget_mln,
          meters_offline_cnt, low_consumption_cnt,
          meters_replace_need_cnt, meters_replaced_cnt)
       VALUES ($1,$2,($3 || '-01')::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [submissionId, mfyId, period,
       data.consumersPopulation, data.consumersLegal, data.consumersActive,
       data.consumersDisconnected, data.consumersNew,
       data.debtPopulationMln, data.debtLegalMln, data.debtBudgetMln,
       data.metersOfflineCnt, data.lowConsumptionCnt,
       data.metersReplaceNeedCnt, data.metersReplacedCnt]);

    await client.query('UPDATE fact.submission SET updated_at = now() WHERE id = $1', [submissionId]);
  });
}

/**
 * TP holati qatorlarini SAQLAYDI — `saveEnergyBalance` bilan bir xil "hammasini
 * o'chir, qayta yoz" strategiyasi (bitta konvert = bitta oy uchun to'liq
 * ro'yxat). Shu sababli AI asbobi (`update_tp_status`, `ai-tools.ts`) bitta
 * TP ni yangilashdan oldin MAVJUD qatorlarni (`tpStatusRows`) o'qib, ustiga
 * birlashtirib qayta yuborishi kerak — aks holda boshqa TP larning holati
 * yo'qolib qolardi.
 */
export async function saveTpStatus(
  ctx: AppContext, submissionId: number, rows: TpStatus[],
): Promise<number> {
  return withTransaction(ctx, async (client) => {
    const { period } = await assertEditable(client, submissionId);
    await client.query('DELETE FROM fact.tp_status_monthly WHERE submission_id = $1', [submissionId]);
    if (rows.length === 0) return 0;

    const params: unknown[] = [];
    const tuples = rows.map((r) => {
      params.push(
        submissionId, r.tpId, period, r.loadPct, r.peakKva, r.condition,
        r.underLoad, r.repairNeeded, r.repairReason ?? null,
      );
      const b = params.length - 9;
      return `($${b + 1},$${b + 2},($${b + 3}||'-01')::date,$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
    });

    try {
      await client.query(
        `INSERT INTO fact.tp_status_monthly
           (submission_id, tp_id, period_month, load_pct, peak_kva, condition,
            under_load, repair_needed, repair_reason)
         VALUES ${tuples.join(',')}`, params);
    } catch (err) {
      // `tp_id` chet kalit — noto'g'ri/o'chirilgan TP berilsa tushunarli xabar.
      if (isPgError(err) && err.code === '23503') {
        throw Object.assign(new Error('TP topilmadi — berilgan ID mavjud emas'), { statusCode: 400 });
      }
      throw err;
    }

    await client.query('UPDATE fact.submission SET updated_at = now() WHERE id = $1', [submissionId]);
    return rows.length;
  });
}

/** Tarmoq nuqsoni qatorlarini SAQLAYDI — `saveTpStatus` bilan bir xil naqsh. */
export async function saveNetworkDefect(
  ctx: AppContext, submissionId: number, rows: NetworkDefect[],
): Promise<number> {
  return withTransaction(ctx, async (client) => {
    const { mfyId, period } = await assertEditable(client, submissionId);
    await client.query('DELETE FROM fact.network_defect WHERE submission_id = $1', [submissionId]);
    if (rows.length === 0) return 0;

    const params: unknown[] = [];
    const tuples = rows.map((r) => {
      params.push(submissionId, mfyId, period, r.voltageKv, r.repairNeededKm, r.repairedKm);
      const b = params.length - 6;
      return `($${b + 1},$${b + 2},($${b + 3}||'-01')::date,$${b + 4},$${b + 5},$${b + 6})`;
    });
    await client.query(
      `INSERT INTO fact.network_defect
         (submission_id, mfy_id, period_month, voltage_kv, repair_needed_km, repaired_km)
       VALUES ${tuples.join(',')}`, params);

    await client.query('UPDATE fact.submission SET updated_at = now() WHERE id = $1', [submissionId]);
    return rows.length;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tekshirish (dry-run — hech narsa yozilmaydi)
// ═══════════════════════════════════════════════════════════════════════════

export async function validateSubmission(
  ctx: AppContext, submissionId: number,
): Promise<ValidationReport> {
  const sub = await getSubmission(ctx, submissionId);
  if (!sub) throw Object.assign(new Error('Konvert topilmadi'), { statusCode: 404 });

  const issues: ValidationIssue[] = [];
  let filled = 0;
  let expected = 1;

  if (sub.domain === 'ENERGY_BALANCE') {
    const rows = await energyBalanceRows(ctx, submissionId);
    const start = new Date(`${sub.periodStart}T00:00:00Z`);
    const end = new Date(`${sub.periodEnd}T00:00:00Z`);
    expected = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    filled = rows.length;

    for (const r of rows) {
      if (r.kwhSold > r.kwhIn) {
        issues.push({
          path: 'kwhSold', rowKey: r.bizDate, severity: 'error',
          message: 'Sotilgan energiya tarmoqqa kirgan energiyadan ko‘p',
        });
      }
      const total = r.kwhIn - r.kwhSold;
      const parts = r.kwhLossNatural + r.kwhLossTechnical + r.kwhLossIllegal;
      if (Math.abs(total - parts) > balanceTolerance(r.kwhIn)) {
        issues.push({
          path: 'kwhLossTechnical', rowKey: r.bizDate, severity: 'error',
          message: `Yo‘qotish tarkibi jamiga mos emas: ${parts.toFixed(1)} ≠ ${total.toFixed(1)} kWh`,
        });
      }
    }

    if (filled < expected) {
      issues.push({
        path: 'rows', severity: 'warning',
        message: `${expected} kundan ${filled} tasi to‘ldirilgan (${expected - filled} kun yetishmaydi)`,
      });
    }

    // O'tgan oyga nisbatan keskin o'zgarish — izoh talab qilinadi.
    const prevTotal = await queryOne<{ kwh: number }>(
      `SELECT coalesce(sum(a.kwh_in), 0) AS kwh FROM agg.mfy_daily a
       WHERE a.mfy_id = $1
         AND a.biz_date >= ($2::date - INTERVAL '1 month')
         AND a.biz_date <  $2::date`,
      [sub.scopeId, sub.periodStart], ctx);
    const curTotal = rows.reduce((a, r) => a + r.kwhIn, 0);
    const prev = Number(prevTotal?.kwh ?? 0);
    if (prev > 0 && curTotal > 0) {
      const change = Math.abs((curTotal - prev) / prev);
      if (change > 0.3) {
        issues.push({
          path: 'kwhIn', severity: 'warning',
          message: `Tarmoqqa kirgan energiya o‘tgan oyga nisbatan ${(change * 100).toFixed(0)}% o‘zgargan — izoh talab qilinadi`,
        });
      }
    }
  } else if (sub.domain === 'MONTHLY_RETURN') {
    const data = await monthlyReturnRow(ctx, submissionId);
    filled = data ? 1 : 0;
    if (!data) {
      issues.push({ path: 'form', severity: 'error', message: 'Oylik hisobot to‘ldirilmagan' });
    } else {
      const total = data.consumersPopulation + data.consumersLegal;
      if (data.consumersActive > total) {
        issues.push({ path: 'consumersActive', severity: 'error', message: 'Aloqaga chiqayotgan istemolchilar jamidan ko‘p' });
      }
      if (data.metersReplacedCnt > data.metersReplaceNeedCnt) {
        issues.push({ path: 'metersReplacedCnt', severity: 'error', message: 'Almashtirilgan soni kerakli sondan ko‘p' });
      }
    }
  } else {
    const table = {
      TP_STATUS: 'fact.tp_status_monthly', TP_READING: 'fact.tp_reading_daily',
      NETWORK_DEFECT: 'fact.network_defect', DEBT: 'fact.debt_top_entry',
      WORKS: 'fact.work', VIOLATION: 'fact.violation_act',
    }[sub.domain];
    if (table) {
      const c = await queryOne<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE submission_id = $1`, [submissionId], ctx);
      filled = Number(c?.n ?? 0);
      if (filled === 0) {
        issues.push({ path: 'rows', severity: 'warning', message: 'Hech qanday qator kiritilmagan' });
      }
    }
  }

  return {
    ok: issues.every((i) => i.severity !== 'error'),
    issues,
    completeness: { filled, expected },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Revisiyalar farqi — ko'ruvchi maydon darajasidagi o'zgarishni ko'radi
// ═══════════════════════════════════════════════════════════════════════════

const FIELD_LABELS: Record<string, string> = {
  consumers_population: 'Aholi iste’molchilari',
  consumers_legal: 'Yuridik iste’molchilar',
  consumers_active: 'Aloqaga chiqayotgan istemolchilar',
  consumers_disconnected: 'Uzilgan abonentlar',
  consumers_new: 'Yangi ulangan',
  debt_population_mln: 'Aholi qarzdorligi',
  debt_legal_mln: 'Yuridik qarzdorlik',
  debt_budget_mln: 'Budjet qarzdorligi',
  meters_offline_cnt: 'Aloqasiz hisoblagichlar',
  low_consumption_cnt: 'Kam iste’molchilar',
  meters_replace_need_cnt: 'Almashtirish kerak',
  meters_replaced_cnt: 'Almashtirilgan',
  kwh_in: 'Tarmoqqa kirgan energiya',
  kwh_sold: 'Sotilgan energiya',
  kwh_loss_natural: 'Tabiiy yo‘qotish',
  kwh_loss_technical: 'Texnik yo‘qotish',
  kwh_loss_illegal: 'Noqonuniy foydalanish',
};

export async function submissionDiff(
  ctx: AppContext, submissionId: number,
): Promise<SubmissionDiffRow[]> {
  const sub = await getSubmission(ctx, submissionId);
  if (!sub) return [];

  // Taqqoslash uchun oldingi tasdiqlangan revisiya
  const prevId = sub.supersedesId;
  if (!prevId) return [];

  if (sub.domain === 'MONTHLY_RETURN') {
    const [cur, prev] = await Promise.all([
      monthlyReturnRow(ctx, submissionId),
      monthlyReturnRow(ctx, prevId),
    ]);
    if (!cur || !prev) return [];

    const keyMap: [keyof MonthlyReturn, string][] = [
      ['consumersPopulation', 'consumers_population'], ['consumersLegal', 'consumers_legal'],
      ['consumersActive', 'consumers_active'], ['consumersDisconnected', 'consumers_disconnected'],
      ['consumersNew', 'consumers_new'],
      ['debtPopulationMln', 'debt_population_mln'], ['debtLegalMln', 'debt_legal_mln'],
      ['debtBudgetMln', 'debt_budget_mln'],
      ['metersOfflineCnt', 'meters_offline_cnt'], ['lowConsumptionCnt', 'low_consumption_cnt'],
      ['metersReplaceNeedCnt', 'meters_replace_need_cnt'], ['metersReplacedCnt', 'meters_replaced_cnt'],
    ];

    return keyMap
      .filter(([k]) => cur[k] !== prev[k])
      .map(([k, col]) => {
        const before = prev[k] as number;
        const after = cur[k] as number;
        return {
          path: col, labelUz: FIELD_LABELS[col] ?? col,
          before, after,
          deltaPct: before === 0 ? null : Number((((after - before) / before) * 100).toFixed(1)),
          justification: null,
        };
      });
  }

  // Energiya balansi: oylik jamlar bo'yicha
  const totals = await query<Record<string, unknown>>(
    `SELECT 'kwh_in' AS field,
            (SELECT coalesce(sum(kwh_in), 0) FROM fact.energy_balance_daily WHERE submission_id = $2) AS before,
            (SELECT coalesce(sum(kwh_in), 0) FROM fact.energy_balance_daily WHERE submission_id = $1) AS after
     UNION ALL
     SELECT 'kwh_sold',
            (SELECT coalesce(sum(kwh_sold), 0) FROM fact.energy_balance_daily WHERE submission_id = $2),
            (SELECT coalesce(sum(kwh_sold), 0) FROM fact.energy_balance_daily WHERE submission_id = $1)`,
    [submissionId, prevId], ctx);

  return totals
    .filter((t) => Number(t['before']) !== Number(t['after']))
    .map((t) => {
      const before = Number(t['before']);
      const after = Number(t['after']);
      const field = String(t['field']);
      return {
        path: field, labelUz: FIELD_LABELS[field] ?? field, before, after,
        deltaPct: before === 0 ? null : Number((((after - before) / before) * 100).toFixed(1)),
        justification: null,
      };
    });
}
