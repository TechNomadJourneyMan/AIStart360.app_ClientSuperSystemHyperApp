/**
 * lib/data-layer/refresh.ts — re-materialise a company after its data changed
 * (a document deleted, a discrepancy resolved …): metrics, period facts and
 * discrepancies are rebuilt from the current inputs. Service role, scoped to
 * the company's primary owner (lib/metrics/materialize-tenant.ts).
 *
 * Callers must have authorised the company. Runs after the response.
 */
import { runInBackground } from '@/lib/background'

export async function refreshCompanyData(companyId: string): Promise<void> {
  const [{ createServiceClient }, { materializeForTenant, companyOwnerId }] = await Promise.all([
    import('@/lib/supabase-service'),
    import('@/lib/metrics/materialize-tenant'),
  ])
  const service = createServiceClient()
  const owner = await companyOwnerId(service, companyId)
  if (!owner) return
  await materializeForTenant(service, service, { companyId, userId: owner })
}

export function refreshCompanyDataInBackground(companyId: string | null | undefined): void {
  if (!companyId) return
  void runInBackground(`data-refresh:${companyId}`, () => refreshCompanyData(companyId))
}

/** The company of a user without one on the row (older uploads): companies.user_id. */
export async function companyOfOwner(userId: string): Promise<string | null> {
  const { createServiceClient } = await import('@/lib/supabase-service')
  const { data } = await createServiceClient().from('companies').select('id').eq('user_id', userId).limit(1)
  return ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null
}
