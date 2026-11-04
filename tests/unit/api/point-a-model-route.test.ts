import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const supabase = vi.hoisted(() => ({ client: {}, create: vi.fn() }))
const identity = vi.hoisted(() => ({ getSessionUser: vi.fn() }))
const repository = vi.hoisted(() => ({
  ensureOwnedCompany: vi.fn(),
  backfillStoredDocumentsToPointA: vi.fn(),
  backfillStoredSurveyAnswersToPointA: vi.fn(),
  readPointAModel: vi.fn(),
  pointARepositoryError: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: supabase.create,
}))
vi.mock('@/lib/api-identity', () => ({
  getSessionUser: identity.getSessionUser,
}))
vi.mock('@/lib/point-a/model/repository', () => repository)

import { GET } from '@/app/api/v1/point-a/model/route'

function request(query = '') {
  return new NextRequest(`http://localhost/api/v1/point-a/model${query}`)
}

describe('GET /api/v1/point-a/model', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabase.create.mockReturnValue(supabase.client)
    identity.getSessionUser.mockResolvedValue({ id: 'user-1' })
    repository.ensureOwnedCompany.mockResolvedValue('company-1')
    repository.backfillStoredSurveyAnswersToPointA.mockResolvedValue({
      created: 0,
      unchanged: 0,
      fields: [],
    })
    repository.backfillStoredDocumentsToPointA.mockResolvedValue({
      created: 0,
      unchanged: 0,
      fields: [],
    })
    repository.readPointAModel.mockResolvedValue({
      companyId: 'company-1',
      generatedAt: '2026-07-25T00:00:00.000Z',
      completion: 0,
      fields: [],
      conflicts: [],
      missing: [],
      recentChanges: [],
    })
    repository.pointARepositoryError.mockImplementation((error: unknown) => (
      error instanceof Error ? error.message : String(error)
    ))
  })

  it('requires a session', async () => {
    identity.getSessionUser.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(repository.ensureOwnedCompany).not.toHaveBeenCalled()
  })

  it('bootstraps legacy survey answers before reading the model', async () => {
    const response = await GET(request('?company_id=company-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(repository.ensureOwnedCompany).toHaveBeenCalledWith(
      supabase.client,
      'user-1',
      'company-1',
    )
    expect(repository.backfillStoredSurveyAnswersToPointA).toHaveBeenCalledWith(
      supabase.client,
      { userId: 'user-1', companyId: 'company-1' },
    )
    expect(repository.backfillStoredDocumentsToPointA).toHaveBeenCalledWith(
      supabase.client,
      { userId: 'user-1', companyId: 'company-1' },
    )
    expect(repository.readPointAModel).toHaveBeenCalledWith(
      supabase.client,
      { userId: 'user-1', companyId: 'company-1' },
    )
  })

  it('returns 404 when the requested company does not exist', async () => {
    repository.ensureOwnedCompany.mockRejectedValue(
      new Error('Компания пользователя не найдена'),
    )

    const response = await GET(request('?company_id=missing'))

    expect(response.status).toBe(404)
    expect(repository.backfillStoredSurveyAnswersToPointA).not.toHaveBeenCalled()
  })

  it('returns 500 for a database failure', async () => {
    repository.readPointAModel.mockRejectedValue(new Error('database offline'))

    const response = await GET(request())

    expect(response.status).toBe(500)
  })
})
