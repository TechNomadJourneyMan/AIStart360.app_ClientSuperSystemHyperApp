import type { SupabaseClient } from '@supabase/supabase-js'
import { authorizeStore } from '@/lib/store/request'
import { getMyHonorAnalyticsConfiguration } from './order-analytics'

/** The upstream source is configured by the server, never chosen by a payload. */
export async function authorizeMyHonorAccount(client: SupabaseClient, companyId?: string | null) {
  const access = await authorizeStore(client, companyId)
  if (!access.ok) return access
  const configuration = getMyHonorAnalyticsConfiguration()
  if (!configuration.ready) {
    return {
      ok: false as const,
      error: {
        status: 503, code: 'integration_not_configured',
        message: 'Интеграция MyHonor ещё не настроена',
      },
    }
  }
  if (configuration.userId !== access.userId || configuration.companyId !== access.company.id) {
    return {
      ok: false as const,
      error: {
        status: 403, code: 'integration_not_bound',
        message: 'Интеграция MyHonor не привязана к выбранной компании',
      },
    }
  }
  return access
}
