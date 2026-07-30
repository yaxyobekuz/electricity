import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { bootstrap, getMfy, listNetworkSegments, listTp } from '../db/queries/ref.ts';

const mfyQuery = z.object({ mfyId: z.coerce.number().int().positive().optional() });

const refRoutes: FastifyPluginAsync = async (app) => {
  /** Bitta so'rovda barcha spravochniklar — klient startida chaqiriladi. */
  app.get('/bootstrap', async (req) => bootstrap(req.ctx));

  app.get('/mfy/:id', async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const mfy = await getMfy(req.ctx, id);
    if (!mfy) return reply.code(404).send({ error: 'not_found', message: 'MFY topilmadi' });
    return mfy;
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
