import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { MetricSummary } from '@/types/metrics'

// GET /api/v1/metrics — legacy KPI summary endpoint.
//
// DATA INTEGRITY (D3): never returns mock/fabricated numbers. When there is no
// real per-user source we return an empty list and the UI renders an explicit
// "—" empty state.
//
// MULTI-TENANT: this endpoint used to return the most-recent row of the legacy
// Prisma `financial_snapshots` table (keyed by `orgId`, populated only by
// `prisma/seed.ts`). That table is NOT linked to the Supabase auth user
// (`profiles.organization` is free text, not an FK), so returning the latest row
// leaked one org's seeded numbers (e.g. ₸84.2М) to EVERY user. Until a real,
// per-user financial source is wired through the resolver (`public.metrics` via
// `/api/v1/metrics/catalog`), this endpoint requires a session and returns an
// empty list rather than an unattributable snapshot. See docs/metrics-data-lineage.md.

export async function GET(req: Request) {
  // Echo the standard Point A filter triplet so the client cache key varies per filter.
  const { searchParams } = new URL(req.url)
  void searchParams.get('period')
  void searchParams.get('product')
  void searchParams.get('manager')

  try {
    // Require an authenticated session — never serve metric data anonymously.
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ source: 'empty', data: [] as MetricSummary[] }, { status: 401 })
    }

    // No safely-attributable per-user financial snapshot source exists yet, so
    // return an honest empty list rather than the global, org-keyed legacy rows.
    return NextResponse.json({ source: 'empty', data: [] as MetricSummary[] })
  } catch (err) {
    console.error('[api/v1/metrics]', err)
    return NextResponse.json({ source: 'error', data: [] as MetricSummary[] }, { status: 200 })
  }
}
