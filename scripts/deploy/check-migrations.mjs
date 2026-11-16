#!/usr/bin/env node
/**
 * scripts/deploy/check-migrations.mjs — the CI check of migration files (R4-A4, R-019).
 *
 *   node scripts/deploy/check-migrations.mjs [migrations-dir]     (default supabase/migrations)
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
 *      rollback nobody finds when it is needed).
 * Reads only the folder; no database, no git, no network.
 */
import { readdirSync, realpathSync } from 'node:fs'
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

export function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  const dir = argv[0] ?? 'supabase/migrations'
  const result = checkMigrations(listMigrationsDir(dir))
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
