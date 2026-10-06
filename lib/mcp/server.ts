/**
 * lib/mcp/server.ts — the MCP endpoint (Streamable HTTP, JSON responses).
 *
 * Specification followed: Model Context Protocol, revision 2026-07-28 (the
 * latest at the time of writing), and — for clients that still open with an
 * `initialize` handshake — revisions 2025-11-25 / 2025-06-18 / 2025-03-26.
 * The server is DUAL-ERA as allowed by «Versioning and Compatibility»
 * (https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#backward-compatibility-with-initialization-based-versions):
 *
 *   Modern (2026-07-28) — stateless; every request carries
 *     `_meta["io.modelcontextprotocol/protocolVersion"]` and
 *     `…/clientCapabilities`; the `MCP-Protocol-Version`, `Mcp-Method` and
 *     (tools/call) `Mcp-Name` headers must match the body, else 400 with
 *     HeaderMismatch -32020; an unsupported version → 400 with
 *     UnsupportedProtocolVersion -32022 listing ours; an unknown method →
 *     404 with -32601; results carry `resultType: "complete"` and
 *     `_meta["io.modelcontextprotocol/serverInfo"]`; tools/list and
 *     server/discover carry `ttlMs` / `cacheScope`
 *     (https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).
 *   Legacy (≤ 2025-11-25) — `initialize` negotiates the version; this server
 *     never mints an Mcp-Session-Id (sessions are optional there), so every
 *     request is still independent.
 *
 * Transport rules applied to both eras: one JSON-RPC message per POST (no
 * batches); a notification → 202 with no body; responses are
 * `application/json` (no SSE — nothing here streams); GET and DELETE → 405;
 * the Origin header, when present, must be ours (DNS-rebinding defence,
 * 403 otherwise).
 *
 * Security on every request: bearer token (lib/mcp/auth.ts: 401 +
 * WWW-Authenticate resource_metadata), the caller's CURRENT role → scopes,
 * a per-credential rate limit (bucket 'mcp', fail-closed), and an audit row
 * (lib/mcp/audit.ts). tools/call returns nothing unless its audit row is
 * written.
 */
import { checkRateLimit, clientIp, hashIdentifier, type RateLimitResult } from '@/lib/rate-limit'
import { authenticateMcp, wwwAuthenticate, type AuthOutcome } from './auth'
import { writeMcpAudit, type AuditRow } from './audit'
import { SERVER_INFO } from './metadata'
import { findTool, parseToolArgs, runTool, toolDefinitions, ToolInputError } from './tools'
import { mcpResourceUrl, publicOrigin } from './urls'

export const MODERN_VERSIONS = ['2026-07-28'] as const
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS]
/** Streamable HTTP: a request without the header MAY be treated as 2025-03-26. */
const DEFAULT_LEGACY_VERSION = '2025-03-26'

/** JSON-RPC 2.0 / MCP error codes. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
  // Application codes, outside the JSON-RPC reserved range (MCP «Error Codes»).
  UNAUTHORIZED: -31001,
  FORBIDDEN: -31003,
  RATE_LIMITED: -31029,
  UNAVAILABLE: -31503,
} as const

const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

export const RATE_LIMIT = { max: 120, windowMs: 60_000 } as const
const AUTH_FAIL_LIMIT = { max: 30, windowMs: 60_000 } as const
const MAX_BODY_BYTES = 1_000_000
export const MAX_RESULT_BYTES = 200_000
const TOOLS_LIST_TTL_MS = 5 * 60_000

export const INSTRUCTIONS =
  'Только чтение данных платформы AIStart360. Начните с search_clients, чтобы получить company_id, затем get_client, get_point_a, ' +
  'list_diagnostics, get_metrics, list_reports. Задачи агентов и расходы на ИИ — list_agent_tasks и get_ai_spend (по правам роли). ' +
  'Контакты клиентов маскируются без права на персональные данные.'

export interface ServerDeps {
  authenticate(authorization: string | null, resource: string, ipHash: string | null): Promise<AuthOutcome>
  rateLimit(key: string, bucket: 'mcp' | 'mcp-auth', opts: { max: number; windowMs: number }): Promise<RateLimitResult>
  audit(row: AuditRow): Promise<void>
}

export const defaultServerDeps: ServerDeps = {
  authenticate: authenticateMcp,
  rateLimit: (key, bucket, opts) => checkRateLimit(key, bucket, { ...opts, failClosed: true }),
  audit: writeMcpAudit,
}

type Id = string | number
interface RpcMessage { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: unknown }

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: body === null ? { 'Cache-Control': 'no-store', ...headers } : { ...JSON_HEADERS, ...headers } })
}

function rpcError(id: Id | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', ...(id === null ? {} : { id }), error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function rpcResult(id: Id, result: Record<string, unknown>) {
  return { jsonrpc: '2.0', id, result }
}

/** Decode a header value that may use the `=?base64?…?=` sentinel (Streamable HTTP «Value Encoding»). */
export function decodeHeaderValue(v: string | null): string | null {
  if (v === null) return null
  const m = v.match(/^=\?base64\?([A-Za-z0-9+/=]*)\?=$/)
  if (!m) return v
  try {
    return Buffer.from(m[1], 'base64').toString('utf8')
  } catch {
    return null
  }
}

function allowedOrigin(originHeader: string, ours: string): boolean {
  let o: string
  try {
    o = new URL(originHeader).origin.toLowerCase()
  } catch {
    return false
  }
  if (o === ours) return true
  const extra = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/\/+$/, '')).filter(Boolean)
  return extra.includes(o)
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

interface CallContext {
  auth: Extract<AuthOutcome, { ok: true }>
  origin: string
  ipHash: string
  started: number
  deps: ServerDeps
}

function auditBase(c: CallContext, method: string, protocolVersion: string | null): Omit<AuditRow, 'status' | 'tool' | 'args' | 'errorCode' | 'latencyMs'> {
  const cred = c.auth.credential
  return {
    userId: c.auth.principal.userId,
    credentialKind: cred.kind,
    credentialId: cred.id,
    clientId: cred.clientId,
    method,
    protocolVersion,
    ipHash: c.ipHash,
  }
}

/** Best-effort audit for requests that return no client data. */
async function auditSoft(c: CallContext, row: AuditRow): Promise<void> {
  try {
    await c.deps.audit(row)
  } catch (err) {
    console.error('[mcp] audit write failed:', err instanceof Error ? err.message.split('\n')[0] : err)
  }
}

export async function handleMcpPost(req: Request, deps: ServerDeps = defaultServerDeps): Promise<Response> {
  const started = Date.now()
  const origin = publicOrigin(req.headers, req.url)
  const resource = mcpResourceUrl(origin)

  const originHeader = req.headers.get('origin')
  if (originHeader && !allowedOrigin(originHeader, origin)) {
    return respond(403, rpcError(null, RPC.INVALID_REQUEST, 'Origin not allowed'))
  }

  const ipHash = hashIdentifier(clientIp(req))
  const authorization = req.headers.get('authorization')
  const auth = await deps.authenticate(authorization, resource, ipHash)
  if (!auth.ok) {
    if (auth.status === 503) {
      return respond(503, rpcError(null, RPC.UNAVAILABLE, auth.description), { 'Retry-After': '30' })
    }
    if (auth.error) {
      // A token was presented and refused: throttle guessing per IP and keep a trace.
      const rl = await deps.rateLimit(ipHash, 'mcp-auth', AUTH_FAIL_LIMIT)
      if (rl.limited) return respond(rl.reason === 'unavailable' ? 503 : 429, rpcError(null, RPC.RATE_LIMITED, 'Слишком много запросов'), { 'Retry-After': String(rl.retryAfterSeconds) })
      try {
        await deps.audit({
          userId: auth.userId ?? null, credentialKind: auth.credential?.kind ?? null, credentialId: auth.credential?.id ?? null,
          clientId: auth.credential?.clientId ?? null, method: 'auth', tool: null, args: {}, status: auth.status === 403 ? 'denied' : 'unauthorized',
          errorCode: auth.error, latencyMs: Date.now() - started, protocolVersion: req.headers.get('mcp-protocol-version'), ipHash,
        })
      } catch (err) {
        console.error('[mcp] audit write failed:', err instanceof Error ? err.message.split('\n')[0] : err)
      }
    }
    return respond(auth.status, rpcError(null, auth.status === 403 ? RPC.FORBIDDEN : RPC.UNAUTHORIZED, auth.description), {
      'WWW-Authenticate': wwwAuthenticate(origin, { error: auth.error }),
    })
  }

  const cred = auth.credential
  const rl = await deps.rateLimit(cred.kind === 'oauth' ? `oauth:${cred.familyId}` : `pat:${cred.id}`, 'mcp', RATE_LIMIT)
  const ctx: CallContext = { auth, origin, ipHash, started, deps }
  if (rl.limited) {
    await auditSoft(ctx, { ...auditBase(ctx, 'rate_limit', req.headers.get('mcp-protocol-version')), tool: null, args: {}, status: 'rate_limited', errorCode: rl.reason, latencyMs: Date.now() - started })
    const unavailable = rl.reason === 'unavailable'
    return respond(unavailable ? 503 : 429, rpcError(null, unavailable ? RPC.UNAVAILABLE : RPC.RATE_LIMITED,
      unavailable ? 'Лимит запросов временно не проверить — повторите позже' : 'Слишком много запросов — повторите позже'), { 'Retry-After': String(rl.retryAfterSeconds) })
  }

  const contentType = req.headers.get('content-type')
  if (contentType && !/^application\/json\b/i.test(contentType)) {
    return respond(415, rpcError(null, RPC.INVALID_REQUEST, 'Content-Type должен быть application/json'))
  }
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return respond(413, rpcError(null, RPC.INVALID_REQUEST, 'Слишком большой запрос'))
  const text = await req.text()
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return respond(413, rpcError(null, RPC.INVALID_REQUEST, 'Слишком большой запрос'))

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return respond(400, rpcError(null, RPC.PARSE_ERROR, 'Parse error'))
  }
  if (Array.isArray(parsed)) return respond(400, rpcError(null, RPC.INVALID_REQUEST, 'Пакетные запросы (batch) не поддерживаются'))
  const msg = asObject(parsed) as RpcMessage | null
  if (!msg || msg.jsonrpc !== '2.0') return respond(400, rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request'))
  if (typeof msg.method !== 'string' || msg.method.length === 0) {
    // Responses are never expected: this server sends no requests to clients.
    return respond(400, rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request'))
  }
  if (!('id' in msg)) return respond(202, null) // notification: accepted, no body
  if (!(typeof msg.id === 'string' || (typeof msg.id === 'number' && Number.isFinite(msg.id)))) {
    return respond(400, rpcError(null, RPC.INVALID_REQUEST, 'id должен быть строкой или числом'))
  }
  const id: Id = msg.id
  const method = msg.method
  if (msg.params !== undefined && !asObject(msg.params)) return respond(400, rpcError(id, RPC.INVALID_PARAMS, 'params должен быть объектом'))
  const params = asObject(msg.params) ?? {}
  const meta = asObject(params._meta)

  if (method !== 'initialize' && meta && META_VERSION in meta) return handleModern(req, ctx, id, method, params, meta)
  return handleLegacy(req, ctx, id, method, params)
}

// ─── Modern era (2026-07-28) ─────────────────────────────────────────────────

function modernResult(result: Record<string, unknown>): Record<string, unknown> {
  return { resultType: 'complete', ...result, _meta: { [META_SERVER_INFO]: { name: SERVER_INFO.name, version: SERVER_INFO.version } } }
}

async function handleModern(req: Request, c: CallContext, id: Id, method: string, params: Record<string, unknown>, meta: Record<string, unknown>): Promise<Response> {
  const version = meta[META_VERSION]
  if (typeof version !== 'string' || !version) return respond(400, rpcError(id, RPC.INVALID_PARAMS, `_meta.${META_VERSION} должен быть строкой`))
  const header = req.headers.get('mcp-protocol-version')
  if (!header) return respond(400, rpcError(id, RPC.HEADER_MISMATCH, 'Header mismatch: missing MCP-Protocol-Version header'))
  if (header !== version) return respond(400, rpcError(id, RPC.HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version header value '${header.slice(0, 40)}' does not match body value '${version.slice(0, 40)}'`))
  if (!(MODERN_VERSIONS as readonly string[]).includes(version)) {
    return respond(400, rpcError(id, RPC.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: version.slice(0, 40) }))
  }
  if (!asObject(meta[META_CAPABILITIES])) return respond(400, rpcError(id, RPC.INVALID_PARAMS, `_meta.${META_CAPABILITIES} обязателен`))
  const mcpMethod = req.headers.get('mcp-method')
  if (mcpMethod === null) return respond(400, rpcError(id, RPC.HEADER_MISMATCH, 'Header mismatch: missing Mcp-Method header'))
  if (mcpMethod !== method) return respond(400, rpcError(id, RPC.HEADER_MISMATCH, `Header mismatch: Mcp-Method header value '${mcpMethod.slice(0, 60)}' does not match body value '${method.slice(0, 60)}'`))
  if (method === 'tools/call') {
    const raw = req.headers.get('mcp-name')
    const name = decodeHeaderValue(raw)
    if (raw === null) return respond(400, rpcError(id, RPC.HEADER_MISMATCH, 'Header mismatch: missing Mcp-Name header'))
    if (name === null || name !== params.name) return respond(400, rpcError(id, RPC.HEADER_MISMATCH, 'Header mismatch: Mcp-Name header value does not match body value'))
  }

  switch (method) {
    case 'server/discover': {
      const result = modernResult({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: { listChanged: false } },
        instructions: INSTRUCTIONS,
        ttlMs: TOOLS_LIST_TTL_MS,
        cacheScope: 'public',
      })
      await auditSoft(c, { ...auditBase(c, method, version), tool: null, args: {}, status: 'ok', errorCode: null, latencyMs: Date.now() - c.started })
      return respond(200, rpcResult(id, result))
    }
    case 'tools/list':
      return toolsList(c, id, params, version, true)
    case 'tools/call':
      return toolsCall(c, id, params, version, true)
    default:
      return respond(404, rpcError(id, RPC.METHOD_NOT_FOUND, 'Method not found'))
  }
}

// ─── Legacy era (initialize handshake, ≤ 2025-11-25) ────────────────────────

async function handleLegacy(req: Request, c: CallContext, id: Id, method: string, params: Record<string, unknown>): Promise<Response> {
  const header = req.headers.get('mcp-protocol-version')
  if (method !== 'initialize' && header && (MODERN_VERSIONS as readonly string[]).includes(header)) {
    // A modern client that forgot the per-request metadata.
    return respond(400, rpcError(id, RPC.INVALID_PARAMS, `_meta.${META_VERSION} и _meta.${META_CAPABILITIES} обязательны`))
  }
  if (method !== 'initialize' && header && !(LEGACY_VERSIONS as readonly string[]).includes(header)) {
    return respond(400, rpcError(id, RPC.INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${header.slice(0, 40)}; supported: ${SUPPORTED_VERSIONS.join(', ')}`))
  }
  const version = method === 'initialize' ? null : header ?? DEFAULT_LEGACY_VERSION

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : null
      if (!requested) return respond(200, rpcError(id, RPC.INVALID_PARAMS, 'protocolVersion обязателен'))
      // Version negotiation of the legacy lifecycle: echo a version we support,
      // otherwise answer with our latest legacy one and let the client decide.
      const negotiated = (LEGACY_VERSIONS as readonly string[]).includes(requested) ? requested : LEGACY_VERSIONS[0]
      await auditSoft(c, { ...auditBase(c, method, negotiated), tool: null, args: {}, status: 'ok', errorCode: null, latencyMs: Date.now() - c.started })
      return respond(200, rpcResult(id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { ...SERVER_INFO },
        instructions: INSTRUCTIONS,
      }))
    }
    case 'ping':
      return respond(200, rpcResult(id, {}))
    case 'tools/list':
      return toolsList(c, id, params, version, false)
    case 'tools/call':
      return toolsCall(c, id, params, version, false)
    default:
      return respond(200, rpcError(id, RPC.METHOD_NOT_FOUND, 'Method not found'))
  }
}

// ─── Tools ───────────────────────────────────────────────────────────────────

async function toolsList(c: CallContext, id: Id, params: Record<string, unknown>, version: string | null, modern: boolean): Promise<Response> {
  if (params.cursor !== undefined) return respond(200, rpcError(id, RPC.INVALID_PARAMS, 'Неизвестный cursor: список инструментов отдаётся одной страницей'))
  const tools = toolDefinitions(c.auth.scopes)
  await auditSoft(c, { ...auditBase(c, 'tools/list', version), tool: null, args: {}, status: 'ok', errorCode: null, latencyMs: Date.now() - c.started })
  const result = { tools }
  // The list depends on the caller's role → private cache only.
  return respond(200, rpcResult(id, modern ? modernResult({ ...result, ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'private' }) : result))
}

function toolResult(data: Record<string, unknown>, modern: boolean): Record<string, unknown> {
  const r = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false }
  return modern ? modernResult(r) : r
}

function toolError(message: string, modern: boolean): Record<string, unknown> {
  const r = { content: [{ type: 'text', text: message }], isError: true }
  return modern ? modernResult(r) : r
}

async function toolsCall(c: CallContext, id: Id, params: Record<string, unknown>, version: string | null, modern: boolean): Promise<Response> {
  const name = params.name
  if (typeof name !== 'string' || !name) return respond(200, rpcError(id, RPC.INVALID_PARAMS, 'params.name обязателен'))
  const args = params.arguments
  const base = { ...auditBase(c, 'tools/call', version), tool: name.slice(0, 128), args }
  const tool = findTool(name)
  if (!tool) {
    await auditSoft(c, { ...base, status: 'invalid', errorCode: 'unknown_tool', latencyMs: Date.now() - c.started })
    return respond(200, rpcError(id, RPC.INVALID_PARAMS, `Unknown tool: ${name.slice(0, 128)}`))
  }
  if (!c.auth.credential.scopes.includes(tool.scope)) {
    // The credential was not granted the scope: a step-up (re-authorization) can fix it.
    await auditSoft(c, { ...base, status: 'denied', errorCode: 'insufficient_scope', latencyMs: Date.now() - c.started })
    return respond(403, rpcError(id, RPC.FORBIDDEN, `Токен не даёт права ${tool.scope}`), {
      'WWW-Authenticate': wwwAuthenticate(c.origin, { error: 'insufficient_scope', scope: tool.scope, description: `Scope ${tool.scope} required` }),
    })
  }
  if (!c.auth.scopes.includes(tool.scope)) {
    // The role no longer allows it: re-authorizing cannot help, so no challenge.
    await auditSoft(c, { ...base, status: 'denied', errorCode: 'role', latencyMs: Date.now() - c.started })
    return respond(403, rpcError(id, RPC.FORBIDDEN, `Ваша роль не даёт права ${tool.scope}`))
  }

  const parsedArgs = parseToolArgs(tool, args)
  let status: AuditRow['status'] = 'ok'
  let errorCode: string | null = null
  let result: Record<string, unknown>
  if (!parsedArgs.ok) {
    status = 'invalid'
    errorCode = 'bad_arguments'
    result = toolError(parsedArgs.message, modern)
  } else {
    try {
      const data = await runTool(tool, parsedArgs.value, {
        principal: c.auth.principal,
        scopes: c.auth.scopes,
        pii: c.auth.scopes.includes('clients:pii'),
        now: new Date(),
      })
      if (Buffer.byteLength(JSON.stringify(data)) > MAX_RESULT_BYTES) {
        status = 'error'
        errorCode = 'result_too_large'
        result = toolError('Результат слишком большой — уменьшите limit или уточните запрос', modern)
      } else {
        result = toolResult(data, modern)
      }
    } catch (err) {
      if (err instanceof ToolInputError) {
        status = 'invalid'
        errorCode = 'bad_input'
        result = toolError(err.message, modern)
      } else {
        status = 'error'
        errorCode = 'internal'
        console.error(`[mcp] tool ${tool.name} failed:`, err instanceof Error ? err.message.split('\n')[0] : err)
        result = toolError('Не удалось получить данные — повторите позже', modern)
      }
    }
  }

  try {
    await c.deps.audit({ ...base, status, errorCode, latencyMs: Date.now() - c.started })
  } catch (err) {
    console.error('[mcp] audit write failed:', err instanceof Error ? err.message.split('\n')[0] : err)
    // No data leaves without its audit row.
    return respond(503, rpcError(id, RPC.UNAVAILABLE, 'Журнал аудита недоступен — запрос отклонён'), { 'Retry-After': '30' })
  }
  return respond(200, rpcResult(id, result))
}

/** GET / DELETE on the MCP endpoint: no standalone SSE stream, no sessions. */
export function methodNotAllowed(): Response {
  return new Response(JSON.stringify(rpcError(null, RPC.INVALID_REQUEST, 'Method not allowed: use POST')), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'POST' },
  })
}
