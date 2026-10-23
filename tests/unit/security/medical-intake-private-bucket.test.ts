/**
 * POST /api/v1/onboarding/medical stores the patient base in the PRIVATE
 * bucket `client-documents` (the owner's folder) and registers the document
 * with storage_bucket/storage_path. It used to upload to the formerly public
 * bucket `documents` (migration 133).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { MEDICAL_INTAKE_FIELDS } from '@/lib/intake-schemas'

const ME = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: '11111111-1111-4111-8111-111111111111' } } }) } }),
}))
vi.mock('@/lib/supabase-service', () => ({ requireServiceRoleKey: () => 'service-key' }))

const calls: Array<{ url: string; method: string; body: unknown }> = []

const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  calls.push({ url, method, body })
  if (url.includes('/storage/v1/object/')) return new Response('{}', { status: 200 })
  if (url.includes('/rest/v1/companies?user_id=')) return new Response(JSON.stringify([{ id: 'company-1' }]), { status: 200 })
  if (url.includes('/rest/v1/documents')) return new Response(JSON.stringify([{ id: 'doc-1' }]), { status: 201 })
  return new Response('[]', { status: 200 })
})

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.example'
  calls.length = 0
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function intakeRequest(): NextRequest {
  const answers: Record<string, string> = {}
  for (const f of MEDICAL_INTAKE_FIELDS) if (f.type !== 'file') answers[f.key] = f.type === 'email' ? 'a@b.kz' : 'Клиника'
  const form = new FormData()
  form.set('answers', JSON.stringify(answers))
  form.set('patient_base', new File(['phone,date,amount\n+77010000000,2026-01-01,1000\n'], 'patients.csv', { type: 'text/csv' }))
  return new NextRequest('http://localhost/api/v1/onboarding/medical', { method: 'POST', body: form })
}

describe('medical intake upload', () => {
  it('uploads into the owner folder of client-documents, never the documents bucket', async () => {
    const { POST } = await import('@/app/api/v1/onboarding/medical/route')
    const res = await POST(intakeRequest())
    expect(res.status).toBe(200)

    const uploads = calls.filter((c) => c.url.includes('/storage/v1/object/'))
    expect(uploads).toHaveLength(1)
    expect(uploads[0].url).toMatch(new RegExp(`/storage/v1/object/client-documents/${ME}/medical/\\d+_patients\\.csv$`))
    expect(calls.some((c) => c.url.includes('/object/documents/'))).toBe(false)

    const insert = calls.find((c) => c.url.endsWith('/rest/v1/documents') && c.method === 'POST')
    const row = insert?.body as Record<string, unknown>
    expect(row.storage_bucket).toBe('client-documents')
    expect(row.storage_path).toBe(row.file_url)
    expect(String(row.storage_path)).toMatch(new RegExp(`^${ME}/medical/`))
  })
})
