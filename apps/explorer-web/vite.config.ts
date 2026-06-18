import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server proxying (spec 019). The SPA (:5173) is the single browser entry point:
//  - /kratos/*                    -> Kratos public (first-party cookies/CSRF for self-service flows)
//  - gated /api/{chat,admin,auth} -> Oathkeeper, which validates the session + injects X-User-* headers
//  - public /api/* + /healthz     -> Hono backend directly (anonymous browse, lower latency)
// Specific (gated) keys are listed before the catch-all `/api` so they take precedence.
const API_PORT = process.env.EXPLORER_API_PORT ?? '8790';
const HONO = `http://localhost:${API_PORT}`;
const KRATOS = process.env.KRATOS_PUBLIC_URL ?? 'http://localhost:14433';
const OATHKEEPER = process.env.OATHKEEPER_PROXY_URL ?? 'http://localhost:14455';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/kratos': {
        target: KRATOS,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kratos/, ''),
      },
      '/api/chat': { target: OATHKEEPER, changeOrigin: true },
      '/api/admin': { target: OATHKEEPER, changeOrigin: true },
      '/api/auth': { target: OATHKEEPER, changeOrigin: true },
      '/api': { target: HONO, changeOrigin: true },
      '/healthz': { target: HONO, changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
