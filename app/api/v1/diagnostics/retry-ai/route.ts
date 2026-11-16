export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { getSessionUser, mayActOnUser } from '@/lib/api-identity'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { internalBaseUrl } from '@/lib/internal-auth'
import { gatePaidSection } from '@/lib/access/gate'
import { aiBudgetExceededResponse, assertAiBudget, isAiBudgetError } from '@/lib/ai/budget'
import { claimAiAnalysis, claimRefusalText } from '@/lib/point-a/ai-claim'
import { fireAiFanOut } from '@/lib/point-a/diagnostic-row'
import { localeFromRequestCookie } from '@/lib/i18n/locale'

/**
 * POST /api/v1/diagnostics/retry-ai — «Повторить разбор».
 * Body: { diagnostic_id, regenerate? }
 *
 * Who: the owner, or staff / an assigned expert within their client scope
 * (mayActOnUser); the paid section (402 for Free); a per-user rate limit.
 *
 * Ревью R3-PA:
 *   M1  never two paid analyses of one row: the row is CLAIMED with one
 *       conditional UPDATE (lib/point-a/ai-claim.ts) — refused while an
 *       analysis is in progress (409), right after the last start (429,
 *       cooldown), or when it is complete (409; only staff may pass
 *       `regenerate: true` — an explicit «перегенерировать», the cache is
 *       skipped then). The AI budget is checked BEFORE the claim (429).
 *   H1  the call goes through the fan-out (lib/point-a/diagnostic-row.ts
 *       fireAiFanOut): the same timeout as the automatic start, tracked as
 *       background work, and a call that fails (network, timeout, non-2xx)
 *       marks the row failed with the reason — never «готовится» forever.
 * The last stored analysis (and keys other writers keep in ai_analysis) stays
 * until the new one replaces it. Writes use the service role after the checks:
 * `diagnostics` has no UPDATE policy for API roles.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { diagnostic_id?: unknown; regenerate?: unknown }
    const diagnosticId = typeof body.diagnostic_id === 'string' ? body.diagnostic_id : ''
    if (!diagnosticId) {
      return NextResponse.json({ ok: false, error: 'diagnostic_id required' }, { status: 400 })
    }

    const sb = createServerClient()
    // SECURITY (audit 2026-07-02): require a session and throttle — it re-fires a paid analysis.
    const user = await getSessionUser(sb)
    if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    // Round 2 (R2-A): point_a is a paid section — 402 upgrade_required for an account without it (staff exempt).
    const upgrade = await gatePaidSection(sb, user.id, 'point_a')
    if (upgrade) return upgrade
    if (await isRateLimitedKey(user.id, 'diagnostics-retry-ai', { max: 10, windowMs: 60_000 })) {
      return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
    }

    const { data: diag, error: diagErr } = await sb.from('diagnostics').select('user_id').eq('id', diagnosticId).single()
    if (diagErr || !diag) return NextResponse.json({ ok: false, error: 'Diagnostic not found' }, { status: 404 })
    const ownerId = String(diag.user_id)
    // Owner, or staff / an assigned expert within their client scope (SR-02).
    if (!(await mayActOnUser(sb, user.id, ownerId))) {
      return NextResponse.json({ ok: false, error: 'Diagnostic not found' }, { status: 404 })
    }
    // «Перегенерировать» a complete analysis: staff only (not the owner), explicitly.
    const regenerate = body.regenerate === true && user.id !== ownerId

    // The analysis is billed to the owner: a spent budget is refused before anything changes.
    try {
      await assertAiBudget(ownerId, 'point_a_analysis')
    } catch (err) {
      if (isAiBudgetError(err)) return aiBudgetExceededResponse()
      throw err
    }

    // A trusted origin for the internal call (never the request Host in production).
    const baseUrl = internalBaseUrl(req)
    if (!baseUrl) {
      console.error('[retry-ai] AI fan-out skipped: no trusted base URL (NEXT_PUBLIC_APP_URL)')
      return NextResponse.json({ ok: false, error: 'Не удалось перезапустить анализ' }, { status: 503 })
    }

    const db = createServiceClient()
    const claim = await claimAiAnalysis(db, { diagnosticId, userId: ownerId }, { allowCompleted: regenerate })
    if (!claim.ok) {
      const r = claimRefusalText(claim)
      return NextResponse.json({ ok: false, error: r.error, reason: claim.reason }, { status: r.status })
    }

    fireAiFanOut({
      baseUrl, diagnosticId, userId: ownerId, locale: localeFromRequestCookie(req),
      paths: ['/api/v1/diagnostics/ai-analyze'], ...(regenerate ? { regenerate: true } : {}),
    })
    return NextResponse.json({ ok: true, ai_status: 'processing' })
  } catch (error) {
    console.error('[retry-ai] Error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
