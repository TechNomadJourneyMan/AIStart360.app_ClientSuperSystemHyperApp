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

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
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
