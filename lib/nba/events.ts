/**
 * lib/nba/events.ts — NBA interactions → product events (user_events).
 * nba_log stays the source for cooldowns; user_events is the single stream
 * the admin analytics reads (NBA CTR = NBA_DONE / NBA_SHOWN).
 */
import type { EventName } from '@/lib/events/registry'

export const NBA_EVENT_NAMES: Partial<Record<'shown' | 'done' | 'dismissed' | 'why_opened' | 'explained', EventName>> = {
  shown: 'NBA_SHOWN',
  done: 'NBA_DONE',
  dismissed: 'NBA_DISMISSED',
}

/** Action family only (`plan_task:<uuid>` → `plan_task`): small, aggregatable, no ids in metadata. */
export function nbaEventMetadata(actionKey: string, extra: Record<string, number | string | null> = {}): Record<string, number | string | null> {
  const family = String(actionKey).split(':')[0].slice(0, 40)
  return { action: family, ...extra }
}
