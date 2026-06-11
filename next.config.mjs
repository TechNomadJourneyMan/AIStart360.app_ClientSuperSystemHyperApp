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

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
  "img-src 'self' data: https://*.supabase.co https://lh3.googleusercontent.com",
  `connect-src 'self' https://*.supabase.co ${marketAppOrigin}`,
  `frame-src 'self' ${marketAppOrigin}`,
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
}

export default nextConfig
