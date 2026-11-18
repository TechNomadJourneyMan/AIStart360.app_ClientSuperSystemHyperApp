/**
 * lib/crm/sync-cron.ts — the automatic CRM sync (GET /api/cron/crm-sync, lib/cron/schedule.ts).
 *
 * Every run picks the active connections never synced, those catching up (a pass of a large CRM in
 * progress, or writes that stopped — sync_cursor.catching_up) last synced more than
 * CRM_AUTO_SYNC_CATCH_UP_MS (20 min) ago, and those last synced more than CRM_AUTO_SYNC_INTERVAL_MS
 * (6 h) ago — in that order, the oldest first — and runs the same core as the button
 * (lib/crm/sync.ts, syncCrmConnection) on each with the service client:
 *   • at most CRM_AUTO_SYNC_CONCURRENCY (2) at a time;
 *   • the whole run ends within CRM_AUTO_SYNC_RUN_MS (44 s, the ≤45 s rule for background work):
 *     one sync gets at most CRM_AUTO_SYNC_PER_CONNECTION_MS and never past the run's end, and no
 *     sync starts with less than CRM_AUTO_SYNC_MIN_START_MS left — the rest waits for the next run;
 *   • a failure of one connection never stops the others; each connection records its own
 *     last_sync_status / last_sync_error (the core does; an unexpected throw is recorded here);
 *   • a connection whose sync is already running (the button, lease) is skipped: `busy`.
 * The schedule (twice an hour, :17 and :47) and these bounds give every connection a sync about
 * every 6 h as long as the due ones fit in the runs (≈ 4 per run at worst, ≈ 180 per day).
 * The run itself is journalled in ops_job_runs by the scheduler (lib/cron/runner.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Resolver } from '@/lib/crm/endpoint-guard'
import { syncCrmConnection, type CrmSyncReport, type SyncConnection, type SyncOptions } from '@/lib/crm/sync'

export const CRM_AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60_000
/** A connection catching up is synced again after this (so every :17 / :47 run continues it). */
export const CRM_AUTO_SYNC_CATCH_UP_MS = 20 * 60_000
export const CRM_AUTO_SYNC_CONCURRENCY = 2
export const CRM_AUTO_SYNC_RUN_MS = 44_000
export const CRM_AUTO_SYNC_PER_CONNECTION_MS = 30_000
export const CRM_AUTO_SYNC_MIN_START_MS = 12_000
/** Connections looked at per run (more than a run can finish; the rest are next in line). */
export const CRM_AUTO_SYNC_PICK = 20

const CONNECTION_COLUMNS = 'id, user_id, provider, base_url, access_token'

export interface AutoSyncDeps {
  sb: SupabaseClient
  now?: () => number
  /** The sync of one connection (tests); default syncCrmConnection. */
  sync?: (sb: SupabaseClient, conn: SyncConnection, opts: SyncOptions) => Promise<CrmSyncReport>
  /** Called for every connection that ended in 'error' (the route emits INTEGRATION_FAILED). */
  onError?: (conn: SyncConnection, message: string) => void
  resolve?: Resolver
}

export interface AutoSyncResult {
  /** Connections due in this run (at most CRM_AUTO_SYNC_PICK). */
  due: number
  started: number
  success: number
  partial: number
  error: number
  /** Skipped: another sync of the connection was running. */
  busy: number
  /** Due, but left for the next run (the time of this one ran out). */
  deferred: number
  elapsedMs: number
}

/** Throws only when the due connections cannot be read; per-connection failures are counted. */
export async function runCrmAutoSync(deps: AutoSyncDeps): Promise<AutoSyncResult> {
  const now = deps.now ?? Date.now
  const sync = deps.sync ?? syncCrmConnection
  const t0 = now()
  const runEnd = t0 + CRM_AUTO_SYNC_RUN_MS
  const cutoff = new Date(t0 - CRM_AUTO_SYNC_INTERVAL_MS).toISOString()
  const catchUpCutoff = new Date(t0 - CRM_AUTO_SYNC_CATCH_UP_MS).toISOString()

  const never = await deps.sb
    .from('crm_provider_connections')
    .select(CONNECTION_COLUMNS)
    .eq('is_active', true)
    .is('last_sync_at', null)
    .order('created_at', { ascending: true })
    .limit(CRM_AUTO_SYNC_PICK)
  if (never.error) throw new Error(`crm-sync: due connections not read: ${never.error.code ?? ''} ${never.error.message ?? ''}`)
  const catchingUp = await deps.sb
    .from('crm_provider_connections')
    .select(CONNECTION_COLUMNS)
    .eq('is_active', true)
    .eq('sync_cursor->>catching_up', 'true')
    .lt('last_sync_at', catchUpCutoff)
    .order('last_sync_at', { ascending: true })
    .limit(CRM_AUTO_SYNC_PICK)
  if (catchingUp.error) throw new Error(`crm-sync: due connections not read: ${catchingUp.error.code ?? ''} ${catchingUp.error.message ?? ''}`)
  const stale = await deps.sb
    .from('crm_provider_connections')
    .select(CONNECTION_COLUMNS)
    .eq('is_active', true)
    .lt('last_sync_at', cutoff)
    .order('last_sync_at', { ascending: true })
    .limit(CRM_AUTO_SYNC_PICK)
  if (stale.error) throw new Error(`crm-sync: due connections not read: ${stale.error.code ?? ''} ${stale.error.message ?? ''}`)
  const seen = new Set<string>()
  const due = [...(never.data ?? []), ...(catchingUp.data ?? []), ...(stale.data ?? [])]
    .map((c) => c as SyncConnection)
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .slice(0, CRM_AUTO_SYNC_PICK)

  const result: AutoSyncResult = { due: due.length, started: 0, success: 0, partial: 0, error: 0, busy: 0, deferred: 0, elapsedMs: 0 }
  let next = 0

  const worker = async () => {
    while (next < due.length) {
      const startAt = now()
      if (runEnd - startAt < CRM_AUTO_SYNC_MIN_START_MS) return
      const conn = due[next++]
      result.started++
      let report: Pick<CrmSyncReport, 'status' | 'message'>
      try {
        report = await sync(deps.sb, conn, {
          deadlineAt: Math.min(startAt + CRM_AUTO_SYNC_PER_CONNECTION_MS, runEnd),
          now,
          resolve: deps.resolve,
        })
      } catch (e) {
        // syncCrmConnection records its own failures; this is a throw it did not expect.
        const message = `Автосинхронизация прервалась: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
        report = { status: 'error', message }
        const { error } = await deps.sb
          .from('crm_provider_connections')
          .update({ last_sync_at: new Date(now()).toISOString(), last_sync_status: 'error', last_sync_error: message })
          .eq('id', conn.id)
          .eq('user_id', conn.user_id)
        if (error) console.error(`[cron/crm-sync] status of ${conn.id} not recorded: ${error.code ?? ''}`)
      }
      result[report.status]++
      if (report.status === 'error') {
        try {
          deps.onError?.(conn, report.message)
        } catch {
          // an alert must never stop the other connections
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CRM_AUTO_SYNC_CONCURRENCY, due.length) }, worker))
  result.deferred = due.length - result.started
  result.elapsedMs = now() - t0
  return result
}
