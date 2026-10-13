/**
 * lib/point-a/recalc-queue.ts — event-driven Point A recalculation with a
 * per-company debounce (spec 2026-10-12 §2.4; table point_a_recalc_queue,
 * migration 111).
 *
 *   requestPointARecalc  every data event of a company upserts ONE row:
 *                        due_at slides to now + 20 s, the reason is added.
 *                        Ten uploads in a row → one recalculation.
 *   drainPointARecalc    claims due rows (FOR UPDATE SKIP LOCKED, one
 *                        recalculation per company at a time), builds the
 *                        snapshot, then removes the row — or keeps it when a
 *                        new event arrived during the run (one more pass).
 *
 * Drained by the Inngest function `point-a-recalc` (debounced per company,
 * when Inngest is configured) and, in any case, every minute by
 * agentsMaintenance — so it works without Inngest too.
 */
import { prisma } from '@/lib/db'

export const RECALC_DEBOUNCE_MS = 20_000
export const POINT_A_RECALC_EVENT = 'point-a/recalc.requested'
const MAX_ATTEMPTS = 5
const STALE_CLAIM_MINUTES = 10

/** Data events that change what Point A is built from. */
export const POINT_A_TRIGGER_EVENTS: ReadonlySet<string> = new Set([
  'SURVEY_ANSWER_CHANGED',
  'QUESTIONNAIRE_COMPLETED',
  'ONBOARDING_COMPLETED',
  'FILE_PROCESSED',
  'DOCUMENT_DELETED',
  'DISCREPANCY_RESOLVED',
  'TARGET_CHANGED',
  'BLOCK_CONFIG_CHANGED',
  'METRIC_UPDATED',
  'MANUAL_VALUE_SET',
])

/** The queue table itself is missing (migration 111 not applied) — not any other error. */
function missingTable(err: unknown): boolean {
  const meta = (err as { meta?: { code?: string } } | null)?.meta
  if (meta?.code === '42P01') return true
  const msg = err instanceof Error ? err.message : String(err)
  return /relation "(public\.)?point_a_recalc_queue" does not exist/i.test(msg)
}

/** Longest a stream of events may postpone a recalculation (debounce ceiling). */
const MAX_WAIT_SECONDS = 120
/** Without Inngest, a request waits at most this long in the background before draining. */
const INLINE_MAX_DELAY_S = 30

/**
 * Drain this company's due recalculation in the background of the current
 * request (Vercel waitUntil) — the path that works without Inngest and
 * without a minute cron. Never throws.
 */
export function drainInBackground(companyId: string, delayMs = 0): void {
  // Only on Vercel (waitUntil keeps the work alive); never in tests or a
  // local dev server pointed at the production database.
  if (process.env.VERCEL !== '1') return
  void import('@/lib/background').then(({ runInBackground }) =>
    runInBackground('point-a-recalc', async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      await drainPointARecalc({ companyId, budgetMs: 45_000 })
    }),
  ).catch(() => {})
}

function inngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY) || process.env.INNGEST_DEV === '1'
}

/**
 * Queue a recalculation of the company. Never throws; false when the
 * automatic recalculation is switched off or the queue does not exist yet.
 */
export async function requestPointARecalc(
  companyId: string,
  reason: string,
  delayMs = RECALC_DEBOUNCE_MS,
  opts: { slide?: boolean } = {},
): Promise<boolean> {
  try {
    const { getSetting } = await import('@/lib/settings/store')
    if (!(await getSetting('point_a_auto_recalc'))) return false
    const seconds = Math.max(0, Math.round(delayMs / 1000))
    // An event slides the due time (debounce), but never further than
    // MAX_WAIT_SECONDS after the first pending request; a scheduled request
    // (slide: false) never postpones one that is already due earlier.
    if (opts.slide === false) {
      await prisma.$executeRaw`
        INSERT INTO public.point_a_recalc_queue (company_id, reasons, requested_at, due_at, first_requested_at)
        VALUES (${companyId}, ARRAY[${reason}]::text[], now(), now() + make_interval(secs => ${seconds}::int), now())
        ON CONFLICT (company_id) DO UPDATE SET
          reasons = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(point_a_recalc_queue.reasons || EXCLUDED.reasons) AS x)),
          due_at = LEAST(point_a_recalc_queue.due_at, EXCLUDED.due_at)`
    } else {
      await prisma.$executeRaw`
        INSERT INTO public.point_a_recalc_queue (company_id, reasons, requested_at, due_at, first_requested_at)
        VALUES (${companyId}, ARRAY[${reason}]::text[], now(), now() + make_interval(secs => ${seconds}::int), now())
        ON CONFLICT (company_id) DO UPDATE SET
          reasons = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(point_a_recalc_queue.reasons || EXCLUDED.reasons) AS x)),
          requested_at = now(),
          due_at = GREATEST(
            LEAST(EXCLUDED.due_at, point_a_recalc_queue.first_requested_at + make_interval(secs => ${MAX_WAIT_SECONDS}::int)),
            -- a failed run backs off; new events do not cut the backoff short
            CASE WHEN point_a_recalc_queue.last_error IS NOT NULL THEN point_a_recalc_queue.due_at ELSE '-infinity'::timestamptz END)`
    }
    if (inngestConfigured()) {
      const { inngest } = await import('@/lib/inngest')
      await inngest.send({ name: POINT_A_RECALC_EVENT, data: { companyId } }).catch((err: unknown) => {
        console.error('[point-a/queue] inngest send failed', err instanceof Error ? err.message : err)
      })
    } else if (seconds <= INLINE_MAX_DELAY_S) {
      // No Inngest (production had none configured): run the drain after the
      // debounce in the background of this request. A newer event that slid
      // the due time runs its own; the drain only claims due rows, once.
      drainInBackground(companyId, seconds * 1000 + 1_000)
    }
    return true
  } catch (err) {
    if (!missingTable(err)) console.error('[point-a/queue] request failed', companyId, err instanceof Error ? err.message : err)
    return false
  }
}

export interface Claimed {
  company_id: string
  reasons: string[]
  started_at: Date
  attempts: number
}

async function claimDue(limit: number, companyId?: string): Promise<Claimed[]> {
  return companyId
    ? prisma.$queryRaw<Claimed[]>`
        UPDATE public.point_a_recalc_queue q SET started_at = now(), attempts = q.attempts + 1
        WHERE q.company_id IN (
          SELECT company_id FROM public.point_a_recalc_queue
          WHERE company_id = ${companyId} AND due_at <= now() + interval '5 seconds'
            AND (started_at IS NULL OR started_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}::int))
          FOR UPDATE SKIP LOCKED)
        RETURNING q.company_id, q.reasons, q.started_at, q.attempts`
    : prisma.$queryRaw<Claimed[]>`
        UPDATE public.point_a_recalc_queue q SET started_at = now(), attempts = q.attempts + 1
        WHERE q.company_id IN (
          SELECT company_id FROM public.point_a_recalc_queue
          WHERE due_at <= now()
            AND (started_at IS NULL OR started_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}::int))
          ORDER BY due_at
          LIMIT ${limit}::int
          FOR UPDATE SKIP LOCKED)
        RETURNING q.company_id, q.reasons, q.started_at, q.attempts`
}

/**
 * Hold the company for a recalculation outside the drain (the manual
 * «Пересчитать»): claims its queue row — pending or not — so the drain never
 * runs the same company at the same time. null = a recalculation is running.
 * Release with `finish`.
 */
export async function claimCompany(companyId: string, reason: string): Promise<Claimed | null> {
  const rows = await prisma.$queryRaw<Claimed[]>`
    INSERT INTO public.point_a_recalc_queue (company_id, reasons, requested_at, due_at, first_requested_at, started_at, attempts)
    VALUES (${companyId}, ARRAY[${reason}]::text[], now(), now(), now(), now(), 1)
    ON CONFLICT (company_id) DO UPDATE SET
      started_at = now(),
      attempts = point_a_recalc_queue.attempts + 1,
      reasons = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(point_a_recalc_queue.reasons || EXCLUDED.reasons) AS x))
    WHERE point_a_recalc_queue.started_at IS NULL
       OR point_a_recalc_queue.started_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}::int)
    RETURNING company_id, reasons, started_at, attempts`
  return rows[0] ?? null
}

/** Done: remove the row unless a new event arrived meanwhile (then run once more). */
export async function finish(c: Claimed): Promise<void> {
  // Compared in SQL with the row's own started_at (microseconds): a JS Date
  // parameter is truncated to milliseconds and almost never matched.
  const removed = await prisma.$executeRaw`
    DELETE FROM public.point_a_recalc_queue WHERE company_id = ${c.company_id} AND requested_at <= started_at`
  if (removed === 0) {
    await prisma.$executeRaw`
      UPDATE public.point_a_recalc_queue
      SET started_at = NULL, attempts = 0, last_error = NULL, first_requested_at = requested_at
      WHERE company_id = ${c.company_id}`
  }
}

/** Failed: retry with a growing delay; give up after MAX_ATTEMPTS. */
export async function fail(c: Claimed, error: string): Promise<void> {
  if (c.attempts >= MAX_ATTEMPTS) {
    console.error('[point-a/queue] giving up', c.company_id, error)
    await prisma.$executeRaw`DELETE FROM public.point_a_recalc_queue WHERE company_id = ${c.company_id}`
    return
  }
  await prisma.$executeRaw`
    UPDATE public.point_a_recalc_queue
    SET started_at = NULL, last_error = ${error.slice(0, 500)}, due_at = now() + make_interval(mins => ${c.attempts}::int)
    WHERE company_id = ${c.company_id}`
}

export interface DrainReport {
  done: Array<{ companyId: string; status: string }>
  failed: Array<{ companyId: string; error: string }>
}

export interface DrainDeps {
  claim: typeof claimDue
  finish: typeof finish
  fail: typeof fail
  build: (companyId: string, reasons: string[]) => Promise<{ status: string }>
}

const defaultDrainDeps: DrainDeps = {
  claim: claimDue,
  finish,
  fail,
  build: async (companyId, reasons) => {
    const { buildPointASnapshot } = await import('./snapshot')
    return buildPointASnapshot(companyId, { trigger: reasons.length > 0 && reasons.every((r) => r === 'nightly') ? 'schedule' : 'event', reasons })
  },
}

/** Run the due recalculations (all, or of one company) within `budgetMs`. */
export async function drainPointARecalc(
  opts: { budgetMs?: number; companyId?: string; batch?: number } = {},
  deps: DrainDeps = defaultDrainDeps,
): Promise<DrainReport> {
  const report: DrainReport = { done: [], failed: [] }
  const deadline = Date.now() + (opts.budgetMs ?? 60_000)
  try {
    while (Date.now() < deadline) {
      const claimed = await deps.claim(opts.batch ?? 3, opts.companyId)
      if (!claimed.length) break
      for (const c of claimed) {
        try {
          const r = await deps.build(c.company_id, c.reasons ?? [])
          await deps.finish(c)
          report.done.push({ companyId: c.company_id, status: r.status })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          report.failed.push({ companyId: c.company_id, error: msg })
          await deps.fail(c, msg).catch(() => undefined)
        }
      }
      if (opts.companyId) break
    }
  } catch (err) {
    if (!missingTable(err)) throw err
  }
  return report
}
