/**
 * lib/metrics/materialize-tenant.ts — materialise the metrics of an
 * AUTHORISED company.
 *
 *   readClient   the caller's session client: reads the inputs under RLS
 *   writeClient  the service role (lib/supabase-service.ts): since migration
 *                088 `anon` / `authenticated` have no INSERT/UPDATE/DELETE on
 *                public.metrics, so a client can never forge a value, its
 *                source, confidence or provenance — only the server writes
 *                what the resolver computed.
 *
 * Callers must authorise the company first (lib/tenancy resolveTenant*). The
 * operation writes only values derived from the company's own inputs and
 * takes no value from the request, so read access to the company suffices.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TenantContext } from '@/lib/tenancy'
import { gatherResolverContext, materializeAll, type MaterializeResult } from './materialize'
import type { MetricValue, ResolverContext } from './types'

/** Primary owner of the company (whose questionnaire feeds the metrics), or null. */
export async function companyOwnerId(readClient: SupabaseClient, companyId: string): Promise<string | null> {
  const { data } = await readClient.from('companies').select('user_id').eq('id', companyId).maybeSingle()
  return (data?.user_id as string | null | undefined) ?? null
}

/** Resolver inputs of the company: the owner's survey answers + the company's parsed documents. */
export async function resolverContextForTenant(
  readClient: SupabaseClient,
  tenant: Pick<TenantContext, 'companyId' | 'userId'>,
  now?: Date,
): Promise<ResolverContext> {
  const ownerId = (await companyOwnerId(readClient, tenant.companyId)) ?? tenant.userId
  return gatherResolverContext(readClient, {
    userId: ownerId,
    companyId: tenant.companyId,
    documentsScope: 'company',
    now,
  })
}

export async function materializeForTenant(
  readClient: SupabaseClient,
  writeClient: SupabaseClient,
  tenant: Pick<TenantContext, 'companyId' | 'userId'>,
): Promise<{ result: MaterializeResult; values: MetricValue[]; ctx: ResolverContext }> {
  const ctx = await resolverContextForTenant(readClient, tenant)
  const { result, values } = await materializeAll(writeClient, ctx)
  return { result, values, ctx }
}
