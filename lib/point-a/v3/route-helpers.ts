// ============================================================
// lib/point-a/v3/route-helpers.ts
//
// Shared scaffolding for the three v3 analytical-engine route
// handlers (segments, retention-curve, loss-map):
//
//   - resolveCompanyId      mirrors aggregate/route.ts
//   - loadV3Context         fetches survey + documents + extracts
//                           the client base in one round-trip
//   - num()/clamp01()       safe coercion helpers
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { gatherResolverContext } from '@/lib/metrics/materialize'
import type { ResolverContext } from '@/lib/metrics/types'
import {
  extractClientBaseRows,
  type ClientBaseExtractResult,
} from './client-base-loader'
import { loadEcommerceAnalytics } from './ecommerce-orders-loader'

export async function resolveCompanyId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .eq('user_id', userId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return (data.id as string) ?? null
}

export interface V3RouteContext {
  resolver: ResolverContext
  clientBase: ClientBaseExtractResult
}

/**
 * Load + normalise everything a v3 engine needs from Supabase in one go.
 */
export async function loadV3Context(
  supabase: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<V3RouteContext> {
  const [resolver, ecommerce] = await Promise.all([
    gatherResolverContext(supabase, { userId, companyId }),
    loadEcommerceAnalytics(supabase, userId),
  ])
  const documentClientBase = extractClientBaseRows(resolver.documents)
  // Durable order history is the authoritative client base. Uploaded
  // spreadsheets remain a compatibility fallback until a live source exists.
  const clientBase = ecommerce.clientBase.has_client_base
    ? ecommerce.clientBase
    : documentClientBase
  return { resolver, clientBase }
}

/** Coerce arbitrary survey answer into a finite number or null. */
export function num(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d.,-]/g, '').replace(/,/g, '.')
    const n = Number(cleaned)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Accept either 0..1 or 0..100 and return 0..1. */
export function clamp01(n: number | null): number {
  if (n == null || !Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return n > 100 ? 1 : n / 100
  return n
}
