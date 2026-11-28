import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { staffMfaGate } from '@/lib/admin/giga-actor'
import { mfaFlagsEnrolled } from '@/lib/mfa/flags'
import { MFA_COOKIE_NAME, verifyStepUp } from '@/lib/mfa/step-up'
import { resolveTenantWith } from '@/lib/tenancy'

type StoreAccount = { id: string; name: string | null }
export type StoreAccessError = {
  status: number
  code: string
  message: string
  accounts?: StoreAccount[]
}

export async function authorizeStore(
  client: SupabaseClient,
  companyId?: string | null,
): Promise<{ ok: true; userId: string; company: StoreAccount } | { ok: false; error: StoreAccessError }> {
  const deny = (status: number, code: string, message: string, accounts?: StoreAccount[]) => ({
    ok: false as const, error: { status, code, message, accounts },
  })
  if (companyId != null && (typeof companyId !== 'string' || !companyId.trim() || companyId.length > 200)) {
    return deny(400, 'invalid_company_id', 'Недопустимый идентификатор компании')
  }
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return deny(401, 'unauthorized', 'Необходима авторизация')

  try {
    const profile = await client.from('profiles').select('status,role').eq('id', user.id).maybeSingle()
    if (profile.error) throw new Error('profile unavailable')
    const role = profile.data?.role
    if (profile.data?.status !== 'approved' || !['client', 'admin', 'super_admin'].includes(role)) {
      return deny(403, 'forbidden', 'Магазин недоступен для этой учётной записи')
    }
    const stepUp = cookies().get(MFA_COOKIE_NAME)?.value
    const admitted = role === 'client'
      ? !mfaFlagsEnrolled(user) || verifyStepUp(stepUp, user.id)
      : (await staffMfaGate(stepUp, user)) === 'ok'
    if (!admitted) return deny(403, 'mfa_step_up_required', 'Подтвердите вход вторым фактором')

    const owned = client.from('companies').select('id,name').eq('user_id', user.id).order('name').order('id')
    const { data, error: companyError } = await (companyId ? owned.eq('id', companyId.trim()).limit(1) : owned.limit(100))
    if (companyError) throw new Error('company unavailable')
    const accounts = (data ?? []) as StoreAccount[]
    if (accounts.length === 0) {
      return deny(404, 'company_not_found', companyId ? 'Компания не найдена' : 'Сначала заполните данные компании')
    }
    if (accounts.length > 1) return deny(409, 'company_selection_required', 'Выберите компанию', accounts)
    const company = accounts[0]
    const tenant = await resolveTenantWith(client, user.id, { companyId: company.id, access: 'manage' })
    if (!tenant.ok) return deny(tenant.status, tenant.error, 'Нет доступа к магазину этой компании')
    return { ok: true, userId: user.id, company }
  } catch {
    return deny(503, 'store_access_unavailable', 'Не удалось проверить доступ к магазину')
  }
}
