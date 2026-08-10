import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  bootstrap, getMfy, getMfyResponsible, listNetworkSegments, listTp, upsertMfyResponsible,
} from '../db/queries/ref.ts';

const mfyQuery = z.object({ mfyId: z.coerce.number().int().positive().optional() });
const idParam = z.object({ id: z.coerce.number().int().positive() });

const responsibleBody = z.object({
  fullName: z.string().trim().min(1).max(200),
  position: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
});

const refRoutes: FastifyPluginAsync = async (app) => {
  /** Bitta so'rovda barcha spravochniklar - klient startida chaqiriladi. */
  app.get('/bootstrap', async (req) => bootstrap(req.ctx));

  app.get('/mfy/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const mfy = await getMfy(req.ctx, id);
    if (!mfy) return reply.code(404).send({ error: 'not_found', message: 'MFY topilmadi' });
    return mfy;
  });

  /** Fider bo'yicha ma'sul shaxs - belgilanmagan bo'lsa `null`. */
  app.get('/mfy/:id/responsible', async (req) => {
    const { id } = idParam.parse(req.params);
    return getMfyResponsible(req.ctx, id);
  });

  app.patch('/mfy/:id/responsible', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = responsibleBody.parse(req.body);
    return upsertMfyResponsible(req.ctx, id, {
      fullName: body.fullName,
      position: body.position ?? null,
      phone: body.phone ?? null,
    });
  });

  app.get('/tp', async (req) => {
    const { mfyId } = mfyQuery.parse(req.query);
    return listTp(req.ctx, mfyId ?? null);
  });

  app.get('/network-segment', async (req) => {
    const { mfyId } = mfyQuery.parse(req.query);
    return listNetworkSegments(req.ctx, mfyId ?? null);
  });
};

export default refRoutes;
