/**
 * `POST /api/ai/chat` (SSE) ning Node-tomonlik klienti.
 *
 * `apps/web/src/lib/ai.ts` dagi `streamAiChat()` ni Telegram uchun qayta
 * yozgan nusxasi - protokol (so'rov tanasi, hodisa nomlari/tanalari)
 * AYNAN o'sha: `{ messages: [{role, content}], period? }` yuboriladi,
 * `event: delta|tool|action|error` o'qiladi (`apps/api/src/routes/ai.ts`).
 * Bu yerda `period` UMUMAN yuborilmaydi - veb klient ham bermasa server
 * joriy davrni o'zi tanlaydi (`buildSnapshot`), bot ham shu standartga
 * tayanadi.
 *
 * `tool` va `meta` hodisalari ATAYLAB e'tiborsiz qoldiriladi: Telegramda
 * "asbob ishlamoqda" ko'rsatkichi ortiqcha murakkablik, oddiy "..." bilan
 * boshlangan xabar yetarli (`index.ts` ga qarang).
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** `ai-tools.ts` dagi `ClientAction` bilan bir xil shakl - bot faqat `download` ni tushunadi. */
export interface ChatAction {
  type: string;
  payload: Record<string, unknown>;
}

export interface ChatStreamHandlers {
  /** Har bir yangi bo'lak - javob matniga qo'shiladi. */
  onDelta: (text: string) => void;
  /** Agent brauzerdan amal so'radi (navigate/set_period/download/...). */
  onAction?: (action: ChatAction) => void;
  /** Server xatoni oqim ichida yuboradi (sarlavha allaqachon ketgan) yoki tarmoq yiqilgan. */
  onError?: (message: string) => void;
}

/**
 * Suhbatni yuboradi va javobni bo'lak-bo'lak qaytaradi.
 *
 * Node 24 ning o'rnatilgan `fetch`/`ReadableStream` bilan ishlaydi - qo'shimcha
 * HTTP klient kutubxonasi shart emas (`apps/api/src/services/ai.ts` OpenAI
 * oqimini xuddi shu usulda o'qiydi).
 */
export async function streamChat(
  apiBaseUrl: string,
  messages: ChatMessage[],
  handlers: ChatStreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages }),
    });
  } catch (err) {
    // Tarmoq yo'q / API ishlamayapti.
    handlers.onError?.(`API ga ulanib bo‘lmadi: ${err instanceof Error ? err.message : 'noma’lum xato'}`);
    return;
  }

  if (!res.ok || !res.body) {
    let message = `So‘rov xatosi (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* JSON emas - standart xabar bilan qolamiz */
    }
    handlers.onError?.(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE bo'laklari bo'sh qator bilan ajratiladi.
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');

      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;

        if (event === 'delta' && typeof parsed['text'] === 'string') {
          handlers.onDelta(parsed['text']);
        } else if (event === 'action') {
          handlers.onAction?.({
            type: String(parsed['type'] ?? ''),
            payload: (parsed['payload'] ?? {}) as Record<string, unknown>,
          });
        } else if (event === 'error') {
          handlers.onError?.(String(parsed['message'] ?? 'Noma’lum xato'));
        }
        // 'meta', 'tool', 'done' - bu klientga kerak emas, jimgina o'tkazib yuboriladi.
      } catch {
        /* buzilgan bo'lak - tashlab ketamiz */
      }
    }
  }
}
