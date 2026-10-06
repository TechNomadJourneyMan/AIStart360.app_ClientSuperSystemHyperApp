/**
 * MCP endpoint conformance (lib/mcp/server.ts) — no database: the credential
 * check, rate limit and audit are injected, the read models are mocked.
 *
 *   modern (2026-07-28): per-request _meta, header/body validation (-32020),
 *     unsupported version (-32022), missing capabilities (-32602), unknown
 *     method (404 / -32601), server/discover, resultType / serverInfo /
 *     ttlMs / cacheScope;
 *   legacy (initialize, ≤ 2025-11-25): version negotiation, no session id,
 *     ping, tools/list, tools/call;
 *   transport: notifications → 202, no batches, parse errors, Origin, 405;
 *   auth: 401 + WWW-Authenticate resource_metadata/scope, 403
 *     insufficient_scope for a missing credential scope, 403 without a
 *     challenge when the role no longer allows it;
 *   rate limit (bucket 'mcp', fail-closed) and audit (no data without it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/mcp/data', async (orig) => {
  const actual = await orig<typeof import('@/lib/mcp/data')>()
  return {
    ...actual,
    clientCompanyExists: vi.fn(async (id: string) => id === 'co-1'),
    searchClients: vi.fn(async () => ({
      items: [{ company_id: 'co-1', company_name: 'Ромашка', industry: null, stage: null, owner: null, overall_score: 64, diagnostic_at: null }],
      hasMore: true,
    })),
    clientCard: vi.fn(async () => null),
  }
})

import { handleMcpPost, methodNotAllowed, RPC, type ServerDeps } from '@/lib/mcp/server'
import { isFailClosed, type RateLimitResult } from '@/lib/rate-limit'
import type { AuthOutcome } from '@/lib/mcp/auth'
import type { AuditRow } from '@/lib/mcp/audit'
import type { McpScope } from '@/lib/mcp/scopes'
import * as data from '@/lib/mcp/data'

const ORIGIN = 'https://portal.test'
const MCP = `${ORIGIN}/api/mcp`
const MODERN = '2026-07-28'

const OK_RL: RateLimitResult = { limited: false, reason: 'ok', limit: 120, remaining: 119, retryAfterSeconds: 0, backend: 'memory' }

function principal(scopes: McpScope[], allowed: McpScope[] = scopes): AuthOutcome {
  return {
    ok: true,
    principal: { userId: '11111111-1111-4111-8111-111111111111', email: 'a@staff.local', role: { kind: 'staff', staffRole: 'analyst' }, allowed },
    credential: { kind: 'pat', id: '22222222-2222-4222-8222-222222222222', scopes, clientId: null },
    scopes: scopes.filter((s) => allowed.includes(s)),
  }
}

let audits: AuditRow[]
let rlCalls: Array<{ key: string; bucket: string }>
function deps(over: Partial<ServerDeps> & { auth?: AuthOutcome } = {}): ServerDeps {
  return {
    authenticate: vi.fn(async () => over.auth ?? principal(['clients:read', 'reports:read'])),
    rateLimit: over.rateLimit ?? vi.fn(async (key: string, bucket: string) => { rlCalls.push({ key, bucket }); return OK_RL }),
    audit: over.audit ?? vi.fn(async (r: AuditRow) => { audits.push(r) }),
  }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(MCP, {
    method: 'POST',
    headers: { host: 'portal.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer a360_pat_x', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const meta = (extra: Record<string, unknown> = {}) => ({
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
  ...extra,
})
function modern(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return post({ jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: meta() } },
    { 'mcp-protocol-version': MODERN, 'mcp-method': method, ...(method === 'tools/call' ? { 'mcp-name': String(params.name) } : {}), ...headers })
}

async function json(res: Response) {
  return (await res.json()) as { id?: unknown; result?: Record<string, any>; error?: { code: number; message: string; data?: any } }
}

beforeEach(() => {
  audits = []
  rlCalls = []
  vi.mocked(data.searchClients).mockClear()
})

describe('modern era (2026-07-28)', () => {
  it('server/discover advertises versions, capabilities and identity', async () => {
    const res = await handleMcpPost(modern('server/discover'), deps())
    expect(res.status).toBe(200)
    const b = await json(res)
    expect(b.id).toBe(7)
    expect(b.result).toMatchObject({
      resultType: 'complete',
      supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'],
      capabilities: { tools: { listChanged: false } },
      cacheScope: 'public',
    })
    expect(b.result!.ttlMs).toBeGreaterThanOrEqual(0)
    expect(b.result!._meta['io.modelcontextprotocol/serverInfo']).toEqual({ name: 'aistart360-mcp', version: '1.0.0' })
    expect(res.headers.get('mcp-session-id')).toBeNull()
  })

  it('tools/list: only tools of the effective scopes, deterministic order, private cache', async () => {
    const res = await handleMcpPost(modern('tools/list'), deps({ auth: principal(['clients:read', 'reports:read', 'spend:read'], ['clients:read', 'reports:read']) }))
    const b = await json(res)
    expect(b.result!.resultType).toBe('complete')
    expect(b.result!.cacheScope).toBe('private')
    expect(b.result!.tools.map((t: { name: string }) => t.name)).toEqual(['search_clients', 'get_client', 'list_reports'])
    const search = b.result!.tools[0]
    expect(search.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(search.inputSchema.$schema).toBeUndefined()
    expect(search.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  })

  it('rejects a missing or mismatching MCP-Protocol-Version header with HeaderMismatch (-32020)', async () => {
    const r1 = await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta() } }, { 'mcp-method': 'tools/list' }), deps())
    expect(r1.status).toBe(400)
    expect((await json(r1)).error!.code).toBe(RPC.HEADER_MISMATCH)
    const r2 = await handleMcpPost(modern('tools/list', {}, { 'mcp-protocol-version': '2025-11-25' }), deps())
    expect(r2.status).toBe(400)
    expect((await json(r2)).error!.code).toBe(-32020)
  })

  it('rejects Mcp-Method / Mcp-Name that do not match the body; decodes the base64 sentinel', async () => {
    const r1 = await handleMcpPost(modern('tools/list', {}, { 'mcp-method': 'tools/call' }), deps())
    expect([r1.status, (await json(r1)).error!.code]).toEqual([400, -32020])
    const r2 = await handleMcpPost(modern('tools/call', { name: 'search_clients', arguments: {} }, { 'mcp-name': 'get_client' }), deps())
    expect([r2.status, (await json(r2)).error!.code]).toEqual([400, -32020])
    const r3 = await handleMcpPost(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_clients', arguments: {}, _meta: meta() } },
      { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call' }), deps())
    expect([r3.status, (await json(r3)).error!.code]).toEqual([400, -32020])
    const encoded = `=?base64?${Buffer.from('search_clients').toString('base64')}?=`
    const r4 = await handleMcpPost(modern('tools/call', { name: 'search_clients', arguments: {} }, { 'mcp-name': encoded }), deps())
    expect(r4.status).toBe(200)
  })

  it('unsupported version → 400 UnsupportedProtocolVersion listing ours', async () => {
    const req = post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...meta(), 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } },
      { 'mcp-protocol-version': '1900-01-01', 'mcp-method': 'tools/list' })
    const res = await handleMcpPost(req, deps())
    expect(res.status).toBe(400)
    const b = await json(res)
    expect(b.error).toMatchObject({ code: -32022, message: 'Unsupported protocol version', data: { requested: '1900-01-01' } })
    expect(b.error!.data.supported).toContain('2026-07-28')
  })

  it('missing clientCapabilities → 400 Invalid params', async () => {
    const req = post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } },
      { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/list' })
    const res = await handleMcpPost(req, deps())
    expect([res.status, (await json(res)).error!.code]).toEqual([400, -32602])
  })

  it('unknown method → 404 with -32601; ping is not part of 2026-07-28', async () => {
    for (const m of ['resources/list', 'ping']) {
      const res = await handleMcpPost(modern(m), deps())
      expect(res.status).toBe(404)
      expect((await json(res)).error!.code).toBe(-32601)
    }
  })

  it('tools/call returns structured content with resultType and audits without PII', async () => {
    const res = await handleMcpPost(modern('tools/call', { name: 'search_clients', arguments: { query: 'ivan@corp.kz', limit: 1 } }), deps())
    expect(res.status).toBe(200)
    const b = await json(res)
    expect(b.result).toMatchObject({ resultType: 'complete', isError: false })
    expect(b.result!.structuredContent.items[0].company_id).toBe('co-1')
    expect(typeof b.result!.structuredContent.next_cursor).toBe('string')
    expect(JSON.parse(b.result!.content[0].text)).toEqual(b.result!.structuredContent)
    expect(vi.mocked(data.searchClients)).toHaveBeenCalledWith({ query: 'ivan@corp.kz', pii: false, limit: 1, offset: 0 })
    const row = audits.find((a) => a.method === 'tools/call')!
    expect(row).toMatchObject({ tool: 'search_clients', status: 'ok', credentialKind: 'pat', protocolVersion: MODERN })
    expect(JSON.stringify(row)).toContain('ivan@corp.kz') // raw args reach the writer…
    const { summarizeArgs } = await import('@/lib/mcp/audit')
    expect(JSON.stringify(summarizeArgs(row.args))).not.toContain('ivan') // …which stores only the summary
  })
})

describe('legacy era (initialize handshake)', () => {
  it('initialize negotiates a supported version and mints no session', async () => {
    const res = await handleMcpPost(post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } }), deps())
    expect(res.status).toBe(200)
    const b = await json(res)
    expect(b.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'aistart360-mcp' } })
    expect(typeof b.result!.instructions).toBe('string')
    expect(res.headers.get('mcp-session-id')).toBeNull()
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('initialize with an unknown version answers our latest legacy version', async () => {
    const b = await json(await handleMcpPost(post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }), deps()))
    expect(b.result!.protocolVersion).toBe('2025-11-25')
  })

  it('notifications get 202 with no body', async () => {
    const res = await handleMcpPost(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), deps())
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('ping, tools/list and tools/call without _meta', async () => {
    const h = { 'mcp-protocol-version': '2025-11-25' }
    expect((await json(await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, h), deps()))).result).toEqual({})
    const list = await json(await handleMcpPost(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, h), deps()))
    expect(list.result!.resultType).toBeUndefined()
    expect(list.result!.tools.length).toBe(3)
    const call = await json(await handleMcpPost(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_clients', arguments: {} } }, h), deps()))
    expect(call.result!.isError).toBe(false)
  })

  it('unknown legacy method → JSON-RPC -32601; unsupported header version → 400', async () => {
    expect((await json(await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'prompts/list' }), deps()))).error!.code).toBe(-32601)
    const res = await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': '1999-01-01' }), deps())
    expect(res.status).toBe(400)
    // A modern version header without the per-request metadata is malformed.
    const res2 = await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': MODERN }), deps())
    expect([res2.status, (await json(res2)).error!.code]).toEqual([400, -32602])
  })
})

describe('transport', () => {
  it('parse error, batch, invalid request, non-JSON content type', async () => {
    expect((await json(await handleMcpPost(post('{not json'), deps()))).error!.code).toBe(-32700)
    const batch = await handleMcpPost(post([{ jsonrpc: '2.0', id: 1, method: 'ping' }]), deps())
    expect([batch.status, (await json(batch)).error!.code]).toEqual([400, -32600])
    expect((await json(await handleMcpPost(post({ jsonrpc: '1.0', id: 1, method: 'ping' }), deps()))).error!.code).toBe(-32600)
    expect((await json(await handleMcpPost(post({ jsonrpc: '2.0', id: null, method: 'ping' }), deps()))).error!.code).toBe(-32600)
    expect((await json(await handleMcpPost(post({ jsonrpc: '2.0', id: 1, result: {} }), deps()))).error!.code).toBe(-32600)
    expect((await handleMcpPost(post('{}', { 'content-type': 'text/plain' }), deps())).status).toBe(415)
  })

  it('a foreign Origin is refused with 403 (DNS rebinding)', async () => {
    const res = await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' }), deps())
    expect(res.status).toBe(403)
    const same = await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: ORIGIN }), deps())
    expect(same.status).toBe(200)
  })

  it('GET and DELETE → 405 with Allow: POST', async () => {
    const res = methodNotAllowed()
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })
})

describe('authorization', () => {
  it('no token → 401 with resource_metadata and scope in WWW-Authenticate', async () => {
    const res = await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), deps({ auth: { ok: false, status: 401, error: null, description: 'Требуется токен' } }))
    expect(res.status).toBe(401)
    const h = res.headers.get('www-authenticate')!
    expect(h).toMatch(/^Bearer /)
    expect(h).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`)
    expect(h).toContain('scope="clients:read clients:pii diagnostics:read metrics:read reports:read agents:read spend:read"')
    expect(h).not.toContain('error=')
    expect(audits).toHaveLength(0)
  })

  it('invalid token → 401 invalid_token, audited and throttled per IP', async () => {
    const d = deps({ auth: { ok: false, status: 401, error: 'invalid_token', description: 'Токен недействителен' } })
    const res = await handleMcpPost(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), d)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
    expect(audits[0]).toMatchObject({ status: 'unauthorized', errorCode: 'invalid_token' })
    expect(rlCalls[0].bucket).toBe('mcp-auth')
  })

  it('tool outside the credential scopes → 403 insufficient_scope with the scope to request', async () => {
    const res = await handleMcpPost(modern('tools/call', { name: 'get_ai_spend', arguments: {} }), deps())
    expect(res.status).toBe(403)
    const h = res.headers.get('www-authenticate')!
    expect(h).toContain('error="insufficient_scope"')
    expect(h).toContain('scope="spend:read"')
    expect(audits.at(-1)).toMatchObject({ tool: 'get_ai_spend', status: 'denied', errorCode: 'insufficient_scope' })
  })

  it('scope on the token but not allowed by the current role → 403 without a challenge', async () => {
    const res = await handleMcpPost(modern('tools/call', { name: 'get_ai_spend', arguments: {} }), deps({ auth: principal(['clients:read', 'spend:read'], ['clients:read']) }))
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toBeNull()
    expect((await json(res)).error!.code).toBe(RPC.FORBIDDEN)
    expect(audits.at(-1)).toMatchObject({ status: 'denied', errorCode: 'role' })
  })

  it('unknown tool → -32602; invalid arguments → tool error the model can fix', async () => {
    const unknown = await json(await handleMcpPost(modern('tools/call', { name: 'drop_database', arguments: {} }), deps()))
    expect(unknown.error!.code).toBe(-32602)
    const bad = await json(await handleMcpPost(modern('tools/call', { name: 'search_clients', arguments: { limit: 500 } }), deps()))
    expect(bad.result).toMatchObject({ isError: true })
    expect(bad.result!.content[0].text).toMatch(/limit/)
    const both = await json(await handleMcpPost(modern('tools/call', { name: 'get_client', arguments: { company_id: 'co-1', user_id: '11111111-1111-4111-8111-111111111111' } }), deps()))
    expect(both.result!.isError).toBe(true)
    const missing = await json(await handleMcpPost(modern('tools/call', { name: 'list_reports', arguments: { company_id: 'nope' } }), deps()))
    expect(missing.result).toMatchObject({ isError: true })
    expect(missing.result!.content[0].text).toMatch(/не найдена/)
  })
})

describe('rate limit and audit', () => {
  it('limits per credential in the fail-closed bucket "mcp"', async () => {
    expect(isFailClosed('mcp')).toBe(true)
    await handleMcpPost(modern('tools/list'), deps())
    expect(rlCalls[0]).toEqual({ key: 'pat:22222222-2222-4222-8222-222222222222', bucket: 'mcp' })
    const limited = await handleMcpPost(modern('tools/list'), deps({ rateLimit: vi.fn(async () => ({ ...OK_RL, limited: true, reason: 'limit' as const, remaining: 0, retryAfterSeconds: 17 })) }))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('17')
    expect((await json(limited)).error!.code).toBe(RPC.RATE_LIMITED)
    expect(audits.at(-1)).toMatchObject({ status: 'rate_limited' })
    const down = await handleMcpPost(modern('tools/list'), deps({ rateLimit: vi.fn(async () => ({ ...OK_RL, limited: true, reason: 'unavailable' as const, retryAfterSeconds: 30 })) }))
    expect(down.status).toBe(503)
  })

  it('a tool result is not returned when its audit row cannot be written', async () => {
    const res = await handleMcpPost(modern('tools/call', { name: 'search_clients', arguments: {} }), deps({ audit: vi.fn(async () => { throw new Error('db down') }) }))
    expect(res.status).toBe(503)
    const b = await json(res)
    expect(b.result).toBeUndefined()
    expect(JSON.stringify(b)).not.toContain('Ромашка')
  })
})
