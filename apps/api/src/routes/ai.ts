/**
 * AI yordamchi marshrutlari.
 *
 * `/chat` javobni SSE (server-sent events) oqimi bilan qaytaradi — chat
 * oynasida so'zlar yozilib borgani ko'rinadi. Oddiy JSON javob ham ishlardi,
 * lekin 10 soniyalik jimlik "tizim qotib qoldi" degan taassurot beradi.
 *
 * KIRISH: panelning qolgan qismi kabi login TALAB QILINMAYDI — mehmon ham
 * raqamlarni ko'rayotgan ekan, ular haqida savol ham bera olishi kerak.
 * Suiiste'moldan himoya IP bo'yicha chastota chegarasi bilan: daqiqasiga 20
 * so'rov (har bir so'rov OpenAI hisobidan token yeydi).
 *
 * Ma'lumot ko'lami RLS bilan cheklanadi: surat `req.ctx` orqali yig'iladi,
 * ya'ni mehmon o'zi ko'ra olmaydigan ma'lumotni savol orqali ham ololmaydi.
 * Kalit hech qachon javobga tushmaydi.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import type { ToolContext } from '../services/ai-tools.ts';
import { AiError, aiEnabled, buildSnapshot, runAgent } from '../services/ai.ts';

const chatBody = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    /* 4000 belgidan uzun savol — bu savol emas, fayl. */
    content: z.string().min(1).max(4000),
  })).min(1).max(24),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const aiRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Yordamchi ishlaydimi — klient tugmani shunga qarab ko'rsatadi.
   *
   * Model nomi ham qaytadi: administrator qaysi model ulanganini panelning
   * o'zida ko'rishi kerak, `.env` ga qaramasdan.
   */
  app.get('/status', async () => ({
    enabled: aiEnabled(),
    model: aiEnabled() ? config.ai.model : null,
  }));

  app.post('/chat', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!aiEnabled()) {
      return reply.code(503).send({
        error: 'ai_disabled',
        message: 'AI yordamchi sozlanmagan: .env faylida OPENAI_API_KEY berilishi kerak',
      });
    }

    const parsed = chatBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'So‘rov noto‘g‘ri' });
    }

    const snapshot = await buildSnapshot(req.ctx, parsed.data.period);

    /*
     * CORS sarlavhalarini QO'LDA ko'chiramiz.
     *
     * `@fastify/cors` ularni `reply` obyektiga qo'yadi va ular javob
     * YUBORILAYOTGANDA yozib chiqiladi. Quyidagi `hijack()` esa aynan shu
     * bosqichni chetlab o'tadi — natijada oqim javobida
     * `access-control-allow-origin` bo'lmay qoladi va brauzer javobni rad
     * etadi ("Failed to fetch"). Dev rejimida sahifa 5173, API 3001-portda,
     * ya'ni origin har doim boshqacha — bu yerda majburiy.
     */
    const passthrough: Record<string, string> = {};
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value === undefined) continue;
      const lower = name.toLowerCase();
      if (lower.startsWith('access-control-') || lower === 'vary') {
        passthrough[name] = String(value);
      }
    }

    /*
     * Fastify javobni o'zi yopmasin — biz xom oqimga yozamiz.
     * `X-Accel-Buffering` — proksi oraliq buferlashni o'chirish uchun;
     * aks holda bo'laklar to'planib, oxirida bir yo'la kelib tushadi.
     */
    reply.hijack();
    reply.raw.writeHead(200, {
      ...passthrough,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Foydalanuvchi oynani yopsa — OpenAI so'rovini ham to'xtatamiz.
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    /*
     * Asboblar KONTEKSTI.
     *
     * `requestId` ataylab `ai:` bilan boshlanadi — u tranzaksiyada
     * `app.request_id` ga tushadi va audit triggeri shu qiymatni yozadi.
     * Shu tufayli qaysi yozuv AI orqali kelgani keyinchalik aniqlanadi.
     */
    const tools: ToolContext = {
      ctx: { ...req.ctx, requestId: `ai:${req.id}` },
      user: req.user,
      feederId: snapshot?.feederId ?? null,
      period: snapshot?.period ?? new Date().toISOString().slice(0, 7),
      canWriteMfy: (mfyId) => app.assertMfyWrite(req, mfyId),
    };

    try {
      send('meta', { period: snapshot?.period ?? null, model: config.ai.model });

      for await (const ev of runAgent(parsed.data.messages, snapshot, tools, abort.signal)) {
        if (ev.type === 'delta') send('delta', { text: ev.text });
        else if (ev.type === 'tool') {
          send('tool', { name: ev.name, label: ev.label, status: ev.status, ok: ev.ok ?? true });
        } else {
          send('action', { type: ev.action.type, payload: ev.action.payload });
        }
      }
      send('done', {});
    } catch (err) {
      const message = err instanceof AiError
        ? err.message
        : err instanceof Error ? err.message : 'Noma’lum xato';
      req.log.error({ err }, 'AI chat xatosi');
      // Sarlavha allaqachon yuborilgan — xatoni ham oqim ichida beramiz.
      send('error', { message });
    } finally {
      reply.raw.end();
    }
  });
};

export default aiRoutes;
