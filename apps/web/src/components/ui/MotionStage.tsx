/**
 * Dashboard "sahnasi" — sahifadagi barcha kartalarni jonlantiruvchi qatlam.
 *
 * Uchta ishni qiladi, uchalasini ham CSS yolg'iz uddalay olmaydi:
 *
 *   1. SKROLL bilan chiqish. Karta ekranga kirganda pastdan suzib chiqadi.
 *      Ilgari animatsiya faqat MOUNT paytida ishlardi, ya'ni ekranning
 *      pastidagi 20 ta panel foydalanuvchi ularni ko'rmagan holda "o'ynab"
 *      bo'lardi va pastga tushganda sahifa jonsiz ko'rinardi.
 *   2. Kursor yorug'ligi. Sichqoncha kartaning QAYERIDA turgani `--mx/--my`
 *      o'zgaruvchilariga yoziladi — CSS shu nuqtaga radial yorug'lik qo'yadi.
 *   3. 3D egilish. Kursor chetga surilganda KPI kartasi shu tomonga
 *      qiyshayadi (`--rx/--ry`). Panellarga TEGILMAYDI: ichida diagramma
 *      bor, qiyshaygan diagramma o'qilmaydi.
 *
 * Hammasi bitta konteynerdagi BITTA hodisa tinglovchisi orqali (delegatsiya) —
 * 40 ta kartaga 40 ta listener osilmaydi. Koordinatalar `requestAnimationFrame`
 * ichida yoziladi, ya'ni bir kadrda ko'pi bilan bir marta.
 */
import { useEffect, useRef, type ReactNode } from 'react';

/** Jonlanadigan elementlar — Panel primitivi va KPI kartasi. */
const CARD = '.panel, .kpi';

/** Navbat qadami: bir kadrda ekranga kirgan kartalar shu farq bilan chiqadi. */
const STAGGER_MS = 55;

/** Navbat 8 tadan keyin qaytadan boshlanadi — aks holda oxirgi karta juda kech chiqadi. */
const STAGGER_LOOP = 8;

/** Egilish burchagi (daraja). Bundan kattasi o'yinchoqdek ko'rinadi. */
const TILT_DEG = 6;

function media(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

export function MotionStage({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // ── 1. Skroll bilan chiqish ──────────────────────────────────────────────
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const reveal = (el: Element, order: number): void => {
      (el as HTMLElement).style.setProperty(
        '--reveal-delay',
        `${(order % STAGGER_LOOP) * STAGGER_MS}ms`,
      );
      el.classList.add('is-in');
    };

    // Kuzatuvchi yo'q brauzerda hamma narsa DARHOL ko'rinadi — yashirin
    // qolgandan ko'ra animatsiyasiz chiqqani yaxshi.
    if (typeof IntersectionObserver === 'undefined') {
      root.querySelectorAll(CARD).forEach(reveal);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries
          .filter((e) => e.isIntersecting)
          // Bir kadrda kirganlar yuqoridan pastga, so'ng chapdan o'ngga navbatlanadi.
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top ||
              a.boundingClientRect.left - b.boundingClientRect.left,
          )
          .forEach((e, i) => {
            reveal(e.target, i);
            io.unobserve(e.target);
          });
      },
      // Karta to'liq ko'rinmasdan oldinroq boshlansin — chiqish "kechikkandek"
      // tuyulmasligi uchun ekran pastidan 8% ichkariga surilgan.
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );

    const observeAll = (): void => {
      root.querySelectorAll(CARD).forEach((el) => {
        if (!el.classList.contains('is-in')) io.observe(el);
      });
    };
    observeAll();

    /*
     * Panellar so'rov tugagach paydo bo'ladi, shuning uchun DOM kuzatiladi.
     * Diagrammalar (Nivo/ECharts) ham tugun qo'shib-o'chiradi, ya'ni bu
     * kuzatuvchi tez-tez uyg'onadi — shu sababli qayta skanerlash bir kadrda
     * bir martaga cheklangan.
     */
    let scheduled = 0;
    const mo = new MutationObserver((records) => {
      if (scheduled) return;
      if (!records.some((r) => r.addedNodes.length > 0)) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        observeAll();
      });
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      if (scheduled) cancelAnimationFrame(scheduled);
      mo.disconnect();
      io.disconnect();
    };
  }, []);

  // ── 2–3. Kursor yorug'ligi va egilish ────────────────────────────────────
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Harakat kamaytirilgan bo'lsa — kuzatuvning o'zi ortiqcha.
    if (media('(prefers-reduced-motion: reduce)')) return;
    // Sensorli ekranda "hover" yo'q: barmoq tekkan joyda karta qiyshaysa g'alati.
    if (!media('(hover: hover)')) return;

    let active: HTMLElement | null = null;
    let pending: { el: HTMLElement; x: number; y: number } | null = null;
    let raf = 0;

    const clear = (el: HTMLElement): void => {
      for (const p of ['--mx', '--my', '--rx', '--ry']) el.style.removeProperty(p);
    };

    const apply = (): void => {
      raf = 0;
      if (!pending) return;
      const { el, x, y } = pending;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;

      const px = (x - r.left) / r.width;
      const py = (y - r.top) / r.height;

      el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);

      // Egilish faqat KPI kartasida — panel ichidagi diagramma tik turishi kerak.
      if (el.classList.contains('kpi')) {
        el.style.setProperty('--ry', `${((px - 0.5) * 2 * TILT_DEG).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${((0.5 - py) * 2 * TILT_DEG).toFixed(2)}deg`);
      }
    };

    const onMove = (ev: PointerEvent): void => {
      const target = ev.target as Element | null;
      const card = (target?.closest?.(CARD) ?? null) as HTMLElement | null;

      if (card !== active) {
        if (active) clear(active);
        active = card;
      }
      if (!card) return;

      pending = { el: card, x: ev.clientX, y: ev.clientY };
      raf ||= requestAnimationFrame(apply);
    };

    const onLeave = (): void => {
      if (active) clear(active);
      active = null;
      pending = null;
    };

    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      if (active) clear(active);
    };
  }, []);

  return (
    <div ref={ref} className={className} data-stage="on">
      {children}
    </div>
  );
}
