/**
 * Cloudflare Pages advanced-mode Worker.
 *
 * Production truth boundary:
 * - `/donki/*` injects the NASA key at the edge; the browser never receives it.
 * - `/hv-api/*` makes measured Helioviewer imagery same-origin and cacheable.
 * - `/gfz/*` exposes the key-free Hp30 source without pretending failures are 0.
 * - everything else is an immutable/static Pages asset.
 */

const VERSION = '2026.07.11';
const UPSTREAM_TIMEOUT_MS = 25_000;

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://services.swpc.noaa.gov https://api.bigdatacloud.net; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
};

function withHeaders(response, extras = {}) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  for (const [key, value] of Object.entries(extras)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('upstream timeout'), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function json(body, status = 200, headers = {}) {
  return withHeaders(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  }));
}

async function cachedProxy(request, target, ttlSeconds, provenance) {
  const cache = caches.default;
  const cacheKey = new Request(target.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return withHeaders(hit, { 'X-Helioverse-Cache': 'HIT', 'X-Helioverse-Provenance': provenance });

  let upstream;
  try {
    upstream = await fetchWithTimeout(target, {
      headers: {
        'Accept': request.headers.get('Accept') || '*/*',
        'User-Agent': 'Helioverse/2026 (+https://helioverse.app)',
      },
    });
  } catch (error) {
    return json({ status: 'unavailable', source: provenance, reason: error instanceof Error ? error.message : String(error) }, 503);
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', `public, max-age=${Math.min(ttlSeconds, 300)}, s-maxage=${ttlSeconds}`);
  headers.delete('set-cookie');
  const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  if (upstream.ok) await cache.put(cacheKey, response.clone());
  return withHeaders(response, { 'X-Helioverse-Cache': 'MISS', 'X-Helioverse-Provenance': provenance });
}

async function handleProxy(request, env, url) {
  if (url.pathname.startsWith('/hv-api/')) {
    const target = new URL(url.pathname.replace(/^\/hv-api/, ''), 'https://api.helioviewer.org');
    target.search = url.search;
    return cachedProxy(request, target, 21_600, 'measured Helioviewer/SDO/SOHO imagery');
  }

  if (url.pathname.startsWith('/donki/')) {
    const endpoint = url.pathname.slice('/donki/'.length);
    const allowed = new Set(['CME', 'FLR', 'IPS', 'GST', 'SEP', 'HSS', 'WSAEnlilSimulations', 'notifications']);
    if (!allowed.has(endpoint)) return json({ status: 'rejected', reason: 'Unknown DONKI endpoint.' }, 404);
    if (!env.NASA_DONKI_KEY) {
      return json({ status: 'unavailable', source: 'NASA DONKI', reason: 'NASA_DONKI_KEY is not configured at the edge.' }, 503);
    }
    const target = new URL(`/DONKI/${endpoint}`, 'https://api.nasa.gov');
    target.search = url.search;
    target.searchParams.set('api_key', env.NASA_DONKI_KEY);
    return cachedProxy(request, target, 300, `NASA DONKI ${endpoint}`);
  }

  if (url.pathname.startsWith('/gfz/')) {
    const target = new URL('/app/json/', 'https://kp.gfz.de');
    target.search = url.search;
    return cachedProxy(request, target, 300, 'GFZ Hp30 nowcast');
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withHeaders(new Response(null, { status: 204 }), {
        'Access-Control-Allow-Origin': url.origin,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
    }

    if (!['GET', 'HEAD'].includes(request.method)) return json({ status: 'rejected', reason: 'Read-only public surface.' }, 405);

    if (url.pathname === '/api/health') {
      return json({
        status: 'ok',
        version: VERSION,
        nasa_key_configured: Boolean(env.NASA_DONKI_KEY),
        feeds: {
          solar_wind: 'NOAA RTSW direct browser feed',
          events: 'NASA DONKI edge proxy',
          imagery: 'Helioviewer edge proxy',
          hp30: 'GFZ edge proxy',
        },
      }, 200, { 'Cache-Control': 'no-store' });
    }

    const proxied = await handleProxy(request, env, url);
    if (proxied) return proxied;

    let asset = await env.ASSETS.fetch(request);
    let spaFallback = false;
    if (asset.status === 404 && request.method === 'GET' && request.headers.get('Accept')?.includes('text/html')) {
      asset = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
      spaFallback = true;
    }
    const htmlNavigation = request.method === 'GET' && request.headers.get('Accept')?.includes('text/html');
    const cacheControl = spaFallback || htmlNavigation
      ? 'no-cache'
      : url.pathname.includes('/assets/')
      ? 'public, max-age=31536000, immutable'
      : url.pathname === '/' || url.pathname.endsWith('.html')
        ? 'no-cache'
        : 'public, max-age=3600';
    return withHeaders(asset, { 'Cache-Control': cacheControl });
  },
};
