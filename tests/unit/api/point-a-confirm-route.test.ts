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

import { POST } from '@/app/api/v1/point-a/values/[id]/confirm/route'

function valueLookup(result: { data: unknown; error?: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

function callPost(id = 'value-1') {
  return POST(
    new NextRequest(
      `http://localhost/api/v1/point-a/values/${id}/confirm`,
      { method: 'POST' },
    ),
    { params: { id } },
  )
}

describe('POST /api/v1/point-a/values/[id]/confirm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabase.create.mockReturnValue(supabase.client)
    identity.getSessionUser.mockResolvedValue({ id: 'user-1' })
    repository.confirmPointAValue.mockResolvedValue({
      id: 'resolution-1',
      selected_value_id: 'value-1',
      resolution_status: 'resolved',
    })
    repository.readPointAModel.mockResolvedValue({
      companyId: 'company-1',
      fields: [],
    })
  })

  it('returns 401 and never queries values when unauthenticated', async () => {
    identity.getSessionUser.mockResolvedValue(null)

    const response = await callPost()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'unauthorized',
    })
    expect(supabase.client.from).not.toHaveBeenCalled()
    expect(repository.confirmPointAValue).not.toHaveBeenCalled()
  })

  it('confirms an owned value and returns the refreshed model', async () => {
    const lookup = valueLookup({
      data: { company_id: 'company-1' },
      error: null,
    })
    supabase.client.from.mockReturnValue(lookup)

    const response = await callPost('value-1')

    expect(response.status).toBe(200)
    expect(supabase.client.from).toHaveBeenCalledWith('point_a_values')
    expect(lookup.eq).toHaveBeenNthCalledWith(1, 'id', 'value-1')
    expect(lookup.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-1')
    expect(repository.confirmPointAValue).toHaveBeenCalledWith(
      supabase.client,
      {
        userId: 'user-1',
        companyId: 'company-1',
        valueId: 'value-1',
      },
    )
    expect(repository.readPointAModel).toHaveBeenCalledWith(supabase.client, {
      userId: 'user-1',
      companyId: 'company-1',
    })
    expect(await response.json()).toMatchObject({
      ok: true,
      resolution: {
        selected_value_id: 'value-1',
        resolution_status: 'resolved',
      },
      model: { companyId: 'company-1' },
    })
  })

  it.each([
    ['absent', null],
    ['foreign under the ownership filter', null],
  ])('returns 404 for an %s value', async (_label, data) => {
    const lookup = valueLookup({ data, error: null })
    supabase.client.from.mockReturnValue(lookup)

    const response = await callPost('unavailable-value')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Значение не найдено',
    })
    expect(lookup.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(repository.confirmPointAValue).not.toHaveBeenCalled()
    expect(repository.readPointAModel).not.toHaveBeenCalled()
  })
})
