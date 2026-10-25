import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'
import NextTopLoader from 'nextjs-toploader'
import { RouteProgress } from '@/components/navigation/RouteProgress'
import { Providers } from './providers'
import { getSiteUrl } from '@/lib/site-url'
import { LegacySymbolFont } from '@/components/ui/LegacySymbolFont'
import './globals.css'

/**
 * Базовый адрес для абсолютных ссылок в метаданных.
 *
 * Считается на этапе сборки, поэтому обязан быть устойчивым: `AUTH_URL ?? …`
 * не спасал, когда переменная задана ПУСТОЙ строкой (`??` подставляет запасное
 * значение только для undefined/null) — сборка падала на `/_not-found`
 * с «TypeError: Invalid URL, input: ''». getSiteUrl отбрасывает пустые
 * значения, а try/catch защищает и от некорректно заданного адреса.
 */
function resolveMetadataBase(): URL {
  try {
    return new URL(getSiteUrl())
  } catch {
    return new URL('https://portal.aistart360.app')
  }
}

export const metadata: Metadata = {
  title: {
    default: 'AIStart360 — Institutional Intelligence',
    template: '%s | AIStart360',
  },
  description: 'B2B клиентский портал для управления ростом компаний. GRI диагностика, аналитика, отчёты.',
  keywords: ['AIStart360', 'GRI', 'Growth Readiness', 'B2B Portal', 'Business Intelligence'],
  authors: [{ name: 'AIStart360' }],
  metadataBase: resolveMetadataBase(),
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'AIStart360', statusBarStyle: 'black-translucent' },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'AIStart360',
    title: 'AIStart360 — Institutional Intelligence',
    description: 'B2B клиентский портал для управления ростом компаний.',
  },
}

export const viewport: Viewport = {
  themeColor: '#0A0B0F',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/Inter-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="font-body antialiased">
        <LegacySymbolFont />
        {/* Top navigation progress bar — instant feedback on every click/route change */}
        <NextTopLoader color="#6effc0" height={2} showSpinner={false} shadow="0 0 8px #6effc0,0 0 4px #6effc0" />
        {/* …and its safety net: finishes on every committed route change and
            closes a bar that never finished (lib/route-progress.ts). */}
        <RouteProgress />
        <Providers>{children}</Providers>
        {/* Single global sonner Toaster (PERF-09: the only toast system).
            mobileOffset clears the mobile bottom-nav (UX-07). */}
        <Toaster theme="dark" position="bottom-right" richColors mobileOffset={{ bottom: '88px' }} />
      </body>
    </html>
  )
}
