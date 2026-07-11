import https from 'node:https';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const PROXY_TIMEOUT_MS = 30_000;

const helioviewerAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 5_000,
  maxSockets: 4,
  maxFreeSockets: 1,
  timeout: PROXY_TIMEOUT_MS,
});

/**
 * Build the shared dev/preview proxy table.
 *
 * `/hv-api`  → Helioviewer (no key; CORS-only workaround).
 * `/donki`   → NASA DONKI. The api_key is injected SERVER-SIDE here from
 *              `.env.local` (NASA_DONKI_KEY, no VITE_ prefix) so it never ships
 *              in the browser bundle — the client only ever sees `/donki/...`.
 *              A real deployment must inject the key in its own reverse proxy.
 *              If unset, NASA returns an explicit authentication failure; no
 *              demo credential is silently substituted.
 */
function buildProxy(donkiKey: string): Record<string, ProxyOptions> {
  return {
    '/hv-api': {
      target: 'https://api.helioviewer.org',
      changeOrigin: true,
      agent: helioviewerAgent,
      proxyTimeout: PROXY_TIMEOUT_MS,
      timeout: PROXY_TIMEOUT_MS,
      rewrite: (requestPath) => requestPath.replace(/^\/hv-api/, ''),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req, res) => {
          proxyReq.setTimeout(PROXY_TIMEOUT_MS, () => proxyReq.destroy());
          req.on('aborted', () => proxyReq.destroy());
          res.on('close', () => {
            if (!res.writableEnded) proxyReq.destroy();
          });
        });
      },
    },
    '/donki': {
      target: 'https://api.nasa.gov',
      changeOrigin: true,
      rewrite: (requestPath) => {
        const mapped = requestPath.replace(/^\/donki/, '/DONKI');
        const separator = mapped.includes('?') ? '&' : '?';
        return `${mapped}${separator}api_key=${encodeURIComponent(donkiKey)}`;
      },
    },
    // GFZ Potsdam Kp/Hp30 API — no API key, CC-BY-4.0.
    // Browser fetch blocked by CORS on kp.gfz.de; proxy removes the restriction.
    // Client calls /gfz/?start=...&end=...&index=Hp30&status=nowcast
    // → proxied to https://kp.gfz.de/app/json/?start=...&end=...&index=Hp30&status=nowcast
    '/gfz': {
      target: 'https://kp.gfz.de',
      changeOrigin: true,
      rewrite: (requestPath) => requestPath.replace(/^\/gfz/, '/app/json'),
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load .env / .env.local (all keys, no VITE_ filter) — server-side only.
  const env = loadEnv(mode, process.cwd(), '');
  const donkiKey = env.NASA_DONKI_KEY || '';
  const proxy = buildProxy(donkiKey);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      open: true,
      proxy,
    },
    preview: {
      proxy,
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
    },
  };
});
