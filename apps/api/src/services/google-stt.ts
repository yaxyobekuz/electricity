/**
 * Google Cloud Speech-to-Text v2 (Chirp 2) - ovozli xabar transkripsiyasi.
 *
 * NEGA BU FAYL BOR: OpenAI'ning transkripsiya modellari (`whisper-1`,
 * `gpt-4o-transcribe`) `language: 'uz'`ni RAD ETADI (sinovda aniqlandi - uchala
 * model ham `400`), shuning uchun til faqat `prompt` orqali "tavsiya"
 * qilinardi - bu ishonchsiz (uzun promptlar hatto audio o'rniga PROMPTNING
 * O'ZINI qaytarib yuborardi). Google'ning v2 API'si esa `languageCodes`
 * maydonini ANIQ qabul qiladi - taxmin/hiyla shart emas.
 *
 * AUTENTIFIKATSIYA: v2 API oddiy API kalitni EMAS, OAuth2 bearer tokenni
 * talab qiladi. Google'ning rasmiy SDK'sini (`@google-cloud/speech`,
 * `google-auth-library`) ULAMAYMIZ - u gRPC/protobuf sudralib keladi va bu
 * loyihaning "faqat `fetch`" uslubiga (OpenAI, Telegram integratsiyalarida
 * ham xuddi shunday) mos emas. Buning o'rniga xizmat hisobi (service
 * account) JSON kalitidan RS256 bilan imzolangan JWT yasab, uni to'g'ridan-
 * to'g'ri Google'ning token endpointiga almashtiramiz - `jose` allaqachon
 * loyihada allaqachon bor, yangi bog'liqlik SHART EMAS.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { importPKCS8, SignJWT } from 'jose';

import { config, REPO_ROOT } from '../config.ts';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedAccount: ServiceAccount | null = null;

function loadServiceAccount(): ServiceAccount | null {
  if (cachedAccount) return cachedAccount;
  const file = config.googleStt.credentialsFile;
  if (!file) return null;
  const path = isAbsolute(file) ? file : resolve(REPO_ROOT, file);
  try {
    const raw = readFileSync(path, 'utf8');
    const json = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!json.client_email || !json.private_key) return null;
    cachedAccount = { client_email: json.client_email, private_key: json.private_key, token_uri: json.token_uri };
    return cachedAccount;
  } catch {
    return null;
  }
}

/** `/transcribe` yo'li shu bilan Google yo'liga o'tish-o'tmasligini hal qiladi. */
export function googleSttEnabled(): boolean {
  return Boolean(config.googleStt.projectId) && loadServiceAccount() !== null;
}

interface CachedToken {
  accessToken: string;
  /** Unix soniya - shu vaqtdan 5 daqiqa oldin yangilanadi. */
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/**
 * OAuth2 access tokenni oladi (keshlangan bo'lsa - keshdan).
 *
 * Google tokenlari odatda 1 soatga beriladi - har so'rovda yangisini
 * so'rash shart emas, 5 daqiqalik zaxira bilan qayta ishlatiladi.
 */
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 300 > now) return cachedToken.accessToken;

  const account = loadServiceAccount();
  if (!account) throw new Error('Google xizmat hisobi kaliti topilmadi');

  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
  const key = await importPKCS8(account.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google token olinmadi (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

/**
 * Ovoz baytlarini o'zbekcha (`uz-UZ`) matnga aylantiradi.
 *
 * `recognizers/_` - Google'ning "implicit recognizer" yo'li: alohida
 * Recognizer resursi oldindan yaratish shart emas, konfiguratsiya har bir
 * so'rovda to'g'ridan-to'g'ri beriladi. `autoDecodingConfig` audio
 * konteynerini (Telegram'ning OGG/OPUS'i ham) o'zi aniqlaydi - qo'lda
 * kodek ko'rsatish shart emas.
 */
export async function transcribeUzbek(audio: Buffer): Promise<string> {
  const token = await getAccessToken();
  const { projectId, region } = config.googleStt;
  const url = `https://${region}-speech.googleapis.com/v2/projects/${projectId}/locations/${region}/recognizers/_:recognize`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      config: {
        autoDecodingConfig: {},
        model: 'chirp_2',
        languageCodes: ['uz-UZ'],
        features: { enableAutomaticPunctuation: true },
      },
      content: audio.toString('base64'),
    }),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google STT xatosi (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json() as {
    results?: { alternatives?: { transcript?: string }[] }[];
  };

  return (data.results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? '')
    .filter(Boolean)
    .join(' ')
    .trim();
}
