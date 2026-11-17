#!/usr/bin/env node
/**
 * scripts/deploy/migrations-bundle.mjs — a bundle of migrations for the production database, applied
 * inside the Railway service `db-tools` over the private network (R4-A4; docs/deploy/runbook.md §4).
 *
 *   node scripts/deploy/migrations-bundle.mjs --label round4w3 \
 *        --staging-journal /tmp/staging-journal.txt  supabase/migrations/155_a.sql supabase/migrations/156_b.sql
 *   node scripts/deploy/migrations-bundle.mjs --rollback --label round4w3-undo \
 *        supabase/migrations/rollback/156_b.down.sql                               (runbook §10)
 *
 * What it does — locally, it never connects to a database or to Railway:
 *   1. checks the files: NNN_name.sql directly in supabase/migrations (with --rollback:
 *      rollback/NNN_name.down.sql), no duplicates, and nothing psql -1 cannot run in one transaction
 *      (BEGIN; / COMMIT; / ROLLBACK; of its own, CREATE INDEX CONCURRENTLY …);
 *   2. sha256 of each file — the same sum scripts/apply-migration.js and scripts/staging/apply-migration.sh
 *      write to public.schema_migrations.checksum;
 *   3. with --staging-journal <file|-> (the output of `psql -At -c "SELECT file, checksum FROM
 *      public.schema_migrations …"` on staging): every file must be in the staging journal with THE SAME
 *      sum — what goes to prod is byte for byte what was tested. Missing or different → refused, no bundle.
 *      Without it the bundle is built with a loud warning;
 *   4. the bundle <out>/<label>-<UTC>.tar.gz: the files, apply.sh and SHA256SUMS (COPYFILE_DISABLE=1, ustar —
 *      no macOS metadata, GNU tar in db-tools reads it without warnings);
 *   5. <out>/<label>-<UTC>.upload.sh — the `railway ssh … db-tools` commands that carry the bundle over
 *      in base64 chunks (an argument of `sh -c` must stay under 128 KB) into a fresh /tmp folder there
 *      and check every sum; and prints the one command that runs apply.sh there.
 * apply.sh (inside db-tools, against $TGT_URL): for each file in order,
 *   psql -X -v ON_ERROR_STOP=1 -1 -f <file> -c "INSERT INTO public.schema_migrations …"
 * — the migration and its journal row in ONE transaction; it stops at the first error (earlier files stay
 * applied, each in its own transaction); at the end prints the journal rows of the bundle. With --rollback:
 * the .down.sql files in reverse order, each with `DELETE FROM public.schema_migrations WHERE file = <its
 * migration>` in the same transaction. No `rm -rf` anywhere.
 *
 * Exit 0 — bundle built; 1 — refused (nothing written); 2 — bad arguments.
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/
export const ROLLBACK_FILE = /^(\d{3})_[a-z0-9_]+\.down\.sql$/
const LABEL = /^[a-z0-9][a-z0-9-]{0,40}$/
const HEX64 = /^[0-9a-f]{64}$/
/** One `sh -c '…'` argument stays well under Linux's 128 KB per-argument limit. */
export const CHUNK = 60_000

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { label: null, stagingJournal: null, out: path.join(tmpdir(), 'a360-migrations'), env: 'production', appliedBy: null, rollback: false, files: [] }
  const value = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || (v.startsWith('--') && v !== '-')) throw new UsageError(`${flag}: нужно значение`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--label': opts.label = value(i, a); i++; break
      case '--staging-journal': opts.stagingJournal = value(i, a); i++; break
      case '--out': opts.out = value(i, a); i++; break
      case '--env': opts.env = value(i, a); i++; break
      case '--applied-by': opts.appliedBy = value(i, a); i++; break
      case '--rollback': opts.rollback = true; break
      case '-h': case '--help': throw new UsageError('help')
      default:
        if (a.startsWith('--')) throw new UsageError(`неизвестный аргумент: ${a}`)
        opts.files.push(a)
    }
  }
  if (!opts.label || !LABEL.test(opts.label)) throw new UsageError('--label: обязателен, строчные латинские буквы, цифры, дефис (например round4w3)')
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(opts.env)) throw new UsageError('--env: имя окружения Railway (production)')
  opts.appliedBy ??= `${opts.label}-db-tools`
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(opts.appliedBy)) throw new UsageError('--applied-by: строчные латинские буквы, цифры, дефис')
  if (opts.files.length === 0) throw new UsageError('укажите файлы миграций')
  if (opts.rollback && opts.stagingJournal) throw new UsageError('--staging-journal не для отката: журнал staging хранит миграции, а не откаты')
  return opts
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * What psql -1 (one transaction around the file and the journal row) cannot carry. Comments and
 * dollar-quoted bodies are not parsed: a plpgsql `BEGIN` has no semicolon and its `END;` is not
 * looked at, so function bodies do not match.
 */
export function transactionProblems(sql) {
  const problems = []
  const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  if (/^\s*(BEGIN|START\s+TRANSACTION)\s*(WORK|TRANSACTION)?\s*;/im.test(code)) problems.push('свой BEGIN;')
  if (/^\s*COMMIT\s*(WORK|TRANSACTION)?\s*;/im.test(code)) problems.push('свой COMMIT;')
  if (/^\s*ROLLBACK\s*(WORK|TRANSACTION)?\s*;/im.test(code)) problems.push('свой ROLLBACK;')
  if (/\b(INDEX|REINDEX)\b[^;]*\bCONCURRENTLY\b/i.test(code)) problems.push('INDEX … CONCURRENTLY (не работает внутри транзакции)')
  if (/^\s*VACUUM\b/im.test(code)) problems.push('VACUUM (не работает внутри транзакции)')
  return problems
}

/**
 * Validates and reads the files, in application order (ascending; --rollback: descending).
 * @returns {{ ok: boolean, problems: string[], files: Array<{ name: string, path: string, sum: string, migration: string }> }}
 */
export function collectFiles(paths, { rollback = false, read = readFileSync, exists = existsSync } = {}) {
  const problems = []
  const files = []
  const seen = new Set()
  for (const p of paths) {
    const name = path.basename(p)
    const parent = path.basename(path.dirname(path.resolve(p)))
    const grand = path.basename(path.dirname(path.dirname(path.resolve(p))))
    const pattern = rollback ? ROLLBACK_FILE : MIGRATION_FILE
    const where = rollback ? parent === 'rollback' && grand === 'migrations' : parent === 'migrations'
    if (!pattern.test(name) || !where) {
      problems.push(`${p}: не ${rollback ? 'supabase/migrations/rollback/NNN_имя.down.sql' : 'supabase/migrations/NNN_имя.sql'}`)
      continue
    }
    if (seen.has(name)) { problems.push(`${name}: указан дважды`); continue }
    seen.add(name)
    if (!exists(p)) { problems.push(`${p}: файла нет`); continue }
    const buf = read(p)
    const tx = transactionProblems(buf.toString('utf8'))
    if (tx.length) problems.push(`${name}: ${tx.join(', ')} — psql -1 применяет файл и запись в журнал одной транзакцией`)
    files.push({ name, path: p, sum: sha256(buf), migration: rollback ? name.replace(/\.down\.sql$/, '.sql') : name })
  }
  files.sort((a, b) => (rollback ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)))
  return { ok: problems.length === 0, problems, files }
}

/**
 * The staging journal as psql prints it: `-At` (`file|checksum`), aligned (` file | checksum `), CSV or
 * whitespace-separated. Lines without a migration name and a 64-hex sum are skipped.
 * @returns {Map<string, string>}
 */
export function parseJournal(text) {
  const out = new Map()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d{3}_[a-z0-9_]+\.sql)\s*[|,;\t ]\s*([0-9a-fA-F]{64})\b/.exec(line)
    if (m) out.set(m[1], m[2].toLowerCase())
  }
  return out
}

/** @returns {{ ok: boolean, lines: string[] }} */
export function compareWithStaging(files, journal) {
  const lines = []
  let ok = true
  for (const f of files) {
    const st = journal.get(f.name)
    if (!st) { ok = false; lines.push(`✗ ${f.name}: нет в журнале staging — сначала staging`) }
    else if (st !== f.sum) { ok = false; lines.push(`✗ ${f.name}: сумма в staging другая (${st.slice(0, 12)} ≠ ${f.sum.slice(0, 12)}) — файл менялся после staging`) }
    else lines.push(`✓ ${f.name}: совпадает со staging (${f.sum.slice(0, 12)})`)
  }
  return { ok, lines }
}

const sqlList = (names) => names.map((n) => `'${n}'`).join(', ')

/** apply.sh, run by `sh` inside db-tools. Names and sums are validated above: safe inside quotes. */
export function applyScript({ files, label, stamp, appliedBy, rollback }) {
  const L = [
    '#!/bin/sh',
    `# ${rollback ? 'Откат' : 'Пакет'} миграций ${label} (${stamp}), собран scripts/deploy/migrations-bundle.mjs.`,
    rollback
      ? '# Откатывает по порядку; каждый откат и удаление строки миграции из public.schema_migrations — одной транзакцией.'
      : '# Применяет по порядку; каждая миграция и её строка в public.schema_migrations — одной транзакцией.',
    '# Останавливается на первой ошибке: предыдущие файлы остаются применёнными. Запуск — внутри db-tools.',
    'set -eu',
    'cd "$(dirname "$0")"',
    ': "${TGT_URL:?TGT_URL не задан: запускайте внутри сервиса db-tools}"',
    'sha256sum -c SHA256SUMS',
  ]
  for (const f of files) {
    const journal = rollback
      ? `DELETE FROM public.schema_migrations WHERE file = '${f.migration}'`
      : `INSERT INTO public.schema_migrations (file, checksum, applied_by) VALUES ('${f.name}', '${f.sum}', '${appliedBy}') ON CONFLICT (file) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), applied_by = EXCLUDED.applied_by`
    L.push(`echo "→ ${f.name}"`)
    L.push(`psql "$TGT_URL" -X -q -v ON_ERROR_STOP=1 -1 -f ${f.name} -c "${journal}"`)
    L.push(`echo "✓ ${f.name} (${f.sum.slice(0, 12)})"`)
  }
  L.push(`psql "$TGT_URL" -X -c "SELECT file, left(checksum, 12) AS checksum, applied_by, applied_at FROM public.schema_migrations WHERE file IN (${sqlList(files.map((f) => f.migration))}) ORDER BY file"`)
  if (rollback) L.push(`echo "откат готов: строк выше быть не должно"`)
  return `${L.join('\n')}\n`
}

/** The upload commands, run on the Mac: carry the bundle over in base64 chunks and verify it. */
export function uploadScript({ base64, tarSum, remoteDir, env }) {
  const ssh = `railway ssh -e ${env} -s db-tools -- sh -c`
  const L = [
    '#!/bin/sh',
    '# Сгенерирован scripts/deploy/migrations-bundle.mjs: передаёт пакет в db-tools и проверяет суммы. Ничего не применяет.',
    '# Проверьте `railway status` (проект и окружение) до запуска. Последняя команда должна напечатать OK для каждого файла.',
    'set -eu',
    `${ssh} 'mkdir -m 700 ${remoteDir} && : > ${remoteDir}/b.b64'`,
  ]
  for (let i = 0; i < base64.length; i += CHUNK) {
    L.push(`${ssh} 'printf %s ${base64.slice(i, i + CHUNK)} >> ${remoteDir}/b.b64'`)
  }
  L.push(`${ssh} 'cd ${remoteDir} && base64 -d b.b64 > b.tgz && echo "${tarSum}  b.tgz" | sha256sum -c && tar xzf b.tgz && sha256sum -c SHA256SUMS && ls -l'`)
  return `${L.join('\n')}\n`
}

export function utcStamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/(\d{2})\d{2}Z$/, '$1Z')
}

/** tar.gz of `names` in `dir`: no macOS metadata, ustar. */
export function makeTar(dir, names, outFile, run = spawnSync) {
  const r = run('tar', ['--format=ustar', '-czf', outFile, '-C', dir, ...names], {
    env: { ...process.env, COPYFILE_DISABLE: '1' }, encoding: 'utf8',
  })
  if (r.error || r.status !== 0) throw new Error(`tar: ${(r.stderr || r.error?.message || '').trim()}`)
}

/**
 * Everything except printing.
 * @returns {{ ok: boolean, lines: string[], bundle?: string, upload?: string, remoteDir?: string, tarSum?: string }}
 */
export function buildBundle(opts, deps = {}) {
  const now = deps.now ?? new Date()
  const readJournal = deps.readJournal ?? ((src) => readFileSync(src === '-' ? 0 : src, 'utf8'))
  const lines = []
  const collected = collectFiles(opts.files, { rollback: opts.rollback })
  if (!collected.ok) return { ok: false, lines: ['ПАКЕТ НЕ СОБРАН:', ...collected.problems.map((p) => `✗ ${p}`)] }
  const { files } = collected

  lines.push(`${opts.rollback ? 'Откат' : 'Миграции'} по порядку применения:`)
  for (const f of files) lines.push(`  ${f.name}  sha256 ${f.sum}`)
  lines.push('')
  if (opts.rollback) {
    lines.push('! Откат: сверки со staging нет — откат проверен тестом и на staging? (runbook §10)')
  } else if (opts.stagingJournal) {
    let journal
    try { journal = parseJournal(readJournal(opts.stagingJournal)) } catch (e) {
      return { ok: false, lines: [...lines, `✗ журнал staging не прочитан: ${e instanceof Error ? e.message : e}`] }
    }
    const cmp = compareWithStaging(files, journal)
    lines.push('Сверка с журналом staging:', ...cmp.lines.map((l) => `  ${l}`))
    if (!cmp.ok) return { ok: false, lines: [...lines, '', 'ПАКЕТ НЕ СОБРАН: на прод идёт только то, что применено на staging теми же байтами.'] }
  } else {
    lines.push('! СВЕРКА СО STAGING НЕ СДЕЛАНА (нет --staging-journal). Без неё не выкатывать: runbook §4.')
  }

  const stamp = utcStamp(now)
  const base = `${opts.label}-${stamp}`
  mkdirSync(opts.out, { recursive: true, mode: 0o700 })
  const work = mkdtempSync(path.join(opts.out, `${base}-`))
  for (const f of files) copyFileSync(f.path, path.join(work, f.name))
  const apply = applyScript({ files, label: opts.label, stamp, appliedBy: opts.appliedBy, rollback: opts.rollback })
  writeFileSync(path.join(work, 'apply.sh'), apply, { mode: 0o755 })
  const sums = [...files.map((f) => `${f.sum}  ${f.name}`), `${sha256(Buffer.from(apply))}  apply.sh`].join('\n') + '\n'
  writeFileSync(path.join(work, 'SHA256SUMS'), sums)
  const bundle = path.join(opts.out, `${base}.tar.gz`)
  ;(deps.makeTar ?? makeTar)(work, [...files.map((f) => f.name), 'apply.sh', 'SHA256SUMS'], bundle)
  const tarBuf = readFileSync(bundle)
  const tarSum = sha256(tarBuf)
  const remoteDir = `/tmp/a360-mig-${base.toLowerCase()}-${(deps.random ?? (() => randomBytes(3).toString('hex')))()}`
  const upload = path.join(opts.out, `${base}.upload.sh`)
  writeFileSync(upload, uploadScript({ base64: tarBuf.toString('base64'), tarSum, remoteDir, env: opts.env }), { mode: 0o700 })

  lines.push('')
  lines.push(`Пакет: ${bundle} (${statSync(bundle).size} байт, sha256 ${tarSum})`)
  lines.push(`Передача в db-tools (только копирует и проверяет суммы): sh ${upload}`)
  lines.push(`Применение (после «OK» от передачи; журнал печатается в конце):`)
  lines.push(`  railway ssh -e ${opts.env} -s db-tools -- sh -c 'sh ${remoteDir}/apply.sh'`)
  lines.push(`applied_by в журнале: ${opts.rollback ? '(строки удаляются)' : opts.appliedBy}`)
  return { ok: true, lines, bundle, upload, remoteDir, tarSum }
}

const HELP = `node scripts/deploy/migrations-bundle.mjs --label <имя> [--staging-journal <файл|->] [--out <папка>]
    [--env production] [--applied-by <имя>] [--rollback] <файлы…>
Собирает пакет миграций для db-tools, ничего не применяет. Подробно — docs/deploy/runbook.md §4, §10.`

export function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? console.log
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    if (e instanceof UsageError) {
      log(e.message === 'help' ? HELP : `${e.message}\n\n${HELP}`)
      return e.message === 'help' ? 0 : 2
    }
    throw e
  }
  const result = buildBundle(opts, deps)
  for (const l of result.lines) log(l)
  return result.ok ? 0 : 1
}

function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))
  } catch {
    return false
  }
}

if (isMainModule()) process.exitCode = main()
