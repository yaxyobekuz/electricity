/**
 * AI yordamchi klienti.
 *
 * Javob SSE oqimi bilan keladi: server har bir bo'lakni `event: delta`
 * ko'rinishida yuboradi, biz esa uni chat oynasiga darhol qo'shamiz.
 * Shuning uchun bu yerda TanStack Query emas, oddiy `fetch` ishlatiladi —
 * Query kesh uchun, oqim uchun emas.
 */
import { apiFetchRaw } from './api.ts';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiStatus {
  enabled: boolean;
  model: string | null;
}

export async function fetchAiStatus(signal?: AbortSignal): Promise<AiStatus> {
  const res = await apiFetchRaw('/ai/status', signal ? { signal } : {});
  return (await res.json()) as AiStatus;
}

/** Agent bajarayotgan amal — chatda ko'rsatiladi. */
export interface AiToolEvent {
  name: string;
  label: string;
  status: 'running' | 'done';
  ok: boolean;
}

/**
 * Brauzerda bajariladigan amal.
 *
 * Server bularni O'ZI bajara olmaydi (sahifa ochish, davrni almashtirish,
 * fayl saqlash brauzerda bo'ladi), shuning uchun ularni oqim orqali
 * buyruq sifatida yuboradi.
 */
export interface AiAction {
  type: 'navigate' | 'set_period' | 'set_as_of_date' | 'download';
  payload: Record<string, unknown>;
}

export interface StreamHandlers {
  /** Har bir yangi bo'lak — javob matniga qo'shiladi. */
  onDelta: (text: string) => void;
  /** Agent asbob ishlatdi — "🔧 Hisobot tayyorlanmoqda…" ko'rsatish uchun. */
  onTool?: (event: AiToolEvent) => void;
  /** Agent brauzerdan amal so'radi. */
  onAction?: (action: AiAction) => void;
  /** Server xatoni oqim ichida yuboradi (sarlavha allaqachon ketgan). */
  onError?: (message: string) => void;
}

/**
 * Suhbatni yuboradi va javobni bo'lak-bo'lak qaytaradi.
 *
 * `signal` — foydalanuvchi "to'xtat" bosgani yoki panelni yopgani uchun:
 * shunda server ham OpenAI so'rovini bekor qiladi va token behuda ketmaydi.
 */
export async function streamAiChat(
  messages: AiMessage[],
  opts: StreamHandlers & { period?: string | null; signal?: AbortSignal },
): Promise<void> {
  const res = await apiFetchRaw('/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      messages,
      ...(opts.period ? { period: opts.period } : {}),
    }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (!res.body) throw new Error('Javob oqimi bo‘sh');

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
          opts.onDelta(parsed['text']);
        } else if (event === 'tool') {
          opts.onTool?.({
            name: String(parsed['name'] ?? ''),
            label: String(parsed['label'] ?? ''),
            status: parsed['status'] === 'done' ? 'done' : 'running',
            ok: parsed['ok'] !== false,
          });
        } else if (event === 'action') {
          opts.onAction?.({
            type: parsed['type'] as AiAction['type'],
            payload: (parsed['payload'] ?? {}) as Record<string, unknown>,
          });
        } else if (event === 'error') {
          opts.onError?.(String(parsed['message'] ?? 'Noma’lum xato'));
        }
      } catch {
        /* buzilgan bo'lak — tashlab ketamiz */
      }
    }
  }
}
