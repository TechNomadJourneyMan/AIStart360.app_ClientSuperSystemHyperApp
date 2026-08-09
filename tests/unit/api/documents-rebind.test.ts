// Unit tests for POST /api/v1/documents/[id]/rebind.
//
// Mock policy: Supabase server client and next/headers are mocked. The real
// deterministic `@/lib/documents/bind-fields` module is exercised so the route
// test also verifies that parsed fields reach the canonical metric registry.
//
// Coverage:
//   - 401 (unauthenticated)
//   - 404 (document not found)
//   - 409 (document not yet parsed)
//   - 403 (caller is neither owner nor admin)
//   - 200 owner path: parsed_data preserved and rebound fields are persisted
//   - 200 admin path: a profile with role='admin' can rebind a document they
//     do not own

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── next/headers stub ────────────────────────────────────────────────────────
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}))

// ─── Supabase factory ─────────────────────────────────────────────────────────
interface QueryResult {
  data: unknown
  error: unknown
}

type Op = 'selectSingle' | 'update'

interface FakeUser {
  id: string
  email?: string
}

interface FakeState {
  user: FakeUser | null
  authError: unknown
  tableResponses: Partial<Record<string, Partial<Record<Op, QueryResult>>>>
  updateCalls: Array<{ table: string; values: unknown; matchId: string | null }>
}

const state: FakeState = {
  user: null,
  authError: null,
  tableResponses: {},
  updateCalls: [],
}

function resetState() {
  state.user = null
  state.authError = null
  state.tableResponses = {}
  state.updateCalls = []
}

function makeFrom(table: string) {
  return {
    select: (_cols?: string) => ({
      eq: (_col: string, _val: unknown) => ({
        single: async () => {
          const resp = state.tableResponses[table]?.selectSingle
          return resp ?? { data: null, error: { message: 'no stub' } }
        },
      }),
    }),
    update: (values: unknown) => ({
      eq: async (_col: string, val: unknown) => {
        state.updateCalls.push({
          table,
          values,
          matchId: typeof val === 'string' ? val : String(val),
        })
        const resp = state.tableResponses[table]?.update
        return resp ?? { data: null, error: null }
      },
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user },
        error: state.authError,
      }),
    },
    from: (table: string) => makeFrom(table),
  }),
}))

beforeEach(() => {
  resetState()
})

// ─── Helper ───────────────────────────────────────────────────────────────────
async function callRoute(id: string) {
  const { POST } = await import('@/app/api/v1/documents/[id]/rebind/route')
  const req = new NextRequest(
    `http://localhost/api/v1/documents/${id}/rebind`,
    { method: 'POST' },
  )
  return POST(req, { params: { id } })
}

const sampleFields = [
  {
    key: 'revenue',
    label: 'Revenue',
    value: 100,
    target_tab: 'finance',
    target_parameter: 'revenue',
    metric_id: null,
  },
  {
    key: 'cogs',
    label: 'COGS',
    value: 40,
    target_tab: 'finance',
    target_parameter: 'cogs',
    metric_id: 'kpi.cogs',
  },
]

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('POST /api/v1/documents/[id]/rebind', () => {
  it('returns 401 when not authenticated', async () => {
    state.user = null
    const res = await callRoute('doc-1')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 404 when the document does not exist', async () => {
    state.user = { id: 'user-1' }
    state.tableResponses.documents = {
      selectSingle: { data: null, error: { message: 'not found' } },
    }
    const res = await callRoute('doc-missing')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it("returns 409 when parse_status is 'processing' (not yet parsed)", async () => {
    state.user = { id: 'user-1' }
    state.tableResponses.documents = {
      selectSingle: {
        data: {
          id: 'doc-1',
          user_id: 'user-1',
          doc_type: 'pnl',
          parse_status: 'processing',
          parsed_data: null,
        },
        error: null,
      },
    }
    const res = await callRoute('doc-1')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/not parsed/i)
  })

  it('returns 403 when caller is neither owner nor admin', async () => {
    state.user = { id: 'stranger' }
    state.tableResponses.documents = {
      selectSingle: {
        data: {
          id: 'doc-1',
          user_id: 'user-1', // belongs to someone else
          doc_type: 'pnl',
          parse_status: 'parsed',
          parsed_data: { fields: sampleFields },
        },
        error: null,
      },
    }
    state.tableResponses.profiles = {
      selectSingle: { data: { role: 'client' }, error: null },
    }

    const res = await callRoute('doc-1')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/forbidden/i)
  })

  it('owner can reach the bind step and the bind-fields module rebinds successfully', async () => {
    state.user = { id: 'user-1' }
    state.tableResponses.documents = {
      selectSingle: {
        data: {
          id: 'doc-1',
          user_id: 'user-1',
          doc_type: 'pnl',
          parse_status: 'parsed',
          parsed_data: {
            summary: 's',
            fields: sampleFields,
            raw_text_preview: 'p',
            extracted_at: '2026-01-01T00:00:00Z',
            model_used: 'm',
          },
        },
        error: null,
      },
      update: { data: null, error: null },
    }

    const res = await callRoute('doc-1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // The deterministic binder runs and returns total = sample count.
    expect(body.data.total).toBe(sampleFields.length)
    expect(typeof body.data.updated).toBe('number')
    // Module is available — no degrade note.
    expect(body.note).toBeUndefined()
    // Persistence happens once.
    expect(state.updateCalls).toHaveLength(1)
  })

  it("allows a profile with role='admin' to rebind a document they do not own", async () => {
    state.user = { id: 'admin-user' }
    state.tableResponses.documents = {
      selectSingle: {
        data: {
          id: 'doc-1',
          user_id: 'someone-else',
          doc_type: 'pnl',
          parse_status: 'parsed',
          parsed_data: { fields: sampleFields },
        },
        error: null,
      },
      update: { data: null, error: null },
    }
    state.tableResponses.profiles = {
      selectSingle: { data: { role: 'admin' }, error: null },
    }

    const res = await callRoute('doc-1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(sampleFields.length)
    expect(typeof body.data.updated).toBe('number')
    expect(body.note).toBeUndefined()
  })
})
