export const dynamic = 'force-dynamic'

// app/api/v1/gri/plan-progress/route.ts — галочки интерактивного плана 90 дней
// (Фаза 5, идея №4). Таблица public.gri_plan_progress (миграция 047), RLS «только
// свои строки»; здесь дополнительно фильтруем по user_id сессии (belt-and-braces).
//
// GET  ?assessment_id=<uuid>                       → { ok, done: string[] }
// PATCH { assessment_id, step_key, done: boolean } → done=true: upsert, done=false: delete
//
// Устойчивость к неприменённой миграции 047: GET отвечает
// { ok:true, done:[], unavailable:true }, PATCH — 503 migration_047_required
// (клиент переходит в read-only, это НЕ крэш).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { isValidStepKey } from '@/lib/gri/plan-progress'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PostgREST при отсутствующей таблице: 42P01 (relation does not exist) либо
// PGRST205 / «Could not find the table ... in the schema cache».
function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === '42P01' || err.code === 'PGRST205') return true
  return (
    typeof err.message === 'string' &&
    /relation .* does not exist|could not find the table|schema cache/i.test(err.message)
  )
}

// =============================================================================
// GET /api/v1/gri/plan-progress?assessment_id=<uuid>
// =============================================================================
export async function GET(req: NextRequest) {
  const assessmentId = req.nextUrl.searchParams.get('assessment_id') ?? ''
  if (!UUID_RE.test(assessmentId)) {
    return NextResponse.json(
      { ok: false, error: 'assessment_id must be a uuid' },
      { status: 422 },
    )
  }

  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await sb
    .from('gri_plan_progress')
    .select('step_key')
    .eq('user_id', userData.user.id)
    .eq('assessment_id', assessmentId)

  if (error) {
    // Миграция 047 не применена — деградируем в read-only, не 500.
    if (isMissingRelation(error)) {
      return NextResponse.json({ ok: true, done: [], unavailable: true })
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const done = (data ?? [])
    .map((r) => (r as { step_key?: unknown }).step_key)
    .filter((k): k is string => typeof k === 'string')

  return NextResponse.json({ ok: true, done })
}

// =============================================================================
// PATCH /api/v1/gri/plan-progress
// Body: { assessment_id: uuid, step_key: string, done: boolean }
// =============================================================================
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 422 })
  }

  const { assessment_id, step_key, done } = body as {
    assessment_id?: unknown
    step_key?: unknown
    done?: unknown
  }

  if (typeof assessment_id !== 'string' || !UUID_RE.test(assessment_id)) {
    return NextResponse.json(
      { ok: false, error: 'assessment_id must be a uuid' },
      { status: 422 },
    )
  }
  if (!isValidStepKey(step_key)) {
    return NextResponse.json(
      { ok: false, error: 'step_key must look like days_1_30-c0' },
      { status: 422 },
    )
  }
  if (typeof done !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'done must be a boolean' }, { status: 422 })
  }

  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  const { error } = done
    ? await sb
        .from('gri_plan_progress')
        .upsert(
          { user_id: userId, assessment_id, step_key },
          { onConflict: 'user_id,assessment_id,step_key' },
        )
    : await sb
        .from('gri_plan_progress')
        .delete()
        .eq('user_id', userId)
        .eq('assessment_id', assessment_id)
        .eq('step_key', step_key)

  if (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json(
        { ok: false, error: 'migration_047_required' },
        { status: 503 },
      )
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, done })
}
