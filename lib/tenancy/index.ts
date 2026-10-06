/**
 * lib/tenancy — which company a request acts on, and with what rights.
 *
 * Tenancy has three levels (migration 084, docs/platform/03-database.md):
 *   platform staff  → every company (RBAC decides what they may do)
 *   partner members → companies of their partner organisation
 *   company members → their company (owner / admin / member / viewer)
 *
 * The decision is made by the database helpers can_read_company /
 * can_manage_company through the caller's own session, so the API and RLS can
 * never disagree. New company-scoped routes call `resolveTenant()` first and
 * use its `companyId`; they never take a company id from the body on trust.
 *
 * Until 084 is applied in an environment the helpers do not exist; then only
 * the legacy rule applies (the company whose companies.user_id is the caller).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type CompanyAccess = 'read' | 'manage'

export type TenantRole =
  | 'owner' | 'admin' | 'member' | 'viewer'
  | 'partner_admin' | 'partner_expert'
  | 'staff'

export interface TenantContext {
  userId: string
  companyId: string
  role: TenantRole
  canManage: boolean
  /** True when the legacy single-owner rule was used (084 not applied). */
  legacy: boolean
}

export type TenantResult =
  | { ok: true; tenant: TenantContext }
  | { ok: false; status: 401 | 403 | 404; error: 'unauthenticated' | 'forbidden' | 'no_company' }

const MEMBER_ROLES = new Set(['owner', 'admin', 'member', 'viewer'])
const PARTNER_ROLES = new Set(['partner_admin', 'partner_expert'])

/** PostgREST / Postgres "function does not exist" — the migration is not applied yet. */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '')
}

async function rpcValue<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ value: T | null; missing: boolean }> {
  const { data, error } = await client.rpc(fn, args)
  if (error) {
    if (isMissingFunction(error)) return { value: null, missing: true }
    throw new Error(`tenancy: ${fn} failed (${error.code ?? 'unknown'})`)
  }
  return { value: (data ?? null) as T | null, missing: false }
}

async function legacyOwnedCompany(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await client
    .from('companies')
    .select('id')
    .eq('user_id', userId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/** The company a user lands on when none is specified: owner first, then any membership. */
async function defaultCompany(client: SupabaseClient, userId: string): Promise<{ id: string | null; legacy: boolean }> {
  const { data, error } = await client
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (error) {
    // Table missing (42P01 / PGRST205) ⇒ 084 not applied: legacy rule.
    return { id: await legacyOwnedCompany(client, userId), legacy: true }
  }
  const rows = (data ?? []) as Array<{ company_id: string; role: string }>
  const order = ['owner', 'admin', 'member', 'viewer']
  rows.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.company_id.localeCompare(b.company_id))
  if (rows[0]) return { id: rows[0].company_id, legacy: false }
  return { id: await legacyOwnedCompany(client, userId), legacy: false }
}

async function roleFor(client: SupabaseClient, companyId: string): Promise<TenantRole | null> {
  const member = await rpcValue<string>(client, 'company_member_role', { p_company_id: companyId })
  if (member.value && MEMBER_ROLES.has(member.value)) return member.value as TenantRole
  const partner = await rpcValue<string>(client, 'partner_role_for_company', { p_company_id: companyId })
  if (partner.value && PARTNER_ROLES.has(partner.value)) return partner.value as TenantRole
  const staff = await rpcValue<boolean>(client, 'is_platform_staff', {})
  if (staff.value) return 'staff'
  return null
}

/**
 * Resolve and authorise the tenant for `userId` using `client` (a client bound
 * to the caller's session, so auth.uid() inside the helpers is the caller).
 */
export async function resolveTenantWith(
  client: SupabaseClient,
  userId: string | null,
  opts: { companyId?: string | null; access?: CompanyAccess } = {},
): Promise<TenantResult> {
  if (!userId) return { ok: false, status: 401, error: 'unauthenticated' }
  const access = opts.access ?? 'read'

  let companyId = opts.companyId?.trim() || null
  let legacy = false
  if (!companyId) {
    const def = await defaultCompany(client, userId)
    companyId = def.id
    legacy = def.legacy
    if (!companyId) return { ok: false, status: 404, error: 'no_company' }
  }

  const check = await rpcValue<boolean>(
    client,
    access === 'manage' ? 'can_manage_company' : 'can_read_company',
    { p_company_id: companyId },
  )

  if (check.missing) {
    // 084 not applied: only the primary owner has access.
    const owned = await legacyOwnedCompany(client, userId)
    if (owned !== companyId) return { ok: false, status: 404, error: 'no_company' }
    return { ok: true, tenant: { userId, companyId, role: 'owner', canManage: true, legacy: true } }
  }

  // 404 rather than 403: do not confirm that someone else's company exists.
  if (!check.value) return { ok: false, status: opts.companyId ? 404 : 403, error: opts.companyId ? 'no_company' : 'forbidden' }

  const role = (await roleFor(client, companyId)) ?? 'owner'
  const canManage = access === 'manage'
    ? true
    : Boolean((await rpcValue<boolean>(client, 'can_manage_company', { p_company_id: companyId })).value)

  return { ok: true, tenant: { userId, companyId, role, canManage, legacy } }
}

/** Session-bound convenience for route handlers. */
export async function resolveTenant(
  opts: { companyId?: string | null; access?: CompanyAccess } = {},
): Promise<TenantResult> {
  const { createClient } = await import('@/lib/supabase/server')
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  return resolveTenantWith(client, user?.id ?? null, opts)
}

/** Russian message for a failed resolution (UI copy is Russian). */
export function tenantErrorMessage(error: Exclude<TenantResult, { ok: true }>['error']): string {
  switch (error) {
    case 'unauthenticated': return 'Требуется вход в систему'
    case 'forbidden': return 'Нет доступа к компании'
    case 'no_company': return 'Компания не найдена'
  }
}
