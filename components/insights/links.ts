'use client'

/**
 * Where an insight can send the reader — resolved for the segment they are
 * actually in.
 *
 * Both /insights and /intelligence are re-exported into the owner portal
 * (`app/(owner)/owner/insights/page.tsx`), and `middleware.ts:326-332` bounces
 * role `owner` off every (dashboard) path back to /owner/dashboard. A
 * hard-coded "/point-a" CTA would therefore be a dead link for exactly the user
 * these screens are built for. Targets with no owner-portal counterpart
 * (`/point-a/insights`, `/market/analysis`) resolve to the nearest screen that
 * does exist there, or to `null` when there is none.
 */

import { usePathname } from 'next/navigation'

export interface InsightLinks {
  isOwnerPortal: boolean
  /** Point A questionnaire — where the answers behind an insight are filled in. */
  pointA: string
  /** Full discussion timeline. Dashboard segment only — null in the owner portal. */
  feed: string | null
  /** Market questionnaire; the owner portal only has the market overview. */
  market: string
  /** Названа честно: в owner-портале ссылка ведёт на обзор, а не на анкету. */
  marketLabel: string
  insights: string
  intelligence: string
}

export function useInsightLinks(): InsightLinks {
  const pathname = usePathname() ?? ''
  const isOwnerPortal = pathname === '/owner' || pathname.startsWith('/owner/')

  if (isOwnerPortal) {
    return {
      isOwnerPortal,
      pointA: '/owner/point-a',
      feed: null,
      market: '/owner/market',
      marketLabel: 'Рынок',
      insights: '/owner/insights',
      intelligence: '/owner/intelligence',
    }
  }

  return {
    isOwnerPortal,
    pointA: '/point-a',
    feed: '/point-a/insights',
    market: '/market/analysis',
    marketLabel: 'Анализ рынка',
    insights: '/insights',
    intelligence: '/intelligence',
  }
}
