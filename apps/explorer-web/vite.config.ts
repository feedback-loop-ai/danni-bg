import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server proxying (spec 019). Everything goes to the Hono backend, which is now a complete
// single-port app: it serves the API, reverse-proxies `/kratos/*` to Kratos, and validates the
// Kratos session itself (no Oathkeeper hop required). So `:8790` works standalone too; Vite is just
// for HMR in dev. (If you front the stack with Oathkeeper, its injected X-User-* headers still win.)
const API_PORT = process.env.EXPLORER_API_PORT ?? '8790';
const HONO = `http://localhost:${API_PORT}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/kratos': { target: HONO, changeOrigin: true },
      '/api': { target: HONO, changeOrigin: true },
      '/healthz': { target: HONO, changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
