/**
 * lib/runtime/prisma-url.ts + lib/db.ts — the Prisma pool on a long-lived process. On Vercel every
 * function instance has its own tiny pool (connection_limit=1 in DATABASE_URL); a Railway process
 * serves everything through one client, so there the limit comes from PRISMA_CONNECTION_LIMIT
 * (1..50, default 5). Pure string work: no database is touched here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// lib/db.ts is imported fresh per test below; its PrismaClient only records the options it got.
const built = vi.hoisted(() => ({ options: [] as unknown[] }))
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(options: unknown) { built.options.push(options) }
  },
}))

import {
  DEFAULT_PRISMA_CONNECTION_LIMIT,
  persistentPrismaDatasourceUrl,
  prismaConnectionLimit,
  withConnectionLimit,
} from '@/lib/runtime/prisma-url'

const POOLER = 'postgresql://postgres.abc:p%40ss%2Fw0rd@aws-0-eu-west-1.pooler.supabase.invalid:6543/postgres'
const SESSION = 'postgresql://postgres.abc:p%40ss%2Fw0rd@aws-0-eu-west-1.pooler.supabase.invalid:5432/postgres'

describe('withConnectionLimit', () => {
  it('replaces an existing connection_limit and keeps the other params as they were', () => {
    expect(withConnectionLimit(`${POOLER}?pgbouncer=true&connection_limit=1`, 5)).toBe(`${POOLER}?pgbouncer=true&connection_limit=5`)
    expect(withConnectionLimit(`${POOLER}?connection_limit=1&pgbouncer=true`, 7)).toBe(`${POOLER}?pgbouncer=true&connection_limit=7`)
  })

  it('adds it when there is none', () => {
    expect(withConnectionLimit(POOLER, 5)).toBe(`${POOLER}?connection_limit=5`)
    expect(withConnectionLimit(`${POOLER}?`, 5)).toBe(`${POOLER}?connection_limit=5`)
    expect(withConnectionLimit(`${POOLER}?pgbouncer=true`, 5)).toBe(`${POOLER}?pgbouncer=true&connection_limit=5`)
  })

  it('leaves encoded values and the credentials byte for byte', () => {
    const url = `${POOLER}?options=-c%20search_path%3Dpublic&sslmode=require&pool_timeout=20&connection_limit=1`
    expect(withConnectionLimit(url, 5)).toBe(`${POOLER}?options=-c%20search_path%3Dpublic&sslmode=require&pool_timeout=20&connection_limit=5`)
  })

  it('drops every connection_limit, not just the first', () => {
    expect(withConnectionLimit(`${POOLER}?connection_limit=1&a=b&connection_limit=3`, 5)).toBe(`${POOLER}?a=b&connection_limit=5`)
  })

  it('does not touch params whose name only contains connection_limit', () => {
    expect(withConnectionLimit(`${POOLER}?x_connection_limit=1`, 5)).toBe(`${POOLER}?x_connection_limit=1&connection_limit=5`)
  })
})

describe('prismaConnectionLimit', () => {
  it('takes an integer from 1 to 50', () => {
    expect(prismaConnectionLimit('1')).toBe(1)
    expect(prismaConnectionLimit('12')).toBe(12)
    expect(prismaConnectionLimit(' 20 ')).toBe(20)
    expect(prismaConnectionLimit('50')).toBe(50)
  })

  it('anything else is the default, 5', () => {
    expect(DEFAULT_PRISMA_CONNECTION_LIMIT).toBe(5)
    for (const raw of [undefined, '', '  ', '0', '51', '-1', '5.5', '1e1', 'abc', '10abc', '0x10']) {
      expect(prismaConnectionLimit(raw), `raw=${String(raw)}`).toBe(5)
    }
  })
})

describe('persistentPrismaDatasourceUrl', () => {
  it('on a persistent server: DATABASE_URL with connection_limit from PRISMA_CONNECTION_LIMIT', () => {
    expect(
      persistentPrismaDatasourceUrl({
        PERSISTENT_SERVER: '1',
        DATABASE_URL: `${POOLER}?pgbouncer=true&connection_limit=1`,
        PRISMA_CONNECTION_LIMIT: '8',
      }),
    ).toBe(`${POOLER}?pgbouncer=true&connection_limit=8`)
  })

  it('an invalid PRISMA_CONNECTION_LIMIT falls back to 5', () => {
    expect(
      persistentPrismaDatasourceUrl({ PERSISTENT_SERVER: '1', DATABASE_URL: `${POOLER}?pgbouncer=true&connection_limit=1`, PRISMA_CONNECTION_LIMIT: '500' }),
    ).toBe(`${POOLER}?pgbouncer=true&connection_limit=5`)
  })

  it('no DATABASE_URL: no override', () => {
    expect(persistentPrismaDatasourceUrl({ PERSISTENT_SERVER: '1' })).toBeUndefined()
    expect(persistentPrismaDatasourceUrl({ PERSISTENT_SERVER: '1', DATABASE_URL: '  ' })).toBeUndefined()
  })

  it('not a persistent server (Vercel, local, tests): no override', () => {
    expect(persistentPrismaDatasourceUrl({ VERCEL: '1', DATABASE_URL: POOLER })).toBeUndefined()
    expect(persistentPrismaDatasourceUrl({ PERSISTENT_SERVER: '0', DATABASE_URL: POOLER })).toBeUndefined()
    expect(persistentPrismaDatasourceUrl({ DATABASE_URL: POOLER })).toBeUndefined()
    expect(persistentPrismaDatasourceUrl({ VERCEL: '1', DATABASE_URL: POOLER, DIRECT_URL: SESSION, PRISMA_DATASOURCE: 'direct' })).toBeUndefined()
  })

  it('PRISMA_DATASOURCE=direct: DIRECT_URL (session mode) with the connection limit', () => {
    expect(
      persistentPrismaDatasourceUrl({
        PERSISTENT_SERVER: '1',
        DATABASE_URL: `${POOLER}?pgbouncer=true&connection_limit=1`,
        DIRECT_URL: SESSION,
        PRISMA_DATASOURCE: ' direct ',
        PRISMA_CONNECTION_LIMIT: '6',
      }),
    ).toBe(`${SESSION}?connection_limit=6`)
  })

  it('PRISMA_DATASOURCE=direct without a DIRECT_URL keeps DATABASE_URL', () => {
    for (const DIRECT_URL of [undefined, '', '  ']) {
      expect(
        persistentPrismaDatasourceUrl({ PERSISTENT_SERVER: '1', DATABASE_URL: `${POOLER}?pgbouncer=true`, DIRECT_URL, PRISMA_DATASOURCE: 'direct' }),
      ).toBe(`${POOLER}?pgbouncer=true&connection_limit=5`)
    }
  })

  it('any other PRISMA_DATASOURCE keeps DATABASE_URL', () => {
    for (const PRISMA_DATASOURCE of [undefined, '', 'Direct', 'DIRECT_URL', '1', 'pooler']) {
      expect(
        persistentPrismaDatasourceUrl({ PERSISTENT_SERVER: '1', DATABASE_URL: `${POOLER}?pgbouncer=true`, DIRECT_URL: SESSION, PRISMA_DATASOURCE }),
        `PRISMA_DATASOURCE=${String(PRISMA_DATASOURCE)}`,
      ).toBe(`${POOLER}?pgbouncer=true&connection_limit=5`)
    }
  })
})

describe('lib/db.ts: how the client is constructed', () => {
  async function freshClientOptions(): Promise<unknown> {
    built.options = []
    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()
    await import('@/lib/db')
    expect(built.options).toHaveLength(1)
    return built.options[0]
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    delete (globalThis as { prisma?: unknown }).prisma
  })

  it('not a persistent server: exactly the options of before (no datasourceUrl)', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '')
    vi.stubEnv('DATABASE_URL', `${POOLER}?pgbouncer=true&connection_limit=1`)
    expect(await freshClientOptions()).toEqual({ log: [] })
  })

  it('a persistent server: datasourceUrl carries the pool size, and nothing is logged', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
    try {
      vi.stubEnv('PERSISTENT_SERVER', '1')
      vi.stubEnv('DATABASE_URL', `${POOLER}?pgbouncer=true&connection_limit=1`)
      vi.stubEnv('PRISMA_CONNECTION_LIMIT', '6')
      expect(await freshClientOptions()).toEqual({ log: [], datasourceUrl: `${POOLER}?pgbouncer=true&connection_limit=6` })
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('a persistent server without DATABASE_URL: no override', async () => {
    vi.stubEnv('PERSISTENT_SERVER', '1')
    vi.stubEnv('DATABASE_URL', '')
    expect(await freshClientOptions()).toEqual({ log: [] })
  })
})
