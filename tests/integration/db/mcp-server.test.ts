/**
 * MCP server on the real database (migration 101):
 *   • 101 tables: RLS on, closed to anon / authenticated, service role works;
 *   • personal tokens: SHA-256 only, shown once, revoke, expiry, scope picker
 *     limited to the role, per-user cap;
 *   • the caller's role is re-read on EVERY call (revoked / narrowed /
 *     blocked staff lose access at once);
 *   • every tool over real rows, PII masked per role, only client companies,
 *     only published reports, unreviewed AI hypotheses hidden;
 *   • audit rows without free text;
 *   • OAuth 2.1: discovery routes, DCR, /authorize validation, consent
 *     state, PKCE (wrong verifier fails and burns the code), single-use code
 *     with reuse revocation, redirect / resource mismatch, refresh rotation
 *     with reuse detection (family revoked), RFC 7009 revocation, role loss,
 *     resource-bound access tokens on /api/mcp, confidential clients;
 *   • token routes (GIGA / expert portal) and the admin bot /mcp.
 * Run: node scripts/test-db/setup.mjs --db aistart360_w3 &&
 *      TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/aistart360_w3 npx vitest run <this file>
 */
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

const hoisted = vi.hoisted(() => ({
  mfaGate: { value: 'ok' as 'ok' | 'step_up' | 'enroll' },
  gigaActor: { value: null as null | { id: string; kind: 'session' | 'staff_cookie'; role: string; email?: string; permissions: string[] } },
  expert: { value: null as null | { id: string; role: string; email: string | null } },
  auditCalls: [] as Array<{ action: string; entityId?: string | null; required: boolean }>,
  auditFails: { value: false },
  sessionUser: { value: null as null | { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> } },
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: hoisted.sessionUser.value } }) } }),
}))

vi.mock('@/lib/admin/giga-actor', async (orig) => {
  const actual = await orig<typeof import('@/lib/admin/giga-actor')>()
  const { NextResponse } = await import('next/server')
  return {
    ...actual,
    staffMfaGate: vi.fn(async () => hoisted.mfaGate.value),
    requireGiga: vi.fn(async () => (hoisted.gigaActor.value
      ? { actor: hoisted.gigaActor.value }
      : { response: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }), staff: false })),
  }
})
vi.mock('@/lib/expert-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/expert-auth')>()
  return { ...actual, resolveExpert: vi.fn(async () => (hoisted.expert.value ? { ok: true, viewer: hoisted.expert.value } : { ok: false, block: 'forbidden' })) }
})
vi.mock('@/lib/admin/audit', async (orig) => {
  const actual = await orig<typeof import('@/lib/admin/audit')>()
  return {
    ...actual,
    recordAdminAction: vi.fn(async (_a: unknown, entry: { action: string; entityId?: string | null }, _r?: unknown, opts?: { required?: boolean }) => {
      if (hoisted.auditFails.value) {
        if (opts?.required) throw new Error('Audit log unavailable — action refused')
        return false
      }
      hoisted.auditCalls.push({ action: entry.action, entityId: entry.entityId, required: Boolean(opts?.required) })
      return true
    }),
  }
})
// The point A overview builder reads through PostgREST (not available locally);
// the MCP tool's part — authorisation, company check, wiring — is what is tested.
vi.mock('@/lib/point-a/overview', async (orig) => {
  const actual = await orig<typeof import('@/lib/point-a/overview')>()
  return { ...actual, loadPointAOverview: vi.fn(async (_c: unknown, t: { companyId: string }) => ({ companyId: t.companyId, overallScore: 64, keyRisks: [] })) }
})
// loadCompanyMetrics takes a Supabase client: answer its one query from the real database.
vi.mock('@/lib/supabase-service', async () => {
  const { testPool } = await import('../../helpers/pg-rls')
  function from(table: string) {
    const where: Array<{ sql: (i: number) => string; value: unknown }> = []
    let cols = '*'
    const b = {
      select(c: string) { cols = c; return b },
      eq(c: string, v: unknown) { where.push({ sql: (i) => `${c} = $${i}`, value: v }); return b },
      in(c: string, v: unknown[]) { where.push({ sql: (i) => `${c} = ANY($${i})`, value: v }); return b },
      then(resolve: (r: { data: unknown[] | null; error: unknown }) => unknown, reject: (e: unknown) => unknown) {
        if (!/^[a-z_]+$/.test(table) || !/^[a-z_, ]+$/.test(cols)) return Promise.reject(new Error('unexpected query')).then(resolve, reject)
        const sql = `SELECT ${cols} FROM public.${table}${where.length ? ` WHERE ${where.map((w, i) => w.sql(i + 1)).join(' AND ')}` : ''}`
        return testPool().query(sql, where.map((w) => w.value))
          .then((r) => ({ data: r.rows, error: null }), (e) => ({ data: null, error: e }))
          .then(resolve, reject)
      },
    }
    return b
  }
  return { createServiceClient: () => ({ from }) }
})

describe.skipIf(!dbTestsEnabled)('MCP server (101)', async () => {
  const { prisma } = await import('@/lib/db')
  const { NextRequest } = await import('next/server')
  const { inRollback, asUser, asService, pgErrorCode, seedUser, closeTestPool } = await import('../../helpers/pg-rls')
  const { resolveMcpPrincipal } = await import('@/lib/mcp/principal')
  const { createPat, findActivePat, listPats, revokePat, MAX_ACTIVE_PATS } = await import('@/lib/mcp/tokens')
  const { handleMcpPost } = await import('@/lib/mcp/server')
  const oauth = await import('@/lib/mcp/oauth')
  const { consentState } = await import('@/lib/mcp/consent')
  const { getMetricRegistry } = await import('@/lib/metrics/registry')
  const prmRoute = await import('@/app/.well-known/oauth-protected-resource/[[...path]]/route')
  const asRoute = await import('@/app/.well-known/oauth-authorization-server/route')
  const registerRoute = await import('@/app/api/oauth/register/route')
  const authorizeRoute = await import('@/app/api/oauth/authorize/route')
  const tokenRoute = await import('@/app/api/oauth/token/route')
  const revokeRoute = await import('@/app/api/oauth/revoke/route')
  const decisionRoute = await import('@/app/api/oauth/authorize/decision/route')
  const tokensRoute = await import('@/app/api/mcp/tokens/route')
  const tokenIdRoute = await import('@/app/api/mcp/tokens/[id]/route')

  const ORIGIN = 'https://portal.test'
  const RESOURCE = `${ORIGIN}/api/mcp`
  const tag = `mcp${Date.now().toString(36)}`
  const ids = {
    admin: randomUUID(), analyst: randomUUID(), support: randomUUID(), content: randomUUID(), expert: randomUUID(),
    client: randomUUID(), staffOwner: randomUUID(), blocked: randomUUID(),
  }
  const companyA = `${tag}-a`
  const companyS = `${tag}-s`
  const metricKey = getMetricRegistry()[0].id

  async function user(id: string, email: string, role: string, status = 'approved', phone: string | null = null) {
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${email})`
    await prisma.$executeRaw`UPDATE public.profiles SET role = ${role}, status = ${status}, full_name = ${`Имя ${email.split('@')[0]}`}, phone = ${phone} WHERE id = ${id}::uuid`
  }
  async function staff(id: string, role: string) {
    await prisma.$executeRaw`INSERT INTO public.staff_roles (user_id, role) VALUES (${id}::uuid, ${role})`
  }
  async function principal(id: string) {
    const p = await resolveMcpPrincipal(id)
    if (!p) throw new Error(`no principal ${id}`)
    return p
  }
  async function pat(id: string, scopes?: string[]) {
    const p = await principal(id)
    const r = await createPat({ principal: p, name: `t ${tag}`, scopes: scopes ?? p.allowed, expiresInDays: 30, via: 'giga' })
    if (!r.ok) throw new Error(r.error)
    return r
  }

  let rpcId = 1
  function mcpRequest(token: string | null, method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) {
    return new Request(RESOURCE, {
      method: 'POST',
      headers: {
        host: 'portal.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7',
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, ...(params ? { params } : {}) }),
    })
  }
  async function rpc(token: string | null, method: string, params?: Record<string, unknown>) {
    const res = await handleMcpPost(mcpRequest(token, method, params))
    return { status: res.status, headers: res.headers, body: (await res.json()) as { result?: any; error?: { code: number; message: string } } }
  }
  async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
    const r = await rpc(token, 'tools/call', { name, arguments: args })
    return { ...r, data: r.body.result?.structuredContent, text: r.body.result?.content?.[0]?.text as string | undefined, isError: r.body.result?.isError as boolean | undefined }
  }
  const sha = (v: string) => createHash('sha256').update(v).digest('hex')

  beforeAll(async () => {
    await user(ids.admin, `${tag}.admin@staff.local`, 'client')
    await staff(ids.admin, 'admin')
    await user(ids.analyst, `${tag}.analyst@staff.local`, 'client')
    await staff(ids.analyst, 'analyst')
    await user(ids.support, `${tag}.support@staff.local`, 'client')
    await staff(ids.support, 'support')
    await user(ids.content, `${tag}.content@staff.local`, 'client')
    await staff(ids.content, 'content_manager')
    await user(ids.expert, `${tag}.expert@staff.local`, 'expert')
    await user(ids.client, `${tag}.owner@corp.kz`, 'client', 'approved', '+7 701 555 12 34')
    await user(ids.staffOwner, `${tag}.crm@staff.local`, 'client')
    await staff(ids.staffOwner, 'crm_manager')
    await user(ids.blocked, `${tag}.blocked@corp.kz`, 'expert', 'blocked')

    await prisma.$executeRaw`
      INSERT INTO public.companies (id, name, user_id, industry, stage, contact_name, contact_email, contact_phone, "updatedAt")
      VALUES (${companyA}, ${`Ромашка ${tag}`}, ${ids.client}::uuid, 'retail', 'growth', 'Айгуль', ${`${tag}.contact@corp.kz`}, '+7 777 000 11 22', now()),
             (${companyS}, ${`Служебная ${tag}`}, ${ids.staffOwner}::uuid, 'it', 'early', null, null, null, now())`
    const [sess] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostic_sessions (company_id, status, completeness, error, completed_at)
      VALUES (${companyA}, 'ready', 0.8, ${`ошибка письма ${tag}.owner@corp.kz`}, now()) RETURNING id::text`
    const [diag] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.diagnostics (user_id, company_id, overall_score, health_index, stage, finance_score, data_gaps, is_current, session_id)
      VALUES (${ids.client}::uuid, ${companyA}, 64, 58, 'growth', '{"score": 71}'::jsonb, '["выручка по месяцам"]'::jsonb, true, ${sess.id}::uuid)
      RETURNING id::text`
    await prisma.$executeRaw`UPDATE public.diagnostic_sessions SET diagnostic_id = ${diag.id}::uuid WHERE id = ${sess.id}::uuid`
    await prisma.$executeRaw`
      INSERT INTO public.diagnostic_findings (company_id, session_id, kind, area, title, severity, provenance_type, confidence, produced_by, visible_to_client)
      VALUES (${companyA}, ${sess.id}::uuid, 'risk', 'finance', 'Кассовый разрыв', 'critical', 'CALCULATED', 0.9, 'engine:test', true),
             (${companyA}, ${sess.id}::uuid, 'risk', 'sales', 'Гипотеза: отток', 'high', 'AI_HYPOTHESIS', 0.6, 'agent:test', false)`
    await prisma.$executeRaw`
      INSERT INTO public.report_versions (company_id, report_type, status, title, content, provenance, data_hash, created_by, published_at)
      VALUES (${companyA}, 'point_a', 'published', 'Точка А — опубликовано', '{}'::jsonb, '{}'::jsonb, 'h1', 'test', now()),
             (${companyA}, 'point_a', 'draft', 'Точка А — черновик', '{}'::jsonb, '{}'::jsonb, 'h2', 'test', null),
             (${companyS}, 'point_a', 'published', 'Служебный отчёт', '{}'::jsonb, '{}'::jsonb, 'h3', 'test', now())`
    await prisma.$executeRaw`
      INSERT INTO public.agent_tasks (agent_key, company_id, trigger, status, last_error_code, last_error, finished_at)
      VALUES (${`${tag}_agent`}, ${companyA}, 'manual', 'failed', 'send_failed', ${`не доставлено на ${tag}.owner@corp.kz`}, now())`
    await prisma.$executeRaw`
      INSERT INTO public.ai_usage_ledger (source, model, tokens_in, tokens_out, cost_usd, company_id)
      VALUES (${`feature:${tag}`}, 'test-model', 100, 50, 0.25, ${companyA})`
    await prisma.$executeRaw`
      INSERT INTO public.metrics (company_id, metric_key, metric_value, metric_unit, source, computed_at, period_year)
      VALUES (${companyA}, ${metricKey}, 1234.5, 'KZT', 'manual', now(), 2026)`
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.mcp_audit WHERE user_id = ANY(${Object.values(ids)}::uuid[])`
    await prisma.$executeRaw`DELETE FROM public.agent_tasks WHERE agent_key = ${`${tag}_agent`}`
    await prisma.$executeRaw`DELETE FROM public.ai_usage_ledger WHERE source = ${`feature:${tag}`}`
    await prisma.$executeRaw`DELETE FROM public.oauth_clients WHERE client_name LIKE ${`${tag}%`}`
    await prisma.$executeRaw`DELETE FROM public.companies WHERE id IN (${companyA}, ${companyS})`
    await prisma.$executeRaw`DELETE FROM public.staff_telegram_links WHERE user_id = ANY(${Object.values(ids)}::uuid[])`
    await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${Object.values(ids)}::uuid[])`
    await closeTestPool()
    await prisma.$disconnect()
  })

  it('101 tables: RLS on, closed to anon and authenticated, open to the service role', async () => {
    const tables = ['mcp_tokens', 'oauth_clients', 'oauth_auth_requests', 'oauth_auth_codes', 'oauth_tokens', 'mcp_audit']
    const rls = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(${tables}::text[]) AND relnamespace = 'public'::regnamespace`
    expect(rls.map((r) => [r.relname, r.relrowsecurity]).sort()).toEqual(tables.map((t) => [t, true]).sort())
    await inRollback(async (db) => {
      const someone = await seedUser(db, { status: 'approved', role: 'expert' })
      for (const t of tables) {
        for (const who of [null, someone]) {
          expect(await pgErrorCode(asUser(db, who, () => db.query(`SELECT * FROM public.${t} LIMIT 1`)))).toBe('42501')
        }
      }
      // A person cannot even plant a token row for themselves.
      expect(await pgErrorCode(asUser(db, someone, () => db.query(
        `INSERT INTO public.mcp_tokens (user_id, name, token_hash, prefix, scopes, expires_at) VALUES ($1, 'x', $2, 'a360_pat_x', '{clients:read}', now() + interval '1 day')`,
        [someone, 'a'.repeat(64)],
      )))).toBe('42501')
      await asService(db, async () => {
        await db.query(
          `INSERT INTO public.mcp_tokens (user_id, name, token_hash, prefix, scopes, expires_at) VALUES ($1, 'svc', $2, 'a360_pat_x', '{clients:read}', now() + interval '1 day')`,
          [someone, 'b'.repeat(64)],
        )
        const { rows } = await db.query(`SELECT name FROM public.mcp_tokens WHERE user_id = $1`, [someone])
        expect(rows).toEqual([{ name: 'svc' }])
      })
      // Constraints: hash shape, expiry window.
      const violates = async (sql: string, params: unknown[]) => {
        await db.query('SAVEPOINT c')
        const code = await pgErrorCode(db.query(sql, params))
        await db.query('ROLLBACK TO SAVEPOINT c')
        return code
      }
      expect(await violates(
        `INSERT INTO public.mcp_tokens (user_id, name, token_hash, prefix, scopes, expires_at) VALUES ($1, 'x', 'plain-token', 'a360_pat_x', '{clients:read}', now() + interval '1 day')`, [someone],
      )).toBe('23514')
      expect(await violates(
        `INSERT INTO public.mcp_tokens (user_id, name, token_hash, prefix, scopes, expires_at) VALUES ($1, 'x', $2, 'a360_pat_x', '{clients:read}', now() + interval '400 days')`, [someone, 'c'.repeat(64)],
      )).toBe('23514')
      expect(await violates(
        `INSERT INTO public.oauth_clients (client_id, redirect_uris, token_endpoint_auth_method, client_secret_hash) VALUES ('mcpc_aaaaaaaaaaaaaaaaaaaa', '{https://a.example/cb}', 'none', $1)`, ['d'.repeat(64)],
      )).toBe('23514')
    })
  })

  it('personal tokens: only the SHA-256 is stored, the token works once issued, revocation and expiry end it', async () => {
    const r = await pat(ids.admin, ['clients:read'])
    expect(r.token).toMatch(/^a360_pat_[A-Za-z0-9_-]{43}$/)
    const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM public.mcp_tokens WHERE id = ${r.row.id}::uuid`
    expect(row.token_hash).toBe(sha(r.token))
    expect(JSON.stringify(row)).not.toContain(r.token.slice(9))
    expect(row.prefix).toBe(r.token.slice(0, 16))
    expect((await findActivePat(r.token))?.id).toBe(r.row.id)
    expect(await findActivePat(`${r.token.slice(0, -1)}${r.token.endsWith('A') ? 'B' : 'A'}`)).toBeNull()
    expect((await listPats(ids.admin)).some((t) => t.id === r.row.id)).toBe(true)

    expect((await rpc(r.token, 'tools/list')).status).toBe(200)
    expect(await revokePat(ids.analyst, r.row.id)).toBe(false) // not theirs
    expect(await revokePat(ids.admin, r.row.id)).toBe(true)
    expect(await findActivePat(r.token)).toBeNull()
    const after = await rpc(r.token, 'tools/list')
    expect(after.status).toBe(401)
    expect(after.headers.get('www-authenticate')).toContain('error="invalid_token"')

    const e = await pat(ids.admin, ['clients:read'])
    await prisma.$executeRaw`UPDATE public.mcp_tokens SET created_at = now() - interval '3 days', expires_at = now() - interval '1 second' WHERE id = ${e.row.id}::uuid`
    expect(await findActivePat(e.token)).toBeNull()
    expect((await rpc(e.token, 'tools/list')).status).toBe(401)
  })

  it('a token gets only scopes the creator\'s role allows; content managers get none; per-user cap', async () => {
    const analyst = await principal(ids.analyst)
    expect(analyst.allowed).not.toContain('clients:pii')
    const denied = await createPat({ principal: analyst, name: 'x', scopes: ['clients:read', 'clients:pii'], expiresInDays: 30, via: 'giga' })
    expect(denied).toEqual({ ok: false, error: 'scopes_not_allowed' })
    expect(await createPat({ principal: analyst, name: 'x', scopes: ['clients:read'], expiresInDays: 3650, via: 'giga' })).toEqual({ ok: false, error: 'bad_expiry' })
    expect(await createPat({ principal: analyst, name: ' ', scopes: ['clients:read'], expiresInDays: 30, via: 'giga' })).toEqual({ ok: false, error: 'bad_name' })
    expect(await createPat({ principal: analyst, name: 'x', scopes: ['root'], expiresInDays: 30, via: 'giga' })).toEqual({ ok: false, error: 'bad_scopes' })
    expect((await principal(ids.content)).allowed).toEqual([])
    expect(await resolveMcpPrincipal(ids.client)).toBeNull()
    expect(await resolveMcpPrincipal(ids.blocked)).toBeNull()

    await inRollback(async (db) => {
      const id = await seedUser(db, { status: 'approved', role: 'expert' })
      for (let i = 0; i < MAX_ACTIVE_PATS; i++) {
        await db.query(`INSERT INTO public.mcp_tokens (user_id, name, token_hash, prefix, scopes, expires_at) VALUES ($1, 'x', $2, 'a360_pat_x', '{clients:read}', now() + interval '1 day')`,
          [id, sha(`${id}-${i}`)])
      }
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.mcp_tokens WHERE user_id = $1`, [id])
      expect(rows[0].n).toBe(MAX_ACTIVE_PATS)
    })
  })

  it('re-reads the role on every call: a narrowed role loses tools at once, a revoked or blocked one loses everything', async () => {
    const id = randomUUID()
    await user(id, `${tag}.temp@staff.local`, 'client')
    await staff(id, 'admin')
    try {
      const r = await pat(id, ['clients:read', 'agents:read', 'spend:read'])
      let list = await rpc(r.token, 'tools/list')
      expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(['search_clients', 'get_client', 'list_agent_tasks', 'get_ai_spend'])
      expect((await tool(r.token, 'get_ai_spend')).isError).toBe(false)

      await prisma.$executeRaw`UPDATE public.staff_roles SET role = 'support' WHERE user_id = ${id}::uuid`
      list = await rpc(r.token, 'tools/list')
      expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(['search_clients', 'get_client'])
      const spend = await tool(r.token, 'get_ai_spend')
      expect(spend.status).toBe(403)
      expect(spend.headers.get('www-authenticate')).toBeNull()

      await prisma.$executeRaw`UPDATE public.staff_roles SET role = 'content_manager' WHERE user_id = ${id}::uuid`
      expect((await rpc(r.token, 'tools/list')).status).toBe(403)

      await prisma.$executeRaw`DELETE FROM public.staff_roles WHERE user_id = ${id}::uuid`
      const gone = await rpc(r.token, 'tools/list')
      expect(gone.status).toBe(401)
      expect(gone.headers.get('www-authenticate')).toContain('invalid_token')

      await staff(id, 'admin')
      expect((await rpc(r.token, 'tools/list')).status).toBe(200)
      await prisma.$executeRaw`UPDATE public.profiles SET status = 'blocked' WHERE id = ${id}::uuid`
      expect((await rpc(r.token, 'tools/list')).status).toBe(401)
    } finally {
      await prisma.$executeRaw`DELETE FROM public.mcp_audit WHERE user_id = ${id}::uuid`
      await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ${id}::uuid`
    }
  })

  it('tools over real data: client companies only, contacts masked without the PII scope', async () => {
    const analyst = (await pat(ids.analyst)).token
    const support = (await pat(ids.support)).token
    const expert = (await pat(ids.expert)).token

    const byName = await tool(analyst, 'search_clients', { query: `Ромашка ${tag}` })
    expect(byName.data.items).toHaveLength(1)
    expect(byName.data.items[0]).toMatchObject({ company_id: companyA, overall_score: 64, owner: { email: `${tag.slice(0, 1)}***@corp.kz` } })
    // The analyst may not find a client by e-mail (would confirm an address they cannot read).
    expect((await tool(analyst, 'search_clients', { query: `${tag}.owner@corp.kz` })).data.items).toHaveLength(0)
    const supportHit = await tool(support, 'search_clients', { query: `${tag}.owner@corp.kz` })
    expect(supportHit.data.items[0].owner.email).toBe(`${tag}.owner@corp.kz`)
    // A staff member's company is not a client.
    expect((await tool(support, 'search_clients', { query: `Служебная ${tag}` })).data.items).toHaveLength(0)
    expect((await tool(support, 'get_client', { company_id: companyS })).isError).toBe(true)

    const masked = await tool(analyst, 'get_client', { company_id: companyA })
    expect(masked.data.owner).toMatchObject({ email: `${tag.slice(0, 1)}***@corp.kz`, phone: '•••34' })
    expect(masked.data.contact_person).toMatchObject({ name: 'Айгуль', email: `${tag.slice(0, 1)}***@corp.kz`, phone: '•••22' })
    expect(masked.data.current_diagnostic).toMatchObject({ overall_score: 64, health_index: 58, area_scores: { finance: 71 }, data_gaps: ['выручка по месяцам'] })
    expect(masked.data.key_findings.map((f: { title: string }) => f.title)).toEqual(['Кассовый разрыв'])
    expect(masked.text).not.toContain(`${tag}.owner@corp.kz`)
    const open = await tool(expert, 'get_client', { user_id: ids.client })
    expect(open.data.owner).toMatchObject({ email: `${tag}.owner@corp.kz`, phone: '+7 701 555 12 34' })

    const diag = await tool(analyst, 'list_diagnostics', { company_id: companyA })
    expect(diag.data.items[0]).toMatchObject({ status: 'ready', diagnostic: { overall_score: 64, is_current: true } })
    expect(diag.data.items[0].error).not.toContain(`${tag}.owner@corp.kz`)
    expect((await tool(expert, 'list_diagnostics', { company_id: companyA })).data.items[0].error).toContain(`${tag}.owner@corp.kz`)

    const reports = await tool(analyst, 'list_reports', { company_id: companyA })
    expect(reports.data.items.map((r: { title: string }) => r.title)).toEqual(['Точка А — опубликовано'])
    const all = await tool(analyst, 'list_reports', { limit: 50 })
    expect(all.data.items.some((r: { title: string }) => r.title === 'Служебный отчёт')).toBe(false)

    const metrics = await tool(expert, 'get_metrics', { company_id: companyA })
    expect(metrics.data).toMatchObject({ company_id: companyA, total: 1, truncated: false })
    expect(metrics.data.metrics[0]).toMatchObject({ metric_id: metricKey, value: 1234.5, unit: 'KZT', source: 'manual', period_year: 2026 })
    expect(metrics.data.metrics[0].label).toBe(getMetricRegistry()[0].label)

    const pointA = await tool(expert, 'get_point_a', { company_id: companyA })
    expect(pointA.data.point_a).toMatchObject({ companyId: companyA, overallScore: 64 })
    expect((await tool(expert, 'get_point_a', { company_id: companyS })).isError).toBe(true)

    const tasks = await tool(analyst, 'list_agent_tasks', { agent_key: `${tag}_agent` })
    expect(tasks.data.items[0]).toMatchObject({ agent_key: `${tag}_agent`, status: 'failed', company_id: companyA })
    expect(tasks.data.items[0].last_error).not.toContain(`${tag}.owner@corp.kz`)
    expect((await tool(expert, 'list_agent_tasks')).status).toBe(403) // experts: no agents scope at all

    const spend = await tool(analyst, 'get_ai_spend', { days: 1, group_by: 'company' })
    const row = spend.data.rows.find((r: { key: string }) => r.key === companyA)
    expect(row).toMatchObject({ company_name: `Ромашка ${tag}`, calls: 1, tokens_in: 100, tokens_out: 50 })
    expect(row.cost_usd).toBeCloseTo(0.25, 6)

    // Paging: cursor round trip and a forged cursor.
    const p1 = await tool(support, 'search_clients', { limit: 1 })
    if (p1.data.next_cursor) expect((await tool(support, 'search_clients', { limit: 1, cursor: p1.data.next_cursor })).isError).toBe(false)
    expect((await tool(support, 'search_clients', { cursor: 'b246OTk5OTk5' })).isError).toBe(true)
  })

  it('audits every call without free text', async () => {
    const r = await pat(ids.support)
    await tool(r.token, 'search_clients', { query: `${tag}.owner@corp.kz` })
    await tool(r.token, 'get_client', { company_id: companyA })
    await tool(r.token, 'get_ai_spend')
    const rows = await prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT method, tool, args_summary, status, error_code, latency_ms, credential_kind, credential_id::text, ip_hash
      FROM public.mcp_audit WHERE credential_id = ${r.row.id}::uuid ORDER BY id`
    expect(rows.map((x) => [x.tool, x.status])).toEqual([['search_clients', 'ok'], ['get_client', 'ok'], ['get_ai_spend', 'denied']])
    expect(rows[0].args_summary).toEqual({ query: { len: `${tag}.owner@corp.kz`.length } })
    expect(rows[1].args_summary).toEqual({ company_id: companyA })
    expect(rows[2].error_code).toBe('insufficient_scope')
    expect(rows.every((x) => x.credential_kind === 'pat' && x.latency_ms >= 0 && /^[A-Za-z0-9_-]+$/.test(x.ip_hash))).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('@corp.kz')
    expect(JSON.stringify(rows)).not.toContain('203.0.113.7')
  })

  // ─── OAuth 2.1 ──────────────────────────────────────────────────────────────

  function req(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    return new NextRequest(url, { method: init.method ?? 'GET', headers: { host: 'portal.test', 'x-forwarded-proto': 'https', ...(init.headers ?? {}) }, body: init.body })
  }
  function form(url: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
    return req(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields).toString() })
  }
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  const REDIRECT = 'http://localhost:33418/callback'

  async function registerPublic(): Promise<string> {
    const res = await registerRoute.POST(req(`${ORIGIN}/api/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: `${tag} Claude Code`, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], application_type: 'native' }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.client_secret).toBeUndefined()
    return body.client_id as string
  }

  async function codeFor(clientId: string, userId: string, scopes = ['clients:read', 'reports:read']): Promise<string> {
    const id = await oauth.createAuthRequest({ clientId, redirectUri: REDIRECT, codeChallenge: challenge, scopes: scopes as never, scopeRequested: true, resource: RESOURCE, state: 'st' })
    const p = await principal(userId)
    const d = await oauth.decideAuthRequest(id, userId, true, oauth.grantableScopes({ scopes: scopes as never, scopeRequested: true }, p.allowed))
    if (!d.ok || !d.code) throw new Error('no code')
    return d.code
  }

  async function exchange(clientId: string, code: string, v = verifier, extra: Record<string, string> = {}) {
    const res = await tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: v, resource: RESOURCE, ...extra }))
    return { status: res.status, body: await res.json(), headers: res.headers }
  }

  it('discovery documents at the well-known locations', async () => {
    for (const path of [['api', 'mcp'], []]) {
      const res = prmRoute.GET(req(`${ORIGIN}/.well-known/oauth-protected-resource/${path.join('/')}`), { params: { path } })
      expect(res.status).toBe(200)
      const prm = await res.json()
      expect(prm).toMatchObject({ resource: RESOURCE, authorization_servers: [ORIGIN] })
    }
    expect(prmRoute.GET(req(`${ORIGIN}/.well-known/oauth-protected-resource/other`), { params: { path: ['other'] } }).status).toBe(404)
    const as = await asRoute.GET(req(`${ORIGIN}/.well-known/oauth-authorization-server`)).json()
    expect(as.issuer).toBe(ORIGIN)
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    // The 401 challenge points at the path-inserted metadata document.
    const un = await rpc(null, 'tools/list')
    expect(un.status).toBe(401)
    expect(un.headers.get('www-authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`)
  })

  it('dynamic client registration stores no plaintext secret', async () => {
    const res = await registerRoute.POST(req(`${ORIGIN}/api/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: `${tag} confidential`, redirect_uris: ['https://app.example/cb'] }),
    }))
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code'], response_types: ['code'], client_secret_expires_at: 0 })
    expect(body.client_id).toMatch(/^mcpc_/)
    const [row] = await prisma.$queryRaw<Array<{ client_secret_hash: string }>>`SELECT client_secret_hash FROM public.oauth_clients WHERE client_id = ${body.client_id}`
    expect(row.client_secret_hash).toBe(sha(body.client_secret))
    const bad = await registerRoute.POST(req(`${ORIGIN}/api/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: `${tag} x`, redirect_uris: ['http://evil.example/cb'] }),
    }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_redirect_uri')
  })

  it('/authorize: never redirects to an unknown client or an unregistered URI; PKCE S256 required; then the consent screen', async () => {
    const clientId = await registerPublic()
    const url = (p: Record<string, string>) => `${ORIGIN}/api/oauth/authorize?${new URLSearchParams(p)}`
    const good = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'clients:read', resource: RESOURCE }

    const unknown = await authorizeRoute.GET(req(url({ ...good, client_id: 'mcpc_doesnotexist000000' })))
    expect(unknown.status).toBe(400)
    expect(unknown.headers.get('location')).toBeNull()
    const mismatch = await authorizeRoute.GET(req(url({ ...good, redirect_uri: 'http://localhost:33418/evil' })))
    expect(mismatch.status).toBe(400)
    expect(mismatch.headers.get('location')).toBeNull()
    const evilHost = await authorizeRoute.GET(req(url({ ...good, redirect_uri: 'https://evil.example/callback' })))
    expect(evilHost.status).toBe(400)

    const plain = await authorizeRoute.GET(req(url({ ...good, code_challenge_method: 'plain' })))
    expect(plain.status).toBe(302)
    const loc = new URL(plain.headers.get('location')!)
    expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT)
    expect(Object.fromEntries(loc.searchParams)).toMatchObject({ error: 'invalid_request', state: 'xyz', iss: ORIGIN })
    const implicit = new URL((await authorizeRoute.GET(req(url({ ...good, response_type: 'token' })))).headers.get('location')!)
    expect(implicit.searchParams.get('error')).toBe('unsupported_response_type')
    const target = new URL((await authorizeRoute.GET(req(url({ ...good, resource: 'https://other.example/mcp' })))).headers.get('location')!)
    expect(target.searchParams.get('error')).toBe('invalid_target')
    const scope = new URL((await authorizeRoute.GET(req(url({ ...good, scope: 'clients:read admin' })))).headers.get('location')!)
    expect(scope.searchParams.get('error')).toBe('invalid_scope')

    // Native app on another ephemeral loopback port: allowed (RFC 8252 §7.3).
    const ok = await authorizeRoute.GET(req(url({ ...good, redirect_uri: 'http://localhost:51515/callback' })))
    expect(ok.status).toBe(302)
    expect(ok.headers.get('location')).toMatch(new RegExp(`^${ORIGIN}/oauth/consent/[0-9a-f-]{36}$`))
  })

  it('consent: login, second factor, staff/expert only, scopes = requested ∩ role', async () => {
    const clientId = await registerPublic()
    const id = await oauth.createAuthRequest({ clientId, redirectUri: REDIRECT, codeChallenge: challenge, scopes: ['clients:read', 'clients:pii', 'spend:read'], scopeRequested: true, resource: RESOURCE, state: null })
    const u = (uid: string) => ({ id: uid, app_metadata: {}, user_metadata: {} })
    expect((await consentState(id, null, null)).kind).toBe('login')
    expect((await consentState(randomUUID(), u(ids.analyst), null)).kind).toBe('invalid')
    expect((await consentState(id, u(ids.client), null)).kind).toBe('forbidden')
    expect((await consentState(id, u(ids.content), null)).kind).toBe('forbidden')
    hoisted.mfaGate.value = 'step_up'
    expect((await consentState(id, u(ids.analyst), null)).kind).toBe('step_up')
    hoisted.mfaGate.value = 'enroll'
    expect((await consentState(id, u(ids.analyst), null)).kind).toBe('enroll')
    hoisted.mfaGate.value = 'ok'
    const s = await consentState(id, u(ids.analyst), null)
    expect(s.kind).toBe('ready')
    if (s.kind !== 'ready') return
    expect(s.grant).toEqual(['clients:read', 'spend:read'])
    expect(s.withheld).toEqual(['clients:pii'])
    expect(s).toMatchObject({ redirectHost: 'localhost:33418', loopback: true })
    // Single use: once decided, the request is gone.
    expect((await oauth.decideAuthRequest(id, ids.analyst, false, s.grant))).toMatchObject({ ok: true, code: null })
    expect((await oauth.decideAuthRequest(id, ids.analyst, true, s.grant)).ok).toBe(false)
    expect((await consentState(id, u(ids.analyst), null)).kind).toBe('invalid')
  })

  it('end to end through the routes: authorize → consent decision → token → MCP call', async () => {
    const clientId = await registerPublic()
    const start = await authorizeRoute.GET(req(`${ORIGIN}/api/oauth/authorize?${new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'opaque-state', resource: RESOURCE,
    })}`))
    const requestId = start.headers.get('location')!.split('/').pop()!
    // The consent form posts the scopes left ticked; the person unticked contacts here.
    const ticked = ['clients:read', 'diagnostics:read', 'metrics:read', 'reports:read', 'spend:read']
    const decide = (decision: string, headers: Record<string, string> = { origin: ORIGIN }) => decisionRoute.POST(req(`${ORIGIN}/api/oauth/authorize/decision`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams([['request_id', requestId], ['decision', decision], ...ticked.map((t) => ['scope', t])]).toString(),
    }))
    // Not signed in: back to the consent screen (which sends the person to /login).
    hoisted.sessionUser.value = null
    const anon = await decide('approve')
    expect(anon.status).toBe(303)
    expect(anon.headers.get('location')).toBe(`${ORIGIN}/oauth/consent/${requestId}`)
    hoisted.sessionUser.value = { id: ids.support, app_metadata: {}, user_metadata: {} }
    expect((await decide('approve', { origin: 'https://evil.example' })).status).toBe(403)
    expect((await decide('approve', {})).status).toBe(403) // a browser form post always carries Origin
    const approved = await decide('approve')
    expect(approved.status).toBe(303)
    const back = new URL(approved.headers.get('location')!)
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
    expect(back.searchParams.get('state')).toBe('opaque-state')
    expect(back.searchParams.get('iss')).toBe(ORIGIN)
    const code = back.searchParams.get('code')!
    expect(code).toMatch(/^a360_ac_/)
    expect((await decide('approve')).status).toBe(400) // single use

    const t = await exchange(clientId, code)
    expect(t.status).toBe(200)
    // No scope requested → what the support role allows, minus what was unticked
    // (spend:read was posted but the role does not allow it: ignored).
    expect(t.body.scope).toBe('clients:read diagnostics:read metrics:read reports:read')
    const found = await tool(t.body.access_token, 'get_client', { company_id: companyA })
    expect(found.data.owner.email).toBe(`${tag.slice(0, 1)}***@corp.kz`) // no contacts scope → masked

    // Deny path.
    const start2 = await authorizeRoute.GET(req(`${ORIGIN}/api/oauth/authorize?${new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's2',
    })}`))
    const id2 = start2.headers.get('location')!.split('/').pop()!
    // Approving with every scope unticked is a denial.
    const denied = await decisionRoute.POST(req(`${ORIGIN}/api/oauth/authorize/decision`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }, body: new URLSearchParams({ request_id: id2, decision: 'approve' }).toString(),
    }))
    const deniedUrl = new URL(denied.headers.get('location')!)
    expect(Object.fromEntries(deniedUrl.searchParams)).toMatchObject({ error: 'access_denied', state: 's2', iss: ORIGIN })
    expect(deniedUrl.searchParams.get('code')).toBeNull()
    hoisted.sessionUser.value = null
  })

  it('PKCE: a wrong verifier fails and burns the code; a code is single use and its reuse revokes the tokens', async () => {
    const clientId = await registerPublic()
    const c1 = await codeFor(clientId, ids.analyst)
    const wrong = await exchange(clientId, c1, 'x'.repeat(43))
    expect([wrong.status, wrong.body.error]).toEqual([400, 'invalid_grant'])
    const late = await exchange(clientId, c1)
    expect(late.body.error).toBe('invalid_grant') // the first (failed) redemption used it up

    const c2 = await codeFor(clientId, ids.analyst)
    const ok = await exchange(clientId, c2)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(ok.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'clients:read reports:read' })
    expect(ok.body.access_token).toMatch(/^a360_at_/)
    expect(ok.body.refresh_token).toMatch(/^a360_rt_/)
    const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM public.oauth_tokens WHERE access_hash = ${sha(ok.body.access_token)}`
    expect(row).toMatchObject({ refresh_hash: sha(ok.body.refresh_token), resource: RESOURCE, client_id: clientId, user_id: ids.analyst })
    expect(JSON.stringify(row)).not.toContain(ok.body.access_token.slice(8))
    expect((await rpc(ok.body.access_token, 'tools/list')).status).toBe(200)

    const reuse = await exchange(clientId, c2)
    expect(reuse.body.error).toBe('invalid_grant')
    expect((await rpc(ok.body.access_token, 'tools/list')).status).toBe(401) // revoked by the reuse
    const [revoked] = await prisma.$queryRaw<Array<{ revoked_reason: string }>>`SELECT revoked_reason FROM public.oauth_tokens WHERE access_hash = ${sha(ok.body.access_token)}`
    expect(revoked.revoked_reason).toBe('code_reuse')
  })

  it('code exchange checks client, redirect URI and resource', async () => {
    const clientId = await registerPublic()
    const other = await registerPublic()
    expect((await exchange(other, await codeFor(clientId, ids.analyst))).body.error).toBe('invalid_grant')
    const redirect = await tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, {
      grant_type: 'authorization_code', code: await codeFor(clientId, ids.analyst), redirect_uri: 'http://localhost:9/other', client_id: clientId, code_verifier: verifier,
    }))
    expect((await redirect.json()).error).toBe('invalid_grant')
    expect((await exchange(clientId, await codeFor(clientId, ids.analyst), verifier, { resource: 'https://other.example/mcp' })).body.error).toBe('invalid_target')
    const expired = await codeFor(clientId, ids.analyst)
    await prisma.$executeRaw`UPDATE public.oauth_auth_codes SET created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' WHERE code_hash = ${sha(expired)}`
    expect((await exchange(clientId, expired)).body.error).toBe('invalid_grant')
    const noVerifier = await tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, { grant_type: 'authorization_code', code: await codeFor(clientId, ids.analyst), redirect_uri: REDIRECT, client_id: clientId }))
    expect((await noVerifier.json()).error).toBe('invalid_request')
    const implicitGrant = await tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, { grant_type: 'password', client_id: clientId }))
    expect((await implicitGrant.json()).error).toBe('unsupported_grant_type')
  })

  it('code exchange: resource compared like /authorize (host case, trailing slash); redirect_uri required only when it was sent', async () => {
    const clientId = await registerPublic()
    const u = new URL(RESOURCE)
    const variant = `${u.protocol}//${u.host.toUpperCase()}${u.pathname}/`
    const ok = await exchange(clientId, await codeFor(clientId, ids.analyst), verifier, { resource: variant })
    expect(ok.status).toBe(200)
    expect(ok.body.access_token).toBeTruthy()

    // Explicit redirect_uri at /authorize → it is required at /token.
    const explicit = await codeFor(clientId, ids.analyst)
    const missing = await tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, { grant_type: 'authorization_code', code: explicit, client_id: clientId, code_verifier: verifier, resource: RESOURCE }))
    expect((await missing.json()).error).toBe('invalid_grant')

    // Omitted at /authorize (single registered URI) → may be omitted at /token.
    const reqId = await oauth.createAuthRequest({ clientId, redirectUri: REDIRECT, redirectUriExplicit: false, codeChallenge: challenge, scopes: ['clients:read'] as never, scopeRequested: true, resource: RESOURCE, state: null })
    const p = await principal(ids.analyst)
    const d = await oauth.decideAuthRequest(reqId, ids.analyst, true, oauth.grantableScopes({ scopes: ['clients:read'] as never, scopeRequested: true }, p.allowed))
    if (!d.ok || !d.code) throw new Error('no code')
    const implicitRedirect = await tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, { grant_type: 'authorization_code', code: d.code, client_id: clientId, code_verifier: verifier, resource: RESOURCE }))
    expect(implicitRedirect.status).toBe(200)
  })

  it('refresh: rotated on every use; replaying an old refresh token revokes the whole family', async () => {
    const clientId = await registerPublic()
    const first = (await exchange(clientId, await codeFor(clientId, ids.analyst))).body
    const refresh = (token: string, extra: Record<string, string> = {}) =>
      tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, { grant_type: 'refresh_token', refresh_token: token, client_id: clientId, ...extra })).then(async (r) => ({ status: r.status, body: await r.json() }))

    const narrowed = await refresh(first.refresh_token, { scope: 'clients:read spend:read' })
    expect(narrowed.body.error).toBe('invalid_scope') // cannot widen
    const second = await refresh(first.refresh_token, { scope: 'clients:read' })
    expect(second.status).toBe(200)
    expect(second.body.scope).toBe('clients:read')
    expect(second.body.refresh_token).not.toBe(first.refresh_token)
    expect((await rpc(first.access_token, 'tools/list')).status).toBe(401) // the rotated pair is closed
    expect((await rpc(second.body.access_token, 'tools/list')).status).toBe(200)

    const replay = await refresh(first.refresh_token)
    expect(replay.body.error).toBe('invalid_grant')
    expect((await rpc(second.body.access_token, 'tools/list')).status).toBe(401)
    expect((await refresh(second.body.refresh_token)).body.error).toBe('invalid_grant')
    const fam = await prisma.$queryRaw<Array<{ revoked_reason: string }>>`
      SELECT revoked_reason FROM public.oauth_tokens WHERE family_id = (SELECT family_id FROM public.oauth_tokens WHERE access_hash = ${sha(first.access_token)}) ORDER BY created_at`
    expect(fam.map((f) => f.revoked_reason)).toEqual(['rotated', 'reuse_detected'])
  })

  it('refresh after the role is lost revokes the family; RFC 7009 revocation ends a sign-in', async () => {
    const id = randomUUID()
    await user(id, `${tag}.oauthtemp@staff.local`, 'client')
    await staff(id, 'analyst')
    try {
      const clientId = await registerPublic()
      const t = (await exchange(clientId, await codeFor(clientId, id))).body
      await prisma.$executeRaw`DELETE FROM public.staff_roles WHERE user_id = ${id}::uuid`
      expect((await rpc(t.access_token, 'tools/list')).status).toBe(401)
      const res = await tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId }))
      expect((await res.json()).error).toBe('invalid_grant')
      const [row] = await prisma.$queryRaw<Array<{ revoked_reason: string }>>`SELECT revoked_reason FROM public.oauth_tokens WHERE access_hash = ${sha(t.access_token)}`
      expect(row.revoked_reason).toBe('access_lost')

      await staff(id, 'analyst')
      const t2 = (await exchange(clientId, await codeFor(clientId, id))).body
      const rv = await revokeRoute.POST(form(`${ORIGIN}/api/oauth/revoke`, { token: t2.refresh_token, client_id: clientId }))
      expect(rv.status).toBe(200)
      expect((await rpc(t2.access_token, 'tools/list')).status).toBe(401)
      expect((await revokeRoute.POST(form(`${ORIGIN}/api/oauth/revoke`, { token: 'a360_rt_unknown', client_id: clientId }))).status).toBe(200)
    } finally {
      await prisma.$executeRaw`DELETE FROM public.mcp_audit WHERE user_id = ${id}::uuid`
      await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ${id}::uuid`
    }
  })

  it('an access token is accepted only by the resource it was issued for', async () => {
    const clientId = await registerPublic()
    const t = (await exchange(clientId, await codeFor(clientId, ids.analyst))).body
    const elsewhere = await handleMcpPost(new Request('https://preview.test/api/mcp', {
      method: 'POST',
      headers: { host: 'preview.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json', authorization: `Bearer ${t.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }))
    expect(elsewhere.status).toBe(401)
    expect((await rpc(t.access_token, 'tools/list')).status).toBe(200)
    const audit = await prisma.$queryRaw<Array<{ credential_kind: string; client_id: string }>>`
      SELECT credential_kind, client_id FROM public.mcp_audit WHERE user_id = ${ids.analyst}::uuid AND client_id = ${clientId}`
    expect(audit.length).toBeGreaterThan(0)
    expect(audit[0].credential_kind).toBe('oauth')
  })

  it('confidential clients must authenticate with their secret', async () => {
    const reg = await registerRoute.POST(req(`${ORIGIN}/api/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: `${tag} web`, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_post' }),
    }))
    const { client_id: id, client_secret: secret } = await reg.json()
    const code = await codeFor(id, ids.analyst)
    const noSecret = await exchange(id, code)
    expect([noSecret.status, noSecret.body.error]).toEqual([401, 'invalid_client'])
    const ok = await exchange(id, await codeFor(id, ids.analyst), verifier, { client_secret: secret })
    expect(ok.status).toBe(200)
    expect(ok.body.refresh_token).toBeUndefined() // registered without refresh_token
    const basic = `Basic ${Buffer.from(`${id}:wrong`).toString('base64')}`
    const res = await tokenRoute.POST(form(`${ORIGIN}/api/oauth/token`, { grant_type: 'authorization_code', code: await codeFor(id, ids.analyst), redirect_uri: REDIRECT, code_verifier: verifier }, { authorization: basic }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic /)
  })

  // ─── Token routes and the admin bot ─────────────────────────────────────────

  it('token routes: staff create (audit first, scopes ⊆ role), list without hashes, revoke; experts too', async () => {
    hoisted.gigaActor.value = { id: ids.analyst, kind: 'session', role: 'analyst', permissions: [] }
    const url = `${ORIGIN}/api/mcp/tokens`
    const post = (body: unknown) => tokensRoute.POST(req(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) }))
    try {
      expect((await post({ name: 'x', scopes: ['clients:pii'], expires_in_days: 30 })).status).toBe(400)
      hoisted.auditFails.value = true
      const refused = await post({ name: 'x', scopes: ['clients:read'], expires_in_days: 30 })
      expect(refused.status).toBe(503)
      hoisted.auditFails.value = false
      const created = await post({ name: `Claude Code ${tag}`, scopes: ['clients:read', 'reports:read'], expires_in_days: 7 })
      expect(created.status).toBe(201)
      const body = await created.json()
      expect(body.token).toMatch(/^a360_pat_/)
      expect(hoisted.auditCalls.find((a) => a.entityId === body.item.id)).toMatchObject({ action: 'mcp.token.create', required: true })

      const list = await (await tokensRoute.GET(req(url))).json()
      expect(list.canCreate).toBe(true)
      expect(list.mcpUrl).toBe(RESOURCE)
      expect(list.allowedScopes.map((s: { scope: string }) => s.scope)).not.toContain('clients:pii')
      expect(JSON.stringify(list)).not.toContain(body.token.slice(9))
      expect(JSON.stringify(list)).not.toContain('token_hash')
      expect(list.items.find((t: { id: string }) => t.id === body.item.id)).toMatchObject({ name: `Claude Code ${tag}`, scopes: ['clients:read', 'reports:read'] })

      // An impersonation cookie session can revoke but not mint.
      hoisted.gigaActor.value = { id: ids.analyst, kind: 'staff_cookie', role: 'analyst', permissions: [] }
      expect((await post({ name: 'x', scopes: ['clients:read'], expires_in_days: 30 })).status).toBe(403)
      const del = await tokenIdRoute.DELETE(req(`${url}/${body.item.id}`, { method: 'DELETE', headers: { origin: ORIGIN } }), { params: { id: body.item.id } })
      expect(del.status).toBe(200)
      expect(await findActivePat(body.token)).toBeNull()
      expect((await tokenIdRoute.DELETE(req(`${url}/${body.item.id}`, { method: 'DELETE', headers: { origin: ORIGIN } }), { params: { id: body.item.id } })).status).toBe(404)

      // Expert portal path.
      hoisted.gigaActor.value = null
      hoisted.expert.value = { id: ids.expert, role: 'expert', email: `${tag}.expert@staff.local` }
      const e = await post({ name: 'expert', scopes: ['clients:read', 'clients:pii'], expires_in_days: 30 })
      expect(e.status).toBe(201)
      expect((await post({ name: 'expert', scopes: ['agents:read'], expires_in_days: 30 })).status).toBe(400)
      hoisted.expert.value = null
      expect((await tokensRoute.GET(req(url))).status).toBe(403)
      // Cross-site mutation refused.
      hoisted.gigaActor.value = { id: ids.analyst, kind: 'session', role: 'analyst', permissions: [] }
      const cross = await tokensRoute.POST(req(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' }))
      expect(cross.status).toBe(403)
    } finally {
      hoisted.gigaActor.value = null
      hoisted.expert.value = null
      hoisted.auditFails.value = false
    }
  })

  it('admin bot /mcp: token sent once with a delete button, stored as a hash, revocable', async () => {
    const ENV = ['TELEGRAM_ADMIN_BOT_TOKEN', 'TELEGRAM_ADMIN_WEBHOOK_SECRET', 'TELEGRAM_CALLBACK_SECRET']
    const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = 'admin-token'
    process.env.TELEGRAM_ADMIN_WEBHOOK_SECRET = 'admin-secret'
    delete process.env.TELEGRAM_CALLBACK_SECRET
    try {
      const { handleUpdate } = await import('@/lib/telegram/bots/dispatcher')
      const { adminRouter } = await import('@/lib/telegram/bots/admin')
      const { memoryStateStore } = await import('@/lib/telegram/bots/store')
      const { signCallback } = await import('@/lib/telegram/bots/callback')
      const { createStaffLinkCode, consumeStaffLinkCode } = await import('@/lib/telegram/staff-link')
      const { ADMIN_COMMANDS } = await import('@/lib/telegram/bots/commands')
      expect(ADMIN_COMMANDS.some((c) => c.command === 'mcp')).toBe(true)

      const tg = 810_000_000 + Math.floor(Math.random() * 1e6)
      const link = await createStaffLinkCode(ids.support)
      expect((await consumeStaffLinkCode({ code: link.code, telegramUserId: tg, chatId: String(tg) })).ok).toBe(true)

      const calls: Array<{ method: string; body: Record<string, any> }> = []
      let mid = 900
      const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        const u = String(url)
        calls.push({ method: u.split('/').pop()!, body: JSON.parse(String(init?.body ?? '{}')) })
        return new Response(JSON.stringify({ ok: true, result: u.endsWith('/sendMessage') ? { message_id: ++mid } : true }), { status: 200 })
      }) as unknown as typeof fetch
      const audit = vi.fn(async () => true)
      const deps = { fetchImpl: fakeFetch, state: memoryStateStore(), audit, rateLimit: async () => false, now: () => new Date() }
      const from = { id: tg, first_name: 'S' }
      let uid = 1
      const text = (t: string) => handleUpdate(adminRouter(), { update_id: uid++, message: { message_id: 100 + uid, chat: { id: tg, type: 'private' }, from, text: t } }, deps)
      const press = (data: string | null, messageId = 1) => handleUpdate(adminRouter(), { update_id: uid++, callback_query: { id: `q${uid}`, from, data: data!, message: { message_id: messageId, chat: { id: tg } } } }, deps)
      const lastText = () => String([...calls].reverse().find((c) => c.method === 'sendMessage' || c.method === 'editMessageText')?.body.text ?? '')

      expect(await text('/mcp')).toBe('command')
      expect(lastText()).toContain('MCP-доступ')
      expect(await press(signCallback('admin', 'mc.n'))).toBe('callback')
      expect(await text(`Ноутбук ${tag}`)).toBe('step')
      expect(lastText()).toContain(`Ноутбук ${tag}`)
      // Support may not have agents:read — its toggle is refused.
      await press(signCallback('admin', 'mc.t', 5))
      expect(calls.at(-1)!.method).toBe('answerCallbackQuery')
      expect(await press(signCallback('admin', 'mc.x', 30))).toBe('callback')
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ id: ids.support, kind: 'telegram' }), expect.objectContaining({ action: 'mcp.token.create' }), { required: true })

      const tokenMsg = calls.filter((c) => c.method === 'sendMessage').find((c) => /a360_pat_[A-Za-z0-9_-]{43}/.test(c.body.text))!
      const token = String(tokenMsg.body.text).match(/a360_pat_[A-Za-z0-9_-]{43}/)![0]
      expect(calls.filter((c) => JSON.stringify(c.body).includes(token))).toHaveLength(1) // sent exactly once
      expect(tokenMsg.body.reply_markup.inline_keyboard[0][0].text).toContain('Удалить')
      const row = (await listPats(ids.support)).find((t) => t.name === `Ноутбук ${tag}`)!
      expect(row.scopes).toEqual(['clients:read', 'diagnostics:read', 'metrics:read', 'reports:read'])
      expect(row.createdVia).toBe('telegram')
      expect((await findActivePat(token))?.id).toBe(row.id)

      expect(await press(tokenMsg.body.reply_markup.inline_keyboard[0][0].callback_data, 777)).toBe('callback')
      expect(calls.find((c) => c.method === 'deleteMessage')?.body).toMatchObject({ message_id: 777 })

      expect(await press(signCallback('admin', 'mc.r', row.id))).toBe('callback')
      const nonce = String((await deps.state.get('admin', String(tg)))?.nonce)
      expect(await press(signCallback('admin', 'cf', nonce))).toBe('confirmed')
      expect(await findActivePat(token)).toBeNull()
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
  })
})
