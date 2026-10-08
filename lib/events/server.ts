/**
 * lib/events/server.ts — server-side emit for actions of the SESSION user.
 *
 * Same as trackEvent, but marks the event as `impersonation` when a staff
 * member is acting inside the user's cabinet, so admin clicks never count as
 * the client's own activity (daily_activity / DAU / cohorts use web+server only).
 * Never throws; analytics must not break the calling route.
 */
import { activeImpersonation } from '@/lib/impersonation/server'
import { trackEvent, type TrackInput } from './track'

export async function trackUserAction(e: Omit<TrackInput, 'source' | 'impersonationSessionId'>): Promise<void> {
  try {
    const imp = e.userId ? await activeImpersonation(e.userId).catch(() => null) : null
    await trackEvent({
      ...e,
      source: imp ? 'impersonation' : 'server',
      impersonationSessionId: imp?.sid ?? null,
    })
  } catch (err) {
    console.error('[events] trackUserAction failed:', e.name, err instanceof Error ? err.message : err)
  }
}
