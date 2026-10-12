// DELETE /api/v1/goals/[id][?companyId=] — remove a goal (manage access);
// a revenue goal also clears companies.target_revenue_*. Emits TARGET_CHANGED.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolveTenantWith, tenantErrorMessage } from '@/lib/tenancy'
import { apiError } from '@/lib/api-error'
import { deleteGoal } from '@/lib/goals/store'
import { emitPlatformEventSafely } from '@/lib/events/platform'

export const dynamic = 'force-dynamic'

const ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|company-(12m|3y))$/i

export async function DELETE(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(tenantErrorMessage('unauthenticated'), 401)
  if (!ID.test(params.id)) return apiError('Цель не найдена', 404)
  const tenant = await resolveTenantWith(supabase, user.id, { companyId: new URL(req.url).searchParams.get('companyId'), access: 'manage' })
  if (!tenant.ok) return apiError(tenantErrorMessage(tenant.error), tenant.status)
  try {
    const removed = await deleteGoal(createServiceClient(), tenant.tenant.companyId, params.id)
    if (!removed) return apiError('Цель не найдена', 404)
    emitPlatformEventSafely({
      name: 'TARGET_CHANGED', companyId: tenant.tenant.companyId, subjectType: 'goal', subjectId: params.id, actor: `user:${user.id}`,
      payload: { removed: true }, dedupeKey: `target_removed:${params.id}:${Date.now()}`,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/v1/goals/[id]] delete failed', err instanceof Error ? err.message : err)
    return apiError('Не удалось удалить цель', 500)
  }
}
