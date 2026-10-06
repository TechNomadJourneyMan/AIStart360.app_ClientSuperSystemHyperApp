/**
 * Security P2-19 — prisma/seed.ts wipes users, organizations and clients and
 * runs automatically on `prisma migrate reset` / `prisma db seed` against the
 * loaded DATABASE_URL (.env points at production). It now refuses unless the
 * operator opts in, outside production, against a local / test database.
 */
import { describe, expect, it } from 'vitest'
import { seedRefusal } from '@/prisma/seed-guard'

const LOCAL = 'postgres://postgres:postgres@127.0.0.1:5432/aistart360'
const PROD = 'postgresql://postgres.abc:pw@aws-0-eu.pooler.supabase.com:6543/postgres?pgbouncer=true'

describe('seedRefusal', () => {
  it('refuses without the explicit opt-in', () => {
    expect(seedRefusal({ DATABASE_URL: LOCAL })).toMatch(/ALLOW_DESTRUCTIVE_SEED/)
  })

  it('refuses a production database host, even with the opt-in', () => {
    expect(seedRefusal({ ALLOW_DESTRUCTIVE_SEED: '1', DATABASE_URL: PROD })).toMatch(/not a local\/test database/)
  })

  it('refuses in production and without a DATABASE_URL', () => {
    expect(seedRefusal({ ALLOW_DESTRUCTIVE_SEED: '1', NODE_ENV: 'production', DATABASE_URL: LOCAL })).toMatch(/production/)
    expect(seedRefusal({ ALLOW_DESTRUCTIVE_SEED: '1' })).toMatch(/DATABASE_URL/)
  })

  it('allows a local database, the test database host, or an explicitly allowed host', () => {
    expect(seedRefusal({ ALLOW_DESTRUCTIVE_SEED: '1', DATABASE_URL: LOCAL })).toBeNull()
    expect(seedRefusal({ ALLOW_DESTRUCTIVE_SEED: '1', DATABASE_URL: 'postgres://u@localhost/db' })).toBeNull()
    expect(seedRefusal({ ALLOW_DESTRUCTIVE_SEED: '1', DATABASE_URL: 'postgres://u@db:5432/x', TEST_DATABASE_URL: 'postgres://u@db:5432/t' })).toBeNull()
    expect(seedRefusal({ ALLOW_DESTRUCTIVE_SEED: '1', DATABASE_URL: 'postgres://u@pg.local/x', SEED_ALLOWED_HOSTS: 'other, pg.local' })).toBeNull()
  })
})
