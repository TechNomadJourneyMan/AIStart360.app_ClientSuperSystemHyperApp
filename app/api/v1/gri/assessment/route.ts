export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import { readEntitlements } from '@/lib/access/server'
import { canRunFullGri } from '@/lib/access/entitlements'
import { getAccessGatesEnabled } from '@/lib/settings/system-settings'
import {
  computeTop5Limits,
  generate90DayPlan,
} from '@/lib/gri-calculator/top5-action-plan'
import { trackEvent } from '@/lib/events/track'
import { computeGriIndex, computeSectionAvgs, scoresFingerprint, type GriScores } from '@/lib/gri-assessment/score'
import { runInBackground } from '@/lib/background'
import { notifyGriCompleted } from '@/lib/notifications/product'

// Scores shape: { [sectionId]: { [criterionId]: number 1..10 } }. The math lives in
// lib/gri-assessment/score.ts and is shared with the widget.
type Scores = GriScores

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

    // Idempotency: re-opening the results screen (or a double click) re-sends the
    // same answers. Storing them again would duplicate the row and burn a run of
    // the free-tier quota, so an identical submission returns the current row.
    const { data: currentRow } = await sb
      .from('gri_assessments')
      .select('id, gri_index, section_avgs, created_at, scores, top_5_limits, action_plan_90d')
      .eq('user_id', userId)
      .eq('is_current', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (currentRow && scoresFingerprint(currentRow.scores as Scores) === scoresFingerprint(scores as Scores)) {
      const { scores: _same, ...rest } = currentRow
      void _same
      await sb.from('gri_assessment_drafts').delete().eq('user_id', userId)
      return NextResponse.json({ ok: true, data: { ...rest, duplicate: true } })
    }

    // Фаза 6A — тарифный гейт полного GRI (решение ПО, вариант А: free = 1
    // демо-проход). Активен ТОЛЬКО при включённом системном тумблере
    // access_gates (default OFF — существующих не ограничиваем молча).
    if (await getAccessGatesEnabled()) {
      const ent = await readEntitlements(sb, userId)
      let runs = 0
      try {
        const { count } = await sb
          .from('gri_assessments')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
        runs = count ?? 0
      } catch {
        runs = 0
      }
      if (!canRunFullGri(ent, runs)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'upgrade_required',
            feature: 'gri_full',
            message: ent.gri_full_limit === 0
              ? 'Полный GRI доступен на тарифе Pro.'
              : `Бесплатный тариф включает полных проходов GRI: ${ent.gri_full_limit}. Повторные пересчёты — на тарифе Pro.`,
          },
          { status: 402 },
        )
      }
    }

    // Lookup company (best-effort — null is OK; field is nullable).
    const { data: companyRow } = await sb
      .from('companies')
      .select('id, name')
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

    void trackEvent({ userId, name: 'GRI_COMPLETED', entityType: 'gri_assessment', entityId: inserted?.id ?? null, metadata: { gri_index } })

    // «GRI пройден»: запись в ленте + письмо по настройкам категории «gri»
    // (notifyClient). В фоне — расчёт уже сохранён, и почта не должна задерживать
    // ответ. Ключ идемпотентности — id прохождения, так что повторная обработка
    // того же результата уведомление не продублирует.
    runInBackground('gri-completed-notify', async () => {
      const { data: me } = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle()
      const person = me as { full_name?: string | null } | null
      await notifyGriCompleted(userId, {
        assessmentId: inserted?.id ?? null,
        name: person?.full_name ?? null,
        company: (companyRow as { name?: string | null } | null)?.name ?? null,
        griIndex: gri_index,
        completedAt: inserted?.created_at ?? new Date(),
      })
    })
    // The finished test supersedes its draft (best-effort: table may predate 072).
    await sb.from('gri_assessment_drafts').delete().eq('user_id', userId)

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
