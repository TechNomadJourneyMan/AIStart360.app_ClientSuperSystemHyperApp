/**
 * Бэкапы на реальной базе (R-011). Один файл, потому что обе части делят журнал ops_backup_runs:
 *
 *   • сторож (миграция 142 + lib/ops/backup-freshness.ts + notifyStaff): журнал закрыт от anon /
 *     authenticated; свежий бэкап — тишина; старый — одно уведомление, и только Super Admin (не
 *     обычному admin); повтор — без дубля. Telegram Bot API подменён записывающим fetch.
 *   • скрипт scripts/backup/railway-db-backup.sh против локальной тестовой базы: дамп, проверки,
 *     манифест со счётчиками строк, раскладка runs/ latest monthly, ротация только своих имён,
 *     копия Storage, запись в журнал при успехе и при сбое, ни одного секрета в выводе и argv.
 *     S3 заменён поддельным rclone (tests/fixtures/backup/rclone) — каталогом на диске.
 *     Нужен pg_dump той же major-версии, что тестовый сервер (PG_BIN или стандартные пути).
 */
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dbTestsEnabled } from '../../helpers/db-env'

describe.skipIf(!dbTestsEnabled)('backups (142)', async () => {
  const { prisma } = await import('@/lib/db')
  const { runBackupFreshness } = await import('@/lib/ops/backup-freshness')

  const sent: Array<{ chat: string; text: string }> = []
  const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (String(url).endsWith('/sendMessage')) sent.push({ chat: String(body.chat_id), text: String(body.text) })
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 })
  })

  const superAdmin = { id: randomUUID(), tg: 910_000_000 + Math.floor(Math.random() * 1e6) }
  const admin = { id: randomUUID(), tg: superAdmin.tg + 1 }
  const env: Record<string, string | undefined> = {}
  const H = 3600_000

  async function linkedStaff(u: { id: string; tg: number }, role: string) {
    await prisma.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${u.id}::uuid, ${`${u.id}@staff.local`})`
    await prisma.$executeRaw`UPDATE public.profiles SET status = 'approved' WHERE id = ${u.id}::uuid`
    await prisma.$executeRaw`INSERT INTO public.staff_roles (user_id, role) VALUES (${u.id}::uuid, ${role})`
    await prisma.$executeRaw`
      INSERT INTO public.staff_telegram_links (user_id, telegram_user_id, chat_id, linked_at, min_level)
      VALUES (${u.id}::uuid, ${u.tg}, ${String(u.tg)}, now() - interval '1 day', 'WARNING')`
  }

  async function addRun(r: { kind?: string; ok: boolean; hoursAgo: number; error?: string }) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.ops_backup_runs (started_at, finished_at, ok, kind, bytes, tables, sha256, object_key, error)
      VALUES (now() - make_interval(secs => ${r.hoursAgo * 3600 + 300}::double precision),
              now() - make_interval(secs => ${r.hoursAgo * 3600}::double precision),
              ${r.ok}, ${r.kind ?? 'db'}, 52428800, 412, ${'a'.repeat(64)}, 'runs/2026-11-14T00Z.dump', ${r.error ?? null})
      RETURNING id::text`
    return rows[0].id
  }

  const events = () => prisma.$queryRaw<Array<{ level: string; dedupe_key: string; problem: string }>>`
    SELECT level, dedupe_key, data->>'problem' AS problem FROM public.notification_events WHERE type = 'ops.backup' ORDER BY created_at`

  beforeAll(async () => {
    for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_BOT_TOKEN', 'NOTIFY_QUIET_HOURS', 'TELEGRAM_ADMIN_CHAT_IDS', 'TELEGRAM_CHAT_ID', 'ADMIN_NOTIFICATION_EMAIL', 'ADMIN_EMAIL']) env[k] = process.env[k]
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    delete process.env.TELEGRAM_ADMIN_BOT_TOKEN
    process.env.NOTIFY_QUIET_HOURS = ''
    process.env.TELEGRAM_ADMIN_CHAT_IDS = ''
    delete process.env.TELEGRAM_CHAT_ID
    delete process.env.ADMIN_NOTIFICATION_EMAIL
    delete process.env.ADMIN_EMAIL
    vi.stubGlobal('fetch', fakeFetch)
    await linkedStaff(superAdmin, 'super_admin')
    await linkedStaff(admin, 'admin')
  })

  beforeEach(async () => {
    sent.length = 0
    await prisma.$executeRaw`DELETE FROM public.ops_backup_runs`
    await prisma.$executeRaw`DELETE FROM public.notification_events WHERE type = 'ops.backup'`
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma.$executeRaw`DELETE FROM public.ops_backup_runs`
    await prisma.$executeRaw`DELETE FROM public.notification_events WHERE type = 'ops.backup'`
    await prisma.$executeRaw`DELETE FROM auth.users WHERE id IN (${superAdmin.id}::uuid, ${admin.id}::uuid)`
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await prisma.$disconnect()
  })

  it('the journal: RLS on, no grants to anon / authenticated, service_role may write', async () => {
    const [t] = await prisma.$queryRaw<Array<{ rls: boolean }>>`
      SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.ops_backup_runs'::regclass`
    expect(t.rls).toBe(true)
    const privs = await prisma.$queryRaw<Array<{ role: string; any: boolean }>>`
      SELECT r AS role,
             has_table_privilege(r, 'public.ops_backup_runs', 'SELECT')
          OR has_table_privilege(r, 'public.ops_backup_runs', 'INSERT')
          OR has_table_privilege(r, 'public.ops_backup_runs', 'UPDATE')
          OR has_table_privilege(r, 'public.ops_backup_runs', 'DELETE') AS any
      FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r`
    expect(Object.fromEntries(privs.map((p) => [p.role, p.any]))).toEqual({ anon: false, authenticated: false, service_role: true })
    const [policies] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ops_backup_runs'`
    expect(Number(policies.n)).toBe(0)
    await expect(prisma.$executeRaw`INSERT INTO public.ops_backup_runs (ok, kind) VALUES (true, 'bogus')`).rejects.toThrow()
  })

  it('fresh backup: silence, nothing in the feed', async () => {
    await addRun({ ok: true, hoursAgo: 2 })
    const res = await runBackupFreshness(new Date())
    expect(res).toEqual({ status: 'ok', problems: [], notified: [] })
    expect(await events()).toEqual([])
    expect(sent).toEqual([])
  })

  it('old backup: one CRITICAL to the Super Admin only; the next hourly run sends nothing', async () => {
    const oldId = await addRun({ ok: true, hoursAgo: 12 })
    const first = await runBackupFreshness(new Date())
    expect(first).toEqual({ status: 'alerted', problems: [`db:stale:${oldId}`], notified: [`db:stale:${oldId}`] })
    expect(sent.map((s) => s.chat)).toEqual([String(superAdmin.tg)])
    expect(sent[0].text).toContain('Бэкапа базы нет дольше 10 ч')
    expect(await events()).toEqual([expect.objectContaining({ level: 'CRITICAL', problem: `db:stale:${oldId}` })])

    const again = await runBackupFreshness(new Date(Date.now() + H))
    expect(again).toEqual({ status: 'quiet', problems: [`db:stale:${oldId}`], notified: [] })
    expect(sent).toHaveLength(1)
    expect(await events()).toHaveLength(1)
  })

  it('a failed last run is announced with its error; a later failed run is a new problem', async () => {
    await addRun({ ok: true, hoursAgo: 9 })
    const badA = await addRun({ ok: false, hoursAgo: 1, error: 'pg_restore -l: 12 tables < 200' })
    expect((await runBackupFreshness(new Date())).notified).toEqual([`db:failed:${badA}`])
    expect(sent[0].text).toContain('pg_restore -l: 12 tables &lt; 200')

    const badB = await addRun({ ok: false, hoursAgo: 0, error: 'upload: 403' })
    expect((await runBackupFreshness(new Date())).notified).toEqual([`db:failed:${badB}`])
    expect(sent).toHaveLength(2)
  })
  describe('scripts/backup/railway-db-backup.sh', async () => {
    const root = resolve(__dirname, '../../..')
    const script = join(root, 'scripts/backup/railway-db-backup.sh')
    const fakeBin = join(root, 'tests/fixtures/backup')
    const SECRET_KEY = 'sk-test-secret-access-key-0042'
    const DB_PASSWORD = 'pw-never-printed-0042'

    /** pg_dump той же major-версии, что тестовый сервер. */
    const [{ v }] = await prisma.$queryRaw<Array<{ v: string }>>`SELECT current_setting('server_version_num') AS v`
    const major = String(Math.floor(Number(v) / 10000))
    const pgBin = [process.env.PG_BIN, `/opt/homebrew/opt/postgresql@${major}/bin`, `/usr/lib/postgresql/${major}/bin`, `/usr/local/opt/postgresql@${major}/bin`]
      .filter((d): d is string => Boolean(d))
      .find((d) => {
        const r = spawnSync(join(d, 'pg_dump'), ['--version'], { encoding: 'utf8' })
        return r.status === 0 && new RegExp(`\\) ${major}\\.`).test(r.stdout)
      })

    let dir = ''
    const bucket = () => join(dir, 's3', 'a360dst', 'db-backups')
    const dbUrl = () => {
      const u = new URL(process.env.TEST_DATABASE_URL!)
      u.password = DB_PASSWORD // локальный сервер с trust-аутентификацией пароль не проверяет
      return u.toString()
    }

    function runScript(extra: Record<string, string> = {}) {
      const res = spawnSync('bash', [script], {
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          NODE_ENV: 'test',
          PATH: `${fakeBin}:${process.env.PATH}`,
          HOME: dir,
          FAKE_RCLONE_ROOT: join(dir, 's3'),
          POSTGRES_PRIVATE_URL: dbUrl(),
          PG_BIN: pgBin!,
          BUCKET: 'db-backups',
          ENDPOINT: 'https://s3.invalid',
          ACCESS_KEY_ID: 'AKIATESTKEYID0042',
          SECRET_ACCESS_KEY: SECRET_KEY,
          REGION: 'auto',
          STORAGE_BUCKET: 'storage-files',
          STORAGE_ENDPOINT: 'https://storage.invalid',
          STORAGE_ACCESS_KEY_ID: 'AKIASTORAGE0042',
          STORAGE_SECRET_ACCESS_KEY: SECRET_KEY,
          BACKUP_WORKDIR: join(dir, 'work'),
          BACKUP_MIN_BYTES: '10000',
          BACKUP_MIN_TABLES: '100',
          ...extra,
        },
      })
      return { status: res.status, out: `${res.stdout}\n${res.stderr}` }
    }

    const journal = () => prisma.$queryRaw<Array<{ kind: string; ok: boolean; bytes: bigint | null; tables: number | null; sha256: string | null; object_key: string | null; error: string | null }>>`
      SELECT kind, ok, bytes, tables, sha256, object_key, error FROM public.ops_backup_runs ORDER BY started_at, kind`
    const ls = (p: string) => (existsSync(p) ? readdirSync(p).sort() : [])

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'a360-backup-test-'))
      mkdirSync(join(dir, 's3', 'a360src', 'storage-files', 'stub', 'documents'), { recursive: true })
      writeFileSync(join(dir, 's3', 'a360src', 'storage-files', 'stub', 'documents', 'contract.pdf'), 'pdf-bytes')
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    it.skipIf(!pgBin)('dumps, checks, uploads runs/ latest monthly, copies Storage and journals both', async () => {
      const r = runScript()
      expect(r.status, r.out).toBe(0)

      const runs = ls(join(bucket(), 'runs'))
      expect(runs).toHaveLength(2)
      const name = runs.find((f) => f.endsWith('.dump'))!
      expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}Z\.dump$/)
      expect(runs).toContain(name.replace('.dump', '.manifest'))

      const manifest = readFileSync(join(bucket(), 'latest.manifest'), 'utf8')
      const field = (k: string) => manifest.match(new RegExp(`^${k.replace(/\./g, '\\.')}=(.*)$`, 'm'))?.[1]
      const sha = field('sha256')!
      expect(readFileSync(join(bucket(), 'latest.sha256'), 'utf8')).toBe(`${sha}  latest.dump\n`)
      expect(readFileSync(join(bucket(), 'latest.dump')).equals(readFileSync(join(bucket(), 'runs', name)))).toBe(true)
      const month = name.slice(0, 7)
      expect(ls(join(bucket(), 'monthly'))).toEqual([`${month}.dump`, `${month}.manifest`])

      const [counts] = await prisma.$queryRaw<Array<{ profiles: bigint; users: bigint }>>`
        SELECT (SELECT count(*) FROM public.profiles) AS profiles, (SELECT count(*) FROM auth.users) AS users`
      expect(field('rows.public.profiles')).toBe(String(counts.profiles))
      expect(field('rows.auth.users')).toBe(String(counts.users))
      expect(Number(field('tables'))).toBeGreaterThan(100)

      expect(readFileSync(join(bucket(), 'storage', 'current', 'stub', 'documents', 'contract.pdf'), 'utf8')).toBe('pdf-bytes')
      // Источник Storage только читается.
      expect(existsSync(join(dir, 's3', 'a360src', 'storage-files', 'stub', 'documents', 'contract.pdf'))).toBe(true)

      const rows = await journal()
      expect(rows).toEqual([
        expect.objectContaining({ kind: 'db', ok: true, sha256: sha, tables: Number(field('tables')), object_key: `runs/${name}`, error: null }),
        expect.objectContaining({ kind: 'storage', ok: true, bytes: BigInt(9), object_key: 'storage/current/', error: null }),
      ])
      expect(rows[0].bytes).toBe(BigInt(field('bytes')!))

      // Ни ключей, ни пароля базы — ни в логах, ни в argv rclone.
      const calls = readFileSync(join(dir, 's3', 'calls.log'), 'utf8')
      for (const secret of [SECRET_KEY, DB_PASSWORD]) {
        expect(r.out).not.toContain(secret)
        expect(calls).not.toContain(secret)
      }
    })

    it.skipIf(!pgBin)('rotation keeps the newest 21 runs and 12 months and never touches foreign names', () => {
      const runsDir = join(bucket(), 'runs')
      const monthlyDir = join(bucket(), 'monthly')
      mkdirSync(runsDir, { recursive: true })
      mkdirSync(monthlyDir, { recursive: true })
      const seeded: string[] = []
      for (let d = 1; d <= 25; d++) {
        const stem = `2025-01-${String(d).padStart(2, '0')}T08Z`
        seeded.push(stem)
        writeFileSync(join(runsDir, `${stem}.dump`), 'old')
        writeFileSync(join(runsDir, `${stem}.manifest`), 'old')
      }
      writeFileSync(join(runsDir, 'notes.txt'), 'keep me')
      writeFileSync(join(runsDir, 'manual-before-migration.dump'), 'keep me')
      for (let m = 1; m <= 13; m++) {
        const ym = m <= 12 ? `2024-${String(m).padStart(2, '0')}` : '2025-01'
        writeFileSync(join(monthlyDir, `${ym}.dump`), 'old')
      }
      mkdirSync(join(bucket(), 'daily'), { recursive: true })
      writeFileSync(join(bucket(), 'daily', 'day-1.dump'), 'old script')

      const r = runScript()
      expect(r.status, r.out).toBe(0)

      const dumps = ls(runsDir).filter((f) => /^\d{4}-\d{2}-\d{2}T\d{2}Z\.dump$/.test(f))
      expect(dumps).toHaveLength(21)
      // Новый запуск + 20 самых свежих из засеянных; 5 старейших ушли вместе с манифестами.
      for (const stem of seeded.slice(0, 5)) {
        expect(ls(runsDir)).not.toContain(`${stem}.dump`)
        expect(ls(runsDir)).not.toContain(`${stem}.manifest`)
      }
      expect(ls(runsDir)).toEqual(expect.arrayContaining(['notes.txt', 'manual-before-migration.dump', `${seeded[5]}.dump`, `${seeded[5]}.manifest`]))

      const months = ls(monthlyDir).filter((f) => f.endsWith('.dump'))
      expect(months).toHaveLength(12)
      expect(months).not.toContain('2024-01.dump')
      expect(months).not.toContain('2024-02.dump')
      expect(ls(join(bucket(), 'daily'))).toEqual(['day-1.dump'])
    })

    it.skipIf(!pgBin)('a failed check: exit 1, nothing uploaded, ok=false with the reason in the journal', async () => {
      const r = runScript({ BACKUP_MIN_TABLES: '100000' })
      expect(r.status, r.out).toBe(1)
      expect(ls(join(bucket(), 'runs'))).toEqual([])
      expect(existsSync(join(bucket(), 'latest.dump'))).toBe(false)
      const rows = await journal()
      const db = rows.find((x) => x.kind === 'db')!
      expect(db).toMatchObject({ ok: false, object_key: null })
      expect(db.error).toMatch(/таблиц .*порог 100000/)
      expect(r.out).not.toContain(DB_PASSWORD)
    })

    it.skipIf(!pgBin)('a failing upload stops the step at once: exit 1, no latest, ok=false names the step', async () => {
      const r = runScript({ FAKE_RCLONE_FAIL: 'copyto', STORAGE_BUCKET: '' })
      expect(r.status, r.out).toBe(1)
      expect(existsSync(join(bucket(), 'latest.dump'))).toBe(false)
      expect(r.out).not.toMatch(/db: latest/)
      const [db] = await journal()
      expect(db).toMatchObject({ kind: 'db', ok: false, object_key: null })
      expect(db.error).toMatch(/загрузка runs\/.*код 7.*AccessDenied/)
    })

    it.skipIf(!pgBin)('VPS push (VPS_BACKUP_HOST): dump first, then the manifest, host key pinned, journalled as vps', async () => {
      const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-material-0042\n-----END OPENSSH PRIVATE KEY-----\n'
      const r = runScript({
        STORAGE_BUCKET: '',
        VPS_BACKUP_HOST: 'backup.example.kz',
        VPS_SSH_KEY_B64: Buffer.from(key).toString('base64'),
        VPS_SSH_KNOWN_HOSTS: 'backup.example.kz ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeHostKey',
        FAKE_RSYNC_DEST: join(dir, 'vps', 'incoming'),
      })
      expect(r.status, r.out).toBe(0)
      const order = readFileSync(join(dir, 'vps', 'order.log'), 'utf8').trim().split('\n')
      expect(order).toHaveLength(2)
      expect(order[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}Z\.dump$/)
      expect(order[1]).toBe(order[0].replace('.dump', '.manifest'))
      expect(readFileSync(join(dir, 'vps', 'seen-key'), 'utf8')).toBe(key)
      expect(readFileSync(join(dir, 'vps', 'rsync.log'), 'utf8')).toContain('a360backup@backup.example.kz:')
      expect(r.out).not.toContain('fake-key-material-0042')
      // Ключ не остаётся на диске после запуска.
      expect(ls(join(dir, 'work'))).toEqual([])
      const rows = await journal()
      expect(rows.map((x) => [x.kind, x.ok])).toEqual([['db', true], ['vps', true]])
      expect(rows[1].object_key).toBe(`vps:${order[0]}`)
    })

    it.skipIf(!pgBin)('the database is unreachable: exit 1, the masked error is journalled nowhere but the log', () => {
      const r = runScript({ POSTGRES_PRIVATE_URL: `postgres://postgres:${DB_PASSWORD}@127.0.0.1:1/none` })
      expect(r.status).toBe(1)
      expect(r.out).not.toContain(DB_PASSWORD)
      expect(r.out).toMatch(/бэкап базы НЕ удался/)
    })

    it.skipIf(!pgBin)('a broken Storage source does not spoil the db backup: exit 2, db ok, storage ok=false', async () => {
      const r = runScript({ STORAGE_BUCKET: 'missing-bucket' })
      expect(r.status, r.out).toBe(2)
      const rows = await journal()
      expect(rows.find((x) => x.kind === 'db')).toMatchObject({ ok: true })
      expect(rows.find((x) => x.kind === 'storage')).toMatchObject({ ok: false })
      expect(rows.find((x) => x.kind === 'storage')!.error).toBeTruthy()
    })
  })
})
