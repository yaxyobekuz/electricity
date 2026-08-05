/**
 * UI holati — FAQAT uchta narsa uchun.
 * Server shaklidagi ma'lumot bu yerga tushmaydi (u TanStack Query da).
 */
import type { AuthUser } from '@beap/shared';
import { create } from 'zustand';

import { currentScript } from '../i18n/index.ts';

export type ThemeName = 'gov' | 'gov-dark';

interface UiState {
  theme: ThemeName;
  /** Tanlangan davr (`YYYY-MM`). `null` = eng so'nggi mavjud. */
  period: string | null;
  /**
   * Hisobot sanasi (`YYYY-MM-DD`). `null` = davrning oxirgi mavjud kuni.
   *
   * Oylik panellar DAVRGA, kunlik grafiklar esa shu SANAGA bo'ysunadi:
   * "15-may holatiga" degan ko'rinish shundan hosil bo'ladi.
   */
  asOfDate: string | null;
  sidebarOpen: boolean;
  user: AuthUser | null;
  script: 'latn' | 'cyrl';
  /** AI yordamchi paneli ochiqmi — boshqa joylardan (masalan tavsiya kartasi) ham ochilishi kerak. */
  aiOpen: boolean;
  /**
   * AI panelga TASHQARIDAN yuborilishi kerak bo'lgan savol — masalan
   * "Rejalashtirilgan ishlar" panelidagi "AI tavsiya" tugmasidan. `null` =
   * navbatda hech narsa yo'q. `AiAssistant` buni o'qib darhol yuboradi va
   * tozalaydi — shu bilan bir xil savol ikki marta yuborilmaydi.
   */
  aiPendingPrompt: string | null;

  setTheme: (t: ThemeName) => void;
  toggleTheme: () => void;
  setPeriod: (p: string | null) => void;
  setAsOfDate: (d: string | null) => void;
  toggleSidebar: () => void;
  setUser: (u: AuthUser | null) => void;
  setScript: (s: 'latn' | 'cyrl') => void;
  setAiOpen: (open: boolean) => void;
  /** AI panelni ochadi va shu savolni avtomatik yuboradi (panel ichidagi "AI tavsiya" tugmalari uchun). */
  askAi: (prompt: string) => void;
  /** `AiAssistant` savolni yuborib bo'lgach navbatni bo'shatadi. */
  clearAiPendingPrompt: () => void;
}

const THEME_KEY = 'beap.theme';

function readTheme(): ThemeName {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'gov' || v === 'gov-dark') return v;
  } catch {
    /* mavjud emas */
  }
  return 'gov';
}

/** Temani `<html>` ga qo'llaydi — HeroUI ham class'ni, ham data-theme ni o'qiydi. */
export function applyTheme(theme: ThemeName): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.classList.toggle('dark', theme === 'gov-dark');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* saqlab bo'lmadi */
  }
}

export const useUi = create<UiState>((set, get) => ({
  theme: readTheme(),
  period: null,
  asOfDate: null,
  sidebarOpen: true,
  user: null,
  script: currentScript(),
  aiOpen: false,
  aiPendingPrompt: null,

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next: ThemeName = get().theme === 'gov-dark' ? 'gov' : 'gov-dark';
    applyTheme(next);
    set({ theme: next });
  },
  /*
   * Oy o'zgarsa sana TOZALANADI: aks holda "iyul oyi · 15-may holatiga"
   * degan mos kelmaydigan holat qolib ketardi.
   */
  setPeriod: (period) => set({ period, asOfDate: null }),

  /** Sana tanlansa davr ham o'sha oyga ko'chadi — ikkalasi doim mos. */
  setAsOfDate: (asOfDate) =>
    set(asOfDate === null ? { asOfDate: null } : { asOfDate, period: asOfDate.slice(0, 7) }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setUser: (user) => set({ user }),
  setScript: (script) => set({ script }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  askAi: (prompt) => set({ aiOpen: true, aiPendingPrompt: prompt }),
  clearAiPendingPrompt: () => set({ aiPendingPrompt: null }),
}));
