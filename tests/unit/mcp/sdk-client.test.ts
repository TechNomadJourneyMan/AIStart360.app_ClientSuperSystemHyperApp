/**
 * Interoperability with the official MCP TypeScript SDK client
 * (@modelcontextprotocol/sdk, latest on npm; it speaks the initialize-based
 * protocol up to 2025-11-25 — what Claude Code and Claude Desktop use today).
 * The SDK's Streamable HTTP transport talks to lib/mcp/server.ts through an
 * in-process fetch; credential check, rate limit and audit are injected.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/mcp/data', async (orig) => {
  const actual = await orig<typeof import('@/lib/mcp/data')>()
  return {
    ...actual,
    searchClients: vi.fn(async () => ({
      items: [{ company_id: 'co-1', company_name: 'Ромашка', industry: 'retail', stage: 'growth', owner: null, overall_score: 64, diagnostic_at: null }],
      hasMore: false,
    })),
  }
})

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { handleMcpPost, type ServerDeps } from '@/lib/mcp/server'
import type { AuditRow } from '@/lib/mcp/audit'

function deps(audits: AuditRow[]): ServerDeps {
  return {
    async authenticate(authorization) {
      if (authorization !== 'Bearer a360_pat_test') return { ok: false, status: 401, error: 'invalid_token', description: 'bad' }
      return {
        ok: true,
        principal: { userId: '11111111-1111-4111-8111-111111111111', email: null, role: { kind: 'expert', profileRole: 'expert' }, allowed: ['clients:read', 'clients:pii'] },
        credential: { kind: 'pat', id: '22222222-2222-4222-8222-222222222222', scopes: ['clients:read'], clientId: null },
        scopes: ['clients:read'],
      }
    },
    rateLimit: async () => ({ limited: false, reason: 'ok', limit: 120, remaining: 119, retryAfterSeconds: 0, backend: 'memory' }),
    audit: async (r) => { audits.push(r) },
  }
}

function transport(audits: AuditRow[], token = 'a360_pat_test') {
  const url = new URL('https://portal.test/api/mcp')
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method !== 'POST') {
        const { methodNotAllowed } = await import('@/lib/mcp/server')
        return methodNotAllowed()
      }
      return handleMcpPost(new Request(input, init), deps(audits))
    },
  })
}

describe('official SDK client ↔ /api/mcp', () => {
  it('connects (initialize), lists and calls tools', async () => {
    const audits: AuditRow[] = []
    const client = new Client({ name: 'sdk-interop-test', version: '1.0.0' })
    await client.connect(transport(audits))
    expect(client.getServerVersion()).toMatchObject({ name: 'aistart360-mcp' })
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} })
    expect(client.getInstructions()).toMatch(/search_clients/)

    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['search_clients', 'get_client'])

    const res = await client.callTool({ name: 'search_clients', arguments: { query: 'Ромашка' } })
    expect(res.isError).toBe(false)
    expect((res.structuredContent as { items: Array<{ company_name: string }> }).items[0].company_name).toBe('Ромашка')

    await client.close()
    expect(audits.map((a) => a.method)).toEqual(expect.arrayContaining(['initialize', 'tools/list', 'tools/call']))
  })

  it('surfaces 401 for a bad token', async () => {
    const client = new Client({ name: 'sdk-interop-test', version: '1.0.0' })
    await expect(client.connect(transport([], 'a360_pat_wrong'))).rejects.toThrow()
  })
})
