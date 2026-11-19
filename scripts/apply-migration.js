// Apply one Supabase migration file via DIRECT_URL (DATABASE_URL as a fallback).
//
//   node scripts/apply-migration.js <migration_file>                     — a check: target, file, journal
//   node scripts/apply-migration.js <migration_file> --yes               — apply and record
//   node scripts/apply-migration.js <migration_file> --yes --force-checksum
//                                                     — re-apply a file the journal already has, rewriting its row
//
// Loads env from .env.local then .env. THAT FILE MAY POINT AT PRODUCTION: production migrations go
// through the bundle (scripts/deploy/migrations-bundle.mjs, docs/deploy/runbook.md §4) and staging
// through scripts/staging/apply-migration.sh — this script is for a local or test database.
//
// R-058:
//   • the target is printed first as host:port/db and user — the password never;
//   • nothing is applied without --yes (without it: the target, the file, its checksum and what the
//     journal says, then exit 1);
//   • a file already recorded in public.schema_migrations is refused BEFORE anything runs — with the
//     same checksum (it is applied) or another one (the file changed after it was applied); the row is
//     rewritten only with --force-checksum, and the old → new checksum is printed;
//   • a new row is inserted with ON CONFLICT DO NOTHING: nothing is overwritten silently.
//
// Why a one-shot script: this repo has no `supabase` CLI and migrations live as plain SQL in
// supabase/migrations/. We run them as a single multi-statement query through pg's simple-query
// protocol so DO $$...$$ blocks survive intact.
// Exit 0 — applied; 1 — refused / failed / not confirmed; 2 — bad arguments.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

class UsageError extends Error {}

const USAGE = 'Usage: node scripts/apply-migration.js <migration_file> [--yes] [--force-checksum]'

function parseArgs(argv) {
  const opts = { file: null, yes: false, forceChecksum: false }
  for (const a of argv) {
    if (a === '--yes') opts.yes = true
    else if (a === '--force-checksum') opts.forceChecksum = true
    else if (a.startsWith('-')) throw new UsageError(`неизвестный аргумент: ${a}`)
    else if (opts.file) throw new UsageError('один файл миграции за раз')
    else opts.file = a
  }
  if (!opts.file) throw new UsageError('укажите файл миграции')
  return opts
}

/** host:port/db (пользователь u) — the password never. */
function describeTarget(connectionString) {
  try {
    const u = new URL(connectionString)
    const db = decodeURIComponent(u.pathname.replace(/^\//, '')) || '(база по умолчанию)'
    const user = u.username ? decodeURIComponent(u.username) : '(без пользователя)'
    return `${u.hostname}:${u.port || '5432'}/${db} (пользователь ${user}, пароль ***)`
  } catch {
    return '(строка подключения не разобрана — не печатаю её)'
  }
}

function loadEnv(file, env) {
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (env[m[1]] === undefined) env[m[1]] = val
  }
}

/**
 * @param {{ argv: string[], env?: Record<string, string | undefined>, makeClient?: (cs: string) => any,
 *           readFile?: (p: string) => string, exists?: (p: string) => boolean,
 *           log?: (l: string) => void, error?: (l: string) => void, cwd?: string }} o
 * @returns {Promise<number>} exit code
 */
async function run(o) {
  const log = o.log || console.log
  const error = o.error || console.error
  const env = o.env || process.env
  const readFile = o.readFile || ((p) => fs.readFileSync(p, 'utf8'))
  const exists = o.exists || fs.existsSync
  let opts
  try {
    opts = parseArgs(o.argv)
  } catch (e) {
    if (e instanceof UsageError) {
      error(`${e.message}\n${USAGE}`)
      return 2
    }
    throw e
  }

  const absPath = path.isAbsolute(opts.file) ? opts.file : path.resolve(o.cwd || process.cwd(), opts.file)
  if (!exists(absPath)) {
    error(`Migration file not found: ${absPath}`)
    return 1
  }
  const connectionString = env.DIRECT_URL || env.DATABASE_URL
  if (!connectionString) {
    error('Neither DIRECT_URL nor DATABASE_URL is set.')
    return 1
  }

  const file = path.basename(absPath)
  const sql = readFile(absPath)
  const checksum = crypto.createHash('sha256').update(sql).digest('hex')
  log(`Цель:   ${describeTarget(connectionString)}`)
  log(`Файл:   ${file} (sha256 ${checksum.slice(0, 12)})`)

  const client = o.makeClient ? o.makeClient(connectionString) : new (require('pg').Client)({ connectionString })
  await client.connect()
  try {
    // The journal (public.schema_migrations, created by 083): older databases have none.
    const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') AS t`)
    const journal = Boolean(rows[0] && rows[0].t)
    let recorded = null
    if (journal) {
      const r = await client.query('SELECT checksum FROM public.schema_migrations WHERE file = $1', [file])
      recorded = r.rows[0] ? String(r.rows[0].checksum) : null
    }
    if (!journal) log('Журнал: таблицы public.schema_migrations нет (база до 083) — запись не будет сделана')
    else if (!recorded) log('Журнал: файла нет — будет записан')
    else if (recorded === checksum) log(`Журнал: уже применена с той же суммой (${recorded.slice(0, 12)})`)
    else log(`Журнал: записана ДРУГАЯ сумма ${recorded.slice(0, 12)} ≠ ${checksum.slice(0, 12)} — файл менялся после применения`)

    if (recorded && !opts.forceChecksum) {
      error(recorded === checksum
        ? `✗ ${file} уже применена (в журнале та же сумма) — ничего не делаю. Применить заново и переписать строку журнала: --force-checksum --yes`
        : `✗ ${file}: в журнале сумма ${recorded.slice(0, 12)}, у файла ${checksum.slice(0, 12)} — не перезаписываю. Изменение схемы — новой миграцией; если файл осознанно применяется заново: --force-checksum --yes`)
      return 1
    }
    if (!opts.yes) {
      log(`Ничего не применено: проверьте цель выше и запустите с --yes${recorded ? ' --force-checksum' : ''}.`)
      return 1
    }

    log(`→ Applying ${file}`)
    try {
      await client.query(sql)
    } catch (err) {
      error(`✗ Migration failed: ${err.message}`)
      if (err.position) error(`  at position ${err.position}`)
      if (err.detail) error(`  detail: ${err.detail}`)
      if (err.hint) error(`  hint: ${err.hint}`)
      return 1
    }
    log('✓ Migration applied successfully')
    if (!journal) return 0

    const by = env.USER || 'apply-migration.js'
    if (recorded) {
      await client.query(
        `INSERT INTO public.schema_migrations (file, checksum, applied_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (file) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), applied_by = EXCLUDED.applied_by`,
        [file, checksum, by],
      )
      log(`! Журнал ПЕРЕЗАПИСАН (--force-checksum): ${recorded.slice(0, 12)} → ${checksum.slice(0, 12)}`)
      return 0
    }
    const ins = await client.query(
      `INSERT INTO public.schema_migrations (file, checksum, applied_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (file) DO NOTHING`,
      [file, checksum, by],
    )
    if (ins.rowCount === 0) {
      error(`✗ ${file}: строку журнала успел записать кто-то другой — не перезаписываю, сверьте сумму вручную`)
      return 1
    }
    log(`✓ Recorded in schema_migrations (${checksum.slice(0, 12)})`)
    return 0
  } finally {
    await client.end()
  }
}

module.exports = { parseArgs, describeTarget, run, UsageError }

if (require.main === module) {
  const env = { ...process.env }
  loadEnv(path.resolve(__dirname, '..', '.env.local'), env)
  loadEnv(path.resolve(__dirname, '..', '.env'), env)
  run({ argv: process.argv.slice(2), env }).then(
    (code) => { process.exitCode = code },
    (err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    },
  )
}
