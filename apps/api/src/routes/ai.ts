/**
 * AI yordamchi marshrutlari.
 *
 * `/chat` javobni SSE (server-sent events) oqimi bilan qaytaradi - chat
 * oynasida so'zlar yozilib borgani ko'rinadi. Oddiy JSON javob ham ishlardi,
 * lekin 10 soniyalik jimlik "tizim qotib qoldi" degan taassurot beradi.
 *
 * KIRISH: panelning qolgan qismi kabi login TALAB QILINMAYDI - mehmon ham
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
import { getCachedDigest } from '../services/alerts.ts';

const chatBody = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    /* 4000 belgidan uzun savol - bu savol emas, fayl. */
    content: z.string().min(1).max(4000),
  })).min(1).max(24),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const aiRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Yordamchi ishlaydimi - klient tugmani shunga qarab ko'rsatadi.
   *
   * Model nomi ham qaytadi: administrator qaysi model ulanganini panelning
   * o'zida ko'rishi kerak, `.env` ga qaramasdan.
   */
  app.get('/status', async () => ({
    enabled: aiEnabled(),
    model: aiEnabled() ? config.ai.model : null,
  }));

  /**
   * Kunlik ogohlantirish digest'i - `server.ts` dagi cron har kuni 08:00 da
   * hisoblab keshlaydi, bu yerda faqat o'qiladi (qayta hisoblanmaydi).
   * Server hali birinchi marta 08:00 ga yetmagan bo'lsa (masalan yangi
   * ishga tushgan) - `/status` dagi "enabled: false" uslubida
   * `available: false` qaytadi, xato emas.
   */
  app.get('/alerts', async () => {
    const digest = getCachedDigest();
    if (!digest) return { available: false };
    return { available: true, ...digest };
  });

  app.post('/chat', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!aiEnabled()) {
      return reply.code(503).send({
        error: 'ai_disabled',
        message: 'AI yordamchi sozlanmagan: .env faylida OPENAI_API_KEY berilishi kerak',
      });
    }

    /*
     * Bu marshrut `requireAuth` talab qilmaydi - mehmon ham chatlasha oladi.
     * Lekin `Authorization` sarlavhasi BERILGAN bo'lib, token yaroqsiz/eskirgan
     * bo'lsa (`plugins/auth.ts`ning `onRequest` ilgagi buni jimgina `req.user =
     * null` qilib qo'yadi - mehmon bilan farqlanmaydi), shu yerda 401
     * qaytariladi. Aks holda avval kirgan foydalanuvchi 15 daqiqadan keyin
     * "mehmon" sifatida davom etib, yozish asboblari doim "kirish huquqi yo'q"
     * deb qaytaraverardi - klient buni hech qachon tushunmas, chunki
     * `apiFetchRaw`dagi token-yangilash mexanizmi FAQAT 401 statusiga
     * ishlaydi. 401 qaytarilsa, klient tokenni yangilab qayta so'raydi.
     */
    if (req.headers.authorization && !req.user) {
      return reply.code(401).send({
        error: 'token_expired',
        message: 'Sessiya muddati tugagan. Qaytadan urinib ko‘ring.',
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
     * bosqichni chetlab o'tadi - natijada oqim javobida
     * `access-control-allow-origin` bo'lmay qoladi va brauzer javobni rad
     * etadi ("Failed to fetch"). Dev rejimida sahifa 5173, API 3001-portda,
     * ya'ni origin har doim boshqacha - bu yerda majburiy.
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
     * Fastify javobni o'zi yopmasin - biz xom oqimga yozamiz.
     * `X-Accel-Buffering` - proksi oraliq buferlashni o'chirish uchun;
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

    // Foydalanuvchi oynani yopsa - OpenAI so'rovini ham to'xtatamiz.
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    /*
     * Asboblar KONTEKSTI.
     *
     * `requestId` ataylab `ai:` bilan boshlanadi - u tranzaksiyada
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
      // Sarlavha allaqachon yuborilgan - xatoni ham oqim ichida beramiz.
      send('error', { message });
    } finally {
      reply.raw.end();
    }
  });

  /**
   * Ovozli xabarni matnga aylantirish.
   *
   * Telegram bot ovozli xabarlarni ogg/opus formatida shu yo'lga yuboradi -
   * bot o'zi OpenAI kalitini bilmaydi, faqat shu API'ga ko'prik. `chat/
   * completions` uchun ishlatiladigan `config.ai.model` bu yerga MOS
   * KELMAYDI (u - matn modeli), shuning uchun transkripsiya modeli qattiq
   * yozilgan.
   *
   * `gpt-4o-transcribe` ishlatiladi - eskiroq `whisper-1` EMAS. Sinovda
   * aniqlandi: `whisper-1` sokin/tushunarsiz audioda tasodifiy TILDA
   * gallyutsinatsiya qiladi (masalan turkcha "Altyazı M.K." kabi bema'ni
   * matn chiqargan), `gpt-4o-transcribe` esa xuddi shu holatda ham
   * `prompt`dagi tilga (o'zbekchaga) sodiq qoladi - OpenAI'ning eng aniq
   * transkripsiya modeli, xato darajasi va ko'p tillarni tushunishda
   * `whisper-1`dan sezilarli ustun.
   */
  app.post('/transcribe', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!aiEnabled()) {
      return reply.code(503).send({
        error: 'ai_disabled',
        message: 'AI yordamchi sozlanmagan: .env faylida OPENAI_API_KEY berilishi kerak',
      });
    }

    // `/chat` dagi bilan bir xil sabab - 401 klientning token-yangilash
    // mexanizmini ishga tushiradi, aks holda eskirgan token jimgina
    // mehmon rejimiga tushib qolardi.
    if (req.headers.authorization && !req.user) {
      return reply.code(401).send({
        error: 'token_expired',
        message: 'Sessiya muddati tugagan. Qaytadan urinib ko‘ring.',
      });
    }

    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: 'no_file', message: 'Ovozli fayl yuborilmadi' });
    }

    const buf = await file.toBuffer();

    /*
     * Node 24 ning o'rnatilgan FormData/Blob obyektlaridan foydalaniladi -
     * `telegram.ts`dagi `sendDocument` xuddi shu texnikani ishlatadi.
     * `Content-Type` sarlavhasini QO'LDA qo'ymaymiz: `fetch` FormData
     * tanasi uchun to'g'ri `boundary`ni o'zi qo'shadi, qo'lda yozilsa buziladi.
     */
    /*
     * `language` maydoni ATAYLAB berilmaydi: OpenAI'ning `whisper-1`i (va
     * yangiroq `gpt-4o-*-transcribe` modellari ham) faqat o'zi tan olgan
     * ISO-639-1 kodlar ro'yxatini qabul qiladi va "uz" o'sha ro'yxatda
     * YO'Q - berilsa `400 unsupported_language`/`invalid_value` bilan butun
     * so'rov qulaydi (sinovda aniqlandi, uchala model ham rad etadi).
     *
     * Buning o'rniga til `prompt` orqali "majburlanadi": OpenAI'ning o'zi
     * xato xabarida aynan shuni maslahat beradi - "Try adding the language
     * name to your prompt". `prompt` - modelga transkripsiya USLUBI va
     * lug'atini ko'rsatuvchi namuna matn; shu yerda o'zbekcha so'z va tizim
     * atamalari bilan boshlansa, Whisper talaffuzi yaqin tillarga (rus,
     * qozoq) chalg'imasdan, aynan o'zbekcha (lotin yozuvida) transkripsiya
     * qiladi. Bu hech qachon 400 bermaydi - eng yomon holatda shunchaki
     * e'tiborga olinmaydi.
     */
    const UZBEK_TRANSCRIBE_PROMPT =
      "Quyidagi audio o'zbek tilida, lotin yozuvida yozib olinadi. Mavzu - "
      + "elektr energiyasi, transformator, fider, mahalla, yo'qotish foizi, "
      + 'hisobot va ish holati: "Assalomu alaykum, TP-067 dagi yo\'qotish darajasi '
      + 'qancha, qaysi mahallada ish rejalashtirilgan?"';

    const form = new FormData();
    form.append('file', new Blob([buf], { type: file.mimetype || 'audio/ogg' }), 'voice.ogg');
    form.append('model', 'gpt-4o-transcribe');
    form.append('prompt', UZBEK_TRANSCRIBE_PROMPT);

    let res: Response;
    try {
      res = await fetch(`${config.ai.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.ai.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(config.ai.timeoutMs),
      });
    } catch (err) {
      // Tarmoq yo'q / DNS ishlamayapti - offline muhitda odatiy hol.
      return reply.code(502).send({
        error: 'ai_upstream',
        message: `AI xizmatiga ulanib bo‘lmadi: ${err instanceof Error ? err.message : 'noma’lum xato'}`,
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return reply.code(502).send({
        error: 'ai_upstream',
        message: `AI xizmati xatosi (${res.status}): ${detail.slice(0, 300) || res.statusText}`,
      });
    }

    const data = await res.json() as { text?: string };
    return reply.send({ text: data.text ?? '' });
  });
};

export default aiRoutes;
