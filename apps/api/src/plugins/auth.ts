/**
 * Autentifikatsiya va rol nazorati.
 *
 *  • Parol      — argon2id
 *  • Access     — JWT (jose, HS256), 15 daq, klientda faqat xotirada
 *  • Refresh    — opaque 32 bayt, xeshlangan holda DB da, httpOnly cookie,
 *                 oila (family) bo'yicha qayta ishlatishni aniqlash
 *
 * Har bir so'rovda `AppContext` quriladi va u DB tranzaksiyasiga
 * `SET LOCAL app.*` orqali uzatiladi — audit va RLS shundan oziqlanadi.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { AuthUser, Role } from '@beap/shared';
import argon2 from 'argon2';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { SignJWT, jwtVerify } from 'jose';

import { config } from '../config.ts';
import { type AppContext, query, queryOne, withTransaction } from '../db/pool.ts';

const secretKey = new TextEncoder().encode(config.auth.jwtSecret);
const REFRESH_COOKIE = 'beap_rt';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    ctx: AppContext;
  }
}

// ─── Token yordamchilari ────────────────────────────────────────────────────

export async function signAccessToken(user: AuthUser): Promise<string> {
  return new SignJWT({ role: user.role, login: user.login })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(config.auth.accessTtl)
    .setIssuer('beap')
    .sign(secretKey);
}

async function verifyAccessToken(token: string): Promise<{ userId: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { issuer: 'beap' });
    const sub = Number(payload.sub);
    return Number.isFinite(sub) ? { userId: sub } : null;
  } catch {
    return null;
  }
}

const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

// ─── Foydalanuvchi yuklash ──────────────────────────────────────────────────

export async function loadUser(userId: number): Promise<AuthUser | null> {
  const u = await queryOne<{ id: number; login: string; full_name: string; role: Role }>(
    `SELECT id, login, full_name, role FROM sec.app_user WHERE id = $1 AND is_active`,
    [userId]);
  if (!u) return null;

  const scopes = await query<{ scope_type: string; scope_id: number | null }>(
    `SELECT scope_type, scope_id FROM sec.user_scope WHERE user_id = $1`, [userId]);

  const elektrosetIds = scopes.filter((s) => s.scope_type === 'ELEKTROSET')
    .map((s) => s.scope_id!).filter(Boolean);
  let mfyIds = scopes.filter((s) => s.scope_type === 'MFY')
    .map((s) => s.scope_id!).filter(Boolean);

  // Elektroset menejerining scope'i o'z MFY lariga yoyiladi.
  if (elektrosetIds.length > 0) {
    const expanded = await query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE elektroset_id = ANY($1::int[]) AND valid_to IS NULL`,
      [elektrosetIds]);
    mfyIds = [...new Set([...mfyIds, ...expanded.map((r) => r.id)])];
  }
  // Admin barcha MFY larga yozadi.
  if (u.role === 'admin') {
    const all = await query<{ id: number }>(`SELECT id FROM ref.mfy WHERE valid_to IS NULL`);
    mfyIds = all.map((r) => r.id);
  }

  return { id: u.id, login: u.login, fullName: u.full_name, role: u.role, mfyIds, elektrosetIds };
}

// ─── Login / refresh ────────────────────────────────────────────────────────

export interface LoginOutcome {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export async function login(
  loginName: string, password: string, ip: string | undefined, ua: string | undefined,
): Promise<LoginOutcome | null> {
  const row = await queryOne<{ id: number; password_hash: string; is_active: boolean }>(
    `SELECT id, password_hash, is_active FROM sec.app_user WHERE login = $1`, [loginName]);

  // Foydalanuvchi topilmasa ham xeshni tekshiramiz — vaqt bo'yicha sizib chiqishni oldini oladi.
  const hash = row?.password_hash ?? '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aaaaaaaaaaaaaaaaaaaaaa';
  let ok = false;
  try {
    ok = await argon2.verify(hash, password);
  } catch {
    ok = false;
  }
  if (!row || !row.is_active || !ok) return null;

  const user = await loadUser(row.id);
  if (!user) return null;

  const refreshToken = randomBytes(32).toString('base64url');
  await withTransaction({ userId: user.id, role: user.role, mfyIds: [], requestId: 'login' },
    async (client) => {
      await client.query(
        `INSERT INTO sec.refresh_token
           (user_id, family_id, token_hash, expires_at, client_ip, user_agent)
         VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5, $6)`,
        [user.id, randomUUID(), hashToken(refreshToken), config.auth.refreshTtlDays, ip ?? null, ua ?? null]);
      await client.query('UPDATE sec.app_user SET last_login_at = now() WHERE id = $1', [user.id]);
    });

  return { user, accessToken: await signAccessToken(user), refreshToken };
}

export async function rotateRefresh(token: string): Promise<LoginOutcome | null> {
  const row = await queryOne<{
    id: number; user_id: number; family_id: string; used_at: string | null;
    revoked_at: string | null; expired: boolean;
  }>(`SELECT id, user_id, family_id, used_at::text, revoked_at::text,
             (expires_at < now()) AS expired
      FROM sec.refresh_token WHERE token_hash = $1`, [hashToken(token)]);

  if (!row || row.revoked_at || row.expired) return null;

  // QAYTA ISHLATISH aniqlandi — butun oila bekor qilinadi.
  if (row.used_at) {
    await withTransaction({ userId: row.user_id, role: 'system', mfyIds: [], requestId: 'token-reuse' },
      async (client) => {
        await client.query(
          `UPDATE sec.refresh_token SET revoked_at = now()
           WHERE family_id = $1 AND revoked_at IS NULL`, [row.family_id]);
      });
    return null;
  }

  const user = await loadUser(row.user_id);
  if (!user) return null;

  const next = randomBytes(32).toString('base64url');
  await withTransaction({ userId: user.id, role: user.role, mfyIds: [], requestId: 'refresh' },
    async (client) => {
      await client.query('UPDATE sec.refresh_token SET used_at = now() WHERE id = $1', [row.id]);
      await client.query(
        `INSERT INTO sec.refresh_token (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
        [user.id, row.family_id, hashToken(next), config.auth.refreshTtlDays]);
    });

  return { user, accessToken: await signAccessToken(user), refreshToken: next };
}

export async function revokeRefresh(token: string): Promise<void> {
  await withTransaction({ userId: null, role: 'system', mfyIds: [], requestId: 'logout' },
    async (client) => {
      await client.query(
        'UPDATE sec.refresh_token SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]);
    });
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: config.auth.cookieSecure,
    path: '/api/auth', maxAge: config.auth.refreshTtlDays * 86400,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

export const readRefreshCookie = (req: FastifyRequest): string | undefined =>
  req.cookies[REFRESH_COOKIE];

// ─── Plugin ─────────────────────────────────────────────────────────────────

const authPlugin: FastifyPluginAsync = async (app) => {
  // `onRequest` hook har bir so'rovda haqiqiy qiymatni o'rnatadi; bu yerda
  // faqat maydonni e'lon qilamiz (Fastify tipi `null` ni qabul qilmaydi).
  app.decorateRequest('user', null);
  app.decorateRequest('ctx', undefined as unknown as AppContext);

  // Har bir so'rovda kontekstni quramiz (token bo'lmasa ham — anonim kontekst).
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    let user: AuthUser | null = null;

    if (header?.startsWith('Bearer ')) {
      const payload = await verifyAccessToken(header.slice(7));
      if (payload) user = await loadUser(payload.userId);
    }

    req.user = user;
    req.ctx = user
      ? { userId: user.id, role: user.role, mfyIds: user.mfyIds, requestId: req.id }
      : { userId: null, role: 'anonymous', mfyIds: [], requestId: req.id };
  });

  /** Autentifikatsiya talab qiladi. */
  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      await reply.code(401).send({ error: 'unauthorized', message: 'Tizimga kirish talab qilinadi' });
    }
  });

  /** Ma'lum rollarni talab qiladi. */
  app.decorate('requireRole', (...roles: Role[]) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) {
        await reply.code(401).send({ error: 'unauthorized', message: 'Tizimga kirish talab qilinadi' });
        return;
      }
      if (!roles.includes(req.user.role)) {
        await reply.code(403).send({
          error: 'forbidden',
          message: 'Bu amal uchun sizda ruxsat yo‘q',
        });
      }
    });

  /** Berilgan MFY ga yozish huquqini tekshiradi. */
  app.decorate('assertMfyWrite', (req: FastifyRequest, mfyId: number): boolean => {
    if (!req.user) return false;
    if (req.user.role === 'admin') return true;
    return req.user.mfyIds.includes(mfyId);
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    assertMfyWrite: (req: FastifyRequest, mfyId: number) => boolean;
  }
}

export default fp(authPlugin, { name: 'auth' });
