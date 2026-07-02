import type { MetadataRoute } from 'next'

// PWA manifest → served at /manifest.webmanifest. Makes the portal installable
// ("Add to Home Screen") and, together with the service worker, work offline.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AIStart360 — Institutional Intelligence',
    short_name: 'AIStart360',
    description: 'B2B портал управления ростом: GRI-диагностика, аналитика, отчёты.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0A0B0F',
    theme_color: '#0A0B0F',
    lang: 'ru',
    icons: [
      // Raster icons for reliable Android install prompt + splash (maskable SVG
      // is unreliable). SVG kept as an extra scalable "any" variant.
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/logo-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}
