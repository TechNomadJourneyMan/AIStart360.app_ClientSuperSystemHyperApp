import type { Metadata } from 'next'
import { Providers } from './providers'
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
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'AIStart360',
    title: 'AIStart360 — Institutional Intelligence',
    description: 'B2B клиентский портал для управления ростом компаний.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement,t=JSON.parse(localStorage.getItem('aistart360_theme')||'{}');var th=t&&t.state&&t.state.theme;if(th==='light'){d.classList.remove('dark');d.classList.add('light')}else{d.classList.add('dark');d.classList.remove('light')}}catch(e){d.classList.add('dark')}})()`,
          }}
        />
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
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
