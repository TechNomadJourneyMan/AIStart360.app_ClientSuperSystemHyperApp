/**
 * SR-04 / R-009 — захват аккаунта до его создания через приглашение.
 *
 * Было: регистрация без подтверждения почты + `acceptInvitation(email, userId)`
 * выдавала роль персонала ЛЮБОМУ аккаунту с совпадающим e-mail. Атакующий
 * заранее регистрировал адрес будущего сотрудника своим паролем; владелец
 * адреса переходил по ссылке — роль получал аккаунт атакующего.
 *
 * Стало:
 *  - роль выдаётся только по одноразовому токену приглашения из письма
 *    (в базе — только его SHA-256), со сроком; совпадение e-mail без токена
 *    роль не даёт никогда;
 *  - аккаунт, существовавший ДО приглашения, перед выдачей роли «отбирается»
 *    у прежнего держателя: случайный пароль (новый задаёт владелец почты),
 *    отзыв всех остальных сессий GoTrue, удаление факторов 2FA, отзыв
 *    MCP/OAuth-токенов и Telegram-привязок, событие в журнале безопасности;
 *  - если «отобрать» не удалось — роль не выдаётся.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

type Op = { table: string; op: 'select' | 'update' | 'insert' | 'delete' | 'upsert'; patch?: Record<string, unknown>; filters: Array<[string, string, unknown]> }

const s = vi.hoisted(() => ({
  ops: [] as Array<Op>,
  invitations: [] as Array<Record<string, unknown>>,
  authUser: null as null | { id: string; email: string; created_at: string; email_confirmed_at: string | null },
  passwordSetFor: [] as string[],
  signOuts: [] as Array<{ jwt: string; scope: string }>,
  signOutError: null as null | { message: string },
  factorsDeleted: [] as string[],
  mfaResets: [] as string[],
  activity: [] as Array<Record<string, unknown>>,
  claimConflict: false,
  generateLinkUser: { id: 'new-user' } as { id: string } | null,
  sent: [] as Array<{ to: string; url: string }>,
}))

function matches(row: Record<string, unknown>, filters: Op['filters']): boolean {
  return filters.every(([kind, col, val]) => {
    const v = col.startsWith('metadata->>') ? (row.metadata as Record<string, unknown> | undefined)?.[col.slice('metadata->>'.length)] : row[col]
    if (kind === 'eq') return v === val
    if (kind === 'ilike') return String(v).toLowerCase() === String(val).toLowerCase()
    if (kind === 'is') return v === val || (val === null && v === undefined)
    return true
  })
}

function builder(table: string) {
  const op: Op = { table, op: 'select', filters: [] }
  const b: Record<string, unknown> = {}
  const run = () => {
    s.ops.push(op)
    if (table === 'platform_invitations') {
      if (op.op === 'insert') {
        const row = { id: `inv-${s.invitations.length + 1}`, status: 'sent', ...op.patch }
        s.invitations.push(row)
        return { data: { id: row.id }, error: null }
      }
      const rows = s.invitations.filter((r) => matches(r, op.filters))
      if (op.op === 'update') {
        if (s.claimConflict && op.patch?.status === 'accepted') return { data: [], error: null }
        rows.forEach((r) => Object.assign(r, op.patch))
        return { data: rows.map((r) => ({ id: r.id })), error: null }
      }
      return { data: rows, error: null }
    }
    return { data: op.op === 'select' ? [] : [{ id: 'x' }], error: null }
  }
  for (const m of ['eq', 'ilike', 'is', 'neq']) b[m] = (col: string, val: unknown) => { op.filters.push([m, col, val]); return b }
  for (const m of ['order', 'limit']) b[m] = () => b
  b.select = () => b
  b.update = (patch: Record<string, unknown>) => { op.op = 'update'; op.patch = patch; return b }
  b.insert = (patch: Record<string, unknown>) => { op.op = 'insert'; op.patch = patch; return b }
  b.delete = () => { op.op = 'delete'; return b }
  b.upsert = (patch: Record<string, unknown>) => { op.op = 'upsert'; op.patch = patch; return b }
  b.single = async () => run()
  b.maybeSingle = async () => {
    const r = run()
    const d = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
    return { data: d, error: null }
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej)
  return b
}

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: builder,
    auth: {
      admin: {
        generateLink: async () => ({ data: { properties: { hashed_token: 'th-1' }, user: s.generateLinkUser }, error: null }),
        getUserById: async (id: string) => ({ data: { user: s.authUser && s.authUser.id === id ? s.authUser : null }, error: s.authUser ? null : { message: 'not found' } }),
        updateUserById: async (id: string, attrs: Record<string, unknown>) => {
          if (typeof attrs.password === 'string') s.passwordSetFor.push(id)
          return { data: { user: { id } }, error: null }
        },
        signOut: async (jwt: string, scope: string) => { s.signOuts.push({ jwt, scope }); return { data: null, error: s.signOutError } },
        mfa: {
          listFactors: async () => ({ data: { factors: [{ id: 'f-1' }, { id: 'f-2' }] }, error: null }),
          deleteFactor: async ({ id }: { id: string }) => { s.factorsDeleted.push(id); return { data: { id }, error: null } },
        },
      },
    },
  }),
}))
vi.mock('@/lib/mfa/store', () => ({ adminResetUserMfa: async (id: string) => { s.mfaResets.push(id) } }))
vi.mock('@/lib/activity/log', () => ({ logActivity: async (e: Record<string, unknown>) => { s.activity.push(e) } }))
vi.mock('@/lib/email', () => ({
  sendPortalInvitationEmail: async (to: string, input: { url: string }) => { s.sent.push({ to, url: input.url }); return { ok: true } },
}))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://portal.aistart360.app' }))

const { acceptInvitation, sendPlatformInvite, hashInviteToken } = await import('@/lib/admin/invites')

const sha = (t: string) => createHash('sha256').update(t).digest('hex')
const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString()
const longAgo = '2026-01-01T00:00:00.000Z'

function seedInvite(over: Record<string, unknown> = {}, token = 'tok-1') {
  const row = {
    id: `inv-${s.invitations.length + 1}`,
    email: 'victim@corp.kz',
    staff_role: 'admin',
    status: 'sent',
    link_type: 'magiclink',
    user_id: 'attacker-account',
    sent_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: inOneHour(),
    metadata: { accept_token_hash: sha(token) },
    ...over,
  }
  s.invitations.push(row)
  return row
}

beforeEach(() => {
  s.ops = []
  s.invitations = []
  s.authUser = { id: 'attacker-account', email: 'victim@corp.kz', created_at: longAgo, email_confirmed_at: longAgo }
  s.passwordSetFor = []
  s.signOuts = []
  s.signOutError = null
  s.factorsDeleted = []
  s.mfaResets = []
  s.activity = []
  s.claimConflict = false
  s.generateLinkUser = { id: 'new-user' }
  s.sent = []
})

const staffRoleUpserts = () => s.ops.filter((o) => o.table === 'staff_roles')

describe('SR-04: роль только по токену приглашения', () => {
  it('SR-04: совпадение e-mail без токена роль не даёт никогда', async () => {
    seedInvite()
    const r = await acceptInvitation({ inviteToken: null, userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r.accepted).toBe(false)
    expect(r.staffRole).toBeNull()
    expect(staffRoleUpserts()).toHaveLength(0)
    expect(s.invitations[0].status).toBe('sent')
  })

  it('SR-04: чужой / поддельный токен роль не даёт', async () => {
    seedInvite()
    const r = await acceptInvitation({ inviteToken: 'guess', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r.accepted).toBe(false)
    expect(staffRoleUpserts()).toHaveLength(0)
  })

  it('SR-04: токен приглашения на другой адрес не принимается этим аккаунтом', async () => {
    seedInvite({ email: 'other@corp.kz' })
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r.accepted).toBe(false)
    expect(staffRoleUpserts()).toHaveLength(0)
  })

  it('SR-04: просроченный токен роль не даёт и закрывает приглашение', async () => {
    seedInvite({ expires_at: new Date(Date.now() - 1000).toISOString() })
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r.accepted).toBe(false)
    expect(staffRoleUpserts()).toHaveLength(0)
    expect(s.invitations[0].status).toBe('expired')
  })

  it('SR-04: токен одноразовый — второе принятие роль не выдаёт', async () => {
    seedInvite({ status: 'accepted' })
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r.accepted).toBe(false)
    expect(staffRoleUpserts()).toHaveLength(0)
  })

  it('SR-04: параллельное принятие — выигрывает одно (атомарный захват записи)', async () => {
    seedInvite()
    s.claimConflict = true
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r.accepted).toBe(false)
    expect(staffRoleUpserts()).toHaveLength(0)
    expect(s.passwordSetFor).toHaveLength(0)
  })
})

describe('SR-04: аккаунт, существовавший до приглашения, отбирается у прежнего держателя', () => {
  it('SR-04: пароль сброшен, остальные сессии отозваны, 2FA удалена, токены отозваны, событие в журнале — затем роль', async () => {
    seedInvite()
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r).toMatchObject({ accepted: true, staffRole: 'admin', secured: true })
    expect(s.passwordSetFor).toEqual(['attacker-account'])
    // Сессия владельца почты, только что созданная ссылкой, остаётся; все остальные — нет.
    expect(s.signOuts).toEqual([{ jwt: 'jwt-new', scope: 'others' }])
    expect(s.mfaResets).toEqual(['attacker-account'])
    expect(s.factorsDeleted.sort()).toEqual(['f-1', 'f-2'])
    expect(s.ops.some((o) => o.table === 'mcp_tokens' && o.op === 'update' && o.patch?.revoked_at)).toBe(true)
    expect(s.ops.some((o) => o.table === 'oauth_tokens' && o.op === 'update' && o.patch?.revoked_reason === 'revoked')).toBe(true)
    expect(s.ops.some((o) => o.table === 'staff_telegram_links' && o.op === 'delete')).toBe(true)
    expect(s.ops.some((o) => o.table === 'profiles' && o.op === 'update' && o.patch && 'telegram_chat_id' in o.patch && o.patch.telegram_chat_id === null)).toBe(true)
    expect(s.activity).toContainEqual(expect.objectContaining({ userId: 'attacker-account', action: 'security.invite_account_secured', category: 'security', severity: 'critical' }))
    // Порядок: сначала «отобрать», потом выдать роль.
    const roleAt = s.ops.findIndex((o) => o.table === 'staff_roles')
    const mcpAt = s.ops.findIndex((o) => o.table === 'mcp_tokens')
    expect(roleAt).toBeGreaterThan(mcpAt)
    expect(staffRoleUpserts()[0].patch).toMatchObject({ user_id: 'attacker-account', role: 'admin' })
  })

  it('SR-04: аккаунт создан ДО приглашения, даже если запись помечена как invite — тоже отбирается', async () => {
    seedInvite({ link_type: 'invite', user_id: 'attacker-account' })
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r.secured).toBe(true)
    expect(s.passwordSetFor).toEqual(['attacker-account'])
  })

  it('SR-04: не удалось отозвать сессии — роль НЕ выдаётся, приглашение помечено failed, событие в журнале', async () => {
    seedInvite()
    s.signOutError = { message: 'gotrue down' }
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r.accepted).toBe(false)
    expect(r.staffRole).toBeNull()
    expect(staffRoleUpserts()).toHaveLength(0)
    expect(s.invitations[0].status).toBe('failed')
    expect(s.activity).toContainEqual(expect.objectContaining({ action: 'security.invite_accept_refused', severity: 'critical' }))
  })

  it('SR-04: без сессии ссылки (нечем отозвать остальные) — роль не выдаётся', async () => {
    seedInvite()
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: null })
    expect(r.accepted).toBe(false)
    expect(staffRoleUpserts()).toHaveLength(0)
  })

  it('SR-04: новый аккаунт, созданный самим приглашением, не трогается (пароль задаётся по ссылке)', async () => {
    seedInvite({ link_type: 'invite', user_id: 'new-user', sent_at: new Date(Date.now() - 60_000).toISOString() })
    s.authUser = { id: 'new-user', email: 'victim@corp.kz', created_at: new Date(Date.now() - 30_000).toISOString(), email_confirmed_at: new Date().toISOString() }
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'new-user', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r).toMatchObject({ accepted: true, staffRole: 'admin', secured: false })
    expect(s.passwordSetFor).toHaveLength(0)
    expect(s.signOuts).toHaveLength(0)
    expect(staffRoleUpserts()[0].patch).toMatchObject({ user_id: 'new-user', role: 'admin' })
  })

  it('SR-04: приглашение без роли (клиент) ничего не отбирает и ничего не выдаёт', async () => {
    seedInvite({ staff_role: null })
    const r = await acceptInvitation({ inviteToken: 'tok-1', userId: 'attacker-account', email: 'victim@corp.kz', accessToken: 'jwt-new' })
    expect(r).toMatchObject({ accepted: true, staffRole: null, secured: false })
    expect(s.passwordSetFor).toHaveLength(0)
    expect(staffRoleUpserts()).toHaveLength(0)
  })
})

describe('SR-04: письмо приглашения несёт одноразовый токен, в базе — только его хеш', () => {
  it('SR-04: ссылка содержит invite=<токен>, запись хранит SHA-256, сам токен не хранится', async () => {
    const r = await sendPlatformInvite({ email: 'new@corp.kz', staffRole: 'super_expert', invitedById: 'staff-1' })
    expect(r.outcome).toBe('invited')
    const url = new URL(s.sent[0].url)
    const token = url.searchParams.get('invite')
    expect(token).toBeTruthy()
    expect(token!.length).toBeGreaterThanOrEqual(32)
    const row = s.invitations[0]
    expect((row.metadata as Record<string, unknown>).accept_token_hash).toBe(hashInviteToken(token!))
    expect(JSON.stringify(row)).not.toContain(token!)
    // Пользователь, созданный приглашением, записан — по нему отличаем «новый» аккаунт от существовавшего.
    expect(row.user_id).toBe('new-user')
  })
})
