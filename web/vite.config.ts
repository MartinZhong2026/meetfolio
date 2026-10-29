import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
    },
  },
  build: { sourcemap: false, target: 'es2022' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
});
