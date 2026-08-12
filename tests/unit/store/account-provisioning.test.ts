import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  APPLY_CONFIRM_PREFIX,
  STORE_DISPLAY_NAME,
  accountAppMetadata,
  accountMetadata,
  parseArgs,
  provisionStoreAccount,
} = require('../../../scripts/provision-store-account.js') as {
  APPLY_CONFIRM_PREFIX: string
  STORE_DISPLAY_NAME: string
  accountAppMetadata: (existing?: Record<string, unknown>) => Record<string, unknown>
  accountMetadata: (existing?: Record<string, unknown>) => Record<string, unknown>
  parseArgs: (args: string[]) => { apply: boolean; rotatePassword: boolean }
  provisionStoreAccount: (client: FakeSupabase, input: {
    email: string
    password?: string
    confirmation?: string
    apply: boolean
    rotatePassword: boolean
    now?: string
  }) => Promise<Record<string, unknown>>
}

interface FakeUser {
  id: string
  email: string
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

interface FakeCompany {
  id: string
  user_id: string
  name: string
  industry?: string
  business_model?: string
}

interface FakeProfile {
  id: string
  email?: string
  role?: string
  status?: string
  vertical?: string
  full_name?: string
  organization?: string
  approved_at?: string
}

class FakeQuery {
  private action: 'select' | 'upsert' | 'update' | 'insert' = 'select'
  private payload: Record<string, unknown> | null = null
  private filters: Array<[string, unknown]> = []

  constructor(
    private readonly client: FakeSupabase,
    private readonly table: 'profiles' | 'companies',
  ) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value])
    return this
  }

  limit() {
    return this
  }

  upsert(payload: Record<string, unknown>) {
    this.action = 'upsert'
    this.payload = payload
    return this
  }

  update(payload: Record<string, unknown>) {
    this.action = 'update'
    this.payload = payload
    return this
  }

  insert(payload: Record<string, unknown>) {
    this.action = 'insert'
    this.payload = payload
    return this
  }

  maybeSingle() {
    return Promise.resolve(this.readSingle())
  }

  single() {
    return Promise.resolve(this.execute())
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private matches(row: Record<string, unknown>) {
    return this.filters.every(([column, value]) => row[column] === value)
  }

  private readSingle() {
    const rows = this.table === 'profiles'
      ? [...this.client.profiles.values()]
      : this.client.companies
    const row = rows.find((candidate) => this.matches(candidate as unknown as Record<string, unknown>))
    return { data: row ?? null, error: null }
  }

  private execute() {
    if (this.action === 'select') {
      const rows = this.table === 'profiles'
        ? [...this.client.profiles.values()]
        : this.client.companies
      return {
        data: rows.filter((candidate) => this.matches(candidate as unknown as Record<string, unknown>)),
        error: null,
      }
    }

    if (this.table === 'profiles' && this.action === 'upsert') {
      if (this.client.failProfileWrite) return { data: null, error: { message: 'profile failed' } }
      const profile = this.payload as unknown as FakeProfile
      this.client.profiles.set(profile.id, { ...this.client.profiles.get(profile.id), ...profile })
      this.client.profileWrites.push(profile)
      return { data: profile, error: null }
    }

    if (this.table === 'companies' && this.action === 'update') {
      if (this.client.failCompanyWrite) return { data: null, error: { message: 'company failed' } }
      const index = this.client.companies.findIndex((company) => this.matches(company as unknown as Record<string, unknown>))
      if (index < 0) return { data: null, error: { message: 'not found' } }
      this.client.companies[index] = { ...this.client.companies[index], ...this.payload } as FakeCompany
      this.client.companyWrites.push(this.client.companies[index])
      return { data: { id: this.client.companies[index].id }, error: null }
    }

    if (this.table === 'companies' && this.action === 'insert') {
      if (this.client.failCompanyWrite) return { data: null, error: { message: 'company failed' } }
      const company = {
        id: 'generated-company-id',
        ...this.payload,
      } as unknown as FakeCompany
      this.client.companies.push(company)
      this.client.companyWrites.push(company)
      return { data: { id: company.id }, error: null }
    }

    return { data: null, error: { message: 'unsupported fake query' } }
  }
}

class FakeSupabase {
  users: FakeUser[]
  profiles = new Map<string, FakeProfile>()
  companies: FakeCompany[]
  authUpdates: Array<Record<string, unknown>> = []
  authCreates: Array<Record<string, unknown>> = []
  authDeletes: string[] = []
  profileWrites: FakeProfile[] = []
  companyWrites: FakeCompany[] = []
  failProfileWrite = false
  failCompanyWrite = false

  constructor(input: { users?: FakeUser[]; profiles?: FakeProfile[]; companies?: FakeCompany[] } = {}) {
    this.users = input.users ?? []
    this.companies = input.companies ?? []
    for (const profile of input.profiles ?? []) this.profiles.set(profile.id, profile)
  }

  auth = {
    admin: {
      listUsers: async () => ({ data: { users: this.users }, error: null }),
      updateUserById: async (id: string, changes: Record<string, unknown>) => {
        this.authUpdates.push(changes)
        const user = this.users.find((candidate) => candidate.id === id)
        if (!user) return { data: { user: null }, error: { message: 'not found' } }
        Object.assign(user, {
          app_metadata: changes.app_metadata,
          user_metadata: changes.user_metadata,
        })
        return { data: { user }, error: null }
      },
      createUser: async (values: Record<string, unknown>) => {
        this.authCreates.push(values)
        const user: FakeUser = {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          email: String(values.email),
          app_metadata: values.app_metadata as Record<string, unknown>,
          user_metadata: values.user_metadata as Record<string, unknown>,
        }
        this.users.push(user)
        return { data: { user }, error: null }
      },
      deleteUser: async (id: string) => {
        this.authDeletes.push(id)
        return { data: null, error: null }
      },
    },
  }

  from(table: 'profiles' | 'companies') {
    return new FakeQuery(this, table)
  }
}

const EMAIL = 'store@example.com'
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function existingClient(companyCount = 1) {
  return new FakeSupabase({
    users: [{
      id: USER_ID,
      email: EMAIL,
      app_metadata: { provider: 'email' },
      user_metadata: { locale: 'ru', full_name: 'HONOR GROUP · demo client' },
    }],
    profiles: [{
      id: USER_ID,
      role: 'client',
      status: 'approved',
      vertical: 'ecommerce',
      full_name: 'HONOR GROUP · demo client',
      organization: 'HONOR GROUP',
    }],
    companies: Array.from({ length: companyCount }, (_, index) => ({
      id: `company-${index + 1}`,
      user_id: USER_ID,
      name: 'HONOR GROUP',
    })),
  })
}

describe('Store account provisioning', () => {
  it('builds trusted metadata without discarding unrelated keys', () => {
    expect(accountMetadata({ locale: 'ru' })).toMatchObject({
      locale: 'ru',
      full_name: STORE_DISPLAY_NAME,
      organization: STORE_DISPLAY_NAME,
      vertical: 'ecommerce',
      store_account: true,
    })
    expect(accountAppMetadata({ provider: 'email' })).toEqual({
      provider: 'email',
      role: 'client',
      status: 'approved',
    })
  })

  it('defaults to a read-only plan', async () => {
    const client = existingClient()
    const result = await provisionStoreAccount(client, {
      email: EMAIL,
      apply: false,
      rotatePassword: false,
    })

    expect(result).toMatchObject({
      outcome: 'update_existing',
      applied: false,
      companyNeedsUpdate: true,
      profileNeedsUpdate: true,
    })
    expect(client.authUpdates).toHaveLength(0)
    expect(client.profileWrites).toHaveLength(0)
    expect(client.companyWrites).toHaveLength(0)
  })

  it('upgrades the isolated existing tenant without rotating its password', async () => {
    const client = existingClient()
    const result = await provisionStoreAccount(client, {
      email: EMAIL,
      confirmation: `${APPLY_CONFIRM_PREFIX}${EMAIL}`,
      apply: true,
      rotatePassword: false,
      now: '2026-08-13T00:00:00.000Z',
    })

    expect(result).toMatchObject({
      outcome: 'updated',
      displayName: STORE_DISPLAY_NAME,
      role: 'client',
      status: 'approved',
      loginPath: '/login?from=/store',
    })
    expect(result).not.toHaveProperty('password')
    expect(client.authUpdates).toHaveLength(1)
    expect(client.authUpdates[0]).not.toHaveProperty('password')
    expect(client.authUpdates[0].user_metadata).toMatchObject({ locale: 'ru' })
    expect(client.profiles.get(USER_ID)).toMatchObject({
      full_name: STORE_DISPLAY_NAME,
      organization: STORE_DISPLAY_NAME,
      role: 'client',
      status: 'approved',
    })
    expect(client.companies).toEqual([
      expect.objectContaining({ user_id: USER_ID, name: STORE_DISPLAY_NAME }),
    ])
  })

  it('refuses ambiguous multi-company ownership before any write', async () => {
    const client = existingClient(2)
    await expect(provisionStoreAccount(client, {
      email: EMAIL,
      confirmation: `${APPLY_CONFIRM_PREFIX}${EMAIL}`,
      apply: true,
      rotatePassword: false,
    })).rejects.toThrow('more than one company')
    expect(client.authUpdates).toHaveLength(0)
    expect(client.profileWrites).toHaveLength(0)
  })

  it('deletes a newly-created Auth user when downstream bootstrap fails', async () => {
    const client = new FakeSupabase()
    client.failProfileWrite = true

    await expect(provisionStoreAccount(client, {
      email: EMAIL,
      password: 'strong-password-2026',
      confirmation: `${APPLY_CONFIRM_PREFIX}${EMAIL}`,
      apply: true,
      rotatePassword: false,
    })).rejects.toThrow('Unable to write Store profile')

    expect(client.authCreates).toHaveLength(1)
    expect(client.authCreates[0]).toMatchObject({
      email: EMAIL,
      app_metadata: { role: 'client', status: 'approved' },
    })
    expect(client.authDeletes).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])
  })

  it('requires an exact apply confirmation and rejects unknown flags', async () => {
    const client = existingClient()
    await expect(provisionStoreAccount(client, {
      email: EMAIL,
      confirmation: 'wrong',
      apply: true,
      rotatePassword: false,
    })).rejects.toThrow('does not match')
    expect(client.authUpdates).toHaveLength(0)
    expect(() => parseArgs(['--delete'])).toThrow('Unknown option')
  })
})
