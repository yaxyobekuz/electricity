/** `VITE_API_BASE` ni joriy sahifa hostiga moslab hal qiladi. */
function resolveBase() {
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
    }
    catch {
        // Noto'g'ri yozilgan manzil butun ilovani sindirmasin.
        return '/api';
    }
}
const BASE = resolveBase();
/** To'liq API manzilini quradi — `api.ts` tashqarisidagi `fetch` lar uchun. */
export function apiUrl(path) {
    return `${BASE}${path}`;
}
let accessToken = null;
let onUnauthorized = null;
export function setAccessToken(token) {
    accessToken = token;
}
export function getAccessToken() {
    return accessToken;
}
export function setUnauthorizedHandler(fn) {
    onUnauthorized = fn;
}
export class ApiRequestError extends Error {
    status;
    code;
    /** Maydonga bog'langan xatolar — HeroUI `<Form validationErrors>` uchun. */
    fieldErrors;
    requestId;
    constructor(status, body) {
        super(body.message ?? `So‘rov xatosi (${status})`);
        this.name = 'ApiRequestError';
        this.status = status;
        this.code = body.error ?? 'unknown';
        this.fieldErrors = body.errors ?? {};
        this.requestId = body.requestId;
    }
}
let refreshInFlight = null;
async function refreshAccessToken() {
    refreshInFlight ??= (async () => {
        try {
            const res = await fetch(`${BASE}/auth/refresh`, {
                method: 'POST',
                // API boshqa portda bo'lishi mumkin — cookie baribir yuborilsin.
                credentials: 'include',
            });
            if (!res.ok)
                return false;
            const data = (await res.json());
            accessToken = data.accessToken;
            return true;
        }
        catch {
            return false;
        }
        finally {
            // Keyingi 401 uchun yangi urinishga ruxsat beramiz.
            setTimeout(() => {
                refreshInFlight = null;
            }, 0);
        }
    })();
    return refreshInFlight;
}
export async function apiFetch(path, options = {}) {
    const { method = 'GET', body, signal, skipRefresh = false } = options;
    const doFetch = async () => {
        const headers = { Accept: 'application/json' };
        if (body !== undefined)
            headers['Content-Type'] = 'application/json';
        if (accessToken)
            headers['Authorization'] = `Bearer ${accessToken}`;
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
        }
        else {
            accessToken = null;
            onUnauthorized?.();
        }
    }
    if (!res.ok) {
        let payload = {};
        try {
            payload = (await res.json());
        }
        catch {
            payload = { message: res.statusText };
        }
        throw new ApiRequestError(res.status, payload);
    }
    if (res.status === 204)
        return undefined;
    return (await res.json());
}
export const api = {
    get: (path, signal) => apiFetch(path, signal ? { signal } : {}),
    post: (path, body) => apiFetch(path, { method: 'POST', body }),
    patch: (path, body) => apiFetch(path, { method: 'PATCH', body }),
    delete: (path) => apiFetch(path, { method: 'DELETE' }),
};
/** So'rov parametrlarini qurish — `undefined` qiymatlar tushib qoladi. */
export function qs(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '')
            sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
}
