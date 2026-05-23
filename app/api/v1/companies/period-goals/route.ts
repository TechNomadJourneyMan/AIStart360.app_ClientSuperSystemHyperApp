export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

// Short-cycle goals (week / month) live in survey_answers under
// well-known synthetic step=99 so we don't need a new column on
// companies. Client-driven — the user types free-form text.

const KEY_WEEK = 'goal_week_v2'
const KEY_MONTH = 'goal_month_v2'
// survey_answers.step has a CHECK constraint (0..12); reuse step 0 as a
// synthetic "metadata" slot — clients never submit step 0 through the
// onboarding wizard (steps 1..12).
const STEP = 0

interface PeriodGoals {
  goal_week: string | null
  goal_month: string | null
}

export async function GET() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  const { data, error } = await sb
    .from('survey_answers')
    .select('question_key, answer')
    .eq('user_id', userId)
    .in('question_key', [KEY_WEEK, KEY_MONTH])

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const out: PeriodGoals = { goal_week: null, goal_month: null }
  for (const row of data ?? []) {
    const v = (row.answer as { value?: unknown })?.value
    if (typeof v === 'string') {
      if (row.question_key === KEY_WEEK) out.goal_week = v
      if (row.question_key === KEY_MONTH) out.goal_month = v
    }
  }
  return NextResponse.json({ ok: true, data: out })
}

export async function PATCH(req: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  let body: Partial<PeriodGoals>
  try {
    body = (await req.json()) as Partial<PeriodGoals>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  // Best-effort company lookup so company_id stays in sync.
  const { data: companyRow } = await sb
    .from('companies')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  const companyId: string | null = companyRow?.id ?? null

  const rows: Array<Record<string, unknown>> = []
  if ('goal_week' in body) {
    rows.push({
      user_id: userId,
      company_id: companyId,
      step: STEP,
      question_key: KEY_WEEK,
      answer: { value: body.goal_week ?? null },
      answered_at: new Date().toISOString(),
    })
  }
  if ('goal_month' in body) {
    rows.push({
      user_id: userId,
      company_id: companyId,
      step: STEP,
      question_key: KEY_MONTH,
      answer: { value: body.goal_month ?? null },
      answered_at: new Date().toISOString(),
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await sb
    .from('survey_answers')
    .upsert(rows, { onConflict: 'user_id,question_key' })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
