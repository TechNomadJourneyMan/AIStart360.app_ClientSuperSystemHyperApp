import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dependencies = vi.hoisted(() => ({ access: vi.fn(), configuration: vi.fn() }))
vi.mock('@/lib/store/request', () => ({ authorizeStore: dependencies.access }))
vi.mock('@/lib/integrations/myhonor/order-analytics', () => ({
  getMyHonorAnalyticsConfiguration: dependencies.configuration,
}))
import { authorizeMyHonorAccount } from '@/lib/integrations/myhonor/access'

describe('MyHonor account binding', () => {
  const client = {} as SupabaseClient
  beforeEach(() => {
    vi.resetAllMocks()
    dependencies.access.mockResolvedValue({
      ok: true, userId: 'owner-1', company: { id: 'company-1', name: 'Synthetic company' },
    })
    dependencies.configuration.mockReturnValue({
      ready: true, userId: 'owner-1', companyId: 'company-1', webhookSecret: 'private-test-value',
    })
  })

  it('preserves access denials, including MFA, before inspecting integration configuration', async () => {
    const denial = { ok: false, error: { status: 403, code: 'mfa_step_up_required' } }
    dependencies.access.mockResolvedValue(denial)
    expect(await authorizeMyHonorAccount(client, 'company-1')).toEqual(denial)
    expect(dependencies.configuration).not.toHaveBeenCalled()
  })

  it('requires both configured owner and exact selected company', async () => {
    for (const mismatch of [{ userId: 'other-owner' }, { companyId: 'other-company' }]) {
      dependencies.configuration.mockReturnValue({
        ready: true, userId: 'owner-1', companyId: 'company-1', ...mismatch,
      })
      expect(await authorizeMyHonorAccount(client, 'company-1')).toMatchObject({
        ok: false, error: { status: 403, code: 'integration_not_bound' },
      })
    }
    expect(dependencies.access).toHaveBeenCalledWith(client, 'company-1')
  })

  it('does not return configuration secrets or infer readiness', async () => {
    const result = await authorizeMyHonorAccount(client, 'company-1')
    expect(result).toMatchObject({ ok: true, userId: 'owner-1', company: { id: 'company-1' } })
    expect(JSON.stringify(result)).not.toContain('private-test-value')
    dependencies.configuration.mockReturnValue({ ready: false })
    expect(await authorizeMyHonorAccount(client, 'company-1')).toMatchObject({
      ok: false, error: { status: 503, code: 'integration_not_configured' },
    })
  })
})
