/**
 * N5-1a on the real database: the readiness query against public.schema_migrations (083). The test
 * database is built without journal rows, so the build's migrations are missing there at first —
 * exactly the «code ahead of the database» case — and then recorded by this test.
 * Review of wave 1A: readiness asks for EVERY migration of the bundle era (≥ 140), not only the newest;
 * the query takes the list as one text[] parameter.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('readiness: schema against the journal (N5-1a)', async () => {
  const { prisma } = await import('@/lib/db')
  const health = await import('@/lib/health/platform')
  const { NEWEST_MIGRATION, SHIPPED_MIGRATIONS } = await import('@/lib/health/schema-version')
  /** File names only this test uses: the shared test database may hold other rows. */
  const PROBE_OLD = '998_n5_1a_readiness_probe_older.sql'
  const PROBE = '999_n5_1a_readiness_probe.sql'

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM public.schema_migrations WHERE file IN (${PROBE}, ${PROBE_OLD})`
  })

  const record = (file: string) =>
    prisma.$executeRaw`INSERT INTO public.schema_migrations (file, checksum, applied_by) VALUES (${file}, ${'0'.repeat(64)}, 'n5-1a-test') ON CONFLICT (file) DO NOTHING`

  it('a list with an older file missing is behind even when the newest is recorded; all recorded is ok', async () => {
    await record(PROBE)
    let s = await health.schemaStatus([PROBE_OLD, PROBE])
    expect(s).toMatchObject({ expected: PROBE, checked: 2, journal: true, applied: false, missing: [PROBE_OLD], latestRecorded: PROBE })
    expect(health.judgeSchema(s)).toBe('fail')

    await record(PROBE_OLD)
    s = await health.schemaStatus([PROBE_OLD, PROBE])
    expect(s).toEqual({ expected: PROBE, checked: 2, journal: true, applied: true, missing: [], latestRecorded: PROBE })
    expect(health.judgeSchema(s)).toBe('ok')
  })

  it('the default is every migration of the build from 140 on, and readiness reports it', async () => {
    const s = await health.schemaStatus()
    expect(s.expected).toBe(NEWEST_MIGRATION)
    expect(s.checked).toBe(SHIPPED_MIGRATIONS.length)
    expect(s.missing.every((f) => (SHIPPED_MIGRATIONS as readonly string[]).includes(f))).toBe(true)
    health.resetReadinessCache()
    const r = await health.checkReadiness()
    expect(r.schema).toBe(s.applied ? 'ok' : 'fail')
  })
})
