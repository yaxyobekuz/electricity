/**
 * Demo ma'lumot generatori.
 *
 * Maqsad: tuman jamlari HAQIQIY pasport raqamlarini takrorlaydigan, ammo
 * tuman kabi jonli ko'rinadigan - muammolari bilan birga - demo yaratish.
 *
 * Determinizm: `mulberry32` urug'i qat'iy, shuning uchun skrinshotlar barcha
 * mashinalarda bir xil chiqadi.
 *
 * KALIBROVKA: barcha taqsimotlar "largest remainder" usuli bilan yaxlitlanadi,
 * shuning uchun MFY lar yig'indisi tuman jamiga AYNAN teng bo'ladi.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import argon2 from 'argon2';
import type pg from 'pg';

import { config } from '../src/config.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Determinstik tasodifiylik
// ═══════════════════════════════════════════════════════════════════════════

const SEED = 20260731;

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

/** Box–Muller - normal taqsimot. */
function gauss(mean = 0, sd = 1): number {
  const u = Math.max(rand(), 1e-9);
  const v = Math.max(rand(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const between = (lo: number, hi: number): number => lo + rand() * (hi - lo);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const r1 = (x: number): number => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

// ═══════════════════════════════════════════════════════════════════════════
// Taqsimlash - largest remainder (yig'indi AYNAN mos keladi)
// ═══════════════════════════════════════════════════════════════════════════

/** Butun sonlarni og'irlik bo'yicha taqsimlaydi; yig'indi = total. */
export function allocateInt(total: number, weights: number[], min = 0): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const reserved = min * n;
  const spread = total - reserved;
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;

  const exact = weights.map((w) => (spread * w) / sumW);
  const out = exact.map((e) => Math.floor(e) + min);
  let remainder = total - out.reduce((a, b) => a + b, 0);

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  let k = 0;
  while (remainder > 0) {
    out[order[k % n]!.i]! += 1;
    remainder -= 1;
    k += 1;
  }
  while (remainder < 0) {
    const idx = order[k % n]!.i;
    if (out[idx]! > min) {
      out[idx]! -= 1;
      remainder += 1;
    }
    k += 1;
  }
  return out;
}

/** O'nlik sonlarni taqsimlaydi (berilgan aniqlikda); yig'indi = total. */
export function allocateFloat(total: number, weights: number[], decimals = 1): number[] {
  const scale = 10 ** decimals;
  return allocateInt(Math.round(total * scale), weights).map((v) => v / scale);
}

/**
 * Qat'iy (pinned) qiymatlarni saqlab, qolganini taqsimlaydi.
 * MFY o'z pasportidan olingan raqamlar hech qachon o'zgarmaydi.
 */
function allocateWithPins(
  total: number,
  items: { weight: number; pin?: number | undefined }[],
  kind: 'int' | 'float',
  decimals = 1,
): number[] {
  const pinnedSum = items.reduce((a, it) => a + (it.pin ?? 0), 0);
  const free = items.map((it, i) => ({ i, weight: it.weight, pinned: it.pin !== undefined }));
  const freeIdx = free.filter((f) => !f.pinned);
  const remainder = total - pinnedSum;

  const alloc =
    kind === 'int'
      ? allocateInt(Math.max(0, Math.round(remainder)), freeIdx.map((f) => f.weight), 1)
      : allocateFloat(Math.max(0, remainder), freeIdx.map((f) => f.weight), decimals);

  const out = new Array<number>(items.length).fill(0);
  items.forEach((it, i) => {
    if (it.pin !== undefined) out[i] = it.pin;
  });
  freeIdx.forEach((f, k) => {
    out[f.i] = alloc[k] ?? 0;
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sana yordamchilari (UTC - vaqt mintaqasi ta'sirisiz)
// ═══════════════════════════════════════════════════════════════════════════

const iso = (d: Date): string => d.toISOString().slice(0, 10);

function monthStart(period: string): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1));
}
function daysIn(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}
function addMonths(period: string, delta: number): string {
  const d = monthStart(period);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

/** Oxirgi TO'LIQ oy (bugungi oydan bitta oldin). */
function lastCompletePeriod(today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mavsumiylik modeli (Andijon: kuchli qish cho'qqisi, ikkilamchi yoz cho'qqisi)
// ═══════════════════════════════════════════════════════════════════════════

function seasonal(d: Date): number {
  const doy = dayOfYear(d);
  return (
    1 +
    0.3 * Math.cos((2 * Math.PI * (doy - 15)) / 365) +
    0.09 * Math.cos((4 * Math.PI * (doy - 15)) / 365)
  );
}

function weekly(d: Date): number {
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6 ? 0.94 : 1.02;
}

/** Qish davridagi sovuq to'lqinlar - yiliga 2–4 marta, 3–6 kun, ×1.15. */
function buildColdSnaps(from: string, to: string): Map<string, number> {
  const map = new Map<string, number>();
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  for (let y = startYear; y <= endYear; y += 1) {
    const events = 2 + Math.floor(rand() * 3);
    for (let e = 0; e < events; e += 1) {
      // Dekabr–fevral oralig'ida
      const startDay = Math.floor(between(-31, 59)); // 1-yanvarga nisbatan
      const len = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < len; k += 1) {
        const d = new Date(Date.UTC(y, 0, 1 + startDay + k));
        map.set(iso(d), 1.15);
      }
    }
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// Seed konfiguratsiyasi tiplari
// ═══════════════════════════════════════════════════════════════════════════

interface PinnedValues {
  consumersPopulation?: number;
  consumersLegal?: number;
  tpCount?: number;
  lineKm04?: number;
  lineKm10?: number;
  metersOfflineCnt?: number;
  lowConsumptionCnt?: number;
  metersReplaceNeedCnt?: number;
  metersReplacedCnt?: number;
  tpRepairNeeded?: number;
  repairKm04?: number;
  repairKm10?: number;
  treeClearingKmYear?: number;
}

interface MfySeed {
  code: string;
  nameUz: string;
  nameUzCyr: string;
  shortName: string;
  elektroset: string;
  weight: number;
  profile: string;
  grid: [number, number];
  source: string;
  pinned?: PinnedValues;
}

interface ProfileSpec {
  lossFactor: number;
  debtFactor: number;
  distanceM: [number, number];
  note: string;
}

interface SeedConfig {
  district: { nameUz: string; nameUzCyr: string; region: string };
  districtTotals: Record<string, number>;
  lossModel: {
    startTotalPct: number;
    endTotalPct: number;
    startSplit: { natural: number; technical: number; illegal: number };
    endSplit: { natural: number; technical: number; illegal: number };
  };
  mfys: MfySeed[];
  profiles: Record<string, ProfileSpec>;
}

export function loadSeedConfig(): SeedConfig {
  const raw = readFileSync(resolve(config.paths.seed, 'mfy.seed.json'), 'utf8');
  return JSON.parse(raw) as SeedConfig;
}

// ═══════════════════════════════════════════════════════════════════════════
// Bulk insert yordamchisi
// ═══════════════════════════════════════════════════════════════════════════

async function bulkInsert(
  client: pg.PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 400,
): Promise<void> {
  if (rows.length === 0) return;
  const colList = columns.join(', ');

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((val) => {
        params.push(val);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(`INSERT INTO ${table} (${colList}) VALUES ${tuples.join(', ')}`, params);
  }
}

/** Seed davomida audit triggerlarini o'chiradi (aks holda 2× qator va sekinlik). */
async function setAuditTriggers(client: pg.PoolClient, enabled: boolean): Promise<void> {
  const { rows } = await client.query<{ sch: string; tbl: string }>(`
    SELECT n.nspname AS sch, c.relname AS tbl
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'zz_audit' AND NOT t.tgisinternal
  `);
  for (const r of rows) {
    await client.query(
      `ALTER TABLE ${r.sch}.${r.tbl} ${enabled ? 'ENABLE' : 'DISABLE'} TRIGGER zz_audit`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Asosiy generator
// ═══════════════════════════════════════════════════════════════════════════

export interface SeedOptions {
  months: number;
  /** TP kunlik ko'rsatkichlari necha oy uchun generatsiya qilinsin. */
  readingMonths: number;
  log: (msg: string) => void;
}

export interface SeedResult {
  mfyCount: number;
  tpCount: number;
  months: string[];
  rowCounts: Record<string, number>;
  warnings: string[];
  integrityDemo: string | null;
}

export async function generateSeed(
  client: pg.PoolClient,
  opts: SeedOptions,
): Promise<SeedResult> {
  const { log } = opts;
  const cfg = loadSeedConfig();
  const warnings: string[] = [];
  const rowCounts: Record<string, number> = {};

  const lastPeriod = lastCompletePeriod();
  const currentPeriod = addMonths(lastPeriod, 1);
  const periods: string[] = [];
  for (let i = opts.months - 1; i >= 0; i -= 1) periods.push(addMonths(lastPeriod, -i));

  log(`Davrlar: ${periods[0]} … ${lastPeriod} (${periods.length} oy) + joriy ${currentPeriod}`);

  // ── 0. Tozalash ──────────────────────────────────────────────────────────
  await setAuditTriggers(client, false);
  await client.query(`
    TRUNCATE fact.tp_reading_daily, fact.energy_balance_daily, fact.mfy_monthly_return,
             fact.tp_status_monthly, fact.network_defect, fact.debt_top_entry,
             fact.violation_act, fact.work, fact.passport_snapshot, fact.report_job,
             fact.submission RESTART IDENTITY CASCADE;
    TRUNCATE ref.network_segment, ref.tp, ref.mfy RESTART IDENTITY CASCADE;
    TRUNCATE sec.audit_log, sec.refresh_token, sec.user_scope RESTART IDENTITY CASCADE;
    DELETE FROM sec.app_user;
    ALTER SEQUENCE sec.app_user_id_seq RESTART;
  `);

  // ── 1. Foydalanuvchilar ──────────────────────────────────────────────────
  log('Foydalanuvchilar…');
  const demoPassword = 'Beap2026!';
  const hash = await argon2.hash(demoPassword, { type: argon2.argon2id });

  const userDefs = [
    { login: 'admin', fullName: 'Tizim administratori', role: 'admin' },
    { login: 'hokim', fullName: 'Hokimiyat kuzatuvchisi', role: 'hokimiyat_viewer' },
    { login: 'hokim2', fullName: 'Hokim o‘rinbosari', role: 'hokimiyat_viewer' },
    { login: 'manager.baliqchi', fullName: 'Baliqchi Elektraset menejeri', role: 'elektroset_manager' },
    { login: 'manager.chinobod', fullName: 'Chinobod Elektraset menejeri', role: 'elektroset_manager' },
    { login: 'operator1', fullName: 'Sarnaul MFY operatori', role: 'mfy_operator' },
    { login: 'operator2', fullName: 'Chinobod MFY operatori', role: 'mfy_operator' },
    { login: 'operator3', fullName: 'Gulshan MFY operatori', role: 'mfy_operator' },
  ];

  const userIds = new Map<string, number>();
  for (const u of userDefs) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO sec.app_user (login, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [u.login, u.fullName, hash, u.role],
    );
    userIds.set(u.login, rows[0]!.id);
  }
  const adminId = userIds.get('admin')!;
  rowCounts['sec.app_user'] = userDefs.length;
  // Foydalanuvchi hududlari MFY lar yaratilgandan KEYIN beriladi (quyida).

  // ── 2. MFY lar ───────────────────────────────────────────────────────────
  log('MFY lar…');
  const { rows: esRows } = await client.query<{ id: number; code: string }>(
    'SELECT id, code FROM ref.elektroset',
  );
  const esByCode = new Map(esRows.map((r) => [r.code, r.id]));

  const mfyIds: number[] = [];
  for (const [idx, m] of cfg.mfys.entries()) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO ref.mfy (elektroset_id, code, name_uz, name_uz_cyr, short_name,
                            sort_order, grid_row, grid_col, valid_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2024-01-01') RETURNING id`,
      [
        esByCode.get(m.elektroset),
        m.code,
        m.nameUz,
        m.nameUzCyr,
        m.shortName,
        idx,
        m.grid[0],
        m.grid[1],
      ],
    );
    mfyIds.push(rows[0]!.id);
  }
  rowCounts['ref.mfy'] = cfg.mfys.length;

  const weights = cfg.mfys.map((m) => m.weight);
  const profileOf = (m: MfySeed): ProfileSpec =>
    cfg.profiles[m.profile] ?? cfg.profiles['normal']!;

  // ── 2b. Foydalanuvchi hududlari (sec.user_scope) ─────────────────────────
  // Tizimda kirish yo'q, lekin `sec.app_user` qatorlari SAQLANADI: audit
  // jurnali va `created_by` kabi NOT NULL chet kalitlar shu jadvalga tayanadi
  // (`apps/api/src/plugins/context.ts` demo aktorni shundan oladi).
  log('Foydalanuvchi hududlari…');
  const idxByCode = new Map(cfg.mfys.map((m, i) => [m.code, i]));
  const operatorScopes: [string, string][] = [
    ['operator1', 'MFY-SARNAUL'],
    ['operator2', 'MFY-CHINOBOD'],
    ['operator3', 'MFY-GULSHAN'],
  ];
  const scopeRows: unknown[][] = [];

  for (const [login, mfyCode] of operatorScopes) {
    const uid = userIds.get(login);
    const idx = idxByCode.get(mfyCode);
    if (uid !== undefined && idx !== undefined) {
      scopeRows.push([uid, 'MFY', mfyIds[idx]]);
    }
  }
  // Elektroset menejerlari - butun elektroset (login paytida MFY larga yoyiladi)
  for (const [login, esCode] of [
    ['manager.baliqchi', 'BALIQCHI'],
    ['manager.chinobod', 'CHINOBOD'],
  ] as const) {
    const uid = userIds.get(login);
    const esId = esByCode.get(esCode);
    if (uid !== undefined && esId !== undefined) {
      scopeRows.push([uid, 'ELEKTROSET', esId]);
    }
  }
  // Admin - butun tuman
  scopeRows.push([adminId, 'TUMAN', null]);
  // Hokimiyat kuzatuvchilari - yozish huquqisiz (scope berilmaydi)

  await bulkInsert(client, 'sec.user_scope', ['user_id', 'scope_type', 'scope_id'], scopeRows);
  rowCounts['sec.user_scope'] = scopeRows.length;

  // ── 3. Strukturaviy taqsimot (oxirgi oy = pasport raqamlari) ────────────
  const dt = cfg.districtTotals;

  const popAlloc = allocateWithPins(
    dt['consumersPopulation']!,
    cfg.mfys.map((m) => ({ weight: m.weight, pin: m.pinned?.consumersPopulation })),
    'int',
  );
  const legalAlloc = allocateWithPins(
    dt['consumersLegal']!,
    cfg.mfys.map((m) => ({ weight: m.weight, pin: m.pinned?.consumersLegal })),
    'int',
  );
  const tpAlloc = allocateWithPins(
    dt['tpCount']!,
    cfg.mfys.map((m) => ({ weight: m.weight, pin: m.pinned?.tpCount })),
    'int',
  );
  const line04Alloc = allocateWithPins(
    dt['lineKm04']!,
    cfg.mfys.map((m) => ({ weight: m.weight, pin: m.pinned?.lineKm04 })),
    'float',
    2,
  );
  const line10Alloc = allocateWithPins(
    dt['lineKm10']!,
    cfg.mfys.map((m) => ({ weight: m.weight, pin: m.pinned?.lineKm10 })),
    'float',
    2,
  );

  const statedTotal = dt['_consumersTotalStated'];
  const actualTotal = popAlloc.reduce((a, b) => a + b, 0) + legalAlloc.reduce((a, b) => a + b, 0);
  if (statedTotal !== undefined && statedTotal !== actualTotal) {
    warnings.push(
      `Pasportda jami iste'molchilar ${statedTotal} deb yozilgan, bo'laklar yig'indisi ${actualTotal}. ` +
        `Tizim bo'laklardan hisoblaydi (farq: ${statedTotal - actualTotal}).`,
    );
  }
  warnings.push(
    `Tuman 4-qatori: 10 kV tarmoq ${dt['lineKm10']} km deb olindi ` +
      `(pasportda ${dt['_lineKm10Stated']}, lekin u holda jami 1,255.7 ga mos kelmaydi). Mijoz tasdiqlashi kerak.`,
  );

  // ── 4. Transformator punktlari ───────────────────────────────────────────
  log('Transformatorlar…');
  const KVA_OPTIONS = [63, 100, 160, 250, 400, 630];
  interface TpRec { id: number; mfyIdx: number; ratedKva: number; distanceM: number }
  const tps: TpRec[] = [];
  const tpRows: unknown[][] = [];
  let tpCounter = 0;

  for (const [idx, m] of cfg.mfys.entries()) {
    const prof = profileOf(m);
    const n = tpAlloc[idx]!;
    for (let k = 0; k < n; k += 1) {
      tpCounter += 1;
      const ratedKva = pick(KVA_OPTIONS);
      const distanceM = Math.round(between(prof.distanceM[0], prof.distanceM[1]));
      const year = 1985 + Math.floor(rand() * 38);
      tpRows.push([
        mfyIds[idx],
        `TR-${String(100 + tpCounter).padStart(4, '0')}`,
        `${m.shortName} ${k + 1}-TP`,
        ratedKva,
        '10/0.4',
        distanceM,
        `${year}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-15`,
      ]);
    }
  }

  // Nimstansiyalar (35/10) - pasportning tuman darajasidagi alohida qatori.
  // Ular tp_status_monthly ga kirmaydi, shuning uchun "transformatorlar soni" ga qo'shilmaydi.
  const substationCount = dt['substationCount'] ?? 0;
  const biggest = cfg.mfys
    .map((m, i) => ({ i, w: m.weight }))
    .sort((a, b) => b.w - a.w)
    .slice(0, substationCount);
  for (const [k, b] of biggest.entries()) {
    tpRows.push([
      mfyIds[b.i],
      `NS-${String(k + 1).padStart(2, '0')}`,
      `${cfg.mfys[b.i]!.shortName} nimstansiyasi`,
      6300,
      '35/10',
      null,
      '1998-06-15',
    ]);
  }

  await bulkInsert(
    client,
    'ref.tp',
    ['mfy_id', 'code', 'name', 'rated_kva', 'voltage_class', 'avg_distance_m', 'commissioned_on'],
    tpRows,
  );
  rowCounts['ref.tp'] = tpRows.length;

  const { rows: tpFetched } = await client.query<{
    id: number; mfy_id: number; rated_kva: string; avg_distance_m: string | null; voltage_class: string;
  }>(`SELECT id, mfy_id, rated_kva, avg_distance_m, voltage_class FROM ref.tp
      WHERE voltage_class <> '35/10' ORDER BY id`);
  const mfyIdxById = new Map(mfyIds.map((id, i) => [id, i]));
  for (const t of tpFetched) {
    tps.push({
      id: t.id,
      mfyIdx: mfyIdxById.get(t.mfy_id)!,
      ratedKva: Number(t.rated_kva),
      distanceM: Number(t.avg_distance_m ?? 250),
    });
  }
  const tpsByMfy = new Map<number, TpRec[]>();
  for (const t of tps) {
    const arr = tpsByMfy.get(t.mfyIdx) ?? [];
    arr.push(t);
    tpsByMfy.set(t.mfyIdx, arr);
  }

  // ── 5. Tarmoq segmentlari ────────────────────────────────────────────────
  const segRows: unknown[][] = [];
  for (const [idx] of cfg.mfys.entries()) {
    segRows.push([mfyIds[idx], 0.4, 'overhead', line04Alloc[idx], '2010-01-01']);
    segRows.push([mfyIds[idx], 10, 'overhead', line10Alloc[idx], '2010-01-01']);
  }
  await bulkInsert(
    client,
    'ref.network_segment',
    ['mfy_id', 'voltage_kv', 'line_type', 'length_km', 'installed_on'],
    segRows,
  );
  rowCounts['ref.network_segment'] = segRows.length;

  // ── 6. Energiya modeli ───────────────────────────────────────────────────
  log('Energiya balansi va oylik hisobotlar…');

  const coldSnaps = buildColdSnaps(periods[0]!, currentPeriod);
  const consumerShare = cfg.mfys.map((_, i) => popAlloc[i]! + legalAlloc[i]! * 8); // yuridik og'irroq
  const shareSum = consumerShare.reduce((a, b) => a + b, 0);
  const districtDailyBase = dt['monthlyKwhIn']! / 30.44;

  const lm = cfg.lossModel;
  const totalMonths = periods.length;

  /** Oy indeksi bo'yicha tuman yo'qotish darajasi va tarkibi. */
  function districtLoss(monthIdx: number): { total: number; nat: number; tech: number; ill: number } {
    const t = totalMonths <= 1 ? 1 : monthIdx / (totalMonths - 1);
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const nat = lerp(lm.startSplit.natural, lm.endSplit.natural);
    const tech = lerp(lm.startSplit.technical, lm.endSplit.technical);
    const ill = lerp(lm.startSplit.illegal, lm.endSplit.illegal);
    return { total: nat + tech + ill, nat, tech, ill };
  }

  // AR(1) shovqin har bir MFY uchun
  const lossNoise = cfg.mfys.map(() => 0);

  // Har bir MFY uchun rejalashtirilgan o'chirish kunlari
  const outageDays = new Map<string, Set<string>>();
  for (const [idx, m] of cfg.mfys.entries()) {
    const set = new Set<string>();
    for (const p of periods) {
      if (rand() < 2 / 12) {
        const day = 1 + Math.floor(rand() * daysIn(p));
        set.add(`${p}-${String(day).padStart(2, '0')}`);
      }
    }
    outageDays.set(m.code, set);
  }

  // ── Submission yaratish yordamchisi ──────────────────────────────────────
  interface SubKey { mfyIdx: number; domain: string; period: string }
  const submissionIds = new Map<string, number>();
  const subKey = (k: SubKey): string => `${k.mfyIdx}|${k.domain}|${k.period}`;

  async function createSubmissions(
    period: string,
    status: 'approved' | 'draft' | 'submitted',
    onlyMfyIdx?: number,
  ): Promise<void> {
    const domains = ['ENERGY_BALANCE', 'MONTHLY_RETURN', 'TP_STATUS', 'NETWORK_DEFECT', 'DEBT'];
    const rows: unknown[][] = [];
    const keys: string[] = [];
    const pStart = `${period}-01`;
    const pEnd = `${period}-${String(daysIn(period)).padStart(2, '0')}`;
    const reviewer = status === 'approved' ? adminId : null;

    for (const [idx, m] of cfg.mfys.entries()) {
      if (onlyMfyIdx !== undefined && idx !== onlyMfyIdx) continue;
      const operator =
        userIds.get(idx === 0 ? 'operator1' : idx === 2 ? 'operator2' : 'operator3') ?? adminId;
      for (const domain of domains) {
        rows.push([
          'MFY', mfyIds[idx], domain, 'MONTH', pStart, pEnd, status,
          operator,
          status === 'approved' || status === 'submitted' ? `${pEnd}T09:00:00Z` : null,
          reviewer,
          status === 'approved' ? `${pEnd}T14:00:00Z` : null,
        ]);
        keys.push(subKey({ mfyIdx: idx, domain, period }));
      }
    }

    // RETURNING bilan id larni olish uchun bo'lak-bo'lak insert
    const cols = [
      'scope_type', 'scope_id', 'domain', 'period_type', 'period_start', 'period_end',
      'status', 'created_by', 'submitted_at', 'reviewed_by', 'reviewed_at',
    ];
    let ki = 0;
    for (let s = 0; s < rows.length; s += 200) {
      const chunk = rows.slice(s, s + 200);
      const params: unknown[] = [];
      const tuples = chunk.map((row) => {
        const ph = row.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        return `(${ph.join(', ')})`;
      });
      const { rows: inserted } = await client.query<{ id: number }>(
        `INSERT INTO fact.submission (${cols.join(', ')}) VALUES ${tuples.join(', ')} RETURNING id`,
        params,
      );
      for (const r of inserted) {
        submissionIds.set(keys[ki]!, r.id);
        ki += 1;
      }
    }
  }

  // ── Oylik sikl ───────────────────────────────────────────────────────────
  const ebRows: unknown[][] = [];
  const mrRows: unknown[][] = [];
  const tsRows: unknown[][] = [];
  const ndRows: unknown[][] = [];
  const dtRows: unknown[][] = [];
  let goravonDemo: string | null = null;

  const DEBTOR_NAMES = [
    'MCHJ "Chinobod Don"', 'MCHJ "Bunyodkor Servis"', 'OOO "Baliqchi Mebel"',
    'MCHJ "Gulshan Agro"', 'OOO "Istiqlol Qurilish"', 'MCHJ "Navbahor Tekstil"',
    'OOO "Sohil Baliq"', 'MCHJ "Zarbdor Paxta"', 'OOO "Yangiobod Non"',
    'MCHJ "Oqoltin Sut"', 'OOO "Do‘stlik G‘isht"', 'MCHJ "Uchtepa Yog‘"',
  ];

  for (const [monthIdx, period] of periods.entries()) {
    await createSubmissions(period, 'approved');

    const dl = districtLoss(monthIdx);
    const nDays = daysIn(period);
    // Qarzdorlik trendi: o'tmishda kamroq, oxirgi oyda pasport qiymati.
    const debtTrend = 0.62 + 0.38 * (monthIdx / Math.max(1, totalMonths - 1));
    // Ta'mir zarurati: o'tmishda ko'proq (ishlar bajarilgani sari kamayadi).
    const repairTrend = 1.45 - 0.45 * (monthIdx / Math.max(1, totalMonths - 1));

    // Oylik qarzdorlik taqsimoti.
    // Profil koeffitsienti OG'IRLIKKA kiritiladi (taqsimotdan keyin ko'paytirilmaydi) -
    // aks holda MFY lar yig'indisi tuman jamiga teng bo'lmay qoladi.
    const monthProgress = monthIdx / Math.max(1, totalMonths - 1);
    const debtWeights = cfg.mfys.map((m, i) => {
      const prof = profileOf(m);
      // "problem-debt": ulush oydan oyga o'sadi (yuridik qarzdorlik +12%/oy hikoyasi)
      const factor =
        m.profile === 'problem-debt'
          ? 1.2 + (prof.debtFactor - 1.2) * monthProgress
          : prof.debtFactor;
      return consumerShare[i]! * factor;
    });
    const debtPopAlloc = allocateFloat(dt['debtPopulationMln']! * debtTrend, debtWeights, 1);
    // Pasportda faqat "Aholi" va "Yuridik" bor. Dashboard 3 toifani ko'rsatadi,
    // shuning uchun budjet tashkilotlari yuridik ULUSHIDAN ajratiladi - jamiga
    // qo'shimcha bo'lib qo'shilmaydi.
    const debtLegalTotal = dt['debtLegalMln']! * debtTrend;
    const debtLegalAlloc = allocateFloat(debtLegalTotal, debtWeights, 1);

    const offlineAlloc = allocateWithPins(
      Math.round(dt['metersOfflineCnt']! * repairTrend),
      cfg.mfys.map((m, i) => ({
        weight: consumerShare[i]!,
        pin: monthIdx === totalMonths - 1 ? m.pinned?.metersOfflineCnt : undefined,
      })),
      'int',
    );
    const lowAlloc = allocateWithPins(
      dt['lowConsumptionCnt']!,
      cfg.mfys.map((m, i) => ({
        weight: consumerShare[i]!,
        pin: monthIdx === totalMonths - 1 ? m.pinned?.lowConsumptionCnt : undefined,
      })),
      'int',
    );
    const replaceNeedAlloc = allocateWithPins(
      Math.round(dt['metersReplaceNeedCnt']! * repairTrend),
      cfg.mfys.map((m, i) => ({
        weight: consumerShare[i]!,
        pin: monthIdx === totalMonths - 1 ? m.pinned?.metersReplaceNeedCnt : undefined,
      })),
      'int',
    );
    const replacedAlloc = allocateWithPins(
      Math.round(dt['metersReplacedCnt']! * repairTrend),
      cfg.mfys.map((m, i) => ({
        weight: consumerShare[i]!,
        pin: monthIdx === totalMonths - 1 ? m.pinned?.metersReplacedCnt : undefined,
      })),
      'int',
    );
    // Pin lar taqsimotning ICHIDA hisobga olinadi - aks holda pin qo'yilgan MFY
    // o'z ulushini "olib qo'yadi" va tuman jami kamayib qoladi.
    const isLast = monthIdx === totalMonths - 1;
    const repair04Alloc = allocateWithPins(
      dt['repairKm04']! * repairTrend,
      cfg.mfys.map((m) => ({ weight: m.weight, pin: isLast ? m.pinned?.repairKm04 : undefined })),
      'float',
      2,
    );
    const repair10Alloc = allocateWithPins(
      dt['repairKm10']! * repairTrend,
      cfg.mfys.map((m) => ({ weight: m.weight, pin: isLast ? m.pinned?.repairKm10 : undefined })),
      'float',
      2,
    );
    const tpRepairAlloc = allocateInt(
      Math.round(dt['tpRepairNeeded']! * repairTrend),
      tpAlloc.map((n) => n),
    );

    for (const [idx, m] of cfg.mfys.entries()) {
      const prof = profileOf(m);
      const ebSub = submissionIds.get(subKey({ mfyIdx: idx, domain: 'ENERGY_BALANCE', period }))!;
      const mrSub = submissionIds.get(subKey({ mfyIdx: idx, domain: 'MONTHLY_RETURN', period }))!;
      const tsSub = submissionIds.get(subKey({ mfyIdx: idx, domain: 'TP_STATUS', period }))!;
      const ndSub = submissionIds.get(subKey({ mfyIdx: idx, domain: 'NETWORK_DEFECT', period }))!;
      const dbSub = submissionIds.get(subKey({ mfyIdx: idx, domain: 'DEBT', period }))!;

      const share = consumerShare[idx]! / shareSum;
      const mfyDailyBase = districtDailyBase * share;

      // "improving" profili: oxirgi 8 oyda keskin yaxshilanadi
      let profLoss = prof.lossFactor;
      if (m.profile === 'improving') {
        const fromEnd = totalMonths - 1 - monthIdx;
        profLoss = fromEnd <= 8 ? 1.55 - 0.75 * ((8 - fromEnd) / 8) : 1.55;
      }
      // "problem-illegal": noyabr–fevralda ko'tariladi
      const mon = Number(period.slice(5, 7));
      const winterSpike =
        m.profile === 'problem-illegal' && (mon >= 11 || mon <= 2) ? 1.35 : 1.0;

      let monthIn = 0;
      let monthLoss = 0;

      for (let day = 1; day <= nDays; day += 1) {
        const dstr = `${period}-${String(day).padStart(2, '0')}`;
        const d = new Date(`${dstr}T00:00:00Z`);

        let kwhIn = mfyDailyBase * seasonal(d) * weekly(d) * (1 + gauss(0, 0.045));
        kwhIn *= coldSnaps.get(dstr) ?? 1;
        // Yillik o'sish +3.2%
        kwhIn *= 1 + 0.032 * (monthIdx / 12);
        if (outageDays.get(m.code)?.has(dstr)) kwhIn *= 0.7;

        const in2 = r2(Math.max(kwhIn, 1));

        /*
         * Uchta komponent SAQLANMAYDI - ular faqat yo'qotish darajasini
         * ishonarli shakllantiradi (tarmoq holati, mavsum, noqonuniy ulanish
         * cho'qqisi). Bazaga yagona yo'qotish tushadi: kirgan − sotilgan.
         */
        lossNoise[idx] = lossNoise[idx]! * 0.75 + gauss(0, 0.35);
        const natPct = clamp(dl.nat * (profLoss * 0.35 + 0.65), 0.5, 9);
        const techPct = clamp(dl.tech * profLoss, 0.5, 14);
        const illPct = clamp(dl.ill * profLoss * winterSpike, 0.05, 16);
        const totalPct = clamp(natPct + techPct + illPct + lossNoise[idx]!, 1.5, 34);

        const lossTotal2 = r2((in2 * totalPct) / 100);
        const sold2 = r2(in2 - lossTotal2);

        ebRows.push([ebSub, mfyIds[idx], dstr, in2, sold2]);
        monthIn += in2;
        monthLoss += lossTotal2;
      }

      // ── Oylik hisobot ─────────────────────────────────────────────────
      const growth = 1 - 0.0018 * (totalMonths - 1 - monthIdx); // abonent soni sekin o'sadi
      const pop = Math.round(popAlloc[idx]! * growth);
      const legal = Math.round(legalAlloc[idx]! * growth);
      const total = pop + legal;
      const disconnected = Math.round(total * between(0.004, 0.013));
      const active = total - disconnected;
      const newCons = Math.round(total * between(0.001, 0.006));

      const debtPop = debtPopAlloc[idx]!;
      // Budjet ulushi yuridik summadan AJRATILADI (ustiga qo'shilmaydi).
      const debtBudget = r1(debtLegalAlloc[idx]! * 0.12);
      const debtLegal = r1(debtLegalAlloc[idx]! - debtBudget);

      mrRows.push([
        mrSub, mfyIds[idx], `${period}-01`,
        pop, legal, active, disconnected, newCons,
        debtPop, debtLegal, debtBudget,
        Math.min(offlineAlloc[idx]!, total),
        Math.min(lowAlloc[idx]!, total),
        replaceNeedAlloc[idx]!,
        Math.min(replacedAlloc[idx]!, replaceNeedAlloc[idx]!),
      ]);

      // ── TP holati ─────────────────────────────────────────────────────
      const mfyTps = tpsByMfy.get(idx) ?? [];
      const repairQuota = tpRepairAlloc[idx] ?? 0;
      const overloadBias = m.profile === 'problem-technical' ? 26 : 0;
      mfyTps.forEach((t, k) => {
        const load = clamp(
          between(38, 74) + overloadBias + gauss(0, 7) + (mon >= 11 || mon <= 2 ? 8 : 0),
          5,
          128,
        );
        const condition =
          load >= 90 ? 'OVERLOAD' : load >= 78 ? 'ATTENTION' : rand() < 0.02 ? 'FAULT' : 'GOOD';
        const repairNeeded = k < repairQuota;
        tsRows.push([
          tsSub, t.id, `${period}-01`, r2(load), r1((t.ratedKva * load) / 100),
          condition, rand() < 0.02, repairNeeded,
          repairNeeded
            ? pick([
                'Yog‘ sathi past', 'Izolyator shikastlangan', 'Ortiqcha yuklama',
                'Korpus korroziyasi', 'Yerga ulanish qarshiligi yuqori',
              ])
            : null,
        ]);
      });

      // ── Tarmoq nuqsonlari ─────────────────────────────────────────────
      const pin04 = monthIdx === totalMonths - 1 ? m.pinned?.repairKm04 : undefined;
      const pin10 = monthIdx === totalMonths - 1 ? m.pinned?.repairKm10 : undefined;
      const need04 = pin04 ?? repair04Alloc[idx]!;
      const need10 = pin10 ?? repair10Alloc[idx]!;
      ndRows.push([ndSub, mfyIds[idx], `${period}-01`, 0.4, need04, r2(need04 * between(0, 0.35))]);
      ndRows.push([ndSub, mfyIds[idx], `${period}-01`, 10, need10, r2(need10 * between(0, 0.3))]);

      // ── TOP qarzdorlar ────────────────────────────────────────────────
      const nDebtors = Math.min(5, Math.max(2, Math.round(legal / 12)));
      let remaining = debtLegal;
      for (let rank = 1; rank <= nDebtors; rank += 1) {
        const portion = rank === nDebtors ? remaining : r1(remaining * between(0.28, 0.48));
        remaining = r1(remaining - portion);
        if (portion <= 0) break;
        dtRows.push([
          dbSub, mfyIds[idx], `${period}-01`, rank,
          DEBTOR_NAMES[(idx * 5 + rank) % DEBTOR_NAMES.length],
          'LEGAL', portion,
        ]);
      }

      void monthIn;
      void monthLoss;
    }
  }

  await bulkInsert(
    client, 'fact.energy_balance_daily',
    ['submission_id', 'mfy_id', 'biz_date', 'kwh_in', 'kwh_sold'],
    ebRows,
  );
  rowCounts['fact.energy_balance_daily'] = ebRows.length;

  await bulkInsert(
    client, 'fact.mfy_monthly_return',
    ['submission_id', 'mfy_id', 'period_month', 'consumers_population', 'consumers_legal',
     'consumers_active', 'consumers_disconnected', 'consumers_new',
     'debt_population_mln', 'debt_legal_mln', 'debt_budget_mln',
     'meters_offline_cnt', 'low_consumption_cnt', 'meters_replace_need_cnt', 'meters_replaced_cnt'],
    mrRows,
  );
  rowCounts['fact.mfy_monthly_return'] = mrRows.length;

  await bulkInsert(
    client, 'fact.tp_status_monthly',
    ['submission_id', 'tp_id', 'period_month', 'load_pct', 'peak_kva',
     'condition', 'under_load', 'repair_needed', 'repair_reason'],
    tsRows,
  );
  rowCounts['fact.tp_status_monthly'] = tsRows.length;

  await bulkInsert(
    client, 'fact.network_defect',
    ['submission_id', 'mfy_id', 'period_month', 'voltage_kv', 'repair_needed_km', 'repaired_km'],
    ndRows,
  );
  rowCounts['fact.network_defect'] = ndRows.length;

  await bulkInsert(
    client, 'fact.debt_top_entry',
    ['submission_id', 'mfy_id', 'period_month', 'rank', 'debtor_name', 'category', 'amount_mln'],
    dtRows,
  );
  rowCounts['fact.debt_top_entry'] = dtRows.length;

  // ── 7. TP kunlik ko'rsatkichlari (faqat oxirgi oylar) ────────────────────
  log(`TP kunlik ko‘rsatkichlari (oxirgi ${opts.readingMonths} oy)…`);
  const readingPeriods = periods.slice(-opts.readingMonths);
  const trRows: unknown[][] = [];
  for (const period of readingPeriods) {
    const nDays = daysIn(period);
    for (const [idx] of cfg.mfys.entries()) {
      const sub = submissionIds.get(subKey({ mfyIdx: idx, domain: 'TP_STATUS', period }))!;
      for (const t of tpsByMfy.get(idx) ?? []) {
        for (let day = 1; day <= nDays; day += 1) {
          const dstr = `${period}-${String(day).padStart(2, '0')}`;
          const d = new Date(`${dstr}T00:00:00Z`);
          const s = seasonal(d);
          const maxKw = r2(t.ratedKva * 0.8 * between(0.45, 0.92) * s);
          const minKw = r2(maxKw * between(0.18, 0.42));
          const volts = r1(220 + gauss(0, 6) - (maxKw / t.ratedKva > 0.75 ? 7 : 0));
          const outages = rand() < 0.05 ? 1 + Math.floor(rand() * 2) : 0;
          trRows.push([
            sub, t.id, dstr, maxKw, minKw, clamp(volts, 180, 250),
            outages, outages > 0 ? Math.round(between(15, 260)) : 0,
          ]);
        }
      }
    }
  }
  await bulkInsert(
    client, 'fact.tp_reading_daily',
    ['submission_id', 'tp_id', 'biz_date', 'max_load_kw', 'min_load_kw',
     'avg_voltage_v', 'outage_count', 'outage_minutes'],
    trRows,
    600,
  );
  rowCounts['fact.tp_reading_daily'] = trRows.length;

  // ── 8. Ishlar ────────────────────────────────────────────────────────────
  log('Ishlar va dalolatnomalar…');
  const workRows: unknown[][] = [];
  const WORK_TEMPLATES: { type: string; title: string; unit: string; qty: [number, number] }[] = [
    { type: 'CABLE_REPLACEMENT', title: '0.4 kV kabel liniyasini almashtirish', unit: 'km', qty: [0.4, 3.2] },
    { type: 'OVERHEAD_LINE_RENEWAL', title: 'Havo liniyasini yangilash', unit: 'km', qty: [0.8, 4.5] },
    { type: 'TP_MODERNIZATION', title: 'Transformator punktini modernizatsiya qilish', unit: 'ta', qty: [1, 3] },
    { type: 'TP_INSTALL', title: 'Yangi transformator o‘rnatish', unit: 'ta', qty: [1, 2] },
    { type: 'METER_REPLACEMENT', title: 'Hisoblagichlarni almashtirish', unit: 'ta', qty: [15, 120] },
    { type: 'TREE_CLEARING', title: 'Tarmoqni daraxtlardan tozalash', unit: 'km', qty: [1.5, 9.0] },
    { type: 'ILLEGAL_DISCONNECT', title: 'Noqonuniy ulanishlarni bartaraf etish', unit: 'ta', qty: [2, 18] },
    { type: 'SUPPORT_REPLACEMENT', title: 'Tayanch ustunlarni almashtirish', unit: 'ta', qty: [3, 25] },
  ];

  // Daraxtdan tozalash - tuman jamiga (145.6 km/yil) kalibrovka qilinadi.
  const treeAlloc = allocateWithPins(
    dt['treeClearingKmYear']!,
    cfg.mfys.map((m) => ({ weight: m.weight, pin: m.pinned?.treeClearingKmYear })),
    'float',
    1,
  );

  for (const [idx, m] of cfg.mfys.entries()) {
    // Daraxtdan tozalash: yil davomida 3 bo'lakka bo'linadi
    const treeParts = allocateFloat(treeAlloc[idx]!, [1, 1, 1], 1);
    treeParts.forEach((q, k) => {
      const p = periods[Math.max(0, periods.length - 1 - k * 4)]!;
      workRows.push([
        mfyIds[idx], null, 'TREE_CLEARING', 'Tarmoqni daraxtlardan tozalash', null,
        'COMPLETED', `${p}-05`, `${p}-25`, `${p}-${String(daysIn(p)).padStart(2, '0')}`,
        100, q, 'km', r2(q * between(1.8, 3.4)), null, null, 0,
      ]);
    });

    const nWorks = 1 + Math.floor(rand() * 3);
    for (let w = 0; w < nWorks; w += 1) {
      const tpl = pick(WORK_TEMPLATES.filter((t) => t.type !== 'TREE_CLEARING'));
      const roll = rand();
      const status = roll < 0.45 ? 'COMPLETED' : roll < 0.78 ? 'IN_PROGRESS' : 'PLANNED';
      const pIdx = periods.length - 1 - Math.floor(rand() * 6);
      const p = periods[clamp(pIdx, 0, periods.length - 1)]!;
      const qty = r1(between(tpl.qty[0], tpl.qty[1]));
      const isImproving = m.profile === 'improving';

      workRows.push([
        mfyIds[idx],
        rand() < 0.4 ? (tpsByMfy.get(idx)?.[0]?.id ?? null) : null,
        tpl.type, tpl.title, null,
        status,
        `${p}-05`,
        `${addMonths(p, 1)}-20`,
        status === 'COMPLETED' ? `${p}-${String(daysIn(p)).padStart(2, '0')}` : null,
        status === 'COMPLETED' ? 100 : status === 'IN_PROGRESS' ? Math.round(between(20, 85)) : 0,
        qty, tpl.unit, r2(qty * between(2.5, 14)),
        status === 'COMPLETED' && isImproving ? 11.2 : null,
        status === 'COMPLETED' && isImproving ? 8.1 : null,
        status === 'COMPLETED' ? Math.round(between(4000, 42000)) : 0,
      ]);
    }
  }
  await bulkInsert(
    client, 'fact.work',
    ['mfy_id', 'tp_id', 'work_type', 'title_uz', 'description', 'status',
     'planned_start', 'planned_end', 'actual_end', 'progress_pct',
     'quantity', 'unit', 'cost_mln',
     'effect_loss_pct_before', 'effect_loss_pct_after', 'effect_saving_kwh_month'],
    workRows,
  );
  rowCounts['fact.work'] = workRows.length;

  // ── 9. Dalolatnomalar ────────────────────────────────────────────────────
  // Pasport 10b: aniqlangan yo'qotish umumiy yo'qotishning ~39% i (4,923 / 12,642).
  const vaRows: unknown[][] = [];
  let actNo = 1;
  for (const [idx, m] of cfg.mfys.entries()) {
    const intensity =
      m.profile === 'problem-illegal' ? 6 : m.profile === 'improving' ? 4 : rand() < 0.5 ? 2 : 1;
    for (let k = 0; k < intensity; k += 1) {
      const p = periods[Math.max(0, periods.length - 1 - Math.floor(rand() * 10))]!;
      const day = 1 + Math.floor(rand() * daysIn(p));
      vaRows.push([
        mfyIds[idx],
        rand() < 0.6 ? (tpsByMfy.get(idx)?.[Math.floor(rand() * (tpsByMfy.get(idx)?.length ?? 1))]?.id ?? null) : null,
        `DL-${String(actNo).padStart(4, '0')}`,
        `${p}-${String(day).padStart(2, '0')}`,
        `Abonent №${100000 + Math.floor(rand() * 899999)}`,
        Math.round(between(800, 14000)),
        r2(between(0.4, 9.5)),
        pick(['ISSUED', 'PAID', 'PAID', 'COURT', 'CLOSED']),
      ]);
      actNo += 1;
    }
  }
  await bulkInsert(
    client, 'fact.violation_act',
    ['mfy_id', 'tp_id', 'act_no', 'act_date', 'consumer_ref',
     'kwh_identified', 'fine_mln', 'status'],
    vaRows,
  );
  rowCounts['fact.violation_act'] = vaRows.length;

  // ── 10. Joriy oy: qoralama va ko'rib chiqilayotgan konvertlar ────────────
  log(`Joriy oy (${currentPeriod}) - qoralama va ko‘rib chiqish navbati…`);
  const lateIdx = cfg.mfys.findIndex((m) => m.profile === 'late-submitter');
  const reviewIdx = cfg.mfys.findIndex((m) => m.profile === 'good');

  // Kech topshiruvchi - qoralamada qoladi (to'liqlik matritsasida qizil katak)
  if (lateIdx >= 0) await createSubmissions(currentPeriod, 'draft', lateIdx);
  // Bittasi ko'rib chiqishga yuborilgan - review navbati bo'sh bo'lmasin
  if (reviewIdx >= 0) await createSubmissions(currentPeriod, 'submitted', reviewIdx);

  // Yuborilgan konvertga haqiqiy ma'lumot ham qo'shamiz
  if (reviewIdx >= 0) {
    const sub = submissionIds.get(
      subKey({ mfyIdx: reviewIdx, domain: 'ENERGY_BALANCE', period: currentPeriod }),
    );
    if (sub) {
      const rows: unknown[][] = [];
      const share = consumerShare[reviewIdx]! / shareSum;
      const today = new Date();
      const upto = Math.min(daysIn(currentPeriod), today.getUTCDate());
      for (let day = 1; day <= upto; day += 1) {
        const dstr = `${currentPeriod}-${String(day).padStart(2, '0')}`;
        const d = new Date(`${dstr}T00:00:00Z`);
        const in2 = r2(districtDailyBase * share * seasonal(d) * weekly(d) * (1 + gauss(0, 0.04)));
        const lossTotal2 = r2(in2 * 0.061);
        const sold2 = r2(in2 - lossTotal2);
        rows.push([sub, mfyIds[reviewIdx], dstr, in2, sold2]);
      }
      await bulkInsert(
        client, 'fact.energy_balance_daily',
        ['submission_id', 'mfy_id', 'biz_date', 'kwh_in', 'kwh_sold'],
        rows,
      );
      rowCounts['fact.energy_balance_daily'] = (rowCounts['fact.energy_balance_daily'] ?? 0) + rows.length;
    }
  }

  // ── 11. MA'LUMOT YAXLITLIGI NAMOYISHI ────────────────────────────────────
  // Go'ravon MFY pasportida TUMAN ning qarzdorlik raqamlari MFY qatoriga
  // ko'chirib qo'yilgan. Seed ataylab shu xatoni takrorlashga URINADI.
  // Prezentatsiyada ko'rsatiladigan eng ishonarli 20 soniya.
  const goravonIdx = cfg.mfys.findIndex((m) => m.profile === 'data-quality');
  if (goravonIdx >= 0) {
    const testSub = submissionIds.get(
      subKey({ mfyIdx: goravonIdx, domain: 'MONTHLY_RETURN', period: lastPeriod }),
    );
    try {
      await client.query('SAVEPOINT integrity_demo');
      await client.query(
        `INSERT INTO fact.mfy_monthly_return
           (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
            consumers_active, debt_population_mln, debt_legal_mln, debt_budget_mln)
         VALUES ($1, $2, $3, 820, 9, 810, $4, $5, 0)`,
        [testSub, mfyIds[goravonIdx], `${lastPeriod}-01`,
         dt['debtPopulationMln'], dt['debtLegalMln']],
      );
      await client.query('ROLLBACK TO SAVEPOINT integrity_demo');
      goravonDemo = '✗ KUTILMAGAN: tuman qarzdorligi MFY qatoriga yozildi - trigger ishlamadi!';
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT integrity_demo');
      const msg = err instanceof Error ? err.message : String(err);
      goravonDemo = msg.includes('IMPLAUSIBLE_DEBT')
        ? `✓ Trigger bloklandi: ${msg.split('\n')[0]}`
        : `? Boshqa xato: ${msg.split('\n')[0]}`;
    }
  }

  // ── 12. Yakun ────────────────────────────────────────────────────────────
  await setAuditTriggers(client, true);

  return {
    mfyCount: cfg.mfys.length,
    tpCount: tpRows.length,
    months: periods,
    rowCounts,
    warnings,
    integrityDemo: goravonDemo,
  };
}
