/**
 * lib/metrics/materialize-tenant.ts — materialise the metrics of an
 * AUTHORISED company.
 *
 *   serviceClient  the service role (lib/supabase-service.ts). It reads the
 *                  inputs AND writes public.metrics:
 *                  • writes — since migration 088 `anon` / `authenticated`
 *                    have no INSERT/UPDATE/DELETE on public.metrics, so a
 *                    client can never forge a value, its source, confidence
 *                    or provenance;
 *                  • reads — under RLS (migration 084) a member, partner or
 *                    staff user does not see the owner's survey answers,
 *                    documents and GRI assessment that carry no company_id.
 *                    Reading with their session made the resolver see «no
 *                    inputs» and the superseded-row cleanup then deleted the
 *                    owner's metric values. The inputs are therefore always
 *                    read with the service client, scoped to the company's
 *                    primary owner (companies.user_id) and company_id, so the
 *                    result never depends on who clicked «пересчитать».
 *
 * Callers must authorise the company first (lib/tenancy resolveTenant*). The
 * operation writes only values derived from the company's own inputs and
 * takes no value from the request, so read access to the company suffices.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TenantContext } from '@/lib/tenancy'
import { gatherResolverContext, materializeAll, type MaterializeResult } from './materialize'
import type { MetricValue, ResolverContext } from './types'

/** Company of an authorised request; `role` (when known) is the caller's role in it. */
export type MetricsTenant = Pick<TenantContext, 'companyId' | 'userId'> & { role?: TenantContext['role'] }

/**
 * Primary owner of the company (whose questionnaire feeds the metrics), or
 * null when the company has none. A failed read throws — guessing the owner
 * (e.g. the caller) would feed someone else's inputs.
 */
export async function companyOwnerId(client: SupabaseClient, companyId: string): Promise<string | null> {
  const { data, error } = await client.from('companies').select('user_id').eq('id', companyId).maybeSingle()
  if (error) throw new Error(`metrics: company owner read failed (${error.code ?? 'unknown'})`)
  return (data?.user_id as string | null | undefined) ?? null
}

/**
 * Whose inputs feed the company's metrics: companies.user_id. A company
 * without a primary owner falls back to the caller only when the caller is
 * that company's owner (or the caller named the owner, role unknown — the
 * diagnostics pipeline); anyone else gets an error instead of their own
 * (empty) questionnaire.
 */
export async function metricsInputOwner(serviceClient: SupabaseClient, tenant: MetricsTenant): Promise<string> {
  const owner = await companyOwnerId(serviceClient, tenant.companyId)
  if (owner) return owner
  if (tenant.role === undefined || tenant.role === 'owner') return tenant.userId
  throw new Error('metrics: the company has no primary owner — inputs cannot be attributed')
}

/**
 * Resolver inputs of the company: the owner's survey answers, the company's
 * parsed documents (+ the owner's uploads without a company) and the owner's
 * GRI assessment. `serviceClient` must be the service role, used only after
 * the tenant check.
 */
export async function resolverContextForTenant(
  serviceClient: SupabaseClient,
  tenant: MetricsTenant,
  now?: Date,
): Promise<ResolverContext> {
  const ownerId = await metricsInputOwner(serviceClient, tenant)
  return gatherResolverContext(serviceClient, {
    userId: ownerId,
    companyId: tenant.companyId,
    documentsScope: 'company',
    now,
  })
}

/**
 * Resolve + write the company's metrics. `_sessionClient` (the caller's
 * session) is kept for call-site compatibility only: inputs and writes both go
 * through `serviceClient` (see the file header).
 */
export async function materializeForTenant(
  _sessionClient: SupabaseClient,
  serviceClient: SupabaseClient,
  tenant: MetricsTenant,
): Promise<{ result: MaterializeResult; values: MetricValue[]; ctx: ResolverContext }> {
  const ctx = await resolverContextForTenant(serviceClient, tenant)
  const { result, values } = await materializeAll(serviceClient, ctx)
  return { result, values, ctx }
}
