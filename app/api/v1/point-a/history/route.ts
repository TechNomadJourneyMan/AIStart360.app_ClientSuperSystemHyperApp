export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  listPointASnapshots,
  getPointAByVersion,
  computeDiff,
  type PointASnapshot,
  type PointADiff,
} from '@/lib/point-a/history'

const DEFAULT_LIMIT = 20

/**
 * GET /api/v1/point-a/history
 *   → { ok: true, data: { snapshots: PointASnapshot[] } }
 *
 * GET /api/v1/point-a/history?compare=N
 *   → { ok: true, data: { snapshots, diff: PointADiff | null } }
 *     diff compares the CURRENT version against version N (next - prev = current - N).
 *
 * Optional `?limit=` overrides the default snapshot cap (20).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    )
  }

  const url = req.nextUrl
  const compareParam = url.searchParams.get('compare')
  const limitParam = url.searchParams.get('limit')
  const limit =
    limitParam && Number.isFinite(Number(limitParam))
      ? Math.max(1, Math.min(100, Number(limitParam)))
      : DEFAULT_LIMIT

  const snapshots: PointASnapshot[] = await listPointASnapshots(
    supabase,
    user.id,
    limit,
  )

  if (compareParam == null) {
    return NextResponse.json({ ok: true, data: { snapshots } })
  }

  const compareVersion = Number(compareParam)
  if (!Number.isFinite(compareVersion) || !Number.isInteger(compareVersion)) {
    return NextResponse.json(
      { ok: false, error: 'compare must be an integer version' },
      { status: 400 },
    )
  }

  const current = snapshots.find((s) => s.isCurrent) ?? snapshots[0]
  let diff: PointADiff | null = null

  if (current && current.version !== compareVersion) {
    const [prev, next] = await Promise.all([
      getPointAByVersion(supabase, user.id, compareVersion),
      getPointAByVersion(supabase, user.id, current.version),
    ])
    if (prev && next) {
      diff = computeDiff(prev, next, compareVersion, current.version)
    }
  }

  return NextResponse.json({ ok: true, data: { snapshots, diff } })
}
