#!/usr/bin/env node
/**
 * scripts/deploy/preflight.mjs — checks before a deploy and the plan of its commands (R4-A4, R-019).
 * The steps themselves and why: docs/deploy/runbook.md.
 *
 *   cd <clean copy of the repo, detached on the commit>      # runbook §5
 *   node scripts/deploy/preflight.mjs --label round4w3 [--since <commit deployed now>]
 *       [--commit <sha>] [--env production|staging] [--base-url <url>] [--no-fetch] [--dir <path>]
 *
 * IT ONLY CHECKS AND PRINTS. It never runs railway, psql, curl against the portal or anything that
 * changes a system: its only outside calls are `git fetch origin main` (skip with --no-fetch), reads
 * of the GitHub check runs and statuses of the commit through `gh api` (GET), and `--version` of the
 * tools. Exit 0 — every check passed and the plan is printed; 1 — a check failed (no plan); 2 — bad
 * arguments.
 *
 * Checks:
 *   tools     git, gh, railway are installed;
 *   tree      `git status --porcelain --untracked-files=all` is empty: `railway up` uploads every file
 *             of the folder that .gitignore does not exclude, so an untracked file would be deployed;
 *   commit    HEAD is the commit to deploy. production: it is origin/main, or the --commit given, which
 *             must be in origin/main (an older one is a warning). staging: the commit is on some origin
 *             branch (CI only runs for pushed commits);
 *   CI        the check run «typecheck · lint · tests …» of .github/workflows/ci.yml is green for that
 *             commit; every other check run and commit status is green too — EXCEPT Vercel, ignored on
 *             purpose and said so in the output (the Vercel account is blocked, prod is on Railway);
 *   window    production: not 03:00–06:00 UTC (refused); warnings just before it and around the
 *             nightly recompute (21:45–23:00 UTC);
 *   migrations with --since: the migrations added between the deployed commit and this one go into
 *             the plan; a CHANGED old migration is refused (its checksum no longer matches the journal).
 *
 * Plain ESM, no dependencies, Node 20+. The logic is in pure functions; `run` and `now` are injected
 * (tests/unit/deploy/preflight.test.ts runs it without git, gh or network).
 */
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROD_BASE_URL = 'https://portal.aistart360.app'
/** The job name in .github/workflows/ci.yml starts with this (the check run is named after the job). */
export const CI_CHECK_PREFIX = 'typecheck · lint · tests'
export const VERCEL = /vercel/i
export const FORBIDDEN_UTC = { from: 3, to: 6 }
const SHA = /^[0-9a-f]{40}$/
const LABEL = /^[a-z0-9][a-z0-9-]{0,40}$/
const MIGRATION = /^supabase\/migrations\/(\d{3}_[a-z0-9_]+\.sql)$/

export class UsageError extends Error {}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = { env: 'production', label: 'deploy', commit: null, since: null, baseUrl: null, fetch: true, dir: '.' }
  const value = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag}: нужно значение`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--env': opts.env = value(i, a); i++; break
      case '--label': opts.label = value(i, a); i++; break
      case '--commit': opts.commit = value(i, a); i++; break
      case '--since': opts.since = value(i, a); i++; break
      case '--base-url': opts.baseUrl = value(i, a); i++; break
      case '--dir': opts.dir = value(i, a); i++; break
      case '--no-fetch': opts.fetch = false; break
      case '-h': case '--help': throw new UsageError('help')
      default: throw new UsageError(`неизвестный аргумент: ${a}`)
    }
  }
  if (opts.env !== 'production' && opts.env !== 'staging') throw new UsageError('--env: production или staging')
  if (!LABEL.test(opts.label)) throw new UsageError('--label: строчные латинские буквы, цифры и дефис (например round4w3)')
  for (const [flag, v] of [['--commit', opts.commit], ['--since', opts.since]]) {
    if (v !== null && !/^[0-9a-f]{7,40}$/i.test(v)) throw new UsageError(`${flag}: SHA коммита (7–40 hex)`)
  }
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
 * The deploy window. production: [03:00, 06:00) UTC is refused; 02:30–03:00 and 21:45–23:00 UTC warn.
 * @returns {{ ok: boolean, warn: boolean, detail: string }}
 */
export function windowCheck(now, env) {
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  const at = `${hh}:${mm} UTC`
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  const forbidden = minutes >= FORBIDDEN_UTC.from * 60 && minutes < FORBIDDEN_UTC.to * 60
  if (env !== 'production') {
    return { ok: true, warn: false, detail: `${at} — staging, окно не ограничено` }
  }
  if (forbidden) return { ok: false, warn: false, detail: `${at} — выкатка на прод запрещена с 03:00 до 06:00 UTC` }
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
  const required = [...latest.values()].filter((r) => r.name.startsWith(CI_CHECK_PREFIX))
  if (required.length === 0) {
    ok = false
    lines.push(`✗ проверки «${CI_CHECK_PREFIX} …» для этого коммита нет (CI не запускался или коммит не запушен)`)
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

/** The JSON of `gh api …` or null. */
function json(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** UTC stamp for file names: 20261116T1801Z. */
export function utcStamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/(\d{2})\d{2}Z$/, '$1Z')
}

/**
 * The deploy plan: commands for a human to run one by one. Nothing here is executed.
 * @param {{ env: string, label: string, sha: string, baseUrl: string | null, stamp: string,
 *           migrations: string[] | null }} ctx  migrations null — unknown (no --since)
 * @returns {string[]}
 */
export function buildPlan(ctx) {
  const { env, label, sha, stamp } = ctx
  const base = ctx.baseUrl ?? '<staging-url>'
  const short = sha.slice(0, 12)
  const e = `-e ${env}`
  const dump = `${env === 'production' ? 'prod' : 'staging'}-before-${label}-${stamp}`
  const L = []
  L.push(`ПЛАН ВЫКАТКИ ${short} → ${env} (${label}). Ничего не выполнено: команды по одной, по docs/deploy/runbook.md.`)
  L.push('')
  L.push('0. Перед выкаткой (runbook §2): «да» PO есть; этот коммит уже проверен на staging; `railway status` — нужный проект и окружение.')
  L.push('   railway link        # проект <project>, окружение ' + env)
  L.push('')
  if (env === 'production') {
    L.push('1. Бэкап (runbook §3), внутри db-tools по частной сети:')
    L.push(`   railway ssh ${e} -s db-tools -- sh -c 'pg_dump "$TGT_URL" -Fc -Z6 -f /tmp/${dump}.dump && ls -l /tmp/${dump}.dump && sha256sum /tmp/${dump}.dump && pg_restore -l /tmp/${dump}.dump | grep -c " TABLE "'`)
    L.push(`   railway ssh ${e} -s db-tools -- sh -c 'base64 -w0 /tmp/${dump}.dump' | tr -d '\\r\\n' | base64 -D > ~/AI-Portal-backups/${dump}.dump`)
    L.push(`   chmod 600 ~/AI-Portal-backups/${dump}.dump && shasum -a 256 ~/AI-Portal-backups/${dump}.dump && pg_restore -l ~/AI-Portal-backups/${dump}.dump | grep -c " TABLE "`)
    L.push('   # сумма и число TABLE совпадают с выводом db-tools — иначе стоп')
  } else {
    L.push('1. Бэкап staging (runbook §3): по желанию — staging пересобирается из прод-дампа (docs/staging/README.md).')
  }
  L.push('')
  if (ctx.migrations === null) {
    L.push('2. Миграции (runbook §4): список не известен — запустите preflight с --since <коммит, который сейчас на проде> или найдите новые файлы supabase/migrations/NNN_*.sql сами.')
  } else if (ctx.migrations.length === 0) {
    L.push('2. Миграции: новых нет.')
  } else {
    const files = ctx.migrations.map((f) => `supabase/migrations/${f}`).join(' ')
    if (env === 'production') {
      L.push(`2. Миграции (runbook §4): ${ctx.migrations.join(', ')}. Сначала журнал staging, потом пакет:`)
      L.push(`   PGPASSWORD="$(cat <файл пароля staging>)" psql "<staging-dsn>" -X -At -c "SELECT file, checksum FROM public.schema_migrations WHERE file IN (${ctx.migrations.map((f) => `'${f}'`).join(', ')})" > /tmp/staging-journal.txt`)
      L.push(`   node scripts/deploy/migrations-bundle.mjs --label ${label} --staging-journal /tmp/staging-journal.txt ${files}`)
      L.push('   # затем две команды railway ssh … db-tools, которые напечатает migrations-bundle (передача + применение)')
    } else {
      L.push(`2. Миграции на staging (runbook §4): ${ctx.migrations.join(', ')}`)
      for (const f of ctx.migrations) L.push(`   STAGING_PG_PASSWORD_FILE=… scripts/staging/apply-migration.sh supabase/migrations/${f}`)
    }
  }
  L.push('')
  L.push('3. Код (runbook §5): из ЭТОЙ папки (дерево чистое, HEAD = коммит выше), оба сервиса из одного дерева:')
  L.push(`   railway up ${e} -s portal --detach -m "${sha} ${label}"`)
  L.push(`   railway up ${e} -s agents --detach -m "${sha} ${label}"`)
  L.push(`   railway deployment list ${e} -s portal --limit 3 --json     # ждать SUCCESS у новой строки (id = deploymentId)`)
  L.push(`   railway deployment list ${e} -s agents --limit 3 --json`)
  L.push('')
  L.push('4. Inngest (runbook §6): регистрация функций в нашем Inngest:')
  L.push(`   curl -fsS -X PUT ${base}/api/inngest          # «modified»: true/false — оба нормально`)
  L.push(`   curl -fsS ${base}/api/inngest                 # function_count как ожидалось`)
  L.push('')
  L.push('5. Smoke (runbook §7), только чтение:')
  L.push(`   node scripts/smoke/post-deploy.mjs --base-url ${base} --expect-deployment <deploymentId portal из шага 3>`)
  L.push(`   railway logs ${e} -s portal --lines 200 ; railway logs ${e} -s agents --lines 200     # без ошибок`)
  L.push('   через 15–20 мин — журнал ops_job_runs (SQL в runbook §7): все задачи ok')
  L.push('')
  L.push(env === 'production'
    ? '6. Записать в отчёт выкатки: коммит, deploymentId portal и agents, имя и сумму бэкапа, миграции. Откат — runbook §9–10.'
    : '6. После проверки на staging: PR → зелёный CI → merge в main → эта же проверка с --env production.')
  return L
}

/** spawnSync wrapper: never throws, never uses a shell. */
export function defaultRun(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error.message) : '') }
}

/**
 * All checks, then the plan if every check passed.
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{ run?: typeof defaultRun, now?: Date }} [deps]
 * @returns {{ ok: boolean, checks: Array<{ name: string, ok: boolean, warn?: boolean, detail: string[] }>, plan: string[] | null, sha: string | null }}
 */
export function runPreflight(opts, deps = {}) {
  const run = deps.run ?? defaultRun
  const now = deps.now ?? new Date()
  const git = (...args) => run('git', ['-C', opts.dir, ...args], opts.dir)
  const checks = []
  const add = (name, ok, detail, warn = false) => { checks.push({ name, ok, warn, detail: Array.isArray(detail) ? detail : [detail] }) }

  // tools
  const missing = ['git', 'gh', 'railway'].filter((t) => run(t, ['--version'], opts.dir).status !== 0)
  add('инструменты', missing.length === 0, missing.length === 0 ? 'git, gh, railway на месте' : `не найдены: ${missing.join(', ')}`)

  // fetch
  if (opts.fetch) {
    const f = git('fetch', '--quiet', 'origin', 'main')
    add('git fetch', f.status === 0, f.status === 0 ? 'origin/main обновлён' : `не удалось: ${f.stderr.trim().split('\n')[0] ?? ''}`)
  } else {
    add('git fetch', true, 'пропущен (--no-fetch): origin/main может быть устаревшим', true)
  }

  // tree
  const st = git('status', '--porcelain', '--untracked-files=all')
  const dirty = st.stdout.split('\n').filter(Boolean)
  if (st.status !== 0) add('чистое дерево', false, `git status не сработал: ${st.stderr.trim()}`)
  else if (dirty.length > 0) {
    add('чистое дерево', false, [
      `${dirty.length} изменённых/новых файлов — railway up загрузит и их:`,
      ...dirty.slice(0, 5).map((l) => `  ${l}`),
      ...(dirty.length > 5 ? [`  … и ещё ${dirty.length - 5}`] : []),
    ])
  } else add('чистое дерево', true, 'нет изменённых и неотслеживаемых файлов')

  // commit
  const head = git('rev-parse', 'HEAD').stdout.trim()
  const originMain = git('rev-parse', '--verify', '--quiet', 'origin/main').stdout.trim()
  let sha = null
  if (opts.commit) {
    const r = git('rev-parse', '--verify', '--quiet', `${opts.commit}^{commit}`)
    sha = r.status === 0 && SHA.test(r.stdout.trim()) ? r.stdout.trim() : null
  } else if (opts.env === 'production') {
    sha = SHA.test(originMain) ? originMain : null
  } else {
    sha = SHA.test(head) ? head : null
  }
  const commitDetail = []
  let commitOk = true
  let commitWarn = false
  if (!sha) {
    commitOk = false
    commitDetail.push(opts.commit ? `коммит ${opts.commit} не найден в этой копии (git fetch?)` : 'не удалось определить коммит (нет origin/main?)')
  } else {
    if (head !== sha) {
      commitOk = false
      commitDetail.push(`HEAD ${head.slice(0, 12) || '?'} ≠ выкатываемому ${sha.slice(0, 12)}: git checkout --detach ${sha}`)
    }
    if (opts.env === 'production') {
      if (!SHA.test(originMain)) {
        commitOk = false
        commitDetail.push('нет origin/main в этой копии')
      } else if (sha !== originMain) {
        const inMain = git('merge-base', '--is-ancestor', sha, 'origin/main').status === 0
        if (!inMain) {
          commitOk = false
          commitDetail.push(`${sha.slice(0, 12)} нет в origin/main — на прод только слитое в main`)
        } else {
          const behind = git('rev-list', '--count', `${sha}..origin/main`).stdout.trim()
          commitWarn = true
          commitDetail.push(`${sha.slice(0, 12)} в origin/main, но старше его на ${behind || '?'} коммит(ов) — точно этот?`)
        }
      }
    } else {
      const remote = git('branch', '-r', '--contains', sha).stdout.split('\n').map((s) => s.trim()).filter(Boolean)
      if (remote.length === 0) {
        commitOk = false
        commitDetail.push(`${sha.slice(0, 12)} нет ни в одной ветке origin — CI его не видел: git push`)
      } else commitDetail.push(`в ${remote.slice(0, 3).join(', ')}`)
    }
    if (commitOk) commitDetail.unshift(`${sha} (HEAD)`)
  }
  add('коммит', commitOk, commitDetail, commitWarn)

  // CI
  if (sha) {
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

  // window
  const w = windowCheck(now, opts.env)
  add('окно', w.ok, w.detail, w.warn)

  // migrations
  let migrations = null
  if (opts.since && sha) {
    const since = git('rev-parse', '--verify', '--quiet', `${opts.since}^{commit}`)
    if (since.status !== 0) {
      add('миграции', false, `--since ${opts.since}: коммит не найден`)
    } else {
      const diff = git('diff', '--name-status', '-M', since.stdout.trim(), sha, '--', 'supabase/migrations')
      const m = migrationsFromDiff(diff.stdout)
      migrations = m.added
      if (diff.status !== 0) add('миграции', false, `git diff не сработал: ${diff.stderr.trim()}`)
      else if (m.changed.length > 0) {
        add('миграции', false, [
          `изменены уже существовавшие миграции: ${m.changed.join(', ')}`,
          'их сумма разойдётся с журналом schema_migrations; изменение схемы — только новой миграцией',
        ])
      } else add('миграции', true, m.added.length ? `новые: ${m.added.join(', ')}` : 'новых нет')
    }
  } else {
    add('миграции', true, 'не определены (нет --since): список в плане — вручную', true)
  }

  const ok = checks.every((c) => c.ok)
  const plan = ok && sha
    ? buildPlan({ env: opts.env, label: opts.label, sha, baseUrl: opts.baseUrl, stamp: utcStamp(now), migrations })
    : null
  return { ok, checks, plan, sha }
}

export function formatChecks(result) {
  const lines = []
  for (const c of result.checks) {
    const mark = !c.ok ? '✗' : c.warn ? '!' : '✓'
    lines.push(`${mark} ${c.name.padEnd(14)} ${c.detail[0] ?? ''}`)
    for (const d of c.detail.slice(1)) lines.push(`  ${''.padEnd(14)} ${d}`)
  }
  return lines
}

const HELP = `node scripts/deploy/preflight.mjs --label <имя выкатки> [--since <коммит на проде>] [--commit <sha>]
    [--env production|staging] [--base-url https://…] [--no-fetch] [--dir <папка копии>]
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
  log(`preflight: ${opts.env}, ${opts.label}`)
  for (const l of formatChecks(result)) log(l)
  log('')
  if (!result.ok) {
    log('ВЫКАТКА ЗАПРЕЩЕНА: исправьте отмеченное ✗ и запустите снова.')
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
