import withPWAInit from '@ducanh2912/next-pwa'
import { withWorkflow } from 'workflow/next'
import { buildSecurityConfig, reportSecurityConfigWarnings } from './lib/security/csp.mjs'

// PWA / service worker. Disabled in development so it never interferes with the
// dev server / HMR; it only activates in the production build. Network-first for
// navigations keeps content fresh and falls back to cache when offline.
const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
  // Never precache heavy/dead media (they must not ship in the SW manifest).
  publicExcludes: ['!gri-pulse-audio/**', '!gri-pulse-assets/**', '!**/*.m4a'],
  workboxOptions: {
    disableDevLogs: true,
    // Override the package default (which NetworkFirst-caches ALL GET /api/* for
    // 24h). Authenticated API responses must NOT sit on disk — that leaked one
    // user's data to the next on a shared device and served stale data on slow
    // networks. Only cache Next static assets and same-origin images.
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
        handler: 'NetworkOnly',
      },
      {
        urlPattern: ({ request }) => request.destination === 'image',
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'images', expiration: { maxEntries: 64, maxAgeSeconds: 86400 } },
      },
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/_next/static/'),
        handler: 'CacheFirst',
        options: { cacheName: 'next-static', expiration: { maxEntries: 128, maxAgeSeconds: 2592000 } },
      },
    ],
  },
})

// Routes that can run the document_intelligence agent (and therefore OCR):
// Inngest functions, the agents cron, the kick endpoint of the agents service,
// document finalize (inline waitUntil), the manual re-process route and the
// admin "run agent / retry task" routes.
// Keys are picomatch globs matched with `contains`, so a prefix also covers
// nested routes (e.g. /api/v1/onboarding/documents/[id]/process).
const OCR_ROUTES = [
  '/api/inngest',
  '/api/cron/agents',
  '/api/internal/agents',
  '/api/v1/documents',
  '/api/v1/onboarding/documents',
  '/api/giga-admin/agents',
]
const OCR_TRACE_FILES = [
  './node_modules/@tesseract.js-data/*/4.0.0_best_int/*.traineddata.gz',
  './node_modules/tesseract.js-core/tesseract-core-*lstm.wasm',
  './node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs',
  './node_modules/@napi-rs/canvas/**',
  './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
]

// CSP and next/image remote patterns come from env (R-013/R-135): the Supabase origin is the one in
// NEXT_PUBLIC_SUPABASE_URL (+ its wss:// twin for Realtime) — no `*.supabase.co` wildcard; the
// «Рынок» origin (NEXT_PUBLIC_MARKET_APP_URL) only when set and, in a production build, not a
// loopback host. Both are NEXT_PUBLIC_*, i.e. build-time: a build without them prints a loud warning.
// Built by a pure function so it is unit-tested (tests/unit/security/csp.test.ts).
const securityConfig = buildSecurityConfig(process.env)
if (!globalThis.__aistartCspWarned) {
  globalThis.__aistartCspWarned = true
  reportSecurityConfigWarnings(securityConfig.warnings)
}
const csp = securityConfig.csp

/** @type {import('next').NextConfig} */
const nextConfig = {
  // E-commerce vertical removed (2026-09-24): old links land on the client home.
  async redirects() {
    return [
      { source: '/client/onboarding-ecommerce', destination: '/client/home', permanent: false },
      { source: '/client/dashboard-ecommerce', destination: '/client/home', permanent: false },
      // Роль «owner» убрана из продукта (2026-09-24) — старый кабинет ведёт в клиентский.
      { source: '/owner', destination: '/client/home', permanent: false },
      { source: '/owner/:path*', destination: '/client/home', permanent: false },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: csp,
          },
        ],
      },
    ]
  },
  images: {
    // Our Supabase origin (from NEXT_PUBLIC_SUPABASE_URL) + Google avatars; no *.supabase.co wildcard.
    remotePatterns: securityConfig.remotePatterns,
  },
  // pdfkit loads its built-in .afm font-metric files from disk at runtime.
  // Bundling it into the server chunk rewrites that path and breaks PDF
  // generation (ENOENT .next/server/vendor-chunks/data/Helvetica.afm). Keep it
  // external so it resolves from node_modules. Used by app/api/export/report.
  // The PDF export route embeds custom TTF fonts read from disk at runtime.
  // Next's serverless tracer doesn't see those reads, so without this the TTFs
  // are pruned from the bundle and /api/export/report ENOENTs on Vercel (→ 500
  // render_failed). Force-trace public/fonts into that route's bundle. In Next
  // 14.2.x this key lives UNDER `experimental` (it only moved to the top level
  // in Next 15); placing it at the top level here made Next ignore it.
  //
  // OCR (lib/documents/ocr.ts) runs inside the document_intelligence agent,
  // i.e. in every route that can execute an agent task. It needs files the
  // tracer cannot see:
  //   - tesseract.js spawns a worker_thread from
  //     node_modules/tesseract.js/src/worker-script/node/index.js (resolved via
  //     __dirname — so tesseract.js must stay external, webpack would rewrite
  //     the path), and the worker reads tesseract-core-*-lstm.wasm from disk;
  //   - language data (@tesseract.js-data/*/4.0.0_best_int — the LSTM-only
  //     models, ~7.6 MB for rus+eng+kaz) is read by path, never downloaded;
  //   - pdf-parse renders PDF pages with @napi-rs/canvas (loaded through a
  //     computed createRequire) and runs pdf.worker.mjs via import(workerSrc)
  //     relative to its own file — so pdf-parse stays external too.
  experimental: {
    // Runs instrumentation.ts at boot. On Vercel its register() returns at once; on a persistent
    // server (Railway) it starts the Workflow queue, the in-process cron and the SIGTERM handler.
    instrumentationHook: true,
    // geoip-country (lib/geo/country.ts: landing-page currency by visitor IP) reads its .dat files
    // relative to its own __dirname, so like the packages above it must not be bundled.
    serverComponentsExternalPackages: ['pdfkit', 'tesseract.js', 'pdf-parse', 'geoip-country'],
    outputFileTracingIncludes: {
      '/api/export/report': ['./public/fonts/**'],
      // pdf-parse (text extraction) is reachable from many API routes.
      '/api/**': ['./node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs'],
      ...Object.fromEntries(OCR_ROUTES.map((route) => [route, OCR_TRACE_FILES])),
    },
  },
}

export default withWorkflow(withPWA(nextConfig))
