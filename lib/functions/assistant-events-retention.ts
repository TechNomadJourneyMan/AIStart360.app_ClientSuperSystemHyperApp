import { inngest } from '@/lib/inngest'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * GRI-06: 90-day retention for `assistant_events`.
 *
 * Migration 038 created the table and its RLS (owners insert/select their own,
 * staff read all, deletes are SERVICE-ROLE ONLY — "the 90-day retention cleanup
 * job") but the job itself was never scheduled, so telemetry accumulates
 * forever. This Inngest scheduled function deletes rows older than 90 days once
 * a day via the service role.
 *
 * NOTE: requires the Inngest app to be configured in prod (signing key — see
 * BE-15) for the cron to actually fire.
 */
const RETENTION_DAYS = 90

export const assistantEventsRetention = inngest.createFunction(
  {
    id: 'assistant-events-retention',
    // @ts-ignore -- inngest v4 types in this repo mis-resolve the trigger key
    // (same workaround as lib/functions/calculate-gri.ts's `event`).
    cron: 'TZ=Europe/Amsterdam 0 3 * * *',
  },
  // @ts-ignore -- handler arg types mismatch under the repo's inngest typings
  async () => {
    const sb = createServiceClient()
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { error, count } = await sb
      .from('assistant_events')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff)

    if (error) {
      throw new Error(`assistant_events retention failed: ${error.message}`)
    }
    return { deleted: count ?? 0, cutoff, retentionDays: RETENTION_DAYS }
  },
)
