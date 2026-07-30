/**
 * Yagona validatsiya manbasi.
 *
 * Bu modulni Fastify route ham, React forma ham AYNAN bir xil import qiladi.
 * DB `CHECK` cheklovlari — uchinchi nusxa; `schemas.test.ts` uchalasi mos ekanini
 * tekshiradi. Qoidani o'zgartirsangiz — uchala joyda o'zgartiring.
 */
import { z } from 'zod';
import { CONSUMER_CATEGORIES, DOMAINS, NORM_METRICS, ROLES, TP_CONDITIONS, VIOLATION_STATUSES, WORK_STATUSES, WORK_TYPES, balanceTolerance, } from './constants.ts';
// ─── Asosiy tiplar ───────────────────────────────────────────────────────────
export const idSchema = z.coerce.number().int().positive();
/** `YYYY-MM-DD` */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD ko‘rinishida bo‘lishi kerak');
/** `YYYY-MM` */
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Davr YYYY-MM ko‘rinishida bo‘lishi kerak');
/** Bo'sh input `undefined` bo'lib kelishi mumkin — 0 deb qabul qilamiz. */
const qty = (max = 1e12) => z.coerce.number().nonnegative('Manfiy qiymat bo‘lishi mumkin emas').max(max).default(0);
const count = (max = 1_000_000) => z.coerce.number().int('Butun son bo‘lishi kerak').nonnegative('Manfiy son bo‘lishi mumkin emas').max(max).default(0);
function isFuture(isoDate) {
    // Kunlik aniqlik yetarli; vaqt mintaqasi farqi uchun bugungi kun ham qabul qilinadi.
    return isoDate > new Date().toISOString().slice(0, 10);
}
// ─── 1. Kunlik energiya balansi ──────────────────────────────────────────────
// DB: fact.energy_balance_daily
//   eb_sold_le_in   → kwhSold <= kwhIn
//   eb_components   → |(in - sold) - (natural + technical + illegal)| <= tolerance
//   eb_no_future    → bizDate <= bugun
export const energyBalanceDaySchema = z
    .object({
    bizDate: dateSchema,
    kwhIn: qty(5_000_000),
    kwhSold: qty(5_000_000),
    kwhLossNatural: qty(5_000_000),
    kwhLossTechnical: qty(5_000_000),
    kwhLossIllegal: qty(5_000_000),
    note: z.string().max(500).nullish(),
})
    .superRefine((v, ctx) => {
    if (v.kwhSold > v.kwhIn) {
        ctx.addIssue({
            code: 'custom',
            path: ['kwhSold'],
            message: 'Sotilgan energiya tarmoqqa kirgan energiyadan ko‘p bo‘lishi mumkin emas',
        });
    }
    const total = v.kwhIn - v.kwhSold;
    const parts = v.kwhLossNatural + v.kwhLossTechnical + v.kwhLossIllegal;
    if (Math.abs(total - parts) > balanceTolerance(v.kwhIn)) {
        ctx.addIssue({
            code: 'custom',
            path: ['kwhLossTechnical'],
            message: `Yo‘qotish tarkibi jamiga mos emas: ${parts.toFixed(1)} ≠ ${total.toFixed(1)} kWh`,
        });
    }
    if (isFuture(v.bizDate)) {
        ctx.addIssue({ code: 'custom', path: ['bizDate'], message: 'Kelajakdagi sana kiritib bo‘lmaydi' });
    }
});
/** Bir oylik konvert — kunlik qatorlar to'plami. */
export const energyBalancePatchSchema = z.object({
    rows: z.array(energyBalanceDaySchema).min(1).max(31),
});
// ─── 2. Oylik hisobot (pasport 1, 5, 6, 7, 13-qatorlar) ──────────────────────
// DB: fact.mfy_monthly_return
//   JAMI ustunlar GENERATED — bu yerda ham hisoblanadi, kiritilmaydi.
export const monthlyReturnSchema = z
    .object({
    consumersPopulation: count(200_000),
    consumersLegal: count(50_000),
    consumersActive: count(250_000),
    consumersDisconnected: count(250_000),
    consumersNew: count(50_000),
    debtPopulationMln: qty(1_000_000),
    debtLegalMln: qty(1_000_000),
    debtBudgetMln: qty(1_000_000),
    metersOfflineCnt: count(250_000),
    lowConsumptionCnt: count(250_000),
    metersReplaceNeedCnt: count(250_000),
    metersReplacedCnt: count(250_000),
})
    .superRefine((v, ctx) => {
    const totalConsumers = v.consumersPopulation + v.consumersLegal;
    if (totalConsumers === 0) {
        ctx.addIssue({
            code: 'custom',
            path: ['consumersPopulation'],
            message: 'Iste’molchilar soni noldan katta bo‘lishi kerak',
        });
        return;
    }
    if (v.consumersActive > totalConsumers) {
        ctx.addIssue({
            code: 'custom',
            path: ['consumersActive'],
            message: `Faol abonentlar jamidan (${totalConsumers}) ko‘p bo‘lishi mumkin emas`,
        });
    }
    if (v.consumersDisconnected > totalConsumers) {
        ctx.addIssue({
            code: 'custom',
            path: ['consumersDisconnected'],
            message: `Uzilgan abonentlar jamidan (${totalConsumers}) ko‘p bo‘lishi mumkin emas`,
        });
    }
    if (v.lowConsumptionCnt > totalConsumers) {
        ctx.addIssue({
            code: 'custom',
            path: ['lowConsumptionCnt'],
            message: `Kam iste’molchilar soni jamidan (${totalConsumers}) ko‘p bo‘lishi mumkin emas`,
        });
    }
    if (v.metersOfflineCnt > totalConsumers) {
        ctx.addIssue({
            code: 'custom',
            path: ['metersOfflineCnt'],
            message: `Aloqasiz hisoblagichlar soni jamidan (${totalConsumers}) ko‘p bo‘lishi mumkin emas`,
        });
    }
    if (v.metersReplacedCnt > v.metersReplaceNeedCnt) {
        ctx.addIssue({
            code: 'custom',
            path: ['metersReplacedCnt'],
            message: 'Almashtirilgan hisoblagichlar soni kerakli sondan ko‘p bo‘lishi mumkin emas',
        });
    }
});
// ─── 3. TP oylik holati (pasport 2, 3, 11-qatorlar) ──────────────────────────
export const tpStatusSchema = z.object({
    tpId: idSchema,
    loadPct: z.coerce.number().min(0).max(200, 'Yuklama 200% dan oshmasligi kerak').default(0),
    peakKva: qty(100_000),
    condition: z.enum(TP_CONDITIONS).default('GOOD'),
    underLoad: z.boolean().default(false),
    repairNeeded: z.boolean().default(false),
    repairReason: z.string().max(500).nullish(),
});
export const tpStatusPatchSchema = z.object({ rows: z.array(tpStatusSchema).max(2000) });
// ─── 4. TP kunlik ko'rsatkichlari (tezkor ko'rsatkichlar paneli) ─────────────
export const tpReadingSchema = z
    .object({
    tpId: idSchema,
    bizDate: dateSchema,
    maxLoadKw: qty(100_000),
    minLoadKw: qty(100_000),
    avgVoltageV: z.coerce.number().min(0).max(1000).default(220),
    outageCount: count(500),
    outageMinutes: count(1440 * 31),
})
    .superRefine((v, ctx) => {
    if (v.minLoadKw > v.maxLoadKw) {
        ctx.addIssue({
            code: 'custom',
            path: ['minLoadKw'],
            message: 'Minimal yuklama maksimal yuklamadan katta bo‘lishi mumkin emas',
        });
    }
    if (isFuture(v.bizDate)) {
        ctx.addIssue({ code: 'custom', path: ['bizDate'], message: 'Kelajakdagi sana kiritib bo‘lmaydi' });
    }
});
export const tpReadingPatchSchema = z.object({ rows: z.array(tpReadingSchema).max(31 * 600) });
// ─── 5. Tarmoq nuqsonlari (pasport 12-qator) ─────────────────────────────────
export const networkDefectSchema = z
    .object({
    voltageKv: z.coerce.number().refine((v) => [0.4, 6, 10, 35].includes(v), 'Kuchlanish 0.4 / 6 / 10 / 35 kV bo‘lishi kerak'),
    repairNeededKm: qty(10_000),
    repairedKm: qty(10_000),
})
    .superRefine((v, ctx) => {
    if (v.repairedKm > v.repairNeededKm) {
        ctx.addIssue({
            code: 'custom',
            path: ['repairedKm'],
            message: 'Ta’mirlangan uzunlik ta’mir kerak bo‘lgan uzunlikdan ko‘p bo‘lishi mumkin emas',
        });
    }
});
export const networkDefectPatchSchema = z.object({ rows: z.array(networkDefectSchema).max(8) });
// ─── 6. TOP-5 qarzdorlar ─────────────────────────────────────────────────────
export const debtTopEntrySchema = z.object({
    rank: z.coerce.number().int().min(1).max(20),
    debtorName: z.string().min(2, 'Qarzdor nomi kamida 2 belgidan iborat bo‘lishi kerak').max(300),
    category: z.enum(CONSUMER_CATEGORIES).default('LEGAL'),
    amountMln: qty(1_000_000),
});
export const debtPatchSchema = z.object({ rows: z.array(debtTopEntrySchema).max(20) });
// ─── 7. Ishlar (reja + bajarilgan) ───────────────────────────────────────────
export const workSchema = z
    .object({
    id: z.coerce.number().int().positive().nullish(),
    mfyId: idSchema,
    tpId: idSchema.nullish(),
    workType: z.enum(WORK_TYPES),
    titleUz: z.string().min(3, 'Ish nomi kamida 3 belgidan iborat bo‘lishi kerak').max(300),
    description: z.string().max(2000).nullish(),
    status: z.enum(WORK_STATUSES).default('PLANNED'),
    plannedStart: dateSchema.nullish(),
    plannedEnd: dateSchema.nullish(),
    actualEnd: dateSchema.nullish(),
    progressPct: z.coerce.number().int().min(0).max(100).default(0),
    quantity: qty(100_000),
    unit: z.string().max(16).default('ta'),
    costMln: qty(1_000_000),
    effectLossPctBefore: z.coerce.number().min(0).max(100).nullish(),
    effectLossPctAfter: z.coerce.number().min(0).max(100).nullish(),
    effectSavingKwhMonth: qty(10_000_000),
})
    .superRefine((v, ctx) => {
    if (v.plannedStart && v.plannedEnd && v.plannedEnd < v.plannedStart) {
        ctx.addIssue({
            code: 'custom',
            path: ['plannedEnd'],
            message: 'Tugash sanasi boshlanish sanasidan oldin bo‘lishi mumkin emas',
        });
    }
    if (v.status === 'COMPLETED') {
        if (!v.actualEnd) {
            ctx.addIssue({
                code: 'custom',
                path: ['actualEnd'],
                message: 'Bajarilgan ish uchun haqiqiy tugash sanasi majburiy',
            });
        }
        if (v.progressPct !== 100) {
            ctx.addIssue({
                code: 'custom',
                path: ['progressPct'],
                message: 'Bajarilgan ishning bajarilish darajasi 100% bo‘lishi kerak',
            });
        }
    }
    if (v.status !== 'COMPLETED' && v.progressPct === 100) {
        ctx.addIssue({
            code: 'custom',
            path: ['status'],
            message: '100% bajarilgan ish holati "Bajarildi" bo‘lishi kerak',
        });
    }
});
export const worksPatchSchema = z.object({ rows: z.array(workSchema).max(500) });
// ─── 8. Dalolatnomalar (pasport 10b) ─────────────────────────────────────────
export const violationActSchema = z
    .object({
    id: z.coerce.number().int().positive().nullish(),
    mfyId: idSchema,
    tpId: idSchema.nullish(),
    actNo: z.string().min(1, 'Dalolatnoma raqami majburiy').max(64),
    actDate: dateSchema,
    consumerRef: z.string().max(300).nullish(),
    kwhIdentified: qty(1_000_000),
    fineMln: qty(100_000),
    status: z.enum(VIOLATION_STATUSES).default('ISSUED'),
})
    .superRefine((v, ctx) => {
    if (isFuture(v.actDate)) {
        ctx.addIssue({ code: 'custom', path: ['actDate'], message: 'Kelajakdagi sana kiritib bo‘lmaydi' });
    }
});
export const violationsPatchSchema = z.object({ rows: z.array(violationActSchema).max(500) });
// ─── Submission boshqaruvi ───────────────────────────────────────────────────
export const createSubmissionSchema = z.object({
    scopeType: z.enum(['MFY', 'ELEKTROSET', 'TUMAN']).default('MFY'),
    scopeId: idSchema,
    domain: z.enum(DOMAINS),
    period: periodSchema,
});
export const reviewActionSchema = z.object({
    note: z.string().max(2000).nullish(),
});
export const submitActionSchema = z.object({
    /** >30% o'zgargan qiymatlar uchun majburiy izohlar: { fieldPath: izoh } */
    justifications: z.record(z.string(), z.string().min(5)).default({}),
});
// ─── Registrlar (admin) ──────────────────────────────────────────────────────
export const tpUpsertSchema = z.object({
    id: z.coerce.number().int().positive().nullish(),
    mfyId: idSchema,
    code: z.string().min(2).max(32),
    name: z.string().max(200).nullish(),
    ratedKva: z.coerce.number().positive('Quvvat noldan katta bo‘lishi kerak').max(100_000),
    voltageClass: z.enum(['10/0.4', '6/0.4', '35/10']).default('10/0.4'),
    avgDistanceM: z.coerce.number().min(0).max(50_000).nullish(),
    commissionedOn: dateSchema.nullish(),
    decommissionedOn: dateSchema.nullish(),
});
export const networkSegmentUpsertSchema = z.object({
    id: z.coerce.number().int().positive().nullish(),
    mfyId: idSchema,
    voltageKv: z.coerce.number().refine((v) => [0.4, 6, 10, 35].includes(v)),
    lineType: z.enum(['overhead', 'cable']).default('overhead'),
    lengthKm: z.coerce.number().positive('Uzunlik noldan katta bo‘lishi kerak').max(10_000),
    installedOn: dateSchema.nullish(),
    retiredOn: dateSchema.nullish(),
});
export const normUpsertSchema = z.object({
    scopeType: z.enum(['TUMAN', 'ELEKTROSET', 'MFY']),
    scopeId: idSchema.nullish(),
    metric: z.enum(NORM_METRICS),
    valueNum: z.coerce.number(),
    unit: z.string().max(16),
    effectiveFrom: dateSchema,
    effectiveTo: dateSchema.nullish(),
    sourceDoc: z.string().max(300).nullish(),
});
// ─── Auth ────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
    login: z.string().min(3, 'Login kamida 3 belgidan iborat bo‘lishi kerak').max(64),
    password: z.string().min(6, 'Parol kamida 6 belgidan iborat bo‘lishi kerak').max(200),
});
export const userUpsertSchema = z.object({
    id: z.coerce.number().int().positive().nullish(),
    login: z.string().min(3).max(64),
    fullName: z.string().min(3).max(200),
    role: z.enum(ROLES),
    password: z.string().min(8).max(200).nullish(),
    isActive: z.boolean().default(true),
    scopeIds: z.array(idSchema).default([]),
});
// ─── So'rov parametrlari ─────────────────────────────────────────────────────
export const periodQuerySchema = z.object({ period: periodSchema.optional() });
export const dateQuerySchema = z.object({ date: dateSchema.optional() });
export const rangeQuerySchema = z.object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    bucket: z.enum(['day', 'week', 'month']).default('day'),
});
