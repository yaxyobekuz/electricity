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
  sidebarOpen: boolean;
  user: AuthUser | null;
  script: 'latn' | 'cyrl';

  setTheme: (t: ThemeName) => void;
  toggleTheme: () => void;
  setPeriod: (p: string | null) => void;
  toggleSidebar: () => void;
  setUser: (u: AuthUser | null) => void;
  setScript: (s: 'latn' | 'cyrl') => void;
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
  sidebarOpen: true,
  user: null,
  script: currentScript(),

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next: ThemeName = get().theme === 'gov-dark' ? 'gov' : 'gov-dark';
    applyTheme(next);
    set({ theme: next });
  },
  setPeriod: (period) => set({ period }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setUser: (user) => set({ user }),
  setScript: (script) => set({ script }),
}));
