/**
 * Budget checks when today's spend cannot be read (pool exhausted, database
 * down): fail closed in production, open elsewhere or with
 * AI_BUDGET_FAIL_OPEN=true (review finding #26).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agents/store', () => ({
  spendToday: async () => { throw new Error('P2024: Timed out fetching a new connection from the connection pool') },
}))
vi.mock('@/lib/ai/providers/store', () => ({
  providerSpendToday: async () => { throw new Error('P2024: Timed out fetching a new connection from the connection pool') },
}))
vi.mock('@/lib/ai/providers/router', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/providers/router')>()
  return {
    ...real,
    effectiveBudgets: async () => ({ platformDailyUsd: 50, companyDailyUsd: 5, source: { platform: 'env', company: 'env' } }),
  }
})

import { platformBudgetLeft } from '@/lib/ai/usage-ledger'
import { providerBudgetRefusal } from '@/lib/ai/providers/router'
import type { ProviderTarget } from '@/lib/ai/providers/types'

const target = { providerKey: 'alem', providerName: 'Alem Plus', dailyBudgetUsd: 2 } as unknown as ProviderTarget

afterEach(() => {
  vi.unstubAllEnvs()
  vi.spyOn(console, 'warn').mockRestore()
  vi.spyOn(console, 'error').mockRestore()
})

describe('budget checks with unknown spend', () => {
  it('refuse the call in production', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('NODE_ENV', 'production')
    expect(await platformBudgetLeft()).toBe(0)
    expect(await providerBudgetRefusal(target)).toMatch(/не удалось проверить/)
  })

  it('allow the call in production only with the explicit opt-out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AI_BUDGET_FAIL_OPEN', 'true')
    expect(await platformBudgetLeft()).toBeNull()
    expect(await providerBudgetRefusal(target)).toBeNull()
  })

  it('allow the call outside production', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('NODE_ENV', 'test')
    expect(await platformBudgetLeft()).toBeNull()
    expect(await providerBudgetRefusal(target)).toBeNull()
  })
})
