import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  allowed: true,
  adminOrderColumn: '',
  inserted: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/admin/giga-actor', () => ({
  isGigaSuperAdmin: () => Promise.resolve(state.allowed),
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table === 'admin_requests') {
        return {
          select: () => ({
            order: (column: string) => {
              state.adminOrderColumn = column
              return Promise.resolve({
                data: [{
                  id: 'request-1',
                  type: 'registration',
                  status: 'new',
                  priority: 'medium',
                  source: 'client_portal',
                  payload: { userId: 'user-1', name: 'Honor', email: 'demo@example.com' },
                  rejectionReason: 'Нужны данные',
                  createdAt: '2026-07-29T00:00:00.000Z',
                }],
                error: null,
              })
            },
          }),
          insert: (values: Record<string, unknown>) => {
            state.inserted = values
            return Promise.resolve({ error: null })
          },
        }
      }

      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }

      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { GET, POST } from '@/app/api/giga-admin/requests/route'

describe('/api/giga-admin/requests — Prisma column compatibility', () => {
  beforeEach(() => {
    state.allowed = true
    state.adminOrderColumn = ''
    state.inserted = null
  })

  it('sorts and maps the quoted camelCase Prisma columns', async () => {
    const response = await GET(new NextRequest('http://localhost/api/giga-admin/requests'))
    expect(response.status).toBe(200)
    expect(state.adminOrderColumn).toBe('createdAt')

    const body = await response.json()
    expect(body.requests[0]).toMatchObject({
      id: 'request-1',
      createdAt: '2026-07-29T00:00:00.000Z',
      rejectionReason: 'Нужны данные',
    })
  })

  it('inserts timestamps using the physical camelCase column names', async () => {
    const response = await POST(new NextRequest('http://localhost/api/giga-admin/requests', {
      method: 'POST',
      body: JSON.stringify({ type: 'registration' }),
      headers: { 'content-type': 'application/json' },
    }))

    expect(response.status).toBe(201)
    expect(state.inserted).toMatchObject({
      type: 'registration',
      status: 'new',
    })
    expect(state.inserted).toHaveProperty('createdAt')
    expect(state.inserted).toHaveProperty('updatedAt')
    expect(state.inserted).not.toHaveProperty('created_at')
    expect(state.inserted).not.toHaveProperty('updated_at')
  })
})
