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
import { storeCurrentDiagnostic } from '@/lib/point-a/diagnostic-row'
import { buildPointASnapshot } from '@/lib/point-a/snapshot'
import { resolveFeature } from '@/lib/access/decision'

// POST /api/v1/diagnostics/recalculate
// Body: { user_id? } — the target user; defaults to the session user.
//
// After the caller is authorised (self, or staff for a client), every read and
// write is done with the service role scoped to the target user: `diagnostics`
// has no UPDATE policy for API roles, so with the session client the previous
// current row was never retired (UPDATE 0) and each recalculation added another
// is_current=true row; a staff insert for a client was rejected by
// diagnostics_insert_own. Migration 097 also enforces one current row per user.
/** A snapshot that wrote nothing (R3-PA, B4): an honest answer instead of a v1 score. */
const SKIPPED: Record<'not_migrated' | 'no_owner' | 'no_answers' | 'busy', { status: number; error: string }> = {
  busy: { status: 409, error: 'Точка А уже пересчитывается — обновите страницу через минуту' },
  no_answers: { status: 422, error: 'Нет ответов анкеты — заполните анкету, и Точка А посчитается' },
  no_owner: { status: 422, error: 'У компании нет владельца — Точку А не к кому привязать' },
  not_migrated: { status: 503, error: 'Точка А временно недоступна — попробуйте позже' },
}

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
    // Who asked (staff acting for a client is not the client): the paid-section check below.
    const caller = await getSessionUser(sb)

    if (await isRateLimitedKey(user_id, 'diagnostics-recalculate', { max: 10, windowMs: 60_000 })) {
      return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }

    // Round 2 (R2-A): the recalculation itself stays free — the questionnaire
    // and the express assessment («Снимок бизнеса») trigger it. Point A is a
    // paid section, so for a caller without it the answer carries no Point A
    // numbers (no caller reads them; the snapshot screen reads the express view).
    const pointAOpen = caller ? (await resolveFeature(sb, caller.id, 'point_a', { exemptStaff: true })).allowed : false
    const redact = <T extends Record<string, unknown>>(data: T): T | { scored: unknown; assessment?: unknown } =>
      pointAOpen ? data : { scored: data.scored, ...(data.assessment !== undefined ? { assessment: data.assessment } : {}) }

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

    // A company's Point A is ONE snapshot path (lib/point-a/snapshot.ts):
    // materialised metrics, v1 + v4, the point_a_v4 setting, history with
    // change reasons, AI fan-out and the pipeline. R3-PA (B4, R-070): there is
    // no fallback to a direct v1 calculation for a company any more — v1 scores
    // an incomplete survey (unanswered = 0) and wrote a row WITH a score and
    // without the preliminary mark. A snapshot that did not write tells why.
    if (company?.id) {
      let snapFailed = false
      const snap = await buildPointASnapshot(String(company.id), { trigger: 'manual', force: true, lock: true, locale })
        .catch((err) => { snapFailed = true; console.error('[recalculate] snapshot path failed', err instanceof Error ? err.message : err); return null })
      // A failed snapshot is not «calculate v1 instead» (I2, R-033): the current row stays; try again later.
      if (snapFailed || !snap) {
        return NextResponse.json({ ok: false, error: 'Не удалось пересчитать Точку А — попробуйте через минуту' }, { status: 503 })
      }
      if (snap.status === 'written') {
        // No official score — before the full questionnaire (PO 2026-11-02) or
        // v4 found too little data (R-033, `scored === false`): `written` is
        // then the internal v1 (unanswered = 0) and its numbers are never told.
        const scored = snap.assessment !== 'preliminary' && snap.scored !== false
        const overallScore = scored ? Number(snap.written.overall_score) : null
        runInBackground('point-a-notify', () =>
          notifyPointARecalculated(user_id, { diagnosticId: snap.diagnosticId, overallScore }),
        )
        notifyAdmins('diagnostic_recalculated', { overallScore, stage: scored ? snap.written.stage ?? null : null, diagnosticId: snap.diagnosticId }, user_id)
        return NextResponse.json({ ok: true, data: redact({ diagnostic: snap.diagnostic, point_a: scored ? snap.written : null, assessment: snap.assessment, scored, snapshot_id: snap.snapshotId, engine: snap.engine }) })
      }
      if (snap.status === 'unchanged') {
        return NextResponse.json({ ok: true, data: { unchanged: true, snapshot_id: snap.snapshotId } })
      }
      const skipped = SKIPPED[snap.reason]
      return NextResponse.json({ ok: false, error: skipped.error, reason: snap.reason }, { status: skipped.status })
    }

    // No company: no v4 and no way to check the official rules — the row is
    // stored WITHOUT a score (I2, R-033), no paid AI fan-out, no pipeline, no
    // number in the notifications.
    // Materialised metric values from documents / manual / external sources
    // are used before survey answers. A failed read is an error, not «no
    // document values»: scoring from the survey alone would silently replace a
    // correct current diagnostic.
    let resolvedInputs
    try {
      resolvedInputs = await loadResolvedInputs(db, null)
    } catch (err) {
      console.error('[recalculate] resolved inputs failed', err instanceof Error ? err.message : err)
      return NextResponse.json({ ok: false, error: 'Failed to load metric values' }, { status: 500 })
    }
    const result = calculatePointA(answers, resolvedInputs)

    // Retire the previous current diagnostic(s) of this user and insert the
    // new one (exactly one row stays is_current=true; a failed insert puts the
    // previous row back — lib/point-a/diagnostic-row.ts).
    const stored = await storeCurrentDiagnostic(db, { userId: user_id, companyId: null, result, aiStatus: 'none', preliminary: true })
    if (!stored.ok) return NextResponse.json({ ok: false, error: 'Failed to store diagnostic' }, { status: 500 })
    const diag = stored.diag
    void trackEvent({ userId: user_id, name: 'POINT_A_CALCULATED', entityType: 'diagnostic', entityId: diag?.id ?? null, metadata: { overall_score: null } })

    // Клиенту: «Точка А пересчитана» (лента; email — по настройке «reports»).
    runInBackground('point-a-notify', () =>
      notifyPointARecalculated(user_id, { diagnosticId: diag?.id ?? null, overallScore: null }),
    )
    notifyAdmins('diagnostic_recalculated', { overallScore: null, stage: null, diagnosticId: diag?.id }, user_id)

    return NextResponse.json({ ok: true, data: redact({ diagnostic: diag, point_a: null, scored: false }) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
