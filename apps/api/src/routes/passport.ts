import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { latestPeriod } from '../db/queries/dashboard.ts';
import * as p from '../db/queries/passport.ts';

const periodQ = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const idParam = z.object({ id: z.coerce.number().int().positive() });

const passportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/mfy/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const per = period ?? (await latestPeriod(req.ctx));
    if (!per) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    const result = await p.mfyPassport(req.ctx, id, per);
    if (!result) {
      return reply.code(404).send({
        error: 'no_data',
        message: `${per} davri uchun MFY pasporti topilmadi`,
      });
    }
    return result;
  });

  app.get('/tuman', async (req, reply) => {
    const { period } = periodQ.parse(req.query);
    const per = period ?? (await latestPeriod(req.ctx));
    if (!per) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    const result = await p.tumanPassport(req.ctx, per);
    if (!result) {
      return reply.code(404).send({
        error: 'no_data',
        message: `${per} davri uchun tuman pasporti topilmadi`,
      });
    }
    return result;
  });

  /**
   * Solishtirish: SUM(MFY pasportlari) vs TUMAN pasporti.
   * "Tuman pasporti qo'lda kiritilmaydi" da'vosining tekshiruvi.
   */
  app.get('/tuman/:period/reconcile', async (req) => {
    const { period } = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.params);
    return p.reconcile(req.ctx, period);
  });

  app.get('/snapshots', async (req) => {
    const { scopeType } = z.object({ scopeType: z.enum(['MFY', 'TUMAN']).optional() }).parse(req.query);
    return p.listSnapshots(req.ctx, scopeType ?? null);
  });

  /** Pasportni muzlatish - imzolanadigan rasmiy hujjat. */
  app.post('/freeze', async (req) => {
    const body = z.object({
      scopeType: z.enum(['MFY', 'TUMAN']),
      scopeId: z.coerce.number().int().positive().nullish(),
      period: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(req.body);

    return p.freeze(req.ctx, body.scopeType, body.scopeId ?? null, body.period);
  });
};

export default passportRoutes;
