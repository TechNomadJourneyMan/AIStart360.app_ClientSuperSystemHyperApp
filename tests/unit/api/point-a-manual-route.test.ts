import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const supabase = vi.hoisted(() => ({
  client: { from: vi.fn() },
  create: vi.fn(),
}))
const identity = vi.hoisted(() => ({ getSessionUser: vi.fn() }))
const repository = vi.hoisted(() => ({
  verifyOwnedCompany: vi.fn(),
  setManualPointAValue: vi.fn(),
  readPointAModel: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: supabase.create,
}))
vi.mock('@/lib/api-identity', () => ({
  getSessionUser: identity.getSessionUser,
}))
vi.mock('@/lib/point-a/model/repository', () => ({
  verifyOwnedCompany: repository.verifyOwnedCompany,
  setManualPointAValue: repository.setManualPointAValue,
  readPointAModel: repository.readPointAModel,
  pointARepositoryError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

import { PUT } from '@/app/api/v1/point-a/fields/[fieldKey]/route'

function request(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/point-a/fields/biz.finansy.vyruchka_god',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function callPut(body: unknown, fieldKey = 'biz.finansy.vyruchka_god') {
  return PUT(request(body), { params: { fieldKey } })
}

describe('PUT /api/v1/point-a/fields/[fieldKey]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabase.create.mockReturnValue(supabase.client)
    identity.getSessionUser.mockResolvedValue({ id: 'user-1' })
    repository.verifyOwnedCompany.mockResolvedValue('company-1')
    repository.setManualPointAValue.mockResolvedValue({
      created: 1,
      unchanged: 0,
      fields: ['biz.finansy.vyruchka_god'],
    })
    repository.readPointAModel.mockResolvedValue({
      companyId: 'company-1',
      fields: [],
      conflicts: [],
    })
  })

  it('returns 401 before parsing or repository work when unauthenticated', async () => {
    identity.getSessionUser.mockResolvedValue(null)

    const response = await callPut({ value: 84_200_000 })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'unauthorized',
    })
    expect(repository.verifyOwnedCompany).not.toHaveBeenCalled()
    expect(repository.setManualPointAValue).not.toHaveBeenCalled()
  })

  it('rejects a payload without an explicit value property', async () => {
    const response = await callPut({ scenario: 'fact' })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'value is required',
    })
    expect(repository.verifyOwnedCompany).not.toHaveBeenCalled()
    expect(repository.setManualPointAValue).not.toHaveBeenCalled()
  })

  it('rejects an unsupported scenario', async () => {
    const response = await callPut({
      value: 84_200_000,
      scenario: 'baseline',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'invalid scenario',
    })
    expect(repository.verifyOwnedCompany).not.toHaveBeenCalled()
  })

  it('verifies ownership and forwards the normalized route contract to the manual service', async () => {
    const response = await callPut(
      {
        companyId: 'company-1',
        value: '84,2 млн ₸',
        unit: '₸',
        currency: 'KZT',
        period: '2025-Q4',
        periodYear: 2025,
        periodQuarter: 'Q4',
        periodMonth: 12,
        scenario: 'plan',
      },
      'biz.finansy.vyruchka%5Fgod',
    )

    expect(response.status).toBe(200)
    expect(repository.verifyOwnedCompany).toHaveBeenCalledWith(
      supabase.client,
      'user-1',
      'company-1',
    )
    expect(repository.setManualPointAValue).toHaveBeenCalledWith(
      supabase.client,
      {
        userId: 'user-1',
        companyId: 'company-1',
        fieldKey: 'biz.finansy.vyruchka_god',
        value: '84,2 млн ₸',
        unit: '₸',
        currency: 'KZT',
        period: '2025-Q4',
        periodYear: 2025,
        periodQuarter: 'Q4',
        periodMonth: 12,
        scenario: 'plan',
      },
    )
    expect(repository.readPointAModel).toHaveBeenCalledWith(supabase.client, {
      userId: 'user-1',
      companyId: 'company-1',
    })
    expect(await response.json()).toMatchObject({
      ok: true,
      result: { created: 1 },
      model: { companyId: 'company-1' },
    })
  })

  it('does not write when the requested company is absent or belongs to another user', async () => {
    repository.verifyOwnedCompany.mockRejectedValue(
      new Error('Компания пользователя не найдена'),
    )

    const response = await callPut({
      companyId: 'foreign-company',
      value: 1,
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Компания пользователя не найдена',
    })
    expect(repository.setManualPointAValue).not.toHaveBeenCalled()
    expect(repository.readPointAModel).not.toHaveBeenCalled()
  })
})
