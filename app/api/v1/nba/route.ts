export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { buildNbaSignals, type NbaSignalInput } from '@/lib/nba/signals'
import { selectNextBestAction, type NbaHistory } from '@/lib/nba/select'
import { calculatePointA } from '@/lib/point-a-engine'

const POINT_A_LABELS: Record<string, string> = {
  finance: 'Финансы', sales: 'Продажи', operations: 'Операции', marketing: 'Маркетинг', strategy: 'Стратегия',
}

/**
 * GET /api/v1/nba → { ok, action } — the single Next Best Action, or null.
 *
 * Cookie session only (IDOR-safe). Signals are gathered from the user's own
 * rows; the deterministic core (lib/nba) does the selection. Every read is
 * guarded so a not-yet-migrated table degrades to "no signal" rather than 500.
 * Titles/reasons are the deterministic factual strings from buildNbaSignals;
 * optional LLM phrasing is a later enhancement.
 *
 * NOTE: CRM-overdue and Point-A red-zone signals depend on the GRI/CRM branch
 * and full Point-A compute respectively; wired in once those land.
 */
const DAY_MS = 86_400_000

export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'nba-get', { max: 30, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто. Попробуйте позже.' }, { status: 429 })
  }

  const input: NbaSignalInput = {}

  // Current GRI assessment: main limitation + age.
  try {
    const { data } = await sb
      .from('gri_assessments')
      .select('top_5_limits, created_at')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()
    if (data) {
      const top5 = Array.isArray(data.top_5_limits) ? data.top_5_limits : []
      const first = top5[0] as { criterionText?: string; blockName?: string } | undefined
      if (first?.criterionText) {
        input.hasReport = true
        input.griMainLimit = { criterionText: first.criterionText, blockName: first.blockName ?? '' }
      }
      if (data.created_at) {
        input.griAssessmentAgeDays = Math.floor((Date.now() - new Date(data.created_at).getTime()) / DAY_MS)
      }
    }
  } catch { /* table may be absent — skip */ }

  // Next open 90-day plan task.
  try {
    const { data } = await sb
      .from('action_items')
      .select('id, title')
      .eq('user_id', user.id)
      .eq('status', 'open')
      .order('priority', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.id) input.planNextTask = { id: String(data.id), title: data.title ?? 'Следующий шаг плана' }
  } catch { /* skip */ }

  // Last pulse week → days since.
  try {
    const { data } = await sb
      .from('gri_pulse_responses')
      .select('week_start')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.week_start) {
      input.daysSincePulse = Math.floor((Date.now() - new Date(data.week_start).getTime()) / DAY_MS)
    }
  } catch { /* skip */ }

  // Psych profile present?
  try {
    const { data } = await sb
      .from('founder_psych_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
    input.hasPsychProfile = !!data
  } catch { /* skip */ }

  // Overdue CRM reminders (S1) — reads the GRI/CRM tables directly (no code dep).
  try {
    const nowIso = new Date().toISOString()
    const { data, count } = await sb
      .from('crm_reminders')
      .select('client_id', { count: 'exact' })
      .eq('user_id', user.id)
      .is('done_at', null)
      .lt('due_at', nowIso)
    if ((count ?? 0) > 0) {
      let sampleName: string | undefined
      const firstClientId = (data ?? [])[0]?.client_id
      if (firstClientId) {
        const { data: c } = await sb.from('crm_clients').select('name').eq('id', firstClientId).maybeSingle()
        sampleName = c?.name ?? undefined
      }
      input.crmOverdue = { count: count ?? 0, sampleName }
    }
  } catch { /* crm tables absent — skip */ }

  // Point A red zones (S2) — compute over the user's survey answers.
  try {
    const { data: sa } = await sb.from('survey_answers').select('question_key, answer').eq('user_id', user.id)
    if (sa && sa.length > 0) {
      const answers: Record<string, unknown> = {}
      for (const r of sa as Array<{ question_key: string; answer: unknown }>) {
        answers[r.question_key] = (r.answer as { value?: unknown } | null)?.value ?? r.answer
      }
      const pa = calculatePointA(answers)
      const reds = Object.entries(pa.blocks)
        .filter(([, b]) => (b as { status?: string }).status === 'weak')
        .map(([k, b]) => ({ key: k, label: POINT_A_LABELS[k] ?? k, score: (b as { score: number }).score }))
      if (reds.length > 0) input.redBlocks = reds
    }
  } catch { /* skip */ }

  // Cooldown history from the NBA log.
  const history: NbaHistory = {}
  try {
    const dismissCutoff = new Date(Date.now() - 72 * 3_600_000).toISOString()
    const doneCutoff = new Date(Date.now() - 7 * DAY_MS).toISOString()
    const { data } = await sb
      .from('nba_log')
      .select('action_key, event, created_at')
      .eq('user_id', user.id)
      .in('event', ['dismissed', 'done'])
      .gte('created_at', doneCutoff)
    const rows = (data ?? []) as Array<{ action_key: string; event: string; created_at: string }>
    const dismissed = new Set(rows.filter((r) => r.event === 'dismissed' && r.created_at >= dismissCutoff).map((r) => r.action_key))
    const done = new Set(rows.filter((r) => r.event === 'done').map((r) => r.action_key))
    history.dismissedWithinCooldown = (k) => dismissed.has(k)
    history.completedWithinCooldown = (k) => done.has(k)
  } catch { /* no log yet — no cooldowns */ }

  const action = selectNextBestAction(buildNbaSignals(input), {}, history)

  // Best-effort "shown" telemetry (never blocks the response).
  if (action) {
    try {
      await sb.from('nba_log').insert({
        user_id: user.id,
        action_key: action.actionKey,
        event: 'shown',
        payload: { score: action.score, key: action.key, title: action.title },
      })
    } catch { /* ignore */ }
  }

  return NextResponse.json({ ok: true, action })
}

export function POST() {
  return NextResponse.json({ ok: false, error: 'Use /api/v1/nba/event' }, { status: 405 })
}
