/**
 * lib/analytics/load.ts — RPC calls behind /api/giga-admin/analytics and the
 * CSV export (migration 090). Service-role only; callers enforce RBAC.
 */
import { createServiceClient } from '@/lib/supabase-service'
import { getSetting } from '@/lib/settings/store'
import {
  normalizeActivation, normalizeCohorts, normalizeFreeToPro, normalizeSeries,
  type ActivationStats, type ActivityPoint, type CohortRow, type FreeToProStats,
} from './reports'

export class AnalyticsUnavailable extends Error {}

type Sb = ReturnType<typeof createServiceClient>

export const clampDays = (v: unknown, def = 30, min = 7, max = 180) =>
  Math.min(max, Math.max(min, Number(v) || def))

export async function loadActivitySeries(days: number, sb: Sb = createServiceClient()): Promise<ActivityPoint[]> {
  const { data, error } = await sb.rpc('admin_activity_series', { p_days: days })
  if (error) throw new AnalyticsUnavailable(error.message)
  return normalizeSeries(data)
}

export async function loadRetentionCohorts(weeks: number, sb: Sb = createServiceClient()): Promise<CohortRow[]> {
  const { data, error } = await sb.rpc('admin_retention_cohorts', { p_weeks: weeks })
  if (error) throw new AnalyticsUnavailable(error.message)
  return normalizeCohorts(data)
}

export async function loadConversion(days: number, sb: Sb = createServiceClient()): Promise<{
  activation: ActivationStats | null
  freeToPro: FreeToProStats | null
}> {
  const [event, windowDays] = await Promise.all([getSetting('activation_event'), getSetting('activation_window_days')])
  const [a, f] = await Promise.all([
    sb.rpc('admin_activation_rate', { p_days: days, p_event: event, p_window: windowDays }),
    sb.rpc('admin_free_to_pro', { p_days: days }),
  ])
  return {
    activation: a.error ? null : normalizeActivation(a.data),
    freeToPro: f.error ? null : normalizeFreeToPro(f.data),
  }
}
