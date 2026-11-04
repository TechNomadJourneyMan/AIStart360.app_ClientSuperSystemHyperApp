import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const supabase = vi.hoisted(() => ({ create: vi.fn() }))
const identity = vi.hoisted(() => ({ resolve: vi.fn() }))
const persistence = vi.hoisted(() => ({
  save: vi.fn(),
  parse: vi.fn(),
  validStep: vi.fn(),
  unwrap: vi.fn(),
}))
const notifications = vi.hoisted(() => ({ notify: vi.fn() }))
const pointA = vi.hoisted(() => ({
  verifyCompany: vi.fn(),
  ingest: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: supabase.create,
}))
vi.mock('@/lib/api-identity', () => ({
  resolveTargetUserId: identity.resolve,
}))
vi.mock('@/lib/survey/persistence', () => ({
  saveSurveyAnswers: persistence.save,
  parseSurveyAnswers: persistence.parse,
  isValidSurveyStep: persistence.validStep,
  unwrapStoredSurveyAnswer: persistence.unwrap,
}))
vi.mock('@/lib/notifications', () => ({
  notifyAdmins: notifications.notify,
}))
vi.mock('@/lib/point-a/model/repository', () => ({
  ensureOwnedCompany: pointA.verifyCompany,
  ingestSurveyAnswersToPointA: pointA.ingest,
  pointARepositoryError: pointA.error,
}))

import { GET, POST } from '@/app/api/v1/onboarding/survey/route'

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/onboarding/survey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('onboarding survey route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabase.create.mockReturnValue({})
    identity.resolve.mockResolvedValue({ userId: 'session-user' })
    persistence.parse.mockImplementation((value) => value)
    persistence.validStep.mockReturnValue(true)
    persistence.unwrap.mockImplementation((value) =>
      value && typeof value === 'object' && 'value' in value
        ? (value as { value: unknown }).value
        : value,
    )
    persistence.save.mockResolvedValue({
      ok: true,
      saved: 1,
      sheetSync: { status: 'synced', synced: 1 },
    })
    pointA.verifyCompany.mockResolvedValue('company-1')
    pointA.ingest.mockResolvedValue({
      created: 1,
      unchanged: 0,
      fields: ['survey.revenue'],
    })
    pointA.error.mockImplementation((error) => String(error))
  })

  it('persists only after resolving the authenticated target identity', async () => {
    const response = await POST(
      post({
        user_id: 'body-user',
        company_id: 'company-1',
        step: 2,
        answers: { revenue: { value: 42 } },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        saved: 1,
        sheet_sync: { status: 'synced', synced: 1 },
        point_a_sync: {
          created: 1,
          unchanged: 0,
          fields: ['survey.revenue'],
        },
      },
    })
    expect(identity.resolve).toHaveBeenCalledWith({}, 'body-user')
    expect(persistence.save).toHaveBeenCalledWith(
      {},
      {
        userId: 'session-user',
        companyId: 'company-1',
        step: 2,
        answers: { revenue: { value: 42 } },
      },
    )
  })

  it('returns auth errors before persistence', async () => {
    identity.resolve.mockResolvedValue({ error: 'unauthorized' })
    const response = await POST(
      post({ step: 1, answers: { name: { value: 'A' } } }),
    )

    expect(response.status).toBe(401)
    expect(persistence.save).not.toHaveBeenCalled()
  })

  it('returns DB success with explicit Sheet failure metadata', async () => {
    persistence.save.mockResolvedValue({
      ok: true,
      saved: 1,
      sheetSync: { status: 'failed', reason: 'sync_error' },
    })
    const response = await POST(
      post({ step: 1, answers: { name: { value: 'A' } } }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        saved: 1,
        sheet_sync: { status: 'failed', reason: 'sync_error' },
      },
    })
  })

  it('does not report success when the authoritative DB upsert fails', async () => {
    persistence.save.mockResolvedValue({
      ok: false,
      error: new Error('DB failed'),
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(
      post({ step: 1, answers: { name: { value: 'A' } } }),
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Failed to save answers',
    })
    consoleError.mockRestore()
  })

  it('rejects invalid payloads before authentication', async () => {
    persistence.validStep.mockReturnValue(false)
    const response = await POST(post({ step: 99, answers: {} }))

    expect(response.status).toBe(400)
    expect(identity.resolve).not.toHaveBeenCalled()
  })

  it('reads canonical and imported bare answers for server prefill', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          question_key: 'canonical',
          answer: { value: 10 },
          step: 1,
        },
        {
          question_key: 'imported',
          answer: 'legacy',
          step: 2,
        },
      ],
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    supabase.create.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) })

    const response = await GET(
      new NextRequest('http://localhost/api/v1/onboarding/survey'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        answers: { canonical: 10, imported: 'legacy' },
        completed_steps: [1, 2],
      },
    })
  })
})
