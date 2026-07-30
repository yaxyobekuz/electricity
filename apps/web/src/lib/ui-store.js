import { create } from 'zustand';
import { currentScript } from '../i18n/index.ts';
const THEME_KEY = 'beap.theme';
function readTheme() {
    try {
        const v = localStorage.getItem(THEME_KEY);
        if (v === 'gov' || v === 'gov-dark')
            return v;
    }
    catch {
        /* mavjud emas */
    }
    return 'gov';
}
/** Temani `<html>` ga qo'llaydi — HeroUI ham class'ni, ham data-theme ni o'qiydi. */
export function applyTheme(theme) {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', theme === 'gov-dark');
    try {
        localStorage.setItem(THEME_KEY, theme);
    }
    catch {
        /* saqlab bo'lmadi */
    }
}
export const useUi = create((set, get) => ({
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
        const next = get().theme === 'gov-dark' ? 'gov' : 'gov-dark';
        applyTheme(next);
        set({ theme: next });
    },
    setPeriod: (period) => set({ period }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setUser: (user) => set({ user }),
    setScript: (script) => set({ script }),
}));
