/**
 * «JONLI OQIM» bandi — dashboard tepasidagi asosiy ko'rgazma elementi.
 *
 * NIMA UCHUN BOR: KPI kartalari raqamni aytadi, lekin tarmoq HARAKATDA
 * ekanini ko'rsatmaydi. Bu band bir qarashda uchta narsani beradi —
 * energiya kirdi, qancha sotildi, qancha yo'qoldi — va buni tinim bilmas
 * puls chizig'i bilan "tirik" qilib turadi.
 *
 * TUZILISHI:
 *   fon      │ aurora dog'lari + panjara + o'tuvchi yorug'lik (uchalasi ham CSS)
 *   chapda   │ JONLI belgisi + tarmoqqa kirgan energiya (sanalib chiqadi)
 *   o'rtada  │ tarmoq pulsi (uzluksiz suriladigan EKG chizig'i) + oqim chiplari
 *   o'ngda   │ samaradorlik halqasi (0 dan qiymatgacha to'ladi)
 *   pastda   │ aylanuvchi xulosa qatori — har 4 soniyada yangisi ko'tariladi
 *
 * HAMMASI CSS BILAN: `requestAnimationFrame` sikli yo'q, faqat aylanuvchi
 * xulosa uchun bitta taymer. `prefers-reduced-motion` da `globals.css`
 * dagi umumiy qoida barcha harakatni o'chiradi.
 */
import { energyParts, pct } from '@beap/shared';
import { ArrowRight, Sparkles, TrendingDown } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CountUp } from './CountUp.tsx';

/**
 * Pulsning bitta bo'g'ini — kengligi AYNAN 120px.
 *
 * Uzluksiz surilish shu son bilan bog'liq: chiziq chapga to'liq bitta
 * bo'g'in surilganda ko'rinish o'zgarmaydi, ya'ni ulanish joyi sezilmaydi.
 * Bo'g'in kengligini o'zgartirsangiz, `beap-ekg` keyframe'ini ham
 * o'zgartirish kerak.
 */
const EKG_SEGMENT = 'M0,34 H28 l7,-19 l8,34 l7,-27 l6,12 H80 l6,-9 l6,18 l6,-9 H120';
const EKG_COPIES = 6;

/** Uchqunlar — joylashuv qo'lda tanlangan, tasodifiy emas (har renderda bir xil). */
const SPARKS = [
  { left: '14%', top: '22%', delay: '0s', size: 3 },
  { left: '31%', top: '68%', delay: '1.6s', size: 2 },
  { left: '52%', top: '18%', delay: '3.1s', size: 2 },
  { left: '67%', top: '74%', delay: '0.8s', size: 3 },
  { left: '81%', top: '34%', delay: '2.4s', size: 2 },
  { left: '93%', top: '62%', delay: '4.2s', size: 3 },
];

interface PulseHeroProps {
  /** Tarmoqqa kirgan energiya, kWh. */
  kwhIn: number;
  /** Sotilgan energiya, kWh. */
  kwhSold: number;
  /** Yo'qotilgan energiya, kWh. */
  kwhLoss: number;
  /** Yo'qotish ulushi, %. */
  lossPct: number;
  /** Energiya samaradorlik indeksi (0–100). Hisoblanmagan bo'lsa — `null`. */
  score: number | null;
  /** Aylanib turadigan qisqa xulosalar. */
  notes: string[];
}

export function PulseHero({ kwhIn, kwhSold, kwhLoss, lossPct, score, notes }: PulseHeroProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (notes.length < 2) return;
    const id = setInterval(() => setTick((n) => n + 1), 4200);
    return () => clearInterval(id);
  }, [notes.length]);

  const inParts = energyParts(kwhIn);
  const soldParts = energyParts(kwhSold);
  const lossParts = energyParts(kwhLoss);
  const note = notes.length > 0 ? notes[tick % notes.length] : null;

  return (
    <section aria-label="Tarmoq oqimi" className="hero mb-3">
      <span aria-hidden="true" className="hero__aurora" />
      <span aria-hidden="true" className="hero__grid" />
      <span aria-hidden="true" className="hero__sweep" />
      {SPARKS.map((s) => (
        <span
          key={s.left}
          aria-hidden="true"
          className="hero__spark"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animationDelay: s.delay,
          }}
        />
      ))}

      <div className="relative flex flex-wrap items-center gap-x-7 gap-y-4">
        {/* ── Chap: jonli belgi + kirim ── */}
        <div className="min-w-45 shrink-0">
          <span className="hero__live">
            <span aria-hidden="true" className="hero__live-dot" />
            JONLI
          </span>
          <p className="hero__cap">Tarmoqqa kirgan energiya</p>
          <p className="hero__big">
            <CountUp format={(v) => energyParts(v).value} value={kwhIn} />
            <span className="hero__big-unit">{inParts.unit}</span>
          </p>
        </div>

        {/* ── O'rta: puls chizig'i + oqim ── */}
        <div className="min-w-60 flex-1">
          <EkgLine />

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <FlowChip color="#4ade80" label="sotilgan" value={`${soldParts.value} ${soldParts.unit}`} />
            <ArrowRight aria-hidden="true" className="hero__arrow" />
            <FlowChip color="#fb7185" label="yo‘qotish" value={`${lossParts.value} ${lossParts.unit}`} />
            <span className="hero__loss">
              <TrendingDown aria-hidden="true" className="size-3.5" />
              {pct(lossPct, 2)}
            </span>
          </div>
        </div>

        {/* ── O'ng: samaradorlik halqasi ── */}
        {score !== null && <ScoreRing score={score} />}
      </div>

      {note && (
        <p className="hero__ticker">
          <Sparkles aria-hidden="true" className="size-3.5 shrink-0 opacity-80" />
          {/*
            `key` — matn o'zgarganda React tugunni ALMASHTIRADI, shu sababli
            CSS animatsiyasi qaytadan boshlanadi. `key` siz matn jimgina
            almashib, ko'tarilish effekti yo'qoladi.
          */}
          <span key={tick} className="hero__ticker-item">
            {note}
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * Tarmoq pulsi — uzluksiz chapga suriladigan EKG chizig'i.
 *
 * Bir xil bo'g'in bir necha marta chizilib, guruh bitta bo'g'in kengligiga
 * suriladi va takrorlanadi: chekkasi ko'rinmaydigan cheksiz lenta hosil bo'ladi.
 */
function EkgLine() {
  return (
    <svg
      aria-hidden="true"
      className="hero__ekg"
      preserveAspectRatio="none"
      viewBox="0 0 600 56"
    >
      <defs>
        <linearGradient id="hero-ekg" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="55%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#f0abfc" />
        </linearGradient>
      </defs>

      <g className="hero__ekg-track">
        {Array.from({ length: EKG_COPIES }, (_, i) => {
          /*
           * `vectorEffect` — `preserveAspectRatio="none"` kenglikni cho'zadi
           * va u bilan birga chiziq QALINLIGI ham cho'zilib, notekis
           * ko'rinardi. Bu atribut qalinlikni ekran piksellarida ushlaydi.
           */
          return (
            <path
              key={i}
              d={EKG_SEGMENT}
              fill="none"
              stroke="url(#hero-ekg)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.2}
              transform={`translate(${i * 120} 0)`}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>
    </svg>
  );
}

/** Oqim chipi — rangli nuqta + yorliq + qiymat. */
function FlowChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="hero__chip">
      <span aria-hidden="true" className="hero__chip-dot" style={{ background: color }} />
      <span className="hero__chip-value">{value}</span>
      <span className="hero__chip-label">{label}</span>
    </span>
  );
}

/**
 * Samaradorlik halqasi.
 *
 * To'lish `--deg` o'zgaruvchisi orqali: u `@property` bilan BURCHAK deb
 * ro'yxatdan o'tgani uchun brauzer uni animatsiya qila oladi (oddiy
 * `--x` o'zgaruvchi sakrab o'zgaradi, silliq o'tmaydi).
 */
function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <div className="hero__ring-wrap">
      <div
        className="hero__ring"
        style={{ '--deg': `${(clamped / 100) * 360}deg` } as React.CSSProperties}
      >
        <div className="hero__ring-core">
          <CountUp
            className="hero__ring-value"
            format={(v) => v.toFixed(0)}
            value={clamped}
          />
          <span className="hero__ring-max">/100</span>
        </div>
      </div>
      <p className="hero__ring-cap">
        Samaradorlik
        <br />
        indeksi
      </p>
    </div>
  );
}
