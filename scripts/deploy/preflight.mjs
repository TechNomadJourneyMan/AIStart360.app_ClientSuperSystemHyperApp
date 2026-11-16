#!/usr/bin/env node
/**
 * scripts/deploy/preflight.mjs — checks before a deploy and the plan of its commands (R4-A4, R-019).
 * The steps themselves and why: docs/deploy/runbook.md.
 *
 *   production (runbook §2), from a clean copy detached on origin/main:
 *     node scripts/deploy/preflight.mjs --label round4w3 --verified <sha checked locally against staging>
 *         [--since <commit deployed now>] [--staging-journal <file|->] [--commit <sha>] [--allow-drift]
 *         [--base-url <url>] [--no-fetch] [--dir <path>]
 *   rollback, path B (runbook §9) — run from a copy on main, --dir points at the copy on the old commit:
 *     node <copy on main>/scripts/deploy/preflight.mjs --revert --commit <old sha> --dir <deploy copy> --label …
 *   staging (runbook §4), in the working copy of the branch — no PR, push or CI needed:
 *     node scripts/deploy/preflight.mjs --env staging --label … --since <commit deployed now> [--staging-journal <file|->]
 *
 * There is no code deploy to staging: staging is the database and Supabase of the `staging` environment,
 * and the code is checked locally (`next dev` against staging). So `--env staging` checks what is applied
 * to the staging DATABASE, without CI: which new migrations are already in the staging journal with the
 * same checksum, which still need applying, and that none was applied in another version; it prints the
 * migrations to apply and the local check. CI is the gate of the merge and of production, not of staging.
 *
 * IT ONLY CHECKS AND PRINTS. It never runs railway, psql, curl against the portal or anything that
 * changes a system: its only outside calls are `git fetch origin main` (skip with --no-fetch), reads
 * of the GitHub check runs and statuses of the commit through `gh api` (GET, production only), and
 * `--version` of the tools. Exit 0 — every check passed and the plan is printed; 1 — a check failed (no
 * plan); 2 — bad arguments.
 *
 * Checks (production):
 *   tools     git, gh, railway are installed;
 *   tree      `git status --porcelain --untracked-files=all` is empty: `railway up` uploads every file
 *             of the folder that .gitignore does not exclude, so an untracked file would be deployed;
 *   commit    HEAD is the commit to deploy: origin/main, or the --commit given, which must be in
 *             origin/main (an older one is a warning);
 *   CI        the check run «typecheck · lint · tests …» of .github/workflows/ci.yml has concluded
 *             `success` for that commit (skipped / neutral are NOT enough for it); every other check run
 *             and commit status is green too (skipped / neutral fine there) — EXCEPT Vercel, ignored on
 *             purpose and said so in the output (the Vercel account is blocked, prod is on Railway);
 *   verified  production deploys the merge commit of origin/main, staging checks saw the branch head:
 *             `git diff --name-only <verified> <commit> -- . ':!docs' ':!*.md'` must be empty — the code
 *             going out is the code that was checked. Different files → refused with their list, or
 *             --allow-drift (a loud warning). Not asked with --revert;
 *   window    not 03:00–06:00 UTC (refused; with --revert only a warning); warnings just before it and
 *             around the nightly recompute (21:45–23:00 UTC);
 *   migrations with --since: the migrations added between the deployed commit and this one go into
 *             the plan; a CHANGED old migration is refused (its checksum no longer matches the journal).
 *             With --staging-journal each must be in the staging journal with the checksum of its bytes.
 *
 * Plain ESM, no dependencies, Node 20+. The logic is in pure functions; `run`, `now` and file reads are
 * injected (tests/unit/deploy/preflight.test.ts runs it without git, gh or network).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseJournal } from './migrations-bundle.mjs'

export const PROD_BASE_URL = 'https://portal.aistart360.app'
/** The local dev server of runbook §4 (.claude/launch.json: `npm run dev -- -H 127.0.0.1`). */
export const LOCAL_BASE_URL = 'http://127.0.0.1:3000'
/** The job name in .github/workflows/ci.yml starts with this (the check run is named after the job). */
export const CI_CHECK_PREFIX = 'typecheck · lint · tests'
export const VERCEL = /vercel/i
export const FORBIDDEN_UTC = { from: 3, to: 6 }
/** What may differ between the verified commit and the deployed one: documents only. */
export const DRIFT_PATHSPEC = ['.', ':!docs', ':!*.md']
/** The repository this script runs from: the plan calls the smoke from here (runbook §9, a copy on main). */
const TOOLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHA = /^[0-9a-f]{40}$/
const LABEL = /^[a-z0-9][a-z0-9-]{0,40}$/
const MIGRATION = /^supabase\/migrations\/(\d{3}_[a-z0-9_]+\.sql)$/

export class UsageError extends Error {}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = {
    env: 'production', label: 'deploy', commit: null, since: null, verified: null, allowDrift: false, revert: false,
    stagingJournal: null, baseUrl: null, fetch: true, dir: '.',
  }
  const value = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || (v.startsWith('--') && v !== '-')) throw new UsageError(`${flag}: нужно значение`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--env': opts.env = value(i, a); i++; break
      case '--label': opts.label = value(i, a); i++; break
      case '--commit': opts.commit = value(i, a); i++; break
      case '--since': opts.since = value(i, a); i++; break
      case '--verified': opts.verified = value(i, a); i++; break
      case '--staging-journal': opts.stagingJournal = value(i, a); i++; break
      case '--base-url': opts.baseUrl = value(i, a); i++; break
      case '--dir': opts.dir = value(i, a); i++; break
      case '--allow-drift': opts.allowDrift = true; break
      case '--revert': opts.revert = true; break
      case '--no-fetch': opts.fetch = false; break
      case '-h': case '--help': throw new UsageError('help')
      default: throw new UsageError(`неизвестный аргумент: ${a}`)
    }
  }
  if (opts.env !== 'production' && opts.env !== 'staging') throw new UsageError('--env: production или staging')
  if (!LABEL.test(opts.label)) throw new UsageError('--label: строчные латинские буквы, цифры и дефис (например round4w3)')
  for (const [flag, v] of [['--commit', opts.commit], ['--since', opts.since], ['--verified', opts.verified]]) {
    if (v !== null && !/^[0-9a-f]{7,40}$/i.test(v)) throw new UsageError(`${flag}: SHA коммита (7–40 hex)`)
  }
  if (opts.env === 'staging') {
    if (opts.revert || opts.verified || opts.allowDrift) throw new UsageError('--revert / --verified / --allow-drift — только для production: кода на staging не выкатывают (runbook §4)')
    if (opts.baseUrl !== null) throw new UsageError('--base-url не для staging: код проверяется локально (runbook §4)')
  }
  if (opts.revert && !opts.commit) throw new UsageError('--revert: укажите --commit <коммит, на который откатываемся>')
  if (opts.allowDrift && !opts.verified) throw new UsageError('--allow-drift: только вместе с --verified')
  if (opts.baseUrl !== null) {
    let u
    try { u = new URL(opts.baseUrl) } catch { throw new UsageError('--base-url: не URL') }
    if (u.protocol !== 'https:') throw new UsageError('--base-url: только https://')
    opts.baseUrl = u.origin
  }
  if (opts.baseUrl === null && opts.env === 'production') opts.baseUrl = PROD_BASE_URL
  return opts
}

/**
 * The deploy window. production: [03:00, 06:00) UTC is refused (with --revert only a warning: an incident
 * does not wait); 02:30–03:00 and 21:45–23:00 UTC warn.
 * @returns {{ ok: boolean, warn: boolean, detail: string }}
 */
export function windowCheck(now, env, { revert = false } = {}) {
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  const at = `${hh}:${mm} UTC`
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  const forbidden = minutes >= FORBIDDEN_UTC.from * 60 && minutes < FORBIDDEN_UTC.to * 60
  if (env !== 'production') {
    return { ok: true, warn: false, detail: `${at} — staging (только база), окно не ограничено` }
  }
  if (forbidden) {
    return revert
      ? { ok: true, warn: true, detail: `${at} — запрещённое окно 03:00–06:00 UTC, но это откат: только если без него хуже` }
      : { ok: false, warn: false, detail: `${at} — выкатка на прод запрещена с 03:00 до 06:00 UTC` }
  }
  if (minutes >= 150 && minutes < 180) {
    return { ok: true, warn: true, detail: `${at} — до запрещённого окна (03:00 UTC) меньше 30 минут: выкатка с проверкой займёт 20–30 минут` }
  }
  if (minutes >= 21 * 60 + 45 && minutes < 23 * 60) {
    return { ok: true, warn: true, detail: `${at} — ночной пересчёт Точек А и Б (22:00 UTC): деплой оборвёт идущие разборы, лучше после 23:00` }
  }
  return { ok: true, warn: false, detail: at }
}

/**
 * The CI verdict from the GitHub check runs and the combined status of one commit.
 * The required check (CI_CHECK_PREFIX) passes ONLY with conclusion `success`: a skipped or neutral run
 * means the tests did not run. Other checks may also be skipped / neutral.
 * @param {Array<{ id?: number, name: string, status: string, conclusion: string | null }>} checkRuns
 * @param {Array<{ context: string, state: string }>} statuses
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function evaluateCi(checkRuns, statuses) {
  const lines = []
  let ok = true
  // A re-run leaves the old run in the list: the latest run (highest id) of each name counts.
  /** @type {Map<string, { id?: number, name: string, status: string, conclusion: string | null }>} */
  const latest = new Map()
  for (const run of checkRuns) {
    const prev = latest.get(run.name)
    if (!prev || (run.id ?? 0) > (prev.id ?? 0)) latest.set(run.name, run)
  }
  const isRequired = (name) => name.startsWith(CI_CHECK_PREFIX)
  if (![...latest.values()].some((r) => isRequired(r.name))) {
    ok = false
    lines.push(`✗ проверки «${CI_CHECK_PREFIX} …» для этого коммита нет (CI не запускался: нет PR и не main?)`)
  }
  const GREEN = new Set(['success', 'skipped', 'neutral'])
  for (const run of [...latest.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const state = run.status === 'completed' ? run.conclusion ?? 'unknown' : run.status
    if (VERCEL.test(run.name)) {
      lines.push(`– игнорирую «${run.name}»: ${state} (аккаунт Vercel заблокирован, прод на Railway)`)
      continue
    }
    if (run.status !== 'completed') {
      ok = false
      lines.push(`✗ «${run.name}»: ещё идёт (${run.status}) — дождитесь конца`)
    } else if (isRequired(run.name) && run.conclusion !== 'success') {
      ok = false
      lines.push(`✗ «${run.name}»: ${state} — обязательная проверка должна пройти (success), а не быть пропущенной`)
    } else if (!GREEN.has(run.conclusion ?? '')) {
      ok = false
      lines.push(`✗ «${run.name}»: ${state}`)
    } else {
      lines.push(`✓ «${run.name}»: ${state}`)
    }
  }
  for (const s of [...statuses].sort((a, b) => a.context.localeCompare(b.context))) {
    if (VERCEL.test(s.context)) {
      lines.push(`– игнорирую статус «${s.context}»: ${s.state} (аккаунт Vercel заблокирован, прод на Railway)`)
      continue
    }
    if (s.state === 'success') lines.push(`✓ статус «${s.context}»: success`)
    else {
      ok = false
      lines.push(`✗ статус «${s.context}»: ${s.state}`)
    }
  }
  return { ok, lines }
}

/**
 * Migrations between two commits from `git diff --name-status <since> <commit> -- supabase/migrations`.
 * Only top-level NNN_name.sql count (rollbacks are not applied on deploy).
 * @returns {{ added: string[], changed: string[] }}
 */
export function migrationsFromDiff(nameStatus) {
  const added = []
  const changed = []
  for (const line of nameStatus.split('\n')) {
    const parts = line.trim().split('\t')
    if (parts.length < 2) continue
    const code = parts[0][0]
    const file = parts[parts.length - 1]
    const m = MIGRATION.exec(file)
    if (!m) continue
    if (code === 'A' || code === 'C' || (code === 'R' && !MIGRATION.test(parts[1]))) added.push(m[1])
    else if (code === 'M' || code === 'R') changed.push(m[1])
  }
  return { added: added.sort(), changed: changed.sort() }
}

/**
 * The new migrations against the staging journal (file → checksum of the staging copy).
 * @param {Array<{ name: string, sum: string }>} files  the sums of the bytes in this commit
 * @returns {{ applied: string[], missing: string[], different: string[] }}
 */
export function stagingState(files, journal) {
  const applied = []
  const missing = []
  const different = []
  for (const f of files) {
    const st = journal.get(f.name)
    if (!st) missing.push(f.name)
    else if (st !== f.sum) different.push(f.name)
    else applied.push(f.name)
  }
  return { applied, missing, different }
}

/** The JSON of `gh api …` or null. */
function json(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** UTC stamp for file names: 20261116T1801Z. */
export function utcStamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/(\d{2})\d{2}Z$/, '$1Z')
}

/**
 * The plan: commands for a human to run one by one. Nothing here is executed.
 * @param {{ env: string, label: string, sha: string, baseUrl: string | null, stamp: string,
 *           migrations: string[] | null, toApply?: string[] | null, verified?: string | null, revert?: boolean,
 *           dir?: string, tools?: string }} ctx
 *   migrations null — unknown (no --since); toApply (staging) — those not yet in the staging journal
 * @returns {string[]}
 */
export function buildPlan(ctx) {
  return ctx.env === 'staging' ? stagingPlan(ctx) : productionPlan(ctx)
}

function stagingPlan(ctx) {
  const { label, sha } = ctx
  const short = sha.slice(0, 12)
  const tools = ctx.tools ?? '.'
  const L = []
  L.push(`ПЛАН ПРОВЕРКИ ${short} НА STAGING (${label}). Ничего не выполнено: команды по одной, по docs/deploy/runbook.md §4.`)
  L.push('Кода на staging не выкатывают: staging — это база и Supabase окружения staging, код проверяется локально.')
  L.push('')
  const apply = ctx.toApply ?? ctx.migrations
  if (ctx.migrations === null) {
    L.push('1. Миграции на staging-базу: список не известен — укажите --since <коммит на проде> или найдите новые supabase/migrations/NNN_*.sql сами:')
    L.push('   STAGING_PG_PASSWORD_FILE=<файл пароля> scripts/staging/apply-migration.sh supabase/migrations/<файл>')
  } else if (!apply || apply.length === 0) {
    L.push(`1. Миграции на staging-базу: ${ctx.migrations.length ? 'все новые уже применены с теми же суммами' : 'новых нет'}.`)
  } else {
    L.push(`1. Миграции на staging-базу, по порядку (адрес — файл addr рядом с файлом пароля, docs/staging/README.md):`)
    for (const f of apply) L.push(`   STAGING_PG_PASSWORD_FILE=<файл пароля> scripts/staging/apply-migration.sh supabase/migrations/${f}`)
  }
  L.push('')
  L.push('2. Локальная проверка кода против staging (этот коммит, дерево без правок):')
  L.push('   .env.local → staging: NEXT_PUBLIC_SUPABASE_URL / ключи / DATABASE_URL staging, ENABLE_DEV_AUTH_ROUTES=1 (docs/dev-login.md)')
  L.push('   npm run dev -- -H 127.0.0.1')
  L.push(`   браузер ${LOCAL_BASE_URL}: панель DEV → «Войти как роль» (POST /api/dev/login {role}) → пройти изменённый путь каждой ролью`)
  L.push(`   node ${tools}/scripts/smoke/post-deploy.mjs --base-url ${LOCAL_BASE_URL}     # локальный режим: что к dev не применимо — предупреждения`)
  L.push('')
  L.push('3. Дальше: PR → зелёный CI → merge → CI по merge-коммиту → на проде:')
  L.push(`   node scripts/deploy/preflight.mjs --label <label> --verified ${sha} --since <коммит на проде> --staging-journal <журнал staging>`)
  return L
}

function productionPlan(ctx) {
  const { env, label, sha, stamp } = ctx
  const base = ctx.baseUrl ?? PROD_BASE_URL
  const short = sha.slice(0, 12)
  const e = `-e ${env}`
  const dir = ctx.dir ?? '.'
  const tools = ctx.tools ?? '.'
  const dump = `prod-before-${label}-${stamp}`
  const L = []
  if (ctx.revert) {
    L.push(`ПЛАН ОТКАТА на ${short} (${label}). Ничего не выполнено: команды по одной, по docs/deploy/runbook.md §9 (путь Б).`)
    L.push('Схема базы не трогается: если откат кода требует отката миграций — сначала §10.')
  } else {
    L.push(`ПЛАН ВЫКАТКИ ${short} → ${env} (${label}). Ничего не выполнено: команды по одной, по docs/deploy/runbook.md.`)
    if (ctx.verified) L.push(`Проверенный коммит: ${ctx.verified.slice(0, 12)} (локально против staging).`)
  }
  L.push('')
  L.push(`0. Перед выкаткой (runbook §2): «да» PO есть; \`railway status\` в ${dir} — нужный проект и окружение.`)
  L.push('   railway link        # проект <project>, окружение ' + env)
  L.push('')
  if (!ctx.revert) {
    L.push('1. Бэкап (runbook §3), внутри db-tools по частной сети:')
    L.push(`   railway ssh ${e} -s db-tools -- sh -c 'pg_dump "$TGT_URL" -Fc -Z6 -f /tmp/${dump}.dump && ls -l /tmp/${dump}.dump && sha256sum /tmp/${dump}.dump && pg_restore -l /tmp/${dump}.dump | grep -c " TABLE "'`)
    L.push(`   railway ssh ${e} -s db-tools -- sh -c 'base64 -w0 /tmp/${dump}.dump' | tr -d '\\r\\n' | base64 -D > ~/AI-Portal-backups/${dump}.dump`)
    L.push(`   chmod 600 ~/AI-Portal-backups/${dump}.dump && shasum -a 256 ~/AI-Portal-backups/${dump}.dump && pg_restore -l ~/AI-Portal-backups/${dump}.dump | grep -c " TABLE "`)
    L.push('   # сумма и число TABLE совпадают с выводом db-tools — иначе стоп')
    L.push('')
    if (ctx.migrations === null) {
      L.push('2. Миграции (runbook §4): список не известен — запустите preflight с --since <коммит, который сейчас на проде> или найдите новые файлы supabase/migrations/NNN_*.sql сами.')
    } else if (ctx.migrations.length === 0) {
      L.push('2. Миграции: новых нет.')
    } else {
      const files = ctx.migrations.map((f) => `supabase/migrations/${f}`).join(' ')
      L.push(`2. Миграции (runbook §4): ${ctx.migrations.join(', ')}. Журнал staging, потом пакет:`)
      L.push(`   PGPASSWORD="$(cat <файл пароля staging>)" psql "<staging-dsn>" -X -At -c "SELECT file, checksum FROM public.schema_migrations WHERE file IN (${ctx.migrations.map((f) => `'${f}'`).join(', ')})" > /tmp/staging-journal.txt`)
      L.push(`   node ${tools}/scripts/deploy/migrations-bundle.mjs --label ${label} --staging-journal /tmp/staging-journal.txt ${files}`)
      L.push('   # затем две команды railway ssh … db-tools, которые напечатает migrations-bundle (передача + применение)')
    }
    L.push('')
  }
  L.push(`${ctx.revert ? '1' : '3'}. Код (runbook §5): из папки ${dir} (дерево чистое, HEAD = коммит выше), оба сервиса из одного дерева:`)
  L.push(`   cd ${dir}`)
  L.push(`   railway up ${e} -s portal --detach -m "${sha} ${label}"`)
  L.push(`   railway up ${e} -s agents --detach -m "${sha} ${label}"`)
  L.push(`   railway deployment list ${e} -s portal --limit 3 --json     # ждать SUCCESS у новой строки (id = deploymentId)`)
  L.push(`   railway deployment list ${e} -s agents --limit 3 --json`)
  L.push('')
  L.push(`${ctx.revert ? '2' : '4'}. Inngest (runbook §6): регистрация функций в нашем Inngest:`)
  L.push(`   curl -fsS -X PUT ${base}/api/inngest          # «modified»: true/false — оба нормально`)
  L.push(`   curl -fsS ${base}/api/inngest                 # function_count как ожидалось`)
  L.push('')
  L.push(`${ctx.revert ? '3' : '5'}. Smoke (runbook §7), только чтение, скрипт — из копии на main:`)
  L.push(`   node ${tools}/scripts/smoke/post-deploy.mjs --base-url ${base} --expect-deployment <deploymentId portal из шага ${ctx.revert ? '1' : '3'}>`)
  if (ctx.revert) L.push('   # у кода до R4-A4 в /api/healthz нет deploymentId — будет предупреждение, а не провал; сверка — railway deployment list')
  L.push(`   railway logs ${e} -s portal --lines 200 ; railway logs ${e} -s agents --lines 200     # без ошибок`)
  L.push('   через 15–20 мин — журнал ops_job_runs (SQL в runbook §7): все задачи ok')
  L.push('')
  L.push(ctx.revert
    ? '4. Записать в отчёт: на какой коммит откатились, deploymentId portal и agents, почему.'
    : '6. Записать в отчёт выкатки: коммит, deploymentId portal и agents, имя и сумму бэкапа, миграции. Откат — runbook §9–10.')
  return L
}

/** spawnSync wrapper: never throws, never uses a shell. */
export function defaultRun(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error.message) : '') }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * All checks, then the plan if every check passed.
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{ run?: typeof defaultRun, now?: Date, readFile?: (p: string) => Buffer, readJournal?: (src: string) => string, tools?: string }} [deps]
 * @returns {{ ok: boolean, checks: Array<{ name: string, ok: boolean, warn?: boolean, detail: string[] }>, plan: string[] | null, sha: string | null }}
 */
export function runPreflight(opts, deps = {}) {
  const run = deps.run ?? defaultRun
  const now = deps.now ?? new Date()
  const readFile = deps.readFile ?? ((p) => readFileSync(p))
  const readJournal = deps.readJournal ?? ((src) => readFileSync(src === '-' ? 0 : src, 'utf8'))
  const prod = opts.env === 'production'
  const git = (...args) => run('git', ['-C', opts.dir, ...args], opts.dir)
  const checks = []
  const add = (name, ok, detail, warn = false) => { checks.push({ name, ok, warn, detail: Array.isArray(detail) ? detail : [detail] }) }

  // tools: staging needs only git (no CI, no railway)
  const tools = prod ? ['git', 'gh', 'railway'] : ['git']
  const missing = tools.filter((t) => run(t, ['--version'], opts.dir).status !== 0)
  add('инструменты', missing.length === 0, missing.length === 0 ? `${tools.join(', ')} на месте` : `не найдены: ${missing.join(', ')}`)

  // fetch
  if (opts.fetch) {
    const f = git('fetch', '--quiet', 'origin', 'main')
    const why = `не удалось: ${f.stderr.trim().split('\n')[0] ?? ''}`
    if (f.status === 0) add('git fetch', true, 'origin/main обновлён')
    else if (prod) add('git fetch', false, why)
    else add('git fetch', true, `${why} — для staging не обязателен`, true)
  } else {
    add('git fetch', true, 'пропущен (--no-fetch): origin/main может быть устаревшим', true)
  }

  // tree
  const st = git('status', '--porcelain', '--untracked-files=all')
  const dirty = st.stdout.split('\n').filter(Boolean)
  const listed = (lines) => [...lines.slice(0, 5).map((l) => `  ${l}`), ...(lines.length > 5 ? [`  … и ещё ${lines.length - 5}`] : [])]
  if (st.status !== 0) add('чистое дерево', false, `git status не сработал: ${st.stderr.trim()}`)
  else if (dirty.length === 0) add('чистое дерево', true, 'нет изменённых и неотслеживаемых файлов')
  else if (prod) add('чистое дерево', false, [`${dirty.length} изменённых/новых файлов — railway up загрузит и их:`, ...listed(dirty)])
  else {
    const dirtyMigrations = dirty.filter((l) => l.slice(3).startsWith('supabase/migrations/'))
    if (dirtyMigrations.length) {
      add('чистое дерево', false, ['миграции не закоммичены — на staging должны уйти байты коммита (их сумма сверяется на проде):', ...listed(dirtyMigrations)])
    } else {
      add('чистое дерево', true, [`${dirty.length} незакоммиченных файлов — проверенным считается коммит, закоммитьте до локальной проверки:`, ...listed(dirty)], true)
    }
  }

  // commit
  const head = git('rev-parse', 'HEAD').stdout.trim()
  const originMain = git('rev-parse', '--verify', '--quiet', 'origin/main').stdout.trim()
  const resolve = (ref) => {
    const r = git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
    return r.status === 0 && SHA.test(r.stdout.trim()) ? r.stdout.trim() : null
  }
  let sha = null
  if (opts.commit) sha = resolve(opts.commit)
  else if (prod) sha = SHA.test(originMain) ? originMain : null
  else sha = SHA.test(head) ? head : null
  const commitDetail = []
  let commitOk = true
  let commitWarn = false
  if (!sha) {
    commitOk = false
    commitDetail.push(opts.commit ? `коммит ${opts.commit} не найден в этой копии (git fetch?)` : 'не удалось определить коммит (нет origin/main?)')
  } else {
    if (head !== sha) {
      commitOk = false
      commitDetail.push(`HEAD ${head.slice(0, 12) || '?'} ≠ ${prod ? 'выкатываемому' : 'проверяемому'} ${sha.slice(0, 12)}: git checkout --detach ${sha}`)
    }
    if (prod) {
      if (!SHA.test(originMain)) {
        commitOk = false
        commitDetail.push('нет origin/main в этой копии')
      } else if (sha !== originMain) {
        const inMain = git('merge-base', '--is-ancestor', sha, 'origin/main').status === 0
        if (!inMain) {
          commitOk = false
          commitDetail.push(`${sha.slice(0, 12)} нет в origin/main — на прод только слитое в main`)
        } else if (!opts.revert) {
          const behind = git('rev-list', '--count', `${sha}..origin/main`).stdout.trim()
          commitWarn = true
          commitDetail.push(`${sha.slice(0, 12)} в origin/main, но старше его на ${behind || '?'} коммит(ов) — точно этот?`)
        } else {
          commitDetail.push('откат на коммит из истории origin/main')
        }
      }
    } else {
      commitDetail.push('staging: ни push, ни PR не нужны — проверяется то, что применено к staging-базе')
    }
    if (commitOk) commitDetail.unshift(`${sha} (HEAD)`)
  }
  add('коммит', commitOk, commitDetail, commitWarn)

  // CI — the gate of the merge and of production, not of staging
  if (!prod) {
    add('CI', true, 'не требуется: staging — база и локальная проверка; CI — до merge и перед продом')
  } else if (sha) {
    const runs = run('gh', ['api', '-H', 'Accept: application/vnd.github+json', `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`], opts.dir)
    const status = run('gh', ['api', '-H', 'Accept: application/vnd.github+json', `repos/{owner}/{repo}/commits/${sha}/status`], opts.dir)
    const runsJson = runs.status === 0 ? json(runs.stdout) : null
    const statusJson = status.status === 0 ? json(status.stdout) : null
    if (!runsJson || !Array.isArray(runsJson.check_runs) || !statusJson || !Array.isArray(statusJson.statuses)) {
      const why = (runs.status !== 0 ? runs.stderr : status.stderr).trim().split('\n')[0] || 'неожиданный ответ'
      add('CI', false, `не удалось прочитать проверки через gh (gh auth status?): ${why}`)
    } else {
      const verdict = evaluateCi(runsJson.check_runs, statusJson.statuses)
      add('CI', verdict.ok, verdict.lines)
    }
  } else {
    add('CI', false, 'не проверен: коммит не определён')
  }

  // verified: the code going out is the code that was checked locally against staging
  if (prod && !opts.revert) {
    if (!opts.verified) {
      add('проверенный код', false, 'укажите --verified <коммит, который проверяли локально против staging> (runbook §2)')
    } else {
      const v = resolve(opts.verified)
      if (!v) add('проверенный код', false, `--verified ${opts.verified}: коммит не найден (git fetch origin <ветка>?)`)
      else if (!sha) add('проверенный код', false, 'не сверен: коммит не определён')
      else {
        const d = git('diff', '--name-only', v, sha, '--', ...DRIFT_PATHSPEC)
        const files = d.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
        if (d.status !== 0) add('проверенный код', false, `git diff не сработал: ${d.stderr.trim()}`)
        else if (files.length === 0) add('проверенный код', true, `код = проверенному ${v.slice(0, 12)} (отличаться могут только docs/ и *.md)`)
        else {
          const list = [...files.slice(0, 10).map((f) => `  ${f}`), ...(files.length > 10 ? [`  … и ещё ${files.length - 10}`] : [])]
          if (opts.allowDrift) {
            add('проверенный код', true, [`!!! ВЫКАТЫВАЕТСЯ НЕ ТОТ КОД, ЧТО ПРОВЕРЯЛИ: ${files.length} файлов отличаются от ${v.slice(0, 12)} (--allow-drift):`, ...list, 'эти изменения на staging и локально не проверены — в отчёт выкатки'], true)
          } else {
            add('проверенный код', false, [`${files.length} файлов отличаются от проверенного ${v.slice(0, 12)} — в main попало непроверенное:`, ...list, 'проверьте локально против staging этот коммит или осознанно --allow-drift'])
          }
        }
      }
    }
  }

  // window
  const w = windowCheck(now, opts.env, { revert: opts.revert })
  add('окно', w.ok, w.detail, w.warn)

  // migrations
  let migrations = null
  let toApply = null
  if (opts.revert) {
    add('миграции', true, 'откат кода: схему не трогает (runbook §9–10)')
  } else if (opts.since && sha) {
    const since = resolve(opts.since)
    if (!since) {
      add('миграции', false, `--since ${opts.since}: коммит не найден`)
    } else {
      const diff = git('diff', '--name-status', '-M', since, sha, '--', 'supabase/migrations')
      const m = migrationsFromDiff(diff.stdout)
      migrations = m.added
      if (diff.status !== 0) add('миграции', false, `git diff не сработал: ${diff.stderr.trim()}`)
      else if (m.changed.length > 0) {
        add('миграции', false, [
          `изменены уже существовавшие миграции: ${m.changed.join(', ')}`,
          'их сумма разойдётся с журналом schema_migrations; изменение схемы — только новой миграцией',
        ])
      } else if (m.added.length === 0) {
        add('миграции', true, 'новых нет')
      } else if (!opts.stagingJournal) {
        add('миграции', true, [`новые: ${m.added.join(', ')}`, prod
          ? 'с журналом staging не сверены (нет --staging-journal) — сверит migrations-bundle (runbook §4)'
          : 'журнала staging нет (--staging-journal) — в плане применить все'], true)
      } else {
        // HEAD = sha and the migrations are committed (checked above): the bytes on disk are the commit's.
        let journal = null
        let files = null
        try {
          journal = parseJournal(readJournal(opts.stagingJournal))
          files = m.added.map((f) => ({ name: f, sum: sha256(readFile(path.join(opts.dir, 'supabase', 'migrations', f))) }))
        } catch (e) {
          add('миграции', false, `журнал staging или файл миграции не прочитан: ${e instanceof Error ? e.message : e}`)
        }
        if (journal && files) {
          const s = stagingState(files, journal)
          toApply = s.missing
          const detail = [
            ...s.applied.map((f) => `✓ ${f}: на staging, сумма та же`),
            ...s.missing.map((f) => `${prod ? '✗' : '→'} ${f}: на staging не применена${prod ? ' — сначала staging (runbook §4)' : ' — в плане'}`),
            ...s.different.map((f) => `✗ ${f}: на staging применена другая версия файла — сумма не совпадает`),
          ]
          add('миграции', s.different.length === 0 && (!prod || s.missing.length === 0), detail)
        }
      }
    }
  } else {
    add('миграции', true, 'не определены (нет --since): список в плане — вручную', true)
  }

  const ok = checks.every((c) => c.ok)
  const plan = ok && sha
    ? buildPlan({
        env: opts.env, label: opts.label, sha, baseUrl: opts.baseUrl, stamp: utcStamp(now), migrations, toApply,
        verified: opts.verified, revert: opts.revert, dir: opts.dir === '.' ? '.' : path.resolve(opts.dir), tools: deps.tools ?? TOOLS_ROOT,
      })
    : null
  return { ok, checks, plan, sha }
}

export function formatChecks(result) {
  const lines = []
  for (const c of result.checks) {
    const mark = !c.ok ? '✗' : c.warn ? '!' : '✓'
    lines.push(`${mark} ${c.name.padEnd(16)} ${c.detail[0] ?? ''}`)
    for (const d of c.detail.slice(1)) lines.push(`  ${''.padEnd(16)} ${d}`)
  }
  return lines
}

const HELP = `прод:    node scripts/deploy/preflight.mjs --label <имя> --verified <проверенный коммит> [--since <коммит на проде>]
             [--staging-journal <файл|->] [--commit <sha>] [--allow-drift] [--base-url https://…] [--no-fetch] [--dir <папка>]
откат:   node <копия на main>/scripts/deploy/preflight.mjs --revert --commit <старый sha> --dir <копия для выкатки> --label <имя>
staging: node scripts/deploy/preflight.mjs --env staging --label <имя> [--since <коммит на проде>] [--staging-journal <файл|->]
Только проверяет и печатает план; ничего не выполняет. Подробно — docs/deploy/runbook.md.`

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
  const result = runPreflight(opts, deps)
  log(`preflight: ${opts.env}${opts.revert ? ' (откат)' : ''}, ${opts.label}`)
  for (const l of formatChecks(result)) log(l)
  log('')
  if (!result.ok) {
    log(opts.env === 'staging' ? 'STAGING: исправьте отмеченное ✗ и запустите снова.' : 'ВЫКАТКА ЗАПРЕЩЕНА: исправьте отмеченное ✗ и запустите снова.')
    return 1
  }
  log('Проверки пройдены. ! — предупреждения, прочитайте их.')
  log('')
  for (const l of result.plan ?? []) log(l)
  return 0
}

function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))
  } catch {
    return false
  }
}

if (isMainModule()) process.exitCode = main()
