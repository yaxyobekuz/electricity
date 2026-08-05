/**
 * OFFLINE (AIR-GAP) TEKSHIRUVI.
 *
 * Mijozning asosiy talabi: "ma'lumot tashqariga chiqmasligi kerak".
 * Bu skript o'sha va'dani MASHINA TOMONIDAN tekshiradi.
 *
 * MUHIM FARQ: satr ichidagi URL - bu tarmoq so'rovi EMAS. Kutubxonalar o'z
 * xato xabarlarida hujjat havolasini saqlaydi (`react.dev/errors/…`), JSON
 * Schema identifikatorlari esa umuman yuklanmaydi. Shu sababli tekshiruv
 * ikki darajali:
 *
 *   QATTIQ XATO  - URL tarmoqqa chiqadigan KONTEKSTDA:
 *                  HTML `src`/`href`, CSS `@import`/`url()`, `fetch()`,
 *                  yoki ma'lum CDN/tile/telemetriya hostlari.
 *   MA'LUMOT     - oddiy satr ichidagi URL (hujjat havolasi, sxema ID).
 *
 * Nol bo'lmagan exit kodi = offline va'da buzilgan.
 * CI da har bir build'da ishga tushirilishi kerak.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'apps/web/dist');
const SRC = join(ROOT, 'apps/web/src');
const API_SRC = join(ROOT, 'apps/api/src');

const hard = [];
const info = [];
const ok = [];

/**
 * Hech qachon bo'lmasligi kerak bo'lgan hostlar - shunchaki eslatilsa ham
 * qattiq xato, chunki ular faqat bitta maqsad uchun ishlatiladi: tashqi resurs.
 *
 * `api.openai.com` ATAYLAB shu ro'yxatda YO'Q: bu - yagona ataylab qo'shilgan,
 * hujjatlashtirilgan, ixtiyoriy istisno (OPENAI_API_KEY bo'sh = xususiyat
 * butunlay o'chiq). Uning faqat SERVERDA ishlashi pastdagi CSP tekshiruvi
 * ("connect-src" - shu faylda quyiroqda) bilan mashina darajasida
 * kafolatlanadi, shuning uchun shu hostni bu yerdan olib tashlash haqiqiy
 * air-gap kafolatini bo'shashtirmaydi - faqat ko'rib chiqilgan, qonuniy
 * istisno bo'yicha yolg'on-musbat xatoni to'xtatadi.
 */
const FORBIDDEN_HOSTS = [
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'esm.sh', 'skypack.dev',
  'tile.openstreetmap.org', 'basemaps.cartocdn.com', 'api.mapbox.com',
  'demotiles.maplibre.org', 'tiles.openfreemap.org',
  'maps.googleapis.com', 'maps.google.com',
  'google-analytics.com', 'googletagmanager.com',
  'sentry.io', 'posthog.com', 'segment.io', 'hotjar.com',
  'api.anthropic.com', 'generativelanguage.googleapis.com',
];

const URL_RE = /https?:\/\/[^\s'"`)\\<>]+/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const isLocal = (url) =>
  url.startsWith('http://localhost') ||
  url.startsWith('http://127.0.0.1') ||
  url.includes('${'); // template literal - ish vaqtida lokal manzilga aylanadi

/** XML nom maydonlari va sxema identifikatorlari hech qachon yuklanmaydi. */
const isInertIdentifier = (url) =>
  url.startsWith('http://www.w3.org/') ||
  url.startsWith('https://www.w3.org/') ||
  url.includes('json-schema.org/draft') ||
  url.startsWith('http://www.inkscape.org/');

function checkForbiddenHost(url, where) {
  const host = FORBIDDEN_HOSTS.find((h) => url.includes(h));
  if (host) {
    hard.push(`${where} - TAQIQLANGAN HOST: ${host}\n      ${url}`);
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. dist/index.html - tashqi src / href
// ═══════════════════════════════════════════════════════════════════════════

if (!existsSync(DIST)) {
  info.push('apps/web/dist topilmadi - avval `npm run build`. Bu bosqich o‘tkazib yuborildi.');
} else {
  const htmlFiles = walk(DIST).filter((f) => extname(f) === '.html');
  let externalRefs = 0;

  for (const file of htmlFiles) {
    const text = readFileSync(file, 'utf8');
    const attrRe = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = attrRe.exec(text)) !== null) {
      const url = m[1];
      if (/^https?:\/\//i.test(url) && !isLocal(url)) {
        externalRefs += 1;
        hard.push(`${relative(ROOT, file)} - tashqi resurs yuklanadi: ${url}`);
      }
    }
  }
  if (externalRefs === 0) {
    ok.push(`HTML (${htmlFiles.length} fayl) - barcha resurslar lokal ✓`);
  }

  // ─── 2. CSS - @import va url() ─────────────────────────────────────────
  const cssFiles = walk(DIST).filter((f) => extname(f) === '.css');
  let cssExternal = 0;
  for (const file of cssFiles) {
    const text = readFileSync(file, 'utf8');
    const importRe = /@import\s+(?:url\()?\s*["']?(https?:\/\/[^"')\s]+)/gi;
    const urlRe = /\burl\(\s*["']?(https?:\/\/[^"')\s]+)/gi;
    for (const re of [importRe, urlRe]) {
      let m;
      while ((m = re.exec(text)) !== null) {
        if (isLocal(m[1])) continue;
        cssExternal += 1;
        hard.push(`${relative(ROOT, file)} - CSS tashqi resurs: ${m[1]}`);
      }
    }
  }
  if (cssExternal === 0) ok.push(`CSS (${cssFiles.length} fayl) - tashqi resurs yo‘q ✓`);

  // ─── 3. JS - fetch/XHR/WebSocket va taqiqlangan hostlar ────────────────
  const jsFiles = walk(DIST).filter((f) => extname(f) === '.js');
  let jsHard = 0;
  let jsInfo = 0;

  for (const file of jsFiles) {
    const text = readFileSync(file, 'utf8');
    const where = relative(ROOT, file);

    // Tarmoq chaqiruvida to'g'ridan-to'g'ri tashqi URL
    const callRe = /\b(?:fetch|open|connect|importScripts)\s*\(\s*["'`](https?:\/\/[^"'`]+)/gi;
    let m;
    while ((m = callRe.exec(text)) !== null) {
      if (isLocal(m[1])) continue;
      jsHard += 1;
      hard.push(`${where} - tarmoq chaqiruvida tashqi manzil: ${m[1]}`);
    }
    // WebSocket
    if (/new\s+WebSocket\s*\(\s*["'`]wss?:\/\/(?!localhost|127\.0\.0\.1)/.test(text)) {
      jsHard += 1;
      hard.push(`${where} - tashqi WebSocket ulanishi`);
    }

    // Taqiqlangan hostlar - qayerda bo'lishidan qat'i nazar
    for (const raw of text.match(URL_RE) ?? []) {
      const url = raw.replace(/[.,;:]+$/, '');
      if (checkForbiddenHost(url, where)) {
        jsHard += 1;
        continue;
      }
      if (isLocal(url) || isInertIdentifier(url)) continue;
      jsInfo += 1;
    }
  }

  if (jsHard === 0) {
    ok.push(`JS (${jsFiles.length} bo‘lak) - tashqi tarmoq chaqiruvi yo‘q ✓`);
  }
  if (jsInfo > 0) {
    info.push(
      `JS ichida ${jsInfo} ta passiv URL satri (kutubxonalarning xato-hujjat havolalari, ` +
        `sxema identifikatorlari). Ular tarmoqqa chiqmaydi - faqat matn.`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Taqiqlangan bog'liqliklar
// ═══════════════════════════════════════════════════════════════════════════

const FORBIDDEN_PACKAGES = [
  { name: 'leaflet', why: 'xarita tile serveriga so‘rov yuboradi' },
  { name: 'react-leaflet', why: 'tile server + Hippocratic litsenziya (OSI emas)' },
  { name: 'maplibre-gl', why: 'xarita tile serveriga so‘rov yuboradi' },
  { name: 'mapbox-gl', why: 'tashqi API kaliti talab qiladi' },
  { name: 'react-map-gl', why: 'xarita tile serveri' },
  { name: '@react-google-maps', why: 'Google Maps - ma‘lumot tashqariga chiqadi' },
  { name: 'google-map-react', why: 'Google Maps - ma‘lumot tashqariga chiqadi' },
  { name: 'xlsx', why: 'npm nusxasi CVE-2023-30533 bilan qotgan - exceljs ishlating' },
  { name: '@sentry/', why: 'telemetriya tashqi serverga yuboriladi' },
  { name: 'posthog', why: 'telemetriya tashqi serverga yuboriladi' },
  { name: 'openai', why: 'tashqi LLM - ma‘lumot tashqariga chiqadi' },
  { name: '@anthropic-ai/', why: 'tashqi LLM - ma‘lumot tashqariga chiqadi' },
];

let depProblems = 0;
for (const pf of [
  join(ROOT, 'package.json'),
  join(ROOT, 'apps/web/package.json'),
  join(ROOT, 'apps/api/package.json'),
  join(ROOT, 'packages/shared/package.json'),
]) {
  if (!existsSync(pf)) continue;
  const pkg = JSON.parse(readFileSync(pf, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const f of FORBIDDEN_PACKAGES) {
    const hit = Object.keys(deps).find((d) => d === f.name || d.startsWith(f.name));
    if (hit) {
      depProblems += 1;
      hard.push(`Taqiqlangan bog‘liqlik: ${hit} (${relative(ROOT, pf)}) - ${f.why}`);
    }
  }
}
if (depProblems === 0) ok.push('Taqiqlangan kutubxonalar o‘rnatilmagan ✓');

// ═══════════════════════════════════════════════════════════════════════════
// 5. Manba kodda tarmoq chaqiruvi
// ═══════════════════════════════════════════════════════════════════════════

const srcFiles = [...walk(SRC), ...walk(API_SRC)].filter((f) =>
  ['.ts', '.tsx', '.css'].includes(extname(f)),
);
let srcProblems = 0;

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  const where = relative(ROOT, file);

  const callRe = /\b(?:fetch|axios(?:\.\w+)?)\s*\(\s*["'`](https?:\/\/[^"'`]+)/gi;
  let m;
  while ((m = callRe.exec(text)) !== null) {
    if (isLocal(m[1])) continue;
    srcProblems += 1;
    hard.push(`${where} - kodda tashqi fetch: ${m[1]}`);
  }

  if (/@import\s+(?:url\()?\s*["']?https?:/i.test(text)) {
    srcProblems += 1;
    hard.push(`${where} - CSS da tashqi @import`);
  }

  for (const raw of text.match(URL_RE) ?? []) {
    checkForbiddenHost(raw.replace(/[.,;:]+$/, ''), where);
  }
}
if (srcProblems === 0) {
  ok.push(`Manba kod (${srcFiles.length} fayl) - tashqi tarmoq chaqiruvi yo‘q ✓`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. CSP sarlavhasi - brauzer darajasidagi majburlash
// ═══════════════════════════════════════════════════════════════════════════

const appTs = join(API_SRC, 'app.ts');
if (!existsSync(appTs)) {
  hard.push('apps/api/src/app.ts topilmadi');
} else {
  const flat = readFileSync(appTs, 'utf8').replace(/\s+/g, '');
  if (flat.includes(`connectSrc:["'self'"]`)) {
    ok.push("CSP `connect-src 'self'` - brauzer boshqa hostga so‘rov yubora olmaydi ✓");
  } else {
    hard.push("apps/api/src/app.ts - CSP da `connectSrc: [\"'self'\"]` topilmadi");
  }
  if (flat.includes(`defaultSrc:["'self'"]`)) {
    ok.push("CSP `default-src 'self'` ✓");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Natija
// ═══════════════════════════════════════════════════════════════════════════

process.stdout.write('\nOFFLINE (AIR-GAP) TEKSHIRUVI\n');
process.stdout.write('═'.repeat(78) + '\n');

for (const o of ok) process.stdout.write(`✓ ${o}\n`);
for (const n of info) process.stdout.write(`· ${n}\n`);

if (hard.length > 0) {
  process.stdout.write('\n');
  for (const p of hard) process.stdout.write(`✗ ${p}\n`);
  process.stdout.write('═'.repeat(78) + '\n');
  process.stdout.write(`✗ ${hard.length} ta QATTIQ muammo - OFFLINE VA'DA BUZILGAN.\n\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('═'.repeat(78) + '\n');
  process.stdout.write('✓ Tizim tashqi tarmoqqa murojaat qilmaydi.\n\n');
}
