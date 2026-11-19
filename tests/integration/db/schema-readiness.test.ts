/**
 * N5-1a on the real database: the readiness query against public.schema_migrations (083). The test
 * database is built without journal rows, so the build's newest migration is missing there at
 * first — exactly the «code ahead of the database» case — and then recorded by this test.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('readiness: schema against the journal (N5-1a)', async () => {
  const { prisma } = await import('@/lib/db')
  const health = await import('@/lib/health/platform')
  const { NEWEST_MIGRATION } = await import('@/lib/health/schema-version')
  /** A file name only this test uses: the shared test database may hold other rows. */
  const PROBE = '999_n5_1a_readiness_probe.sql'

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.schema_migrations WHERE file = ${PROBE}`
  })

  it('a file not in the journal is behind; recorded, it is ok; latestRecorded is the newest name', async () => {
    let s = await health.schemaStatus(PROBE)
    expect(s).toMatchObject({ expected: PROBE, journal: true, applied: false })
    expect(health.judgeSchema(s)).toBe('fail')

    await prisma.$executeRaw`INSERT INTO public.schema_migrations (file, checksum, applied_by) VALUES (${PROBE}, ${'0'.repeat(64)}, 'n5-1a-test') ON CONFLICT (file) DO NOTHING`
    s = await health.schemaStatus(PROBE)
    expect(s).toEqual({ expected: PROBE, journal: true, applied: true, latestRecorded: PROBE })
    expect(health.judgeSchema(s)).toBe('ok')
  })

  it('the default is the build’s newest migration, and readiness reports it', async () => {
    const s = await health.schemaStatus()
    expect(s.expected).toBe(NEWEST_MIGRATION)
    health.resetReadinessCache()
    const r = await health.checkReadiness()
    expect(r.schema).toBe(s.applied ? 'ok' : 'fail')
  })
})
