/**
 * API klienti.
 *
 * Manzil `.env` dagi `VITE_API_BASE` orqali beriladi:
 *   • bo'sh yoki `/api`  → nisbiy manzil, Vite proksi orqali (bir xil origin);
 *   • `http://192.168.1.132:3001/api` → to'g'ridan-to'g'ri API serveriga.
 *
 * Absolyut manzil berilganda ham sahifa QAYSI hostdan ochilgan bo'lsa, so'rov
 * o'sha hostga yuboriladi — faqat port va yo'l `.env` dan olinadi. Sabab:
 * LAN IP o'zgarishi mumkin, hamda `localhost:5173` dan ochilganda so'rov
 * `localhost:3001` ga ketsa, refresh cookie (SameSite=Strict) yo'qolmaydi.
 * Tashqi tarmoq YO'Q — hammasi shu kompyuter/LAN ichida.
 */
import type { ApiError } from '@beap/shared';

/** `VITE_API_BASE` ni joriy sahifa hostiga moslab hal qiladi. */
function resolveBase(): string {
  const configured = String(import.meta.env.VITE_API_BASE ?? '').trim();

  // Berilmagan yoki nisbiy — o'zgarishsiz ishlatamiz (Vite proksi yo'li).
  if (!configured || configured.startsWith('/')) {
    return (configured || '/api').replace(/\/+$/, '');
  }

  try {
    const url = new URL(configured);
    // Brauzerda — hostni joriy sahifadan olamiz, port/yo'l sozlamadan qoladi.
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

/** To'liq API manzilini quradi — `api.ts` tashqarisidagi `fetch` lar uchun. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  /** Maydonga bog'langan xatolar — HeroUI `<Form validationErrors>` uchun. */
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
  /** 401 da tokenni yangilashga urinmaslik (refresh/login uchun). */
  skipRefresh?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        // API boshqa portda bo'lishi mumkin — cookie baribir yuborilsin.
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Keyingi 401 uchun yangi urinishga ruxsat beramiz.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, skipRefresh = false } = options;

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    return fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  };

  let res = await doFetch();

  // Access token muddati tugagan bo'lsa — bir marta yangilab ko'ramiz.
  if (res.status === 401 && !skipRefresh) {
    const ok = await refreshAccessToken();
    if (ok) {
      res = await doFetch();
    } else {
      accessToken = null;
      onUnauthorized?.();
    }
  }

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
 * Fayl yuborish / olish — JSON emas.
 *
 * `apiFetch` tanani JSON qilib o'raydi, `FormData` va rasm oqimi esa xom
 * holida ketishi kerak. Token va `credentials` bir xil qoidada qoladi.
 */
export async function apiFetchRaw(path: string, options: { method?: string; body?: BodyInit } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    ...(options.body ? { body: options.body } : {}),
  });

  if (res.status === 401 && (await refreshAccessToken())) {
    const retry: Record<string, string> = {};
    if (accessToken) retry['Authorization'] = `Bearer ${accessToken}`;
    res = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: retry,
      credentials: 'include',
      ...(options.body ? { body: options.body } : {}),
    });
  }

  if (!res.ok) throw new ApiRequestError(res.status, { message: `Fayl so‘rovi xatosi (${res.status})` });
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

/** So'rov parametrlarini qurish — `undefined` qiymatlar tushib qoladi. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
