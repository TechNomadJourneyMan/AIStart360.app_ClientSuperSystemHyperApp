export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { aggregatePointA } from '@/lib/point-a/aggregator'
import type { ApiResult, PointA } from '@/types/onboarding'

/**
 * Look up the caller's first owned company. Phase 4 only deals
 * with a single company per user; multi-tenant support comes
 * later. Returns null if the user has no company yet.
 */
async function resolveCompanyId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  // Prod schema drift: `companies` table uses camelCase `createdAt`,
  // not snake_case `created_at`. Sort by `id` (always present) — for
  // a single-company-per-user world the order doesn't matter much.
  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .eq('user_id', userId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return (data.id as string) ?? null
}

function unauthorized(): NextResponse {
  const body: ApiResult<PointA> = { ok: false, error: 'Unauthorized' }
  return NextResponse.json(body, { status: 401 })
}

function noCompany(): NextResponse {
  const body: ApiResult<PointA> = {
    ok: false,
    error: 'No company found for user',
  }
  return NextResponse.json(body, { status: 404 })
}

/**
 * GET /api/v1/point-a/aggregate
 *
 * Returns the merged Phase 4 Point A payload (legacy rule-based
 * scoring + `intelligence` block). Does NOT re-materialize the
 * `public.metrics` table — that's a write side-effect reserved
 * for the POST handler.
 */
export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return unauthorized()

  const companyId = await resolveCompanyId(supabase, user.id)
  if (!companyId) return noCompany()

  try {
    const pointA = await aggregatePointA(supabase, user.id, companyId, {
      skipMaterialize: true,
    })
    const body: ApiResult<PointA> = { ok: true, data: pointA }
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    const body: ApiResult<PointA> = {
      ok: false,
      error: `aggregate failed: ${message}`,
    }
    return NextResponse.json(body, { status: 500 })
  }
}

/**
 * POST /api/v1/point-a/aggregate
 *
 * Same payload as GET, but also forces a fresh write into
 * `public.metrics`. Use this after the owner uploads a new
 * document or finishes a survey step.
 */
export async function POST() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) return unauthorized()

  const companyId = await resolveCompanyId(supabase, user.id)
  if (!companyId) return noCompany()

  try {
    const pointA = await aggregatePointA(supabase, user.id, companyId)
    const body: ApiResult<PointA> = { ok: true, data: pointA }
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    const body: ApiResult<PointA> = {
      ok: false,
      error: `aggregate failed: ${message}`,
    }
    return NextResponse.json(body, { status: 500 })
  }
}
