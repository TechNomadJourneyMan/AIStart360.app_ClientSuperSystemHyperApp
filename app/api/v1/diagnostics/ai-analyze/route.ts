export const dynamic = 'force-dynamic'
// Full Point A analysis is a large structured generation (~4-5K tokens) that can
// take 90-150s on Claude Sonnet. This route runs async (fire-and-forget from
// recalculate, polled via ai-status), so a generous budget is fine.
export const maxDuration = 300

import { DIAGNOSTIC_POINT_A_COLUMNS } from '@/lib/point-a/from-row'
import { loadOfficialSnapshot, officialPointA, pointAFromOfficial } from '@/lib/point-a/official'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { analyzePointA } from '@/lib/ai/point-a-analyzer'
import { foreignAnalysisKeys, mergeAiAnalysis, readAiAnalysis } from '@/lib/point-a/ai-analysis'
import type { AIAnalysis } from '@/types/onboarding'
import type { GriExpertNotes } from '@/lib/ai/point-a-analyzer'
import { plainAnswer } from '@/lib/survey/plain'
import type { Company } from '@/types/onboarding'
import { localeFromRequestCookie, normalizeLocale } from '@/lib/i18n/locale'
import { hasValidInternalToken } from '@/lib/internal-auth'
import { getSessionUser, mayActOnUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { assertAiBudget, isAiBudgetError, aiBudgetExceededResponse } from '@/lib/ai/budget'
import { recordAiCacheHit, setAiActor } from '@/lib/ai/usage'
import { analyzeWithInputCache, pointAAnalysisInputHash } from '@/lib/point-a/analysis-cache'
import { withDeadline } from '@/lib/runtime/deadline'
import { gatePaidSection } from '@/lib/access/gate'
import { aiErrorOf, aiModelOf, clipAiError, type PointAAnalysisReport } from '@/lib/point-a/ai-review'
import { updateDiagnosticAi } from '@/lib/point-a/ai-columns'
import { claimAiAnalysis, claimRefusalText } from '@/lib/point-a/ai-claim'
import { announceAiReviewNow } from '@/lib/expert-sla/immediate'

/**
 * R3-SLA: the expert's review belongs to the TEXT it checked. A new generation
 * (not the cached text) starts unchecked — «Проверено экспертом» and the
 * corrections of the previous text are not carried over; a cached text keeps the
 * review and the corrections of the row it came from.
 */
const NO_REVIEW = { ai_reviewed_at: null, ai_reviewed_by: null, ai_reviewed_by_name: null, ai_expert_edits: null } as const

/**
 * POST /api/v1/diagnostics/ai-analyze
 * Internal endpoint: runs AI analysis on an existing diagnostic.
 * Called asynchronously after rule-based recalculation completes.
 *
 * Body: { diagnostic_id, user_id }
 *
 * Storage (lib/point-a/ai-analysis.ts, migration 091): the result goes to
 * diagnostics.ai_analysis MERGED with the keys of the current value this route
 * does not own (e.g. `gri`, `pulse` read by the expert routes); the Point A
 * narrative lives in ai_narrative and is never touched here.
 * After the caller is authorised, the route reads and writes with the service
 * role, scoped to the diagnostic of `user_id`: it is usually called
 * server-to-server without cookies, where the session client is anonymous —
 * RLS then hid the survey answers and dropped every write (`diagnostics` has
 * no UPDATE policy for API roles).
 *
 * Status: once the diagnostic is verified, any later failure (a failed input
 * read, no survey answers, a model error, a failed save, an exception) writes
 * ai_status='failed' — callers fire and forget, and the client polls
 * ai-status, which would otherwise show «AI анализирует…» forever.
 *
 * R3-PA (migration 150): every outcome is diagnosable — ai_error (which part
 * failed and why: «blocksB:cut», «summary:schema», «budget», «input:survey»…),
 * ai_model, ai_generated_at. A failed analysis answers 502, never 200 «успех»
 * (the fan-out logs a non-2xx). At least 3 of the 4 parts → the PARTIAL
 * analysis is stored (ai_analysis.partial = the missing parts) with
 * ai_status 'failed': the client sees what is ready and «повторить», the input
 * cache never reuses it. Before migration 150 only ai_status is written.
 */
async function handlePost(req: NextRequest) {
  // Set only after the ownership check: a caller that is not authorised must
  // never be able to flip someone's status, even through an error path.
  let target: { diagnosticId: string; userId: string } | null = null
  try {
    const { diagnostic_id, user_id, locale: bodyLocale, regenerate: regenerateAsked } = await req.json()
    if (!diagnostic_id || !user_id) {
      return NextResponse.json({ ok: false, error: 'diagnostic_id and user_id required' }, { status: 400 })
    }

    const sb = createServerClient()
    // Every AI call below is made for (and billed to) the diagnostic's owner.
    setAiActor({ userId: String(user_id) })

    // SECURITY (audit 2026-07-02): this internal endpoint runs 4 paid AI calls.
    // It is normally fired server-to-server from recalculate/retry-ai, which
    // carry a signed internal token (cookies aren't forwarded). Accept that
    // token; otherwise require a session that owns `user_id` (or staff), and
    // throttle that direct path. Anonymous callers can no longer burn credits.
    // A server-to-server call (snapshot fan-out, retry-ai, catch-up) has already CLAIMED the row;
    // a direct call by a session claims it here (ревью R3-PA M1).
    const internal = hasValidInternalToken(req, { userId: String(user_id), diagnosticId: String(diagnostic_id) })
    let directCallerId: string | null = null
    if (!internal) {
      const caller = await getSessionUser(sb)
      if (!caller) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
      if (!(await mayActOnUser(sb, caller.id, String(user_id)))) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
      }
      if (await isRateLimitedKey(caller.id, 'diagnostics-ai-analyze', { max: 6, windowMs: 60_000 })) {
        return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
      }
      // R2-A (ревью M-3): the paid AI analysis is Точка А — not for a Free caller (staff exempt).
      const upgrade = await gatePaidSection(sb, caller.id, 'point_a')
      if (upgrade) return upgrade
      directCallerId = caller.id
    }
    // «Перегенерировать» a complete analysis (skip the input cache): staff only — through
    // retry-ai (internal, flag in the body) or a direct call of staff for a client.
    const regenerate = regenerateAsked === true && (internal || (directCallerId !== null && directCallerId !== String(user_id)))

    // Server-to-server fires (recalculate → ai-analyze) do NOT forward cookies,
    // so the caller's locale arrives in the body. Fall back to this request's
    // cookie (direct invocation), then the portal default.
    const locale = bodyLocale != null
      ? normalizeLocale(String(bodyLocale))
      : localeFromRequestCookie(req)

    const db = createServiceClient()

    // The diagnostic must belong to user_id — checked before any paid call.
    const { data: owned, error: ownErr } = await db
      .from('diagnostics')
      .select(DIAGNOSTIC_POINT_A_COLUMNS)
      .eq('id', diagnostic_id)
      .eq('user_id', user_id)
      .maybeSingle()
    if (ownErr) {
      console.error('[ai-analyze] diagnostic lookup failed', ownErr.code ?? '', ownErr.message ?? '')
      return NextResponse.json({ ok: false, error: 'Не удалось загрузить диагностику' }, { status: 500 })
    }
    if (!owned) return NextResponse.json({ ok: false, error: 'Диагностика не найдена' }, { status: 404 })
    target = { diagnosticId: String(diagnostic_id), userId: String(user_id) }
    const fail = async (status: number, error: string, code: string, logDetail?: { code?: string; message?: string } | null) => {
      if (logDetail) console.error('[ai-analyze]', error, logDetail.code ?? '', logDetail.message ?? '')
      await markFailed(target, code)
      return NextResponse.json({ ok: false, ai_status: 'failed', error, ai_error: code }, { status })
    }

    // 0. The OFFICIAL Point A (R-033): no paid analysis of a score that does
    // not exist — before the full questionnaire or when v4 found too little
    // data. Never a v1 recalculation of an incomplete survey (I2). The row is
    // reset to 'none' so a poller that saw 'processing' stops waiting.
    const official = officialPointA(owned as Record<string, unknown>, await loadOfficialSnapshot(db, String(user_id)))
    const scored = pointAFromOfficial(official)
    if (!scored) {
      await db
        .from('diagnostics')
        .update({ ai_status: 'none' })
        .eq('id', diagnostic_id)
        .eq('user_id', user_id)
      return NextResponse.json({
        ok: false,
        ai_status: 'none',
        reason: official.state,
        error: 'Разбор появится, когда у Точки А будет оценка: отправьте полную анкету и добавьте данные по пустым блокам',
      }, { status: 409 })
    }

    // 1. Mark as processing (+ when the attempt started: «готовится» older than 15 min is stale).
    if (internal) {
      await updateDiagnosticAi(db, target, { ai_status: 'processing' }, { ai_started_at: new Date().toISOString() })
    } else {
      // A direct call: never a second analysis of a row in progress, never a complete one
      // again (staff may regenerate), not right after the last start.
      const claim = await claimAiAnalysis(db, target, { allowCompleted: regenerate })
      if (!claim.ok) {
        const r = claimRefusalText(claim)
        return NextResponse.json({ ok: false, error: r.error, reason: claim.reason }, { status: r.status })
      }
    }

    // 2. Fetch survey answers. A failed read must not become an analysis of
    // «no data» stored as the client's personal result (and a paid call).
    const { data: rows, error: surveyErr } = await db
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)
    if (surveyErr) return fail(500, 'Не удалось загрузить ответы анкеты', 'input:survey', surveyErr)

    const answers: Record<string, unknown> = {}
    for (const row of (rows ?? [])) {
      // The engines and the model read the words, not the answer editor's Markdown.
      answers[row.question_key] = plainAnswer((row.answer as { value: unknown } | null)?.value)
    }
    if (Object.keys(answers).length === 0) {
      return fail(422, 'Анкета не заполнена — анализировать нечего', 'no_answers')
    }

    // 3. Fetch company
    const { data: company, error: companyErr } = await db
      .from('companies')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle()
    if (companyErr) return fail(500, 'Не удалось загрузить компанию', 'input:company', companyErr)

    // 4. Fetch GRI expert notes (step=0, gri_expert_* keys)
    const { data: expertRows, error: expertErr } = await db
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)
      .eq('step', 0)
      .like('question_key', 'gri_expert_%')
    if (expertErr) return fail(500, 'Не удалось загрузить заметки эксперта', 'input:expert_notes', expertErr)

    const expertNotes: GriExpertNotes = {}
    for (const row of (expertRows ?? [])) {
      const block = row.question_key.replace('gri_expert_', '') as keyof GriExpertNotes
      const value = (row.answer as { value: unknown })?.value
      if (typeof value === 'string' && value.trim()) {
        expertNotes[block] = value
      }
    }

    // 5. The official Point A (the score the client sees); a block without
    // data goes to the model as «нет данных», never as «0/100 critical».
    const { pointA, blocksWithoutData } = scored

    // 6. Run AI analysis (with expert notes) — or reuse a previous analysis of
    // EXACTLY the same input (4 LLM calls saved per unchanged recalculation).
    const inputHash = pointAAnalysisInputHash({
      answers,
      // The no-data list joins the hash only when present: unchanged inputs of
      // fully scored rows keep their cached analysis.
      pointA: blocksWithoutData.length ? { ...pointA, blocksWithoutData } : pointA,
      company: (company ?? null) as Record<string, unknown> | null,
      expertNotes: expertNotes as Record<string, unknown>,
      locale,
    })
    let outcome: { result: Awaited<ReturnType<typeof analyzePointA>>; cached: boolean }
    let report: PointAAnalysisReport | null = null
    // The expert's review of the cached analysis (same input → same AI text): it stays valid.
    let cachedReview: Record<string, unknown> | null = null
    try {
      outcome = await analyzeWithInputCache(inputHash, {
        findCached: async (hash) => {
          if (regenerate) return null // an explicit «перегенерировать»: a new text, not the cached one
          const read = (cols: string) => db
            .from('diagnostics')
            .select(cols)
            .eq('user_id', user_id)
            .eq('narrative_input_hash', hash)
            .eq('ai_status', 'completed')
            .not('ai_analysis', 'is', null)
            .order('calculated_at', { ascending: false }) // diagnostics has no created_at
            .limit(1)
            .maybeSingle()
          let res = await read('ai_analysis, ai_model, ai_generated_at, ai_reviewed_at, ai_reviewed_by, ai_reviewed_by_name, ai_expert_edits')
          if (res.error) res = await read('ai_analysis') // before migration 150
          const data = (res.error ? null : res.data) as Record<string, unknown> | null
          const cached = data ? readAiAnalysis(data.ai_analysis) : null // error: e.g. migration 091 not applied yet
          if (!cached) return null
          if (data && 'ai_reviewed_at' in data) {
            // The review (or the corrections in progress) of the same text — whatever it is, never the current row's.
            cachedReview = {
              ai_reviewed_at: data.ai_reviewed_at ?? null, ai_reviewed_by: data.ai_reviewed_by ?? null,
              ai_reviewed_by_name: data.ai_reviewed_by_name ?? null, ai_expert_edits: data.ai_expert_edits ?? null,
            }
          }
          // The cached text keeps its own model and time (no generation happened now).
          if (typeof data?.ai_model === 'string') cachedReview = { ...(cachedReview ?? {}), ai_model: data.ai_model }
          if (data?.ai_generated_at) cachedReview = { ...(cachedReview ?? {}), ai_generated_at: data.ai_generated_at }
          // Only the analysis itself: keys other writers own (gri, pulse) are
          // taken from the current row when storing, never from an old one.
          const foreign = foreignAnalysisKeys(cached)
          return Object.fromEntries(Object.entries(cached).filter(([k]) => !(k in foreign))) as AIAnalysis
        },
        onCacheHit: () => recordAiCacheHit('point_a_analysis', { userId: String(user_id) }),
        analyze: async () => {
          await assertAiBudget(String(user_id), 'point_a_analysis')
          return analyzePointA(answers, pointA, company as Company | null, expertNotes, locale, blocksWithoutData, (r) => { report = r })
        },
      })
    } catch (err) {
      if (!isAiBudgetError(err)) throw err
      await markFailed(target, 'budget')
      return aiBudgetExceededResponse({ ai_status: 'failed', ai_error: 'budget' }, err)
    }
    const aiResult = outcome.result
    const done = report as PointAAnalysisReport | null
    const diagnosis = {
      ai_model: done ? aiModelOf(done) : typeof aiResult?.model_used === 'string' ? aiResult.model_used : null,
      ai_generated_at: done?.finishedAt ?? new Date().toISOString(),
    }

    if (aiResult) {
      // 7. Store result (+ the input hash for the next recalculation), keeping
      //    keys of the current value this route does not own. Re-read right
      //    before writing: the analysis takes minutes. Falls back to a
      //    hash-less write when migration 091 (ai_usage) is not applied yet.
      const { data: current } = await db
        .from('diagnostics')
        .select('ai_analysis')
        .eq('id', diagnostic_id)
        .eq('user_id', user_id)
        .maybeSingle()
      const merged = mergeAiAnalysis(current?.ai_analysis ?? null, aiResult)
      const partial = Array.isArray(aiResult.partial) && aiResult.partial.length > 0
      const aiError = partial ? (done ? aiErrorOf(done) : clipAiError(`partial:${aiResult.partial!.join(',')}`)) : null
      const status = partial ? 'failed' : 'completed'
      // A partial analysis is never the cached one: no input hash on it.
      const base = { ai_analysis: merged, ai_status: status, ...(partial ? {} : { narrative_input_hash: inputHash }) }
      const extra = outcome.cached
        ? { ai_error: null, ai_generated_at: diagnosis.ai_generated_at, ...NO_REVIEW, ...(cachedReview ?? {}) }
        : { ai_error: aiError, ...diagnosis, ...NO_REVIEW }
      const stored = await updateDiagnosticAi(db, target, base, extra)
      if (!stored.ok) {
        // Before migration 091 there is no narrative_input_hash: the analysis without it.
        const { error: saveErr } = await db
          .from('diagnostics')
          .update({ ai_analysis: merged, ai_status: status })
          .eq('id', diagnostic_id)
          .eq('user_id', user_id)
        if (saveErr) return fail(500, 'Анализ получен, но не сохранён', 'save', saveErr)
      }

      // Решение PO «гибрид»: the expert's task to confirm the analysis opens and is announced NOW
      // (not at the next SLA pass); an already confirmed (cached) text opens nothing. Never throws.
      await announceAiReviewNow({ sb: db, diagnosticId: String(diagnostic_id) })

      if (partial) {
        console.error(`[ai-analyze] partial analysis for diagnostic ${diagnostic_id}: ${aiError ?? ''}`)
        return NextResponse.json({ ok: false, ai_status: 'failed', partial: aiResult.partial, ai_error: aiError, error: 'Разбор получен не полностью' }, { status: 502 })
      }
      return NextResponse.json({ ok: true, ai_status: 'completed', cached: outcome.cached })
    } else {
      // Ids and codes only: the provider bodies may echo client data.
      const code = done ? aiErrorOf(done) ?? 'error' : 'error'
      console.error(`[ai-analyze] analysis failed for diagnostic ${diagnostic_id}: ${code}`)
      await markFailed(target, code, diagnosis)
      return NextResponse.json({ ok: false, ai_status: 'failed', ai_error: code, error: 'AI analysis returned null' }, { status: 502 })
    }
  } catch (error) {
    console.error('[ai-analyze] Error:', error instanceof Error ? error.message : error)
    // The body was already consumed (req.clone() would throw here); the ids
    // verified above are kept in `target`.
    await markFailed(target, 'exception')
    return NextResponse.json({ ok: false, error: 'AI analysis failed' }, { status: 500 })
  }
}

/**
 * Write ai_status='failed' (+ ai_error, and the model / time when a model was
 * called) on the verified diagnostic; never throws. Before migration 150 only
 * the status is written.
 */
async function markFailed(
  target: { diagnosticId: string; userId: string } | null,
  code: string,
  diagnosis: { ai_model?: string | null; ai_generated_at?: string | null } = {},
): Promise<void> {
  if (!target) return
  try {
    const r = await updateDiagnosticAi(createServiceClient(), target, { ai_status: 'failed' }, { ai_error: clipAiError(code), ...diagnosis })
    if (!r.ok) console.error('[ai-analyze] could not mark failed', r.code ?? '')
  } catch (err) {
    console.error('[ai-analyze] could not mark failed', err instanceof Error ? err.message : err)
  }
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After
 * 120 s the client gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline
 * spent (the fan-out waits 150 s (lib/point-a/diagnostic-row.ts); the model calls inside are bounded by the AI deadline). ROUTE_DEADLINE_MS_AI_ANALYZE overrides it; ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const POST = withDeadline(handlePost, { label: 'ai-analyze', ms: 120_000 })
