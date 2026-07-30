import { loginSchema } from '@beap/shared';
import type { FastifyPluginAsync } from 'fastify';

import {
  clearRefreshCookie, login, readRefreshCookie, revokeRefresh,
  rotateRefresh, setRefreshCookie,
} from '../plugins/auth.ts';

const authRoutes: FastifyPluginAsync = async (app) => {
  /** Parol tanlashga urinishlarni cheklaymiz — daqiqasiga 20 ta. */
  const loginRateLimit = {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  };

  app.post('/login', loginRateLimit, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const outcome = await login(body.login, body.password, req.ip, req.headers['user-agent']);

    if (!outcome) {
      req.log.warn({ login: body.login, ip: req.ip }, 'Muvaffaqiyatsiz kirish urinishi');
      return reply.code(401).send({
        error: 'invalid_credentials',
        message: 'Login yoki parol noto‘g‘ri',
      });
    }

    setRefreshCookie(reply, outcome.refreshToken);
    return { accessToken: outcome.accessToken, user: outcome.user };
  });

  app.post('/refresh', async (req, reply) => {
    const token = readRefreshCookie(req);
    if (!token) {
      return reply.code(401).send({ error: 'no_refresh_token', message: 'Sessiya topilmadi' });
    }

    const outcome = await rotateRefresh(token);
    if (!outcome) {
      clearRefreshCookie(reply);
      return reply.code(401).send({
        error: 'invalid_refresh_token',
        message: 'Sessiya muddati tugagan yoki bekor qilingan. Qaytadan kiring.',
      });
    }

    setRefreshCookie(reply, outcome.refreshToken);
    return { accessToken: outcome.accessToken, user: outcome.user };
  });

  app.post('/logout', async (req, reply) => {
    const token = readRefreshCookie(req);
    if (token) await revokeRefresh(token);
    clearRefreshCookie(reply);
    return { ok: true };
  });

  app.get('/me', { onRequest: [app.requireAuth] }, async (req) => req.user);
};

export default authRoutes;
