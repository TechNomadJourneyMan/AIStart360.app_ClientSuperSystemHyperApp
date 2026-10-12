export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { calculatePointA } from '@/lib/point-a-engine'
import { loadResolvedInputs } from '@/lib/point-a/resolved-inputs'
import { notifyAdmins } from '@/lib/notifications'
import { notifyPointARecalculated } from '@/lib/notifications/product'
import { runInBackground } from '@/lib/background'
import { localeFromRequestCookie } from '@/lib/i18n/locale'
import { getSessionUser, resolveTargetUserId } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { trackEvent } from '@/lib/events/track'
import { internalBaseUrl } from '@/lib/internal-auth'
import { fireAiFanOut, startDiagnosticPipeline, storeCurrentDiagnostic } from '@/lib/point-a/diagnostic-row'
import { buildPointASnapshot } from '@/lib/point-a/snapshot'

// POST /api/v1/diagnostics/recalculate
// Body: { user_id? } — the target user; defaults to the session user.
//
// After the caller is authorised (self, or staff for a client), every read and
// write is done with the service role scoped to the target user: `diagnostics`
// has no UPDATE policy for API roles, so with the session client the previous
// current row was never retired (UPDATE 0) and each recalculation added another
// is_current=true row; a staff insert for a client was rejected by
// diagnostics_insert_own. Migration 097 also enforces one current row per user.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const sb = createServerClient()

    // SECURITY (audit 2026-07-02): this endpoint recomputes a diagnostic and
    // fires 2 paid AI fan-outs. It previously took `user_id` from the body with
    // NO auth — anonymous cost/DoS + cross-tenant trigger. Derive identity from
    // the session (staff may target a client) and throttle per user.
    const resolved = await resolveTargetUserId(sb, (body as { user_id?: string }).user_id)
    if ('error' in resolved) {
      return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.error === 'unauthorized' ? 401 : 403 })
    }
    const user_id = resolved.userId
    // Who asked (staff acting for a client is not the client) — for the audit trail.
    const caller = await getSessionUser(sb)
    const requestedBy = `user:${caller?.id ?? user_id}`

    if (await isRateLimitedKey(user_id, 'diagnostics-recalculate', { max: 10, windowMs: 60_000 })) {
      return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }

    // The caller's portal locale lives in this request's cookie. Server-to-server
    // fires below do NOT forward cookies, so we pass it explicitly in their bodies.
    const locale = localeFromRequestCookie(req)

    const db = createServiceClient()

    // Fetch all survey answers for this user
    const { data: rows, error: surveyErr } = await db
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', user_id)

    if (surveyErr) return NextResponse.json({ ok: false, error: 'Failed to load survey answers' }, { status: 500 })

    // Build flat answers map
    const answers: Record<string, unknown> = {}
    for (const row of (rows ?? [])) {
      answers[row.question_key] = (row.answer as { value: unknown }).value
    }

    if (Object.keys(answers).length === 0) {
      return NextResponse.json({ ok: false, error: 'No survey answers found — complete the wizard first' }, { status: 422 })
    }

    // Get company_id
    const { data: company, error: companyErr } = await db
      .from('companies')
      .select('id')
      .eq('user_id', user_id)
      .maybeSingle()
    if (companyErr) {
      console.error('[recalculate] company lookup failed', companyErr.code ?? '', companyErr.message ?? '')
      return NextResponse.json({ ok: false, error: 'Failed to load company' }, { status: 500 })
    }

    // A company's Point A is one snapshot path (lib/point-a/snapshot.ts):
    // materialised metrics, v1 + v4, the point_a_v4 setting, history with
    // change reasons, AI fan-out and the pipeline. Before migration 111 (or on
    // any failure there) the direct calculation below keeps working.
    if (company?.id) {
      const snap = await buildPointASnapshot(String(company.id), { trigger: 'manual', force: true, locale })
        .catch((err) => { console.error('[recalculate] snapshot path failed, direct calculation', err instanceof Error ? err.message : err); return null })
      if (snap?.status === 'written') {
        void trackEvent({ userId: user_id, name: 'POINT_A_CALCULATED', entityType: 'diagnostic', entityId: snap.diagnosticId, metadata: { overall_score: Number(snap.written.overall_score), engine: snap.engine } })
        runInBackground('point-a-notify', () =>
          notifyPointARecalculated(user_id, { diagnosticId: snap.diagnosticId, overallScore: Number(snap.written.overall_score) }),
        )
        notifyAdmins('diagnostic_recalculated', { overallScore: snap.written.overall_score, stage: snap.written.stage ?? null, diagnosticId: snap.diagnosticId }, user_id)
        return NextResponse.json({ ok: true, data: { diagnostic: snap.diagnostic, point_a: snap.written, snapshot_id: snap.snapshotId, engine: snap.engine } })
      }
    }

    // Calculate Point A. Materialised metric values from documents / manual /
    // external sources (LTV, CAC, margin) are used before survey answers. A
    // failed read is an error, not «no document values»: scoring from the
    // survey alone would silently replace a correct current diagnostic.
    let resolvedInputs
    try {
      resolvedInputs = await loadResolvedInputs(db, company?.id ?? null)
    } catch (err) {
      console.error('[recalculate] resolved inputs failed', err instanceof Error ? err.message : err)
      return NextResponse.json({ ok: false, error: 'Failed to load metric values' }, { status: 500 })
    }
    const result = calculatePointA(answers, resolvedInputs)

    // Retire the previous current diagnostic(s) of this user and insert the
    // new one (exactly one row stays is_current=true; a failed insert puts the
    // previous row back — lib/point-a/diagnostic-row.ts).
    const stored = await storeCurrentDiagnostic(db, {
      userId: user_id,
      companyId: company?.id ?? null,
      result,
      aiStatus: process.env.OPENROUTER_API_KEY ? 'processing' : 'none',
    })
    if (!stored.ok) return NextResponse.json({ ok: false, error: 'Failed to store diagnostic' }, { status: 500 })
    const diag = stored.diag
    void trackEvent({ userId: user_id, name: 'POINT_A_CALCULATED', entityType: 'diagnostic', entityId: diag?.id ?? null, metadata: { overall_score: Number(result.overall_score) } })

    // Fire async AI analysis + Point B bridge (non-blocking). Base URL from
    // configuration, never the request Host in production (a spoofed Host
    // would receive the token); unknown → no fan-out.
    const baseUrl = internalBaseUrl(req)
    if (process.env.OPENROUTER_API_KEY && diag?.id && baseUrl) {
      fireAiFanOut({ baseUrl, diagnosticId: String(diag.id), userId: user_id, locale })
    } else if (process.env.OPENROUTER_API_KEY && diag?.id) {
      console.error('[recalculate] AI fan-out skipped: no trusted base URL (NEXT_PUBLIC_APP_URL)')
    }

    // The diagnostic pipeline runs as agents; it reuses this calculation when
    // the inputs are unchanged. Never blocks or fails the response.
    if (company?.id && diag?.id) {
      startDiagnosticPipeline({ companyId: String(company.id), diagnosticId: String(diag.id), requestedBy, trigger: 'manual', reason: 'пересчёт по запросу' })
    }

    // Клиенту: «Точка А пересчитана» (лента; email — по настройке «reports»).
    runInBackground('point-a-notify', () =>
      notifyPointARecalculated(user_id, { diagnosticId: diag?.id ?? null, overallScore: Number(result.overall_score) }),
    )

    // Notify admins about diagnostic recalculation
    notifyAdmins('diagnostic_recalculated', {
      overallScore: result.overall_score,
      stage: result.stage ?? null,
      diagnosticId: diag?.id,
    }, user_id)

    return NextResponse.json({ ok: true, data: { diagnostic: diag, point_a: result } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
