export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import {
  computeTop5Limits,
  generate90DayPlan,
} from '@/lib/gri-calculator/top5-action-plan'

// Section IDs from lib/gri-assessment/sections.ts. We don't import to keep
// this route resilient to widget edits — the resolver-style approach is to
// compute over whatever sectionIds the client posted.
//
// Scores shape: { [sectionId: string]: { [criterionId: string]: number 1..10 } }
type Scores = Record<string, Record<string, number>>

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Per-section mean across numeric criterion scores. Non-numeric / zero values
 * are skipped so an unanswered criterion doesn't pull the average down.
 */
function computeSectionAvgs(scores: Scores): Record<string, number> {
  const out: Record<string, number> = {}
  if (!scores || typeof scores !== 'object') return out

  for (const [sectionId, criteria] of Object.entries(scores)) {
    if (!criteria || typeof criteria !== 'object') {
      out[sectionId] = 0
      continue
    }
    const values: number[] = []
    for (const v of Object.values(criteria)) {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n) && n > 0) values.push(n)
    }
    out[sectionId] = values.length === 0
      ? 0
      : roundTo2(values.reduce((a, b) => a + b, 0) / values.length)
  }
  return out
}

/**
 * Overall index = mean of section averages that have any data (> 0).
 * 0..10, rounded to 2 decimals.
 */
function computeGriIndex(sectionAvgs: Record<string, number>): number {
  const positive = Object.values(sectionAvgs).filter((v) => Number.isFinite(v) && v > 0)
  if (positive.length === 0) return 0
  return roundTo2(positive.reduce((a, b) => a + b, 0) / positive.length)
}

// =============================================================================
// POST /api/v1/gri/assessment
// Body: { onboarding, scores, completedSections }
// =============================================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const { onboarding, scores, completedSections } = body as {
      onboarding?: unknown
      scores?: unknown
      completedSections?: unknown
    }

    if (!scores || typeof scores !== 'object') {
      return NextResponse.json({ ok: false, error: 'scores object required' }, { status: 400 })
    }

    const sb = createServerClient()
    const { data: userData, error: userErr } = await sb.auth.getUser()
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
    const userId = userData.user.id

    // Lookup company (best-effort — null is OK; field is nullable).
    const { data: companyRow } = await sb
      .from('companies')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    const companyId: string | null = companyRow?.id ?? null

    // Server computes roll-ups so the DB row is the source of truth.
    const typedScores = scores as Scores
    const section_avgs = computeSectionAvgs(typedScores)
    const gri_index = computeGriIndex(section_avgs)

    // Derived insights — TOP-5 limitations and the 90-day action plan.
    const top_5_limits = computeTop5Limits(typedScores, GRI_SECTIONS)
    const action_plan_90d = generate90DayPlan(top_5_limits, section_avgs)

    const baseRow = {
      user_id: userId,
      company_id: companyId,
      onboarding: (onboarding && typeof onboarding === 'object') ? onboarding : {},
      scores: typedScores,
      section_avgs,
      gri_index,
      completed_sections: (completedSections && typeof completedSections === 'object')
        ? completedSections
        : {},
    }
    // Persist derived columns best-effort: if the JSONB columns don't exist yet
    // (migration not applied), retry the insert without them.
    const rowWithDerived = { ...baseRow, top_5_limits, action_plan_90d }

    const isMissingColumnError = (msg: string | undefined): boolean =>
      typeof msg === 'string' &&
      /column .* does not exist|could not find the .* column|schema cache/i.test(msg)

    let { data: inserted, error: insertErr } = await sb
      .from('gri_assessments')
      .insert(rowWithDerived)
      .select('id, gri_index, section_avgs, created_at')
      .single()

    if (insertErr && isMissingColumnError(insertErr.message)) {
      ;({ data: inserted, error: insertErr } = await sb
        .from('gri_assessments')
        .insert(baseRow)
        .select('id, gri_index, section_avgs, created_at')
        .single())
    }

    if (insertErr) {
      return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      data: { ...inserted, top_5_limits, action_plan_90d },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid request'
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}

// =============================================================================
// GET /api/v1/gri/assessment[?history=1]
// =============================================================================
export async function GET(req: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  const wantsHistory = req.nextUrl.searchParams.get('history') === '1'

  if (wantsHistory) {
    const { data, error } = await sb
      .from('gri_assessments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const history = data ?? []
    const current = history.find((r) => r.is_current) ?? history[0] ?? null
    return NextResponse.json({ ok: true, data: { current, history } })
  }

  // Default: current row only.
  const { data, error } = await sb
    .from('gri_assessments')
    .select('*')
    .eq('user_id', userId)
    .eq('is_current', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: { current: data ?? null } })
}
