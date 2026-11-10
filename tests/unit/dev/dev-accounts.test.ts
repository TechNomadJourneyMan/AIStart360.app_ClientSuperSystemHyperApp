/**
 * One developer account per role (lib/dev/dev-accounts.ts).
 *
 * Supabase is an in-memory double: nothing here can reach a real project.
 * The double applies ILIKE the way PostgREST does and creates the profile row
 * the way the handle_new_user trigger does (a pending client), so the tests
 * see what the module really leaves in `profiles` and `staff_roles`.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STAFF_ROLES, isStaffRole } from '@/lib/admin/rbac'
import {
  DEV_ROLES,
  DEV_ROLE_LABELS,
  DevAccountError,
  devAccountShape,
  devEmail,
  ensureDevAccount,
  findAuthUserByEmail,
  type DevRole,
} from '@/lib/dev/dev-accounts'

interface FakeUser {
  id: string
  email: string
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
}
type Row = Record<string, unknown>
interface Call { op: string; table?: string; args?: unknown }

/** SQL ILIKE as PostgREST applies it: `\` escapes, `%` / `*` any run, `_` one character. */
function ilike(value: unknown, pattern: string): boolean {
  if (typeof value !== 'string') return false
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (ch === '%' || ch === '*') re += '.*'
    else if (ch === '_') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i').test(value)
}

function fakeAdmin(opts: { trigger?: boolean; fail?: Record<string, string> } = {}) {
  const users = new Map<string, FakeUser>()
  const profiles = new Map<string, Row>()
  const staff = new Map<string, Row>()
  const calls: Call[] = []
  /** Operations that answer an error (`<table>.<op>`, `createUser`, `getUserById`); tests may add to it. */
  const fail: Record<string, string> = { ...(opts.fail ?? {}) }
  /** Runs once, just before the next createUser — a parallel request getting there first. */
  const hooks: { beforeCreate?: () => void } = {}
  const failure = (key: string) => (fail[key] ? { message: fail[key], status: 500 } : null)
  let nextId = 1

  /** Insert an auth user the way GoTrue does; the trigger adds a pending client profile. */
  function addUser(attrs: { email: string; app_metadata?: Row; user_metadata?: Row }): FakeUser {
    const user: FakeUser = {
      id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
      email: attrs.email.toLowerCase(),
      app_metadata: { provider: 'email', ...(attrs.app_metadata ?? {}) },
      user_metadata: { ...(attrs.user_metadata ?? {}) },
    }
    users.set(user.id, user)
    if (opts.trigger !== false) {
      profiles.set(user.id, {
        id: user.id,
        email: user.email,
        full_name: (user.user_metadata.full_name as string | undefined) ?? user.email,
        role: 'client',
        status: 'pending_approval',
      })
    }
    return user
  }

  function table(name: 'profiles' | 'staff_roles') {
    const rows = name === 'profiles' ? profiles : staff
    const key = name === 'profiles' ? 'id' : 'user_id'
    return {
      select(columns: string) {
        const filters: Array<(row: Row) => boolean> = []
        const run = () => {
          const error = failure(`${name}.select`)
          return error ? { data: null, error } : { data: Array.from(rows.values()).filter((row) => filters.every((f) => f(row))), error: null }
        }
        const builder = {
          eq(column: string, value: unknown) {
            filters.push((row) => row[column] === value)
            return builder
          },
          ilike(column: string, pattern: string) {
            filters.push((row) => ilike(row[column], pattern))
            return builder
          },
          async limit(count: number) {
            calls.push({ op: 'select', table: name, args: columns })
            const res = run()
            return res.error ? res : { data: res.data!.slice(0, count), error: null }
          },
          async maybeSingle() {
            calls.push({ op: 'select', table: name, args: columns })
            const res = run()
            return res.error ? res : { data: res.data![0] ?? null, error: null }
          },
        }
        return builder
      },
      async upsert(row: Row, options: { onConflict: string }) {
        calls.push({ op: 'upsert', table: name, args: { row, options } })
        const error = failure(`${name}.upsert`)
        if (error) return { error }
        const id = row[key] as string
        rows.set(id, { ...(rows.get(id) ?? {}), ...row })
        return { error: null }
      },
      delete() {
        return {
          async eq(column: string, value: unknown) {
            calls.push({ op: 'delete', table: name, args: { [column]: value } })
            const error = failure(`${name}.delete`)
            if (error) return { error }
            for (const [id, row] of Array.from(rows.entries())) if (row[column] === value) rows.delete(id)
            return { error: null }
          },
        }
      },
    }
  }

  const client = {
    from: (name: 'profiles' | 'staff_roles') => table(name),
    auth: {
      admin: {
        async getUserById(id: string) {
          calls.push({ op: 'getUserById', args: id })
          const error = failure('getUserById')
          if (error) return { data: { user: null }, error }
          const user = users.get(id)
          return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'User not found', status: 404 } }
        },
        async createUser(attrs: { email: string; password?: string; email_confirm?: boolean; app_metadata?: Row; user_metadata?: Row }) {
          calls.push({ op: 'createUser', args: attrs })
          const racing = hooks.beforeCreate
          hooks.beforeCreate = undefined
          racing?.()
          const error = failure('createUser')
          if (error) return { data: { user: null }, error }
          if (Array.from(users.values()).some((u) => u.email === attrs.email.toLowerCase())) {
            return { data: { user: null }, error: { message: 'A user with this email address has already been registered', status: 422, code: 'email_exists' } }
          }
          return { data: { user: addUser(attrs) }, error: null }
        },
      },
    },
  }

  const writes = () => calls.filter((c) => c.op === 'upsert' || c.op === 'delete' || c.op === 'createUser')
  return { client: client as unknown as SupabaseClient, users, profiles, staff, calls, writes, addUser, fail, hooks }
}

const created = (t: ReturnType<typeof fakeAdmin>) =>
  t.calls.filter((c) => c.op === 'createUser').map((c) => c.args as { email: string; password: string; email_confirm: boolean; app_metadata: Row; user_metadata: Row })

describe('the nine developer roles', () => {
  it('cover a client, an expert and every staff role', () => {
    expect(DEV_ROLES).toEqual(['client', 'expert', 'super_expert', 'admin', 'super_admin', 'crm_manager', 'content_manager', 'analyst', 'support'])
    for (const role of STAFF_ROLES) expect(DEV_ROLES).toContain(role)
  })

  it('carry the Russian labels of the panel', () => {
    expect(DEV_ROLE_LABELS).toEqual({
      client: 'Клиент',
      expert: 'Эксперт',
      super_expert: 'Супер-эксперт',
      admin: 'Админ',
      super_admin: 'Супер-админ',
      crm_manager: 'CRM-менеджер',
      content_manager: 'Контент-менеджер',
      analyst: 'Аналитик',
      support: 'Поддержка',
    })
  })

  it('each has its own address under a domain that cannot exist', () => {
    expect(devEmail('client')).toBe('dev-client@dev.aistart360.test')
    expect(devEmail('super_admin')).toBe('dev-super-admin@dev.aistart360.test')
    expect(devEmail('crm_manager')).toBe('dev-crm-manager@dev.aistart360.test')
    const all = DEV_ROLES.map(devEmail)
    expect(new Set(all).size).toBe(DEV_ROLES.length)
    for (const email of all) expect(email).toMatch(/^dev-[a-z-]+@dev\.aistart360\.test$/)
  })

  it('map to a profile role and a staff role', () => {
    expect(devAccountShape('client')).toEqual({ profileRole: 'client', staffRole: null })
    expect(devAccountShape('expert')).toEqual({ profileRole: 'expert', staffRole: null })
    expect(devAccountShape('admin')).toEqual({ profileRole: 'admin', staffRole: 'admin' })
    expect(devAccountShape('super_admin')).toEqual({ profileRole: 'super_admin', staffRole: 'super_admin' })
    for (const role of ['super_expert', 'crm_manager', 'content_manager', 'analyst', 'support'] as const) {
      expect(devAccountShape(role)).toEqual({ profileRole: 'client', staffRole: role })
    }
    for (const role of DEV_ROLES) {
      const { staffRole } = devAccountShape(role)
      expect(staffRole === null || isStaffRole(staffRole), role).toBe(true)
    }
  })
})

describe('ensureDevAccount', () => {
  it('creates the account on first use: confirmed, with a random password that is not kept', async () => {
    const t = fakeAdmin()
    const account = await ensureDevAccount('client', t.client)

    expect(account).toEqual({ userId: Array.from(t.users.keys())[0], email: 'dev-client@dev.aistart360.test' })
    const [attrs] = created(t)
    expect(attrs.email).toBe('dev-client@dev.aistart360.test')
    expect(attrs.email_confirm).toBe(true)
    expect(attrs.user_metadata).toEqual({ full_name: 'DEV · Клиент', dev_account: true })
    // The marker the next sign-in trusts lives where only the service role can write.
    expect(attrs.app_metadata).toEqual({ dev_account: true })
    // 32 random bytes; neither returned nor stored anywhere by the module.
    expect(attrs.password.length).toBeGreaterThanOrEqual(43)
    expect(JSON.stringify(account)).not.toContain(attrs.password)

    const other = fakeAdmin()
    await ensureDevAccount('client', other.client)
    expect(created(other)[0].password).not.toBe(attrs.password)
  })

  it.each(DEV_ROLES)('%s: profiles and staff_roles match the shape of the role', async (role: DevRole) => {
    const t = fakeAdmin()
    const { userId, email } = await ensureDevAccount(role, t.client)
    const shape = devAccountShape(role)

    expect(email).toBe(devEmail(role))
    expect(t.profiles.get(userId)).toMatchObject({ id: userId, email, full_name: `DEV · ${DEV_ROLE_LABELS[role]}`, role: shape.profileRole, status: 'approved' })
    if (shape.staffRole) expect(t.staff.get(userId)).toMatchObject({ user_id: userId, role: shape.staffRole, granted_by: 'dev-login' })
    else expect(t.staff.has(userId)).toBe(false)
  })

  it('is idempotent: a second call finds the account and writes nothing', async () => {
    for (const role of DEV_ROLES) {
      const t = fakeAdmin()
      const first = await ensureDevAccount(role, t.client)
      const before = { profile: { ...t.profiles.get(first.userId) }, staff: t.staff.get(first.userId) && { ...t.staff.get(first.userId) } }
      t.calls.length = 0

      const second = await ensureDevAccount(role, t.client)
      expect(second, role).toEqual(first)
      expect(t.writes(), role).toEqual([])
      expect(t.users.size, role).toBe(1)
      expect(t.profiles.get(first.userId), role).toEqual(before.profile)
      expect(t.staff.get(first.userId), role).toEqual(before.staff)
    }
  })

  it('puts a drifted account back into shape', async () => {
    const t = fakeAdmin()
    const { userId } = await ensureDevAccount('crm_manager', t.client)
    t.profiles.set(userId, { ...t.profiles.get(userId), role: 'expert', status: 'pending_approval' })
    t.staff.set(userId, { user_id: userId, role: 'support' })

    await ensureDevAccount('crm_manager', t.client)
    expect(t.profiles.get(userId)).toMatchObject({ role: 'client', status: 'approved' })
    expect(t.staff.get(userId)).toMatchObject({ role: 'crm_manager' })
  })

  it('removes a staff role from an account whose role has none', async () => {
    const t = fakeAdmin()
    const { userId } = await ensureDevAccount('client', t.client)
    t.staff.set(userId, { user_id: userId, role: 'super_admin' })

    await ensureDevAccount('client', t.client)
    expect(t.staff.has(userId)).toBe(false)
  })

  it('works when no trigger created the profile row', async () => {
    const t = fakeAdmin({ trigger: false })
    const { userId } = await ensureDevAccount('expert', t.client)
    expect(t.profiles.get(userId)).toMatchObject({ id: userId, email: 'dev-expert@dev.aistart360.test', role: 'expert', status: 'approved' })
  })

  it('never adopts an account it did not create, whatever the account says about itself', async () => {
    // Somebody registered the (public) developer address through the normal
    // sign-up. Raising that account to super_admin would hand them the
    // production panel; user_metadata is theirs to write, app_metadata is not.
    const t = fakeAdmin()
    const stranger = t.addUser({ email: 'dev-super-admin@dev.aistart360.test', user_metadata: { full_name: 'DEV · Супер-админ', dev_account: true } })
    t.calls.length = 0

    const error = await ensureDevAccount('super_admin', t.client).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DevAccountError)
    expect((error as DevAccountError).code).toBe('DEV_ACCOUNT_CONFLICT')
    expect(t.writes()).toEqual([])
    expect(t.profiles.get(stranger.id)).toMatchObject({ role: 'client', status: 'pending_approval' })
    expect(t.staff.size).toBe(0)
  })

  it('uses the account a parallel request has just created', async () => {
    const t = fakeAdmin()
    t.hooks.beforeCreate = () => {
      t.addUser({ email: devEmail('analyst'), app_metadata: { dev_account: true } })
    }

    const { userId } = await ensureDevAccount('analyst', t.client)
    expect(t.users.size).toBe(1)
    expect(created(t)).toHaveLength(1)
    expect(t.profiles.get(userId)).toMatchObject({ role: 'client', status: 'approved' })
    expect(t.staff.get(userId)).toMatchObject({ role: 'analyst' })
  })

  it('reports what failed with a stable code', async () => {
    const code = (fail: Record<string, string>) =>
      ensureDevAccount('admin', fakeAdmin({ fail }).client).then(() => 'ok', (e: unknown) => (e as DevAccountError).code)
    expect(await code({})).toBe('ok')
    expect(await code({ createUser: 'boom' })).toBe('DEV_ACCOUNT_CREATE_FAILED')
    expect(await code({ 'profiles.select': 'boom' })).toBe('DEV_LOOKUP_FAILED')
    expect(await code({ 'profiles.upsert': 'boom' })).toBe('DEV_ACCOUNT_WRITE_FAILED')
    expect(await code({ 'staff_roles.select': 'boom' })).toBe('DEV_LOOKUP_FAILED')
    expect(await code({ 'staff_roles.upsert': 'boom' })).toBe('DEV_ACCOUNT_WRITE_FAILED')

    const t = fakeAdmin()
    const { userId } = await ensureDevAccount('client', t.client)
    t.staff.set(userId, { user_id: userId, role: 'support' })
    t.fail['staff_roles.delete'] = 'boom'
    await expect(ensureDevAccount('client', t.client)).rejects.toMatchObject({ code: 'DEV_ACCOUNT_WRITE_FAILED' })
  })
})

describe('findAuthUserByEmail', () => {
  it('finds an account whatever the letter case, and nothing for an unknown address', async () => {
    const t = fakeAdmin()
    const user = t.addUser({ email: 'ivan.petrov@example.com' })
    t.profiles.set(user.id, { ...t.profiles.get(user.id), email: 'Ivan.Petrov@Example.com' })

    expect((await findAuthUserByEmail(t.client, '  IVAN.petrov@example.com '))?.id).toBe(user.id)
    expect(await findAuthUserByEmail(t.client, 'nobody@example.com')).toBeNull()
    expect(await findAuthUserByEmail(t.client, '')).toBeNull()
  })

  it('treats _ and % in an address as characters, not as wildcards', async () => {
    const t = fakeAdmin()
    const exact = t.addUser({ email: 'a_b@example.com' })
    t.addUser({ email: 'axb@example.com' })

    expect((await findAuthUserByEmail(t.client, 'a_b@example.com'))?.id).toBe(exact.id)
    expect(await findAuthUserByEmail(t.client, 'a_c@example.com')).toBeNull()
    expect(await findAuthUserByEmail(t.client, '%@example.com')).toBeNull()
    expect(await findAuthUserByEmail(t.client, '*@example.com')).toBeNull()
  })

  it('ignores a profile whose account now has another address', async () => {
    const t = fakeAdmin()
    const user = t.addUser({ email: 'new@example.com' })
    t.profiles.set(user.id, { ...t.profiles.get(user.id), email: 'old@example.com' })

    expect(await findAuthUserByEmail(t.client, 'old@example.com')).toBeNull()
  })

  it('a failed lookup is an error, not "no such user"', async () => {
    const lookup = fakeAdmin({ fail: { 'profiles.select': 'boom' } })
    await expect(findAuthUserByEmail(lookup.client, 'a@example.com')).rejects.toMatchObject({ code: 'DEV_LOOKUP_FAILED' })

    const auth = fakeAdmin({ fail: { getUserById: 'boom' } })
    auth.addUser({ email: 'a@example.com' })
    await expect(findAuthUserByEmail(auth.client, 'a@example.com')).rejects.toMatchObject({ code: 'DEV_LOOKUP_FAILED' })
  })
})
