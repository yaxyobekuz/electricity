import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { isPgError } from '../db/pool.ts';
/** Cheklov nomi → (maydon, o'zbekcha xabar). */
const CONSTRAINT_MAP = {
    eb_sold_le_in: {
        field: 'kwhSold',
        message: 'Sotilgan energiya tarmoqqa kirgan energiyadan ko‘p bo‘lishi mumkin emas',
    },
    eb_components: {
        field: 'kwhLossTechnical',
        message: 'Yo‘qotish tarkibi (tabiiy + texnik + noqonuniy) jami yo‘qotishga mos kelmaydi',
    },
    eb_no_future: { field: 'bizDate', message: 'Kelajakdagi sana kiritib bo‘lmaydi' },
    eb_plausible: { field: 'kwhIn', message: 'Qiymat haqiqiy bo‘lishi uchun juda katta' },
    mr_active_le_total: {
        field: 'consumersActive',
        message: 'Aloqaga chiqayotgan istemolchilar soni jami iste’molchilardan ko‘p bo‘lishi mumkin emas',
    },
    mr_discon_le_total: {
        field: 'consumersDisconnected',
        message: 'Uzilgan abonentlar soni jami iste’molchilardan ko‘p bo‘lishi mumkin emas',
    },
    mr_low_le_total: {
        field: 'lowConsumptionCnt',
        message: 'Kam iste’molchilar soni jami iste’molchilardan ko‘p bo‘lishi mumkin emas',
    },
    mr_offline_le_total: {
        field: 'metersOfflineCnt',
        message: 'Aloqasiz hisoblagichlar soni jami iste’molchilardan ko‘p bo‘lishi mumkin emas',
    },
    mr_replaced_le_need: {
        field: 'metersReplacedCnt',
        message: 'Almashtirilgan hisoblagichlar soni kerakli sondan ko‘p bo‘lishi mumkin emas',
    },
    mr_no_future: { field: 'period', message: 'Kelajakdagi davr uchun hisobot kiritib bo‘lmaydi' },
    nd_repaired_le_needed: {
        field: 'repairedKm',
        message: 'Ta’mirlangan uzunlik ta’mir kerak bo‘lgan uzunlikdan ko‘p bo‘lishi mumkin emas',
    },
    tr_min_le_max: {
        field: 'minLoadKw',
        message: 'Minimal yuklama maksimal yuklamadan katta bo‘lishi mumkin emas',
    },
    work_completed: {
        field: 'actualEnd',
        message: 'Bajarilgan ish uchun haqiqiy tugash sanasi va 100% bajarilish talab qilinadi',
    },
    submission_approved_uq: {
        field: 'period',
        message: 'Bu davr uchun allaqachon tasdiqlangan hisobot mavjud',
    },
    submission_draft_uq: {
        field: 'period',
        message: 'Bu davr uchun sizda allaqachon ochiq qoralama bor',
    },
    norm_no_overlap: {
        field: 'effectiveFrom',
        message: 'Bu davr uchun norma allaqachon belgilangan — amal qilish sanasini o‘zgartiring',
    },
    ts_repair_reason: {
        field: 'repairReason',
        message: 'Ta’mir kerak bo‘lsa, sababini ko‘rsating',
    },
};
const errorPlugin = async (app) => {
    app.setErrorHandler((err, req, reply) => {
        const requestId = req.id;
        // 1. Zod validatsiyasi
        if (err instanceof ZodError) {
            const errors = {};
            for (const issue of err.issues) {
                const path = issue.path.join('.') || 'form';
                errors[path] ??= issue.message;
            }
            void reply.code(400).send({
                error: 'validation_error',
                message: 'Kiritilgan ma’lumotda xatolik bor',
                errors, requestId,
            });
            return;
        }
        // 2. Postgres cheklovlari → maydon xabarlari
        if (isPgError(err)) {
            // Ishonchlilik triggeri (Go'ravon hodisasi)
            if (err.message.includes('IMPLAUSIBLE_DEBT')) {
                req.log.warn({ err, hint: err.hint }, 'Ishonchsiz qarzdorlik qiymati bloklandi');
                void reply.code(422).send({
                    error: 'implausible_value',
                    message: err.message.replace(/^.*IMPLAUSIBLE_DEBT: /, ''),
                    errors: {
                        debtLegalMln: 'Bu qiymat tuman formasidan ko‘chirilganga o‘xshaydi. Faqat shu MFY ning qarzdorligini kiriting.',
                    },
                    requestId,
                });
                return;
            }
            const mapped = err.constraint ? CONSTRAINT_MAP[err.constraint] : undefined;
            if (mapped) {
                req.log.info({ constraint: err.constraint }, 'DB cheklovi ishga tushdi');
                void reply.code(422).send({
                    error: 'constraint_violation',
                    message: mapped.message,
                    errors: { [mapped.field]: mapped.message },
                    requestId,
                });
                return;
            }
            // RLS rad etishi
            if (err.code === '42501') {
                void reply.code(403).send({
                    error: 'forbidden',
                    message: 'Bu ma’lumotga yozish huquqingiz yo‘q',
                    requestId,
                });
                return;
            }
            // Yagonalik buzilishi (xaritalanmagan)
            if (err.code === '23505') {
                void reply.code(409).send({
                    error: 'conflict',
                    message: 'Bunday yozuv allaqachon mavjud',
                    requestId,
                });
                return;
            }
        }
        // 3. Qo'lda qo'yilgan statusCode
        // `isPgError` tip qo'riqchisi yuqorida `err` ni toraytiradi, shuning uchun
        // bu yerda uni qayta Error sifatida o'qiymiz.
        const asError = err;
        const statusCode = asError.statusCode ?? 500;
        if (statusCode < 500) {
            void reply.code(statusCode).send({
                error: 'request_error', message: asError.message, requestId,
            });
            return;
        }
        req.log.error({ err }, 'Kutilmagan server xatosi');
        void reply.code(500).send({
            error: 'internal_error',
            message: 'Serverda kutilmagan xatolik yuz berdi',
            requestId,
        });
    });
    app.setNotFoundHandler((req, reply) => {
        void reply.code(404).send({
            error: 'not_found',
            message: `Manzil topilmadi: ${req.method} ${req.url}`,
            requestId: req.id,
        });
    });
};
export default fp(errorPlugin, { name: 'errors' });
