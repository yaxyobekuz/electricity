import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@beap/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // API bilan bir xil origin — CSP `connect-src 'self'` buzilmaydi.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
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
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('echarts')) return 'echarts';
          if (id.includes('@nivo') || id.includes('d3-')) return 'nivo';
          if (id.includes('@heroui') || id.includes('react-aria')) return 'heroui';
          if (id.includes('react-router') || /node_modules[\\/]react(-dom)?[\\/]/.test(id)) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
