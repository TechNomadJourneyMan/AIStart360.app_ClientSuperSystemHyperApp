/**
 * Migration 093: model calls outside the agent runtime are recorded and count
 * toward the platform / company daily AI budget used by agents.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('ai usage ledger', async () => {
  const { prisma } = await import('@/lib/db')
  const { recordUsage } = await import('@/lib/ai/usage-ledger')
  const { spendToday } = await import('@/lib/agents/store')
  const source = `feature:test.${randomUUID().slice(0, 8)}`
  const companyId = randomUUID()

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.ai_usage_ledger WHERE source = ${source}`
    await prisma.$executeRaw`DELETE FROM public.companies WHERE id = ${companyId}`
  })

  it('records spend and adds it to the platform and company totals (not to an agent total)', async () => {
    await prisma.$executeRaw`INSERT INTO public.companies (id, name, "updatedAt") VALUES (${companyId}, 'Ledger Co', now())`
    const platformBefore = await spendToday()
    const companyBefore = await spendToday({ companyId })
    await recordUsage({ source, model: 'm', tokensIn: 10, tokensOut: 5, costUsd: 0.25, costSource: 'provider', companyId, ok: true })
    await recordUsage({ source, model: 'm', tokensIn: 10, tokensOut: 5, costUsd: 0.5, costSource: 'provider', companyId: null, ok: true })

    expect(await spendToday()).toBeCloseTo(platformBefore + 0.75, 6)
    expect(await spendToday({ companyId })).toBeCloseTo(companyBefore + 0.25, 6)
    expect(await spendToday({ agentKey: 'no_such_agent' })).toBe(0)

    const rows = await prisma.$queryRaw<Array<{ cost_usd: string; tokens_in: number }>>`
      SELECT cost_usd::text, tokens_in FROM public.ai_usage_ledger WHERE source = ${source} ORDER BY id`
    expect(rows.map((r) => Number(r.cost_usd))).toEqual([0.25, 0.5])
  })

  it('API roles cannot read or write the ledger', async () => {
    const [{ ok }] = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT NOT has_table_privilege('authenticated', 'public.ai_usage_ledger', 'SELECT')
         AND NOT has_table_privilege('anon', 'public.ai_usage_ledger', 'INSERT') AS ok`
    expect(ok).toBe(true)
  })
})
