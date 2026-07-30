/**
 * Raqamning sanalib chiqishi — 0 dan joriy qiymatga.
 *
 * IKKI QOIDA:
 *   1. `prefers-reduced-motion` yoqilgan bo'lsa animatsiya UMUMAN
 *      bo'lmaydi — qiymat darhol chiqadi. Bu shunchaki did masalasi emas:
 *      harakat ba'zi foydalanuvchilarda bosh aylanishiga sabab bo'ladi.
 *   2. Ekranda ko'rinmaguncha boshlanmaydi (`IntersectionObserver`) —
 *      pastdagi panellar foydalanuvchi ularga yetganda jonlanadi.
 *
 * Kutubxona ishlatilmaydi: `requestAnimationFrame` yetarli va bu tizim
 * hech qanday tashqi paketga bog'lanmasligi kerak.
 */
import { useEffect, useRef, useState } from 'react';

/** easeOutCubic — oxiriga borib sekinlashadi, "to'xtash" tabiiy ko'rinadi. */
const ease = (t: number): number => 1 - (1 - t) ** 3;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface CountUpProps {
  /** Yakuniy qiymat. O'zgarsa — o'sha joydan yangisiga suriladi. */
  value: number | null;
  /** Har bir kadrda qiymatni matnga aylantiradi. */
  format: (v: number) => string;
  durationMs?: number;
  className?: string;
}

export function CountUp({ value, format, durationMs = 900, className }: CountUpProps) {
  const target = value ?? 0;
  const ref = useRef<HTMLSpanElement>(null);
  const fromRef = useRef(0);
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  const [visible, setVisible] = useState(false);

  // Ko'rinish kuzatuvi — sahifa pastidagi raqamlar bekorga sanalmasin.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;

    if (prefersReducedMotion()) {
      setShown(target);
      fromRef.current = target;
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    let raf = 0;
    let start = 0;
    const step = (ts: number): void => {
      start ||= ts;
      const t = Math.min(1, (ts - start) / durationMs);
      setShown(from + (target - from) * ease(t));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, visible, durationMs]);

  return (
    <span ref={ref} className={className}>
      {value === null ? '—' : format(shown)}
    </span>
  );
}
