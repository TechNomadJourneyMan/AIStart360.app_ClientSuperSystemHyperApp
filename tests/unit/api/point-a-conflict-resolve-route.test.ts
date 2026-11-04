import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const supabase = vi.hoisted(() => ({
  client: { from: vi.fn() },
  create: vi.fn(),
}))
const identity = vi.hoisted(() => ({ getSessionUser: vi.fn() }))
const repository = vi.hoisted(() => ({
  confirmPointAValue: vi.fn(),
  readPointAModel: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: supabase.create,
}))
vi.mock('@/lib/api-identity', () => ({
  getSessionUser: identity.getSessionUser,
}))
vi.mock('@/lib/point-a/model/repository', () => ({
  confirmPointAValue: repository.confirmPointAValue,
  readPointAModel: repository.readPointAModel,
  pointARepositoryError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

import { POST } from '@/app/api/v1/point-a/conflicts/[id]/resolve/route'

function lookup(result: { data: unknown; error?: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

function request(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/point-a/conflicts/resolution-1/resolve',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function callPost(body: unknown, id = 'resolution-1') {
  return POST(request(body), { params: { id } })
}

const resolution = {
  id: 'resolution-1',
  company_id: 'company-1',
  field_key: 'biz.finansy.vyruchka_god',
  period_key: '2025-Q4',
  scenario: 'fact',
}

describe('POST /api/v1/point-a/conflicts/[id]/resolve', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabase.create.mockReturnValue(supabase.client)
    identity.getSessionUser.mockResolvedValue({ id: 'user-1' })
    repository.confirmPointAValue.mockResolvedValue({
      id: 'resolution-1',
      selected_value_id: 'value-2',
      resolution_status: 'resolved',
    })
    repository.readPointAModel.mockResolvedValue({
      companyId: 'company-1',
      conflicts: [],
    })
  })

  it('returns 401 before parsing or querying when unauthenticated', async () => {
    identity.getSessionUser.mockResolvedValue(null)

    const response = await callPost({ valueId: 'value-2' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'unauthorized',
    })
    expect(supabase.client.from).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { valueId: 42 },
    { valueId: null },
  ])('rejects an invalid candidate payload %#', async (body) => {
    const response = await callPost(body)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'valueId is required',
    })
    expect(supabase.client.from).not.toHaveBeenCalled()
    expect(repository.confirmPointAValue).not.toHaveBeenCalled()
  })

  it('returns 404 when the conflict is absent or belongs to another user', async () => {
    const conflictLookup = lookup({ data: null, error: null })
    supabase.client.from.mockReturnValue(conflictLookup)

    const response = await callPost({ valueId: 'value-2' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Конфликт не найден',
    })
    expect(conflictLookup.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(repository.confirmPointAValue).not.toHaveBeenCalled()
  })

  it('returns 404 when the candidate is absent, foreign, or outside the conflict group', async () => {
    const conflictLookup = lookup({ data: resolution, error: null })
    const candidateLookup = lookup({ data: null, error: null })
    supabase.client.from
      .mockReturnValueOnce(conflictLookup)
      .mockReturnValueOnce(candidateLookup)

    const response = await callPost({ valueId: 'foreign-value' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Кандидат не найден',
    })
    expect(candidateLookup.eq).toHaveBeenCalledWith('id', 'foreign-value')
    expect(candidateLookup.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(candidateLookup.eq).toHaveBeenCalledWith(
      'company_id',
      'company-1',
    )
    expect(candidateLookup.eq).toHaveBeenCalledWith(
      'field_key',
      'biz.finansy.vyruchka_god',
    )
    expect(candidateLookup.eq).toHaveBeenCalledWith(
      'period_key',
      '2025-Q4',
    )
    expect(candidateLookup.eq).toHaveBeenCalledWith('scenario', 'fact')
    expect(repository.confirmPointAValue).not.toHaveBeenCalled()
  })

  it('resolves the owned conflict with an owned candidate from the exact group', async () => {
    const conflictLookup = lookup({ data: resolution, error: null })
    const candidateLookup = lookup({
      data: { id: 'value-2' },
      error: null,
    })
    supabase.client.from
      .mockReturnValueOnce(conflictLookup)
      .mockReturnValueOnce(candidateLookup)

    const response = await callPost({ valueId: 'value-2' })

    expect(response.status).toBe(200)
    expect(repository.confirmPointAValue).toHaveBeenCalledWith(
      supabase.client,
      {
        userId: 'user-1',
        companyId: 'company-1',
        valueId: 'value-2',
        eventType: 'conflict_resolved',
      },
    )
    expect(repository.readPointAModel).toHaveBeenCalledWith(supabase.client, {
      userId: 'user-1',
      companyId: 'company-1',
    })
    expect(await response.json()).toMatchObject({
      ok: true,
      resolution: {
        selected_value_id: 'value-2',
        resolution_status: 'resolved',
      },
      model: {
        companyId: 'company-1',
        conflicts: [],
      },
    })
  })
})
