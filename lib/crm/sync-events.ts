/**
 * lib/crm/sync-events.ts — the INTEGRATION_FAILED platform event of a failed CRM sync (button or
 * automatic). One event per connection per day, so a revoked token does not alert every run.
 */
import { emitPlatformEventSafely } from '@/lib/events/platform'
import type { CrmProvider } from '@/lib/crm/types'

export function emitCrmSyncFailed(
  conn: { id: string; user_id: string; provider: CrmProvider },
  message: string,
  opts: { companyId?: string | null; now?: Date } = {},
): void {
  const day = (opts.now ?? new Date()).toISOString().slice(0, 10)
  emitPlatformEventSafely({
    name: 'INTEGRATION_FAILED',
    companyId: opts.companyId ?? null,
    subjectType: 'crm_connection',
    subjectId: conn.id,
    actor: conn.user_id,
    payload: { provider: conn.provider, error: message.slice(0, 300) },
    dedupeKey: `integration_failed:${conn.id}:${day}`,
  })
}
