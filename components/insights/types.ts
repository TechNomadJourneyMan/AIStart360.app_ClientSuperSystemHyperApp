/**
 * Shapes for the /insights screen.
 *
 * The feed contract already exists in `components/point-a/v2/InsightItem` —
 * it is extended here instead of redeclared so the two screens that read
 * `point_a_insights` can never drift apart. `source_meta` is returned by
 * /api/v1/point-a/insights but is not part of the Point A card's props, so it
 * is the only field added on top.
 */
import type {
  InsightAuthorRole,
  InsightFeedItem,
  InsightStatus,
} from '@/components/point-a/v2/InsightItem'

export type { InsightAuthorRole, InsightFeedItem, InsightStatus }

/** Provenance written by lib/insights/ai-generator via the ai-generate route. */
export interface InsightSourceMeta {
  model?: string
  prompt_version?: string
  confidence?: number | null
}

export interface InsightRecord extends InsightFeedItem {
  source_meta?: InsightSourceMeta | null
  company_id?: string | null
  updated_at?: string
}

/** Counts the API computes over ALL of the user's rows, not just the page. */
export interface InsightCounts {
  all: number
  ai: number
  expert: number
  client: number
  admin: number
  pending: number
  unanswered: number
}

export interface InsightsApiResponse {
  ok: boolean
  error?: string
  data?: { items: InsightRecord[]; counts: InsightCounts }
}
