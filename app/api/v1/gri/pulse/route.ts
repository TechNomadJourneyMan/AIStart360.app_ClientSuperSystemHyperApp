export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'

// The 7 GRI section ids — derived from sections.ts so the pulse always tracks
// the same blocks as the full diagnostic. Used to validate POST bodies.
const SECTION_IDS = GRI_SECTIONS.map((s) => s.id) as string[]

// scores shape: { [sectionId]: integer 1..10 }
type PulseScores = Record<string, number>

export interface GriPulseRow {
  id: string
  user_id: string
  company_id: string | null
  week_start: string
  scores: PulseScores
  pulse_index: number
  note: string | null
  created_at: string
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Monday (UTC) of the week containing `now`, as an ISO date string (YYYY-MM-DD).
 * getUTCDay(): 0=Sun..6=Sat. Shift so Monday is the anchor.
 */
function mondayOfWeekUTC(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay() // 0..6, Sun=0
  const diff = dow === 0 ? 6 : dow - 1 // days since Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

// =============================================================================
// GET /api/v1/gri/pulse
// Returns { current_week, history (last 26 asc), baseline }
// =============================================================================
export async function GET() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id
  const weekStart = mondayOfWeekUTC()

  // History: last 26 weeks, ascending by week_start (for the trend chart).
  const { data: historyDesc, error: historyErr } = await sb
    .from('gri_pulse_responses')
    .select('*')
    .eq('user_id', userId)
    .order('week_start', { ascending: false })
    .limit(26)

  if (historyErr) {
    return NextResponse.json({ ok: false, error: historyErr.message }, { status: 500 })
  }

  const rows = (historyDesc ?? []) as GriPulseRow[]
  const history = [...rows].sort((a, b) => a.week_start.localeCompare(b.week_start))
  const currentWeek = rows.find((r) => r.week_start === weekStart) ?? null

  // Baseline: latest current full GRI assessment, for per-block delta comparison.
  const { data: baselineRow, error: baselineErr } = await sb
    .from('gri_assessments')
    .select('gri_index, section_avgs, created_at')
    .eq('user_id', userId)
    .eq('is_current', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (baselineErr) {
    return NextResponse.json({ ok: false, error: baselineErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: {
      week_start: weekStart,
      section_ids: SECTION_IDS,
      current_week: currentWeek,
      history,
      baseline: baselineRow ?? null,
    },
  })
}

// =============================================================================
// POST /api/v1/gri/pulse
// Body: { scores: { [sectionId]: 1..10 }, note?: string }
// Upserts on (user_id, week_start).
// =============================================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const { scores, note } = body as { scores?: unknown; note?: unknown }
    if (!scores || typeof scores !== 'object') {
      return NextResponse.json({ ok: false, error: 'scores object required' }, { status: 400 })
    }

    // Validate: all 7 known section ids present, each an integer 1..10.
    const raw = scores as Record<string, unknown>
    const normalized: PulseScores = {}
    for (const id of SECTION_IDS) {
      const v = raw[id]
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 10) {
        return NextResponse.json(
          { ok: false, error: `Invalid or missing score for "${id}" (expected integer 1..10)` },
          { status: 400 },
        )
      }
      normalized[id] = n
    }

    const sb = createServerClient()
    const { data: userData, error: userErr } = await sb.auth.getUser()
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
    const userId = userData.user.id

    const values = SECTION_IDS.map((id) => normalized[id])
    const pulse_index = roundTo2(values.reduce((a, b) => a + b, 0) / values.length)
    const week_start = mondayOfWeekUTC()

    const row = {
      user_id: userId,
      week_start,
      scores: normalized,
      pulse_index,
      note: typeof note === 'string' && note.trim().length > 0 ? note.trim() : null,
    }

    const { data: saved, error: upsertErr } = await sb
      .from('gri_pulse_responses')
      .upsert(row, { onConflict: 'user_id,week_start' })
      .select('*')
      .single()

    if (upsertErr) {
      return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, data: saved })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid request'
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}
