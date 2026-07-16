import withPWAInit from '@ducanh2912/next-pwa'
import { withWorkflow } from 'workflow/next'

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

/** @type {import('next').NextConfig} */

// Origin of the embedded «Рынок» product (Mark-analytics SPA). The /market page
// embeds it in an iframe and probes availability with fetch(no-cors), so CSP
// must allow it in BOTH frame-src and connect-src. Defaults to the local Vite
// dev server; set NEXT_PUBLIC_MARKET_APP_URL in production.
const marketAppOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_MARKET_APP_URL || 'http://localhost:5173').origin
  } catch {
    return 'http://localhost:5173'
  }
})()

// 'unsafe-eval' is only needed by the dev/HMR runtime — drop it in production
// to reduce XSS surface. 'unsafe-inline' stays (Next injects inline bootstrap
// scripts without a nonce in 14.2.x).
const isDev = process.env.NODE_ENV === 'development'
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'"

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
  "img-src 'self' data: https://*.supabase.co https://lh3.googleusercontent.com",
  `connect-src 'self' https://*.supabase.co ${marketAppOrigin}`,
  `frame-src 'self' ${marketAppOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ')

const nextConfig = {
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
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
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
  experimental: {
    serverComponentsExternalPackages: ['pdfkit'],
    outputFileTracingIncludes: {
      '/api/export/report': ['./public/fonts/**'],
    },
  },
}

export default withWorkflow(withPWA(nextConfig))
