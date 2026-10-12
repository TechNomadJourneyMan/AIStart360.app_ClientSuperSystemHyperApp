import { inngest } from '@/lib/inngest'
import { POINT_A_RECALC_EVENT, drainPointARecalc, requestPointARecalc } from '@/lib/point-a/recalc-queue'

/**
 * Inngest wiring of the Point A recalculation (lib/point-a/recalc-queue.ts).
 * inngest 4.x registers triggers only via `triggers: [...]`.
 */

/** Debounced per company: the last event of a wave + 20 s → one recalculation. */
export const pointARecalc = inngest.createFunction(
  {
    id: 'point-a-recalc',
    retries: 0, // retries are the queue's job (attempts + backoff in Postgres)
    debounce: { key: 'event.data.companyId', period: '20s' },
    concurrency: { limit: 1, key: 'event.data.companyId' },
    triggers: [{ event: POINT_A_RECALC_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event }: { event: { data: { companyId?: string } } }) => {
    const companyId = event.data?.companyId
    if (!companyId) return { skipped: 'no companyId' }
    return drainPointARecalc({ companyId, budgetMs: 240_000 })
  },
)

/**
 * Nightly full recalculation (03:00 UTC+5 = 22:00 UTC): a safety net against
 * missed events; unchanged companies stop at the inputs-hash check.
 */
export const pointANightly = inngest.createFunction(
  { id: 'point-a-nightly', retries: 0, concurrency: { limit: 1 }, triggers: [{ cron: '0 22 * * *' }] },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async () => {
    const { prisma } = await import('@/lib/db')
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id FROM public.companies c
      WHERE c.user_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.survey_answers s WHERE s.user_id = c.user_id)`
    let queued = 0
    for (const r of rows) {
      // Spread over the hour so the minute drain is never flooded.
      if (await requestPointARecalc(r.id, 'nightly', (queued % 60) * 60_000)) queued++
    }
    // Retention (spec §2.5): every snapshot of the last 90 days; older ones —
    // the last of each week; snapshots reviewed by an expert are kept forever.
    const pruned = await prisma.$executeRaw`
      DELETE FROM public.point_a_snapshots s
      WHERE s.created_at < now() - interval '90 days'
        AND s.reviewed_at IS NULL
        AND s.id NOT IN (
          SELECT DISTINCT ON (company_id, date_trunc('week', created_at)) id
          FROM public.point_a_snapshots
          WHERE created_at < now() - interval '90 days'
          ORDER BY company_id, date_trunc('week', created_at), created_at DESC)`
      .catch(() => 0)
    return { companies: rows.length, queued, pruned }
  },
)
