/**
 * API klienti.
 *
 * DEMO REJIMI: token, sarlavha va sessiya yangilash YO'Q - tizim loginsiz
 * ishlaydi, shuning uchun so'rov oddiy `fetch` dan iborat.
 *
 * Manzil `.env` dagi `VITE_API_BASE` orqali beriladi:
 *   • bo'sh yoki `/api`  → nisbiy manzil, Vite proksi orqali (bir xil origin);
 *   • `http://192.168.1.132:3001/api` → to'g'ridan-to'g'ri API serveriga.
 *
 * Absolyut manzil berilganda ham sahifa QAYSI hostdan ochilgan bo'lsa, so'rov
 * o'sha hostga yuboriladi - faqat port va yo'l `.env` dan olinadi. Sabab: LAN
 * IP o'zgarishi mumkin. Tashqi tarmoq YO'Q - hammasi shu kompyuter/LAN ichida.
 */
import type { ApiError } from '@beap/shared';

/** `VITE_API_BASE` ni joriy sahifa hostiga moslab hal qiladi. */
function resolveBase(): string {
  const configured = String(import.meta.env.VITE_API_BASE ?? '').trim();

  // Berilmagan yoki nisbiy - o'zgarishsiz ishlatamiz (Vite proksi yo'li).
  if (!configured || configured.startsWith('/')) {
    return (configured || '/api').replace(/\/+$/, '');
  }

  try {
    const url = new URL(configured);
    // Brauzerda - hostni joriy sahifadan olamiz, port/yo'l sozlamadan qoladi.
    if (typeof window !== 'undefined' && window.location.hostname) {
      url.hostname = window.location.hostname;
      url.protocol = window.location.protocol;
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    // Noto'g'ri yozilgan manzil butun ilovani sindirmasin.
    return '/api';
  }
}

const BASE = resolveBase();

/** To'liq API manzilini quradi - `api.ts` tashqarisidagi `fetch` lar uchun. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  /** Maydonga bog'langan xatolar - HeroUI `<Form validationErrors>` uchun. */
  readonly fieldErrors: Record<string, string>;
  readonly requestId: string | undefined;

  constructor(status: number, body: Partial<ApiError>) {
    super(body.message ?? `So‘rov xatosi (${status})`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.error ?? 'unknown';
    this.fieldErrors = body.errors ?? {};
    this.requestId = body.requestId;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    let payload: Partial<ApiError> = {};
    try {
      payload = (await res.json()) as Partial<ApiError>;
    } catch {
      payload = { message: res.statusText };
    }
    throw new ApiRequestError(res.status, payload);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Fayl yuborish / olish - JSON emas.
 *
 * `apiFetch` tanani JSON qilib o'raydi, `FormData` va rasm oqimi esa xom
 * holida ketishi kerak.
 */
export async function apiFetchRaw(
  path: string,
  options: {
    method?: string;
    body?: BodyInit;
    /** Qo'shimcha sarlavhalar - SSE oqimi uchun `Accept`, JSON tana uchun `Content-Type`. */
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: { ...options.headers },
    ...(options.body ? { body: options.body } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!res.ok) {
    // Server sababni JSON da aytgan bo'lsa - o'shani ko'rsatamiz, "xato 503" emas.
    let payload: Partial<ApiError> = {};
    try {
      payload = (await res.json()) as Partial<ApiError>;
    } catch {
      payload = { message: `So‘rov xatosi (${res.status})` };
    }
    throw new ApiRequestError(res.status, payload);
  }
  return res;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    apiFetch<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    apiFetch<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string): Promise<T> => apiFetch<T>(path, { method: 'DELETE' }),
};

/** So'rov parametrlarini qurish - `undefined` qiymatlar tushib qoladi. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
