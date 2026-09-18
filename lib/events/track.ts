import { createServiceClient } from '@/lib/supabase-service'
import { EVENTS, isEventName, sanitizeMetadata, sanitizePage, type EventName } from './registry'

export interface TrackInput {
  userId: string | null
  name: EventName
  page?: string | null
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown>
  source?: 'web' | 'server' | 'admin' | 'impersonation'
  sessionId?: string | null
  impersonationSessionId?: string | null
}

export function toEventRow(e: TrackInput) {
  return {
    user_id: e.userId,
    event_name: e.name,
    event_type: EVENTS[e.name].type,
    page: sanitizePage(e.page),
    entity_type: e.entityType ?? null,
    entity_id: e.entityId ?? null,
    metadata: sanitizeMetadata(e.metadata),
    source: e.source ?? 'server',
    session_id: e.sessionId ? String(e.sessionId).slice(0, 64) : null,
    impersonation_session_id: e.impersonationSessionId ?? null,
  }
}

/**
 * Record a product event. Never throws and never blocks the caller's
 * business logic for long: analytics failures are logged, not propagated.
 */
export async function trackEvent(e: TrackInput): Promise<void> {
  if (!isEventName(e.name)) return
  try {
    const { error } = await createServiceClient().from('user_events').insert(toEventRow(e))
    if (error) console.error('[events] insert failed:', e.name, error.message)
  } catch (err) {
    console.error('[events] insert failed:', e.name, err instanceof Error ? err.message : err)
  }
}

/** Record `name` only if this user has no such event yet (optionally per entity). */
export async function trackEventOnce(e: TrackInput): Promise<void> {
  if (!e.userId || !isEventName(e.name)) return
  try {
    let q = createServiceClient().from('user_events').select('id').eq('user_id', e.userId).eq('event_name', e.name)
    if (e.entityId) q = q.eq('entity_id', e.entityId)
    const { data } = await q.limit(1)
    if (data && data.length) return
  } catch {
    return
  }
  await trackEvent(e)
}
