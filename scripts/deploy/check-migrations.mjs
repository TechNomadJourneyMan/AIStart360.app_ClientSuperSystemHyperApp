#!/usr/bin/env node
/**
 * scripts/deploy/check-migrations.mjs — the CI check of migration files (R4-A4, R-019).
 *
 *   node scripts/deploy/check-migrations.mjs [migrations-dir]     (default supabase/migrations)
 *   node scripts/deploy/check-migrations.mjs --write-schema-version
 *        regenerates lib/health/schema-version.ts from supabase/migrations (after adding a migration)
 *
 * What it refuses, with exit 1 and one line per problem:
 *   1. a file in the folder that is not NNN_name.sql (three digits, lower-case snake name) — appliers
 *      sort by name, and an odd name lands in an odd place;
 *   2. two migrations with one number. The 15 old repeats (035 … 091) were applied long ago in their
 *      own order; they stay, listed by FULL FILE NAME in LEGACY_DUPLICATES — a new file with an old
 *      repeated number is refused like any other;
 *   3. a migration numbered ROLLBACK_REQUIRED_FROM (140) or later without its rollback
 *      rollback/<same name>.down.sql (docs/deploy/runbook.md §10);
 *   4. a file in rollback/ that is not <name of an existing migration>.down.sql (a typo there means a
 *      rollback nobody finds when it is needed);
 *   5. (N5-1a, review of wave 1A) lib/health/schema-version.ts whose SHIPPED_MIGRATIONS is not exactly
 *      the files of the folder numbered SHIPPED_FROM (140, the bundle era) or later: /api/health checks
 *      that every one of them is in public.schema_migrations, so a stale or partial list would pass a
 *      database that misses a migration. The file is generated (--write-schema-version) and must be
 *      byte-for-byte what the generator writes. Checked when the folder is the default one (as CI runs
 *      it) or when it is a repository's supabase/migrations with that file next to it.
 * Reads only the folder (and that one source file); no database, no git, no network. Only
 * --write-schema-version writes, and only that one file.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/
export const ROLLBACK_REQUIRED_FROM = 140

/** Numbers used twice or three times before this check existed (R4-AUDIT-A, R-019). Do not extend. */
export const LEGACY_DUPLICATES = Object.freeze({
  '035': ['035_profiles_preferences.sql', '035_telegram_private_bot.sql'],
  '036': ['036_activity_log.sql', '036_telegram_personal_sync.sql'],
  '069': ['069_ai_first_workspace.sql', '069_omnichannel_conversation_ux.sql', '069_repair_survey_answer_steps.sql'],
  '070': ['070_ai_journey_device_sync.sql', '070_metrics_unique_index.sql', '070_omnichannel_owned_send_claims.sql'],
  '071': ['071_omnichannel_honor_context.sql', '071_survey_completed_notice_once.sql'],
  '072': ['072_gri_assessment_drafts.sql', '072_omnichannel_direct_catalog.sql'],
  '073': ['073_giga_crm_core.sql', '073_myhonor_order_notifications.sql'],
  '083': ['083_admin_purge_user.sql', '083_security_hardening.sql'],
  '084': ['084_security_hardening.sql', '084_tenancy_partners_members.sql'],
  '086': ['086_agents_runtime.sql', '086_expert_workspace.sql'],
  '087': ['087_expert_review_drafts.sql', '087_notifications_telegram_approvals.sql'],
  '088': ['088_admin_operations.sql', '088_metrics_provenance_guard.sql'],
  '089': ['089_documents_pipeline.sql', '089_notifications_automation.sql'],
  '090': ['090_analytics.sql', '090_diagnostic_pipeline.sql'],
  '091': ['091_ai_usage.sql', '091_diagnostics_ai_narrative.sql'],
})

/**
 * @param {{ migrations: string[], rollbacks: string[], others?: string[] }} listing
 *   migrations — file names directly in the folder (files only), rollbacks — file names in rollback/,
 *   others — names of sub-folders other than rollback/ (reported).
 * @param {{ legacy?: Record<string, readonly string[]>, rollbackFrom?: number }} [opts]
 * @returns {{ ok: boolean, problems: string[], checked: number }}
 */
export function checkMigrations(listing, opts = {}) {
  const legacy = opts.legacy ?? LEGACY_DUPLICATES
  const rollbackFrom = opts.rollbackFrom ?? ROLLBACK_REQUIRED_FROM
  const problems = []
  /** @type {Map<string, string[]>} */
  const byNumber = new Map()
  const valid = new Set()

  for (const dir of listing.others ?? []) {
    problems.push(`лишняя папка supabase/migrations/${dir}/ — там бывает только rollback/`)
  }
  for (const file of [...listing.migrations].sort()) {
    const m = MIGRATION_NAME.exec(file)
    if (!m) {
      problems.push(`${file}: имя не по образцу NNN_имя.sql (три цифры, имя строчными латинскими буквами, цифрами и _)`)
      continue
    }
    valid.add(file)
    byNumber.set(m[1], [...(byNumber.get(m[1]) ?? []), file])
  }

  for (const [num, files] of [...byNumber].sort(([a], [b]) => a.localeCompare(b))) {
    if (files.length < 2) continue
    const allowed = new Set(legacy[num] ?? [])
    const fresh = files.filter((f) => !allowed.has(f))
    if (fresh.length > 0) {
      problems.push(`номер ${num} повторяется: ${files.join(', ')} — новой миграции нужен свободный номер (${fresh.join(', ')})`)
    }
  }

  const rollbacks = new Set(listing.rollbacks)
  for (const file of valid) {
    const num = Number(file.slice(0, 3))
    if (num < rollbackFrom) continue
    const down = file.replace(/\.sql$/, '.down.sql')
    if (!rollbacks.has(down)) problems.push(`${file}: нет файла отката rollback/${down} (обязателен с ${rollbackFrom})`)
  }
  for (const down of [...listing.rollbacks].sort()) {
    const up = down.endsWith('.down.sql') ? down.replace(/\.down\.sql$/, '.sql') : null
    if (!up || !valid.has(up)) problems.push(`rollback/${down}: нет миграции ${up ?? '(имя не оканчивается на .down.sql)'} — опечатка в имени отката?`)
  }

  return { ok: problems.length === 0, problems, checked: valid.size }
}

/** The newest migration of a listing (highest number; rollbacks and odd names ignored), or null. */
export function newestMigration(files) {
  const valid = files.filter((f) => MIGRATION_NAME.test(f)).sort()
  return valid.length ? valid[valid.length - 1] : null
}

/** Where the build's list of migrations lives, relative to the repository root. */
export const SCHEMA_VERSION_FILE = 'lib/health/schema-version.ts'
/** From this number on every migration is checked by /api/health (the bundle era, with rollbacks). */
export const SHIPPED_FROM = 140
const WRITE_FLAG = '--write-schema-version'

/** The migrations /api/health checks: valid NNN_name.sql numbered SHIPPED_FROM or later, in order. */
export function shippedMigrations(files) {
  return files.filter((f) => MIGRATION_NAME.test(f) && Number(f.slice(0, 3)) >= SHIPPED_FROM).sort()
}

/** The text of lib/health/schema-version.ts for this list (the generator; the check compares with it). */
export function renderSchemaVersion(files) {
  return `/**
 * lib/health/schema-version.ts — the migrations this build ships, from ${SHIPPED_FROM} on (N5-1a; review of wave 1A).
 *
 * GENERATED by \`node scripts/deploy/check-migrations.mjs ${WRITE_FLAG}\` — do not edit by hand.
 *
 * GET /api/health (lib/health/platform.ts) reports \`schema: fail\` when ANY of these files is not recorded
 * in public.schema_migrations: the code went out without its migrations (runbook §4: migrations go before
 * the code). Every file of the bundle era is checked, not only the newest: a database that has the
 * newest but misses an older one of the same bundle is behind too. It is a constant, not a read of
 * supabase/migrations at runtime: the server runs from a build, and what the repository looks like next
 * to it is not something to rely on.
 *
 * Adding a migration → run the command above. CI refuses a stale list twice:
 * scripts/deploy/check-migrations.mjs (the first CI step) and tests/unit/health/schema-version.test.ts.
 */
export const SCHEMA_CHECK_FROM = ${SHIPPED_FROM}

export const SHIPPED_MIGRATIONS = [
${files.map((f) => `  '${f}',`).join('\n')}
] as const

/** The newest migration of the build (staff detail of /api/health). */
export const NEWEST_MIGRATION: string = SHIPPED_MIGRATIONS[SHIPPED_MIGRATIONS.length - 1]
`
}

/**
 * The list and the start number in the source of lib/health/schema-version.ts, or null when absent.
 * @param {string} source
 * @returns {{ from: number | null, files: string[] } | null}
 */
export function parseShippedConstant(source) {
  const list = /SHIPPED_MIGRATIONS\s*=\s*\[([^\]]*)\]/.exec(source)
  if (!list) return null
  const from = /SCHEMA_CHECK_FROM\s*=\s*(\d+)/.exec(source)
  return { from: from ? Number(from[1]) : null, files: [...list[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) }
}

/**
 * Problems of the list in lib/health/schema-version.ts against the folder.
 * @param {string[]} folder  file names in supabase/migrations
 * @param {string} source    the text of lib/health/schema-version.ts
 * @returns {string[]}
 */
export function checkShippedConstant(folder, source) {
  const fix = `запустите node scripts/deploy/check-migrations.mjs ${WRITE_FLAG}`
  const parsed = parseShippedConstant(source)
  if (!parsed) return [`${SCHEMA_VERSION_FILE}: SHIPPED_MIGRATIONS не найден — /api/health не с чем сверять журнал миграций (${fix})`]
  if (parsed.from !== SHIPPED_FROM) {
    return [`${SCHEMA_VERSION_FILE}: SCHEMA_CHECK_FROM = ${parsed.from ?? '?'}, а проверяются миграции с ${SHIPPED_FROM} (${fix})`]
  }
  const expected = shippedMigrations(folder)
  const have = new Set(parsed.files)
  const want = new Set(expected)
  const missing = expected.filter((f) => !have.has(f))
  const extra = parsed.files.filter((f) => !want.has(f))
  const problems = []
  if (missing.length) problems.push(`${SCHEMA_VERSION_FILE}: в SHIPPED_MIGRATIONS нет ${missing.join(', ')} — /api/health не заметит базу без них (${fix})`)
  if (extra.length) problems.push(`${SCHEMA_VERSION_FILE}: в SHIPPED_MIGRATIONS лишняя ${extra.join(', ')} — такой миграции в папке нет (${fix})`)
  if (!problems.length && source !== renderSchemaVersion(expected)) {
    problems.push(`${SCHEMA_VERSION_FILE}: файл правили руками или не в том порядке (${fix})`)
  }
  return problems
}

/** Reads the folder: files directly in it, files in rollback/, other sub-folders. */
export function listMigrationsDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const migrations = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name)
  const others = entries.filter((e) => e.isDirectory() && e.name !== 'rollback').map((e) => e.name)
  let rollbacks = []
  if (entries.some((e) => e.isDirectory() && e.name === 'rollback')) {
    rollbacks = readdirSync(path.join(dir, 'rollback'), { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
  }
  return { migrations, rollbacks, others }
}

export function main(argv = process.argv.slice(2), { log = console.log, error = console.error, write = writeFileSync } = {}) {
  if (argv[0] === WRITE_FLAG) {
    const dir = 'supabase/migrations'
    const files = shippedMigrations(listMigrationsDir(dir).migrations)
    write(path.resolve(dir, '..', '..', SCHEMA_VERSION_FILE), renderSchemaVersion(files))
    log(`${SCHEMA_VERSION_FILE}: ${files.length} миграций с ${SHIPPED_FROM} (${files[0] ?? '—'} … ${files[files.length - 1] ?? '—'})`)
    return 0
  }
  const dir = argv[0] ?? 'supabase/migrations'
  const listing = listMigrationsDir(dir)
  const result = checkMigrations(listing)
  // N5-1a: the list /api/health compares with the journal. Required for the default folder (CI);
  // for another folder only when it is a repository's supabase/migrations with that file next to it.
  const constant = path.resolve(dir, '..', '..', SCHEMA_VERSION_FILE)
  const inRepo = path.basename(path.resolve(dir)) === 'migrations' && path.basename(path.resolve(dir, '..')) === 'supabase'
  if (argv[0] === undefined || (inRepo && existsSync(constant))) {
    const source = existsSync(constant) ? readFileSync(constant, 'utf8') : ''
    result.problems.push(...checkShippedConstant(listing.migrations, source))
    result.ok = result.problems.length === 0
  }
  if (result.ok) {
    log(`migrations: ${result.checked} файлов, номера уникальны (старые повторы — по списку), откаты с ${ROLLBACK_REQUIRED_FROM} на месте`)
    return 0
  }
  error(`migrations: ${result.problems.length} проблем(ы) в ${dir}:`)
  for (const p of result.problems) error(`  ✗ ${p}`)
  return 1
}

function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))
  } catch {
    return false
  }
}

if (isMainModule()) process.exitCode = main()
