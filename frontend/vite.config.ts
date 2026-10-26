/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? (process.env.GITHUB_ACTIONS ? '/roadguard-ai/' : '/'),
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Sandboxed preview hosts (e.g. *.e2b.app) must be accepted by the dev
    // server. Vite 5.4's TypeScript types lag behind the runtime option, hence
    // the spread cast.
    ...({ allowedHosts: true } as Record<string, unknown>),
    // The browser only talks to this dev server; requests under /api are
    // proxied to FastAPI so the app works inside sandboxed previews too.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      // Matches an allowed CORS origin on the API so live tests can use XHR.
      jsdom: { url: 'http://localhost:5173' },
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    testTimeout: 20000,
  },
});
