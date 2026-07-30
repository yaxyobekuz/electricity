/**
 * API klienti.
 *
 * Barcha so'rovlar NISBIY manzilga ketadi (`/api/...`) — bir xil origin.
 * Tashqi host YO'Q. CSP `connect-src 'self'` buni majburlaydi.
 */
import type { ApiError } from '@beap/shared';

const BASE = '/api';

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
        credentials: 'same-origin',
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
      credentials: 'same-origin',
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
