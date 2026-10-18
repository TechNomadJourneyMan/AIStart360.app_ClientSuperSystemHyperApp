/**
 * components/point-b/pointBAccess.ts — the framework-free part of the Point B
 * tariff gate (spec §19, plan Phase 1 Task 8), so it can be tested without a DOM.
 *
 * The master switch `access_gates` stays the single authority: while it is off
 * (`gatesEnabled === false`) nothing is restricted. The server enforces the
 * same rule on the API (402); this only decides what the page draws.
 */

import { isStaffRole } from '@/lib/api-identity'

export type PointBAccessState = 'loading' | 'open' | 'locked'

export function resolvePointBAccess(input: { loading: boolean; gatesEnabled: boolean; pointB: boolean }): PointBAccessState {
  // Until the answer is in, nothing of the client's data is requested or drawn.
  if (input.loading) return 'loading'
  return input.gatesEnabled && !input.pointB ? 'locked' : 'open'
}

/** The page behind a 402 from the API is locked too (the switch was turned on after the page loaded). */
export function isUpgradeRequired(status: number, body: { error?: unknown } | null | undefined): boolean {
  return status === 402 || body?.error === 'upgrade_required'
}

export type UpgradeRequestState = 'sent' | 'error'

/** Same request the sidebar upgrade modal sends (POST /api/v1/upgrade-request, user from the session). */
export async function sendUpgradeRequest(fetchFn: typeof fetch): Promise<UpgradeRequestState> {
  try {
    const res = await fetchFn('/api/v1/upgrade-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureKey: '/point-b' }),
    })
    return res.ok ? 'sent' : 'error'
  } catch {
    return 'error'
  }
}

/**
 * `/point-b` in the dashboard shell is the staff view; a client (including the legacy
 * `owner` and an unknown role) belongs on the cabinet page `/client/point-b`.
 */
export function isClientForPointB(role: string | null | undefined): boolean {
  return !isStaffRole(role)
}
