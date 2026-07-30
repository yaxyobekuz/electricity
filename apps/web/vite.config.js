import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
/** Repozitoriy ildizi — `.env` bitta joyda turadi (API bilan umumiy). */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig(({ mode }) => {
    // Prefikssiz o'zgaruvchilar ham kerak (WEB_PORT, API_PORT) — 3-argument ''.
    const env = loadEnv(mode, REPO_ROOT, '');
    const webHost = env.WEB_HOST || '0.0.0.0';
    const webPort = Number.parseInt(env.WEB_PORT || '5173', 10);
    const apiPort = Number.parseInt(env.API_PORT || '3001', 10);
    return {
        plugins: [react(), tailwindcss()],
        // `.env` API bilan umumiy — ildizdan o'qiladi, `VITE_*` shu yerdan keladi.
        envDir: REPO_ROOT,
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
                '@beap/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
            },
        },
        server: {
            // 0.0.0.0 — LAN dagi boshqa qurilmalar http://<IP>:5173 orqali kiradi.
            host: webHost,
            port: webPort,
            strictPort: true,
            // `VITE_API_BASE` bo'sh bo'lsa frontend nisbiy `/api` ni ishlatadi va
            // so'rov shu proksi orqali API ga uzatiladi — bir xil origin saqlanadi.
            proxy: {
                '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
            },
        },
        // `vite preview` ham tarmoqda ochilsin.
        preview: {
            host: webHost,
            port: webPort,
            strictPort: true,
            proxy: {
                '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
            },
        },
        build: {
            target: 'es2022',
            // Barcha aktivlar lokal — CDN yo'q, tashqi so'rov yo'q.
            assetsInlineLimit: 4096,
            chunkSizeWarningLimit: 900,
            rollupOptions: {
                output: {
                    // Katta kutubxonalarni alohida bo'laklarga ajratamiz, shunda `/entry`
                    // sahifasi hech qachon Nivo yoki ECharts yuklab olmaydi.
                    manualChunks(id) {
                        if (!id.includes('node_modules'))
                            return undefined;
                        if (id.includes('echarts'))
                            return 'echarts';
                        if (id.includes('@nivo') || id.includes('d3-'))
                            return 'nivo';
                        if (id.includes('@heroui') || id.includes('react-aria'))
                            return 'heroui';
                        if (id.includes('react-router') || /node_modules[\\/]react(-dom)?[\\/]/.test(id)) {
                            return 'react';
                        }
                        return undefined;
                    },
                },
            },
        },
    };
});
