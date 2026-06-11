/**
 * Market Intelligence Portal — types + intentionally-empty placeholders.
 *
 * IMPORTANT: This product enforces a hard rule — NO production-visible mock or
 * fabricated data. The data constants below are deliberately EMPTY (zeros /
 * empty arrays / "—") because there is no real backend feed for the market
 * portal yet. The UI renders honest empty states from these values.
 *
 * TODO(supabase): Replace these empty placeholders with live reads from Supabase
 * tables (market_overview, competitors, intelligence_alerts, news). When implementing:
 *   - Add a `market_overview` row (singleton) keyed by niche/region.
 *   - `competitors` table with columns matching the Competitor interface below.
 *   - `intelligence_alerts` table — insert-only feed keyed by competitor_id.
 *   - `news` table — insert rows from the /api/market/osint sync action.
 * Until then, never populate these with invented values.
 */

export interface MarketData {
  totalVolume: number
  yoyGrowth: number
  activePlayers: number
  marketTemp: string
  chartData: { year: string; volume: number }[]
  pestel: { factor: string; description: string; trend: 'positive' | 'negative' | 'neutral' }[]
}

export interface Competitor {
  id: string
  name: string
  category: 'Direct' | 'Indirect' | 'Substitute' | 'Leader' | 'Newcomer'
  bin_iin: string
  url: string
  estRevenue: number
  taxesPaid: number
  b2gDependency: number
  tags: string[]
  isTracked: boolean
}

export interface IntelligenceAlert {
  id: string
  competitorName: string
  type: 'Price Drop' | 'Tender Win' | 'Legal Risk' | 'New Vacancy'
  description: string
  timestamp: string
}

export interface NewsItem {
  id: string
  source: string
  headline: string
  summary: string
  timestamp: string
  tags: string[]
}

export const COMPETITOR_CATEGORIES = [
  'All',
  'Direct',
  'Indirect',
  'Substitute',
  'Leader',
  'Newcomer',
] as const

// Intentionally empty — no fabricated market figures until a real feed exists.
export const MOCK_MARKET_DATA: MarketData = {
  totalVolume: 0,
  yoyGrowth: 0,
  activePlayers: 0,
  marketTemp: '—',
  chartData: [],
  pestel: [],
}

// Intentionally empty — competitors come from a real backend feed when available.
export const MOCK_COMPETITORS: Competitor[] = []

// Intentionally empty — no fabricated intelligence signals.
export const MOCK_INTELLIGENCE_ALERTS: IntelligenceAlert[] = []

// Intentionally empty — no fabricated news items.
export const MOCK_NEWS: NewsItem[] = []

export function formatKZT(value: number): string {
  if (value >= 1_000_000_000) return `\u20B8${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `\u20B8${(value / 1_000_000).toFixed(1)}M`
  return `\u20B8${value.toLocaleString()}`
}
