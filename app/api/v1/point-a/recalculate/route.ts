// ============================================================
// POST /api/v1/point-a/recalculate[?companyId=] — recalculate the Point A of
// a COMPANY (manage access: owner / admin): the snapshot path with the company
// lock (lib/point-a/snapshot.ts). Unlike /api/v1/diagnostics/recalculate
// (user-scoped, the owner's questionnaire), a member or admin recalculates the
// company, not their own empty questionnaire. Rate-limited per user.
// ============================================================
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { buildPointASnapshot } from '@/lib/point-a/snapshot'
import { gatePaidSection } from '@/lib/access/gate'
import { withDeadline } from '@/lib/runtime/deadline'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function handlePost(req: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  // Round 2 (R2-A): point_a is a paid section — 402 upgrade_required for an account without it (staff exempt).
  const upgrade = await gatePaidSection(supabase, user.id, 'point_a')
  if (upgrade) return upgrade
  const tenant = await resolveTenantWith(supabase, user.id, { companyId: new URL(req.url).searchParams.get('companyId'), access: 'manage' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  if (await isRateLimitedKey(user.id, 'point-a-recalculate', { max: 6, windowMs: 60_000 })) {
    return apiError('Слишком много запросов. Попробуйте через минуту.', 429)
  }
  try {
    const r = await buildPointASnapshot(tenant.tenant.companyId, { trigger: 'manual', force: true, lock: true, reasons: ['manual'] })
    if (r.status === 'skipped') {
      const msg = r.reason === 'busy' ? 'Точка А уже пересчитывается — обновите страницу через минуту'
        : r.reason === 'no_answers' ? 'Заполните анкету — Точку А не из чего считать'
        : r.reason === 'not_migrated' ? 'Пересчёт пока недоступен'
        : 'У компании нет владельца анкеты'
      return apiError(msg, r.reason === 'busy' ? 409 : 422)
    }
    return NextResponse.json({ ok: true, data: { status: r.status } })
  } catch (err) {
    console.error('[api/v1/point-a/recalculate] failed', err instanceof Error ? err.message : err)
    return apiError('Не удалось пересчитать Точку А', 500)
  }
}

/**
 * R-015: on Railway `next start` ignores maxDuration, so the request had no time limit. After 60 s the client
 * gets 504 (DEADLINE_EXCEEDED) and the work below sees its deadline spent. ROUTE_DEADLINE_MS_POINT_A_RECALCULATE overrides it;
 * ROUTE_DEADLINE_DISABLED=1 turns it off.
 */
export const POST = withDeadline(handlePost, { label: 'point-a-recalculate', ms: 60_000 })
