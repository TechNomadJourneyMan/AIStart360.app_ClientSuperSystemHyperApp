/**
 * Manual run of diagnostic pipeline stages: refused on the server with a human
 * message (no task that would fail with NO_SESSION, no audit, no DB access);
 * the GIGA dialog starts the company's diagnostic (orchestrator) instead;
 * NO_SESSION and other agent error codes get a human explanation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ touched: 0, audits: 0 }))

vi.mock('@/lib/admin/giga-actor', async () => {
  const { makeRequireGiga } = await import('../_giga-guard')
  return {
    requireGiga: makeRequireGiga(() => ({ id: 'staff-1', kind: 'session', role: 'super_admin' })),
    STAFF_COOKIE_NAME: 'x',
    STAFF_COOKIE_TTL_SECONDS: 60,
  }
})
vi.mock('@/lib/db', () => ({
  prisma: new Proxy({}, { get: () => { state.touched++; throw new Error('must not reach the database') } }),
}))
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: async () => { state.audits++; return true } }))
// The real registry loads every definition through a lazy require (not available here).
vi.mock('@/lib/agents/registry', () => ({
  getAgent: (key: string) => ({ key, name: key, scope: 'company', inputSchema: { safeParse: () => ({ success: true }) } }),
}))

import { DIAGNOSTIC_ORCHESTRATOR_KEY, diagnosticRunRequest, errorCodeText, pipelineStageLabel } from '@/components/giga-panel/agents/run-model'

const run = await import('@/app/api/giga-admin/agents/[key]/run/route')

beforeEach(() => { state.touched = 0; state.audits = 0 })

describe('pipeline stages are not run on their own', () => {
  it('stage keys are recognised; the orchestrator and other agents are not stages', () => {
    expect(pipelineStageLabel('data_collection')).toBe('Сбор данных')
    expect(pipelineStageLabel('recommendation')).toBe('Рекомендации')
    expect(pipelineStageLabel(DIAGNOSTIC_ORCHESTRATOR_KEY)).toBeNull()
    expect(pipelineStageLabel('monitoring')).toBeNull()
    expect(pipelineStageLabel(null)).toBeNull()
  })

  it('«Запустить диагностику компании» = a manual run of the orchestrator for the company', () => {
    expect(diagnosticRunRequest('co-1', 'Сбор данных')).toEqual({
      url: '/api/giga-admin/agents/diagnostic_orchestrator/run',
      body: { companyId: 'co-1', input: { reason: 'ручной запуск из GIGA (этап «Сбор данных»)' } },
    })
  })

  it('the run route refuses a stage with a human message, before the database and the audit', async () => {
    const res = await run.POST(
      new NextRequest('http://localhost/api/giga-admin/agents/data_collection/run', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId: 'co-1' }),
      }),
      { params: { key: 'data_collection' } },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('«Сбор данных» запускается только внутри диагностики компании')
    expect(state.touched).toBe(0)
    expect(state.audits).toBe(0)
  })
})

describe('agent error codes in human words', () => {
  it('NO_SESSION and model errors are explained; unknown codes are left as is', () => {
    expect(errorCodeText('NO_SESSION')).toMatch(/запустите диагностику компании/)
    expect(errorCodeText('NO_API_KEY')).toMatch(/ключ/)
    expect(errorCodeText('SOMETHING_ELSE')).toBeNull()
    expect(errorCodeText(null)).toBeNull()
  })
})
