import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'
import NextTopLoader from 'nextjs-toploader'
import { Providers } from './providers'
import NativeShell from '@/components/native/NativeShell'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'AIStart360 — Institutional Intelligence',
    template: '%s | AIStart360',
  },
  description: 'B2B клиентский портал для управления ростом компаний. GRI диагностика, аналитика, отчёты.',
  keywords: ['AIStart360', 'GRI', 'Growth Readiness', 'B2B Portal', 'Business Intelligence'],
  authors: [{ name: 'AIStart360' }],
  metadataBase: new URL(process.env.AUTH_URL ?? 'http://localhost:3000'),
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=DM+Sans:ital,wght@0,400;0,500;0,700;1,400&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        {/* Top navigation progress bar — instant feedback on every click/route change */}
        <NextTopLoader color="#6effc0" height={2} showSpinner={false} shadow="0 0 8px #6effc0,0 0 4px #6effc0" />
        <Providers>{children}</Providers>
        {/* Android/iOS shell wiring: back button, splash, status bar, deep
            links. No-ops in a browser — see components/native/NativeShell. */}
        <NativeShell />
        {/* Single global sonner Toaster (PERF-09: the only toast system).
            mobileOffset clears the mobile bottom-nav (UX-07). */}
        <Toaster theme="dark" position="bottom-right" richColors mobileOffset={{ bottom: '88px' }} />
      </body>
    </html>
  )
}
