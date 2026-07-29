import type { MetadataRoute } from 'next'

/**
 * Crawler policy. Everything listed here is either session-gated, token-gated,
 * or drives paid AI calls — none of it belongs in a search index.
 *
 * Journey is the reason this file exists: even on a deployment that opts into
 * NEXT_PUBLIC_JOURNEY_PUBLIC_DEMO=1 the workspace must stay out of the index, so
 * the Disallow is unconditional. `app/journey/page.tsx` already sends
 * `robots: { index: false, follow: false }`, but that meta tag only reaches a
 * crawler that has already fetched (and therefore paid for) the page.
 *
 * robots.txt matches by prefix, so '/journey' also covers '/journey?demo=…'.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        // AI-first workspace (public entry + authenticated alias).
        '/journey',
        '/client/journey',
        // Everything behind a session, a signed cookie or a share token.
        '/api/',
        '/client/',
        '/admin-giga-panel',
        '/giga-login',
        '/2fa',
        '/auth/',
        '/r/',
        '/checkout/',
      ],
    },
  }
}
