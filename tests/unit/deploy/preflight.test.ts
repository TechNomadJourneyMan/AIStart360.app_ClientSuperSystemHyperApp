/**
 * scripts/deploy/preflight.mjs — the checks before a deploy and the printed plan (R4-A4, R-019).
 * No git, gh or network here: `run` is a fake that answers the exact commands the script may call
 * and records them, so the tests also prove the script never runs anything that changes a system.
 * Review fixes (R4-W3-REVIEW-B): W3B-2 staging = database + local check, no CI; W3B-4 the required CI
 * check must be `success`; W3B-5 --verified (the code going out = the code checked); W3B-3 --revert.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  DRIFT_PATHSPEC,
  PROD_BASE_URL,
  UsageError,
  buildPlan,
  evaluateCi,
  main,
  migrationsFromDiff,
  parseArgs,
  runPreflight,
  stagingState,
  utcStamp,
  windowCheck,
} from '../../../scripts/deploy/preflight.mjs'

const SHA = '91b68374aa0e1f2b3c4d5e6f708192a3b4c5d6e7'
const OLD = '0aa6f3ab11223344556677889900aabbccddeeff'
const BRANCH = 'b3c4d5e6f708192a3b4c5d6e791b68374aa0e1f2' // the branch head checked locally against staging
const DAY = new Date('2026-11-17T10:15:00Z')
const CI_NAME = 'typecheck · lint · tests (with prod-mirror DB)'
const TOOLS = '/tools'
const MIG_A = '-- 155\nCREATE TABLE IF NOT EXISTS public.t155 (id int);\n'
const sum = (s: string) => createHash('sha256').update(s).digest('hex')

type Res = { status: number | null; stdout: string; stderr: string }
const ok = (stdout = ''): Res => ({ status: 0, stdout, stderr: '' })
const fail = (stderr = 'boom', status: number | null = 1): Res => ({ status, stdout: '', stderr })

interface World {
  head?: string
  originMain?: string
  porcelain?: string
  checkRuns?: unknown[]
  statuses?: unknown[]
  ghFails?: boolean
  inMain?: (sha: string) => boolean
  diff?: string
  drift?: string
  missingTool?: string
  fetchFails?: boolean
}

function fakeRun(w: World = {}) {
  const calls: string[] = []
  const head = w.head ?? SHA
  const originMain = w.originMain ?? SHA
  const known = new Set([SHA, OLD, BRANCH, head, originMain])
  const run = (cmd: string, args: string[]): Res => {
    const line = [cmd, ...args].join(' ')
    calls.push(line)
    if (args[0] === '--version') return w.missingTool === cmd ? fail('not found', null) : ok(`${cmd} 1.0`)
    if (cmd === 'gh') {
      if (w.ghFails) return fail('gh: To get started with GitHub CLI, please run: gh auth login')
      if (args[3].endsWith('/check-runs?per_page=100')) {
        return ok(JSON.stringify({ check_runs: w.checkRuns ?? [{ id: 1, name: CI_NAME, status: 'completed', conclusion: 'success' }] }))
      }
      if (args[3].endsWith('/status')) return ok(JSON.stringify({ statuses: w.statuses ?? [] }))
      return fail('unexpected gh call')
    }
    if (cmd !== 'git') return fail(`unexpected ${cmd}`)
    const g = args.slice(2) // after -C <dir>
    switch (g[0]) {
      case 'fetch': return w.fetchFails ? fail('fatal: unable to access') : ok()
      case 'status': return ok(w.porcelain ?? '')
      case 'rev-parse': {
        if (g[1] === 'HEAD') return ok(`${head}\n`)
        const ref = g[g.length - 1].replace('^{commit}', '')
        if (ref === 'origin/main') return ok(`${originMain}\n`)
        const full = [...known].find((s) => s.startsWith(ref))
        return full ? ok(`${full}\n`) : fail('')
      }
      case 'merge-base': return (w.inMain ?? ((s: string) => s === originMain || s === OLD))(g[2]) ? ok() : fail('', 1)
      case 'rev-list': return ok('3\n')
      case 'diff': return g[1] === '--name-only' ? ok(w.drift ?? '') : ok(w.diff ?? '')
      default: return fail(`unexpected git ${g[0]}`)
    }
  }
  return { run, calls }
}

const deps = (w: World = {}, extra: Record<string, unknown> = {}) => ({ run: fakeRun(w).run, now: DAY, tools: TOOLS, ...extra })
const prod = (extra: string[] = []) => parseArgs(['--label', 'round4w3', '--verified', BRANCH, ...extra])
const staging = (extra: string[] = []) => parseArgs(['--env', 'staging', '--label', 'w3', ...extra])
const check = (r: { checks: Array<{ name: string }> }, name: string) =>
  r.checks.find((c) => c.name === name) as { name: string; ok: boolean; warn?: boolean; detail: string[] }

describe('parseArgs', () => {
  it('defaults: production, the prod domain, fetch on', () => {
    expect(prod()).toMatchObject({ env: 'production', label: 'round4w3', baseUrl: PROD_BASE_URL, fetch: true, commit: null, since: null, verified: BRANCH })
  })

  it('https only; the URL is reduced to its origin', () => {
    expect(parseArgs(['--base-url', 'https://p.example.test/x?y=1']).baseUrl).toBe('https://p.example.test')
    expect(() => parseArgs(['--base-url', 'http://portal.example.test'])).toThrow(UsageError)
  })

  it('refuses bad input', () => {
    expect(() => parseArgs(['--env', 'prod'])).toThrow(/production или staging/)
    expect(() => parseArgs(['--label', 'Round 4'])).toThrow(/--label/)
    expect(() => parseArgs(['--commit', 'main'])).toThrow(/SHA/)
    expect(() => parseArgs(['--verified', 'HEAD~1'])).toThrow(/SHA/)
    expect(() => parseArgs(['--since'])).toThrow(/нужно значение/)
    expect(() => parseArgs(['--yes'])).toThrow(/неизвестный аргумент/)
  })

  it('staging has no code deploy: no URL, no --verified / --revert; --revert needs --commit; --allow-drift needs --verified', () => {
    expect(() => parseArgs(['--env', 'staging', '--base-url', 'https://stg.example.test'])).toThrow(/локально/)
    expect(() => parseArgs(['--env', 'staging', '--verified', BRANCH])).toThrow(/только для production/)
    expect(() => parseArgs(['--revert'])).toThrow(/--commit/)
    expect(() => parseArgs(['--allow-drift'])).toThrow(/--verified/)
    expect(parseArgs(['--staging-journal', '-']).stagingJournal).toBe('-')
  })
})

describe('windowCheck', () => {
  const at = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00Z`)
  it('production: 03:00–06:00 UTC is refused, the edges are exact', () => {
    expect(windowCheck(at('03:00'), 'production').ok).toBe(false)
    expect(windowCheck(at('05:59'), 'production').ok).toBe(false)
    expect(windowCheck(at('06:00'), 'production')).toMatchObject({ ok: true, warn: false })
    expect(windowCheck(at('02:59'), 'production')).toMatchObject({ ok: true, warn: true })
    expect(windowCheck(at('02:29'), 'production')).toMatchObject({ ok: true, warn: false })
  })

  it('production: around the nightly recompute — a warning, not a refusal', () => {
    expect(windowCheck(at('22:10'), 'production')).toMatchObject({ ok: true, warn: true })
    expect(windowCheck(at('23:00'), 'production')).toMatchObject({ ok: true, warn: false })
  })

  it('a rollback in the forbidden window only warns; staging is not limited', () => {
    expect(windowCheck(at('04:00'), 'production', { revert: true })).toMatchObject({ ok: true, warn: true })
    expect(windowCheck(at('04:00'), 'staging')).toMatchObject({ ok: true, warn: false })
  })
})

describe('evaluateCi', () => {
  const green = { id: 5, name: CI_NAME, status: 'completed', conclusion: 'success' }

  it('green CI + red Vercel check run and status → ok, and Vercel is ignored out loud', () => {
    const v = evaluateCi(
      [green, { id: 6, name: 'Vercel', status: 'completed', conclusion: 'failure' }],
      [{ context: 'Vercel – aistart360', state: 'failure' }],
    )
    expect(v.ok).toBe(true)
    expect(v.lines.filter((l: string) => l.startsWith('– игнорирую'))).toHaveLength(2)
    expect(v.lines.join('\n')).toContain('аккаунт Vercel заблокирован')
  })

  it('no CI check run for the commit → refused', () => {
    expect(evaluateCi([], []).ok).toBe(false)
    expect(evaluateCi([{ id: 1, name: 'Vercel', status: 'completed', conclusion: 'success' }], []).ok).toBe(false)
  })

  it('W3B-4: the required check skipped or neutral → refused (the tests did not run)', () => {
    for (const conclusion of ['skipped', 'neutral']) {
      const v = evaluateCi([{ ...green, conclusion }], [])
      expect(v.ok).toBe(false)
      expect(v.lines[0]).toContain('обязательная проверка должна пройти')
    }
  })

  it('CI still running, failed, or another red check / status → refused', () => {
    expect(evaluateCi([{ ...green, status: 'in_progress', conclusion: null }], []).ok).toBe(false)
    expect(evaluateCi([{ ...green, conclusion: 'failure' }], []).ok).toBe(false)
    expect(evaluateCi([green, { id: 9, name: 'CodeQL', status: 'completed', conclusion: 'cancelled' }], []).ok).toBe(false)
    expect(evaluateCi([green], [{ context: 'security/snyk', state: 'pending' }]).ok).toBe(false)
  })

  it('a re-run counts, not the run it replaced; OTHER checks may be skipped or neutral', () => {
    expect(evaluateCi([{ ...green, id: 1, conclusion: 'failure' }, { ...green, id: 2 }], []).ok).toBe(true)
    expect(evaluateCi([green, { id: 3, name: 'optional', status: 'completed', conclusion: 'skipped' }], []).ok).toBe(true)
    expect(evaluateCi([green, { id: 4, name: 'labeler', status: 'completed', conclusion: 'neutral' }], []).ok).toBe(true)
  })
})

describe('migrationsFromDiff / stagingState', () => {
  it('added top-level migrations go to the plan, changed ones are reported, rollbacks ignored', () => {
    const out = migrationsFromDiff([
      'A\tsupabase/migrations/156_b.sql',
      'A\tsupabase/migrations/155_a.sql',
      'A\tsupabase/migrations/rollback/155_a.down.sql',
      'M\tsupabase/migrations/150_point_a_ai_review.sql',
      'R100\tsupabase/migrations/157_old_name.sql\tsupabase/migrations/157_new_name.sql',
      'D\tsupabase/migrations/011_gone.sql',
      '',
    ].join('\n'))
    expect(out).toEqual({ added: ['155_a.sql', '156_b.sql'], changed: ['150_point_a_ai_review.sql', '157_new_name.sql'] })
  })

  it('applied with the same sum / not applied / applied in another version', () => {
    const s = stagingState(
      [{ name: '155_a.sql', sum: 'a'.repeat(64) }, { name: '156_b.sql', sum: 'b'.repeat(64) }, { name: '157_c.sql', sum: 'c'.repeat(64) }],
      new Map([['155_a.sql', 'a'.repeat(64)], ['157_c.sql', 'f'.repeat(64)]]),
    )
    expect(s).toEqual({ applied: ['155_a.sql'], missing: ['156_b.sql'], different: ['157_c.sql'] })
  })
})

describe('utcStamp', () => {
  it('YYYYMMDDTHHMMZ, as the backup names in the runbook', () => {
    expect(utcStamp(new Date('2026-11-16T18:01:59.123Z'))).toBe('20261116T1801Z')
  })
})

describe('runPreflight — production', () => {
  it('all green: the plan, and nothing but reads was called', () => {
    const { run, calls } = fakeRun()
    const r = runPreflight(prod(), { run, now: DAY, tools: TOOLS })
    expect(r.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.sha).toBe(SHA)
    const plan = r.plan!.join('\n')
    expect(plan).toContain(`railway up -e production -s portal --detach -m "${SHA} round4w3"`)
    expect(plan).toContain(`railway up -e production -s agents --detach -m "${SHA} round4w3"`)
    expect(plan).toContain(`curl -fsS -X PUT ${PROD_BASE_URL}/api/inngest`)
    expect(plan).toContain('prod-before-round4w3-20261117T1015Z.dump')
    expect(plan).toContain(`node ${TOOLS}/scripts/smoke/post-deploy.mjs`)
    expect(plan).toContain(`Проверенный коммит: ${BRANCH.slice(0, 12)}`)
    // what it called: versions, git reads, one fetch, two gh GETs — nothing else
    for (const c of calls) {
      expect(c).toMatch(/^(git|gh|railway) --version$|^git -C \. (fetch --quiet origin main|status|rev-parse|merge-base|rev-list|diff)\b|^gh api -H Accept: application\/vnd\.github\+json repos\/\{owner\}\/\{repo\}\/commits\/[0-9a-f]{40}\/(check-runs\?per_page=100|status)$/)
    }
    expect(calls.some((c) => /railway (up|ssh|deployment)|psql|curl/.test(c))).toBe(false)
    // the drift check compares the verified commit with the deployed one, docs and *.md excluded
    expect(calls).toContain(`git -C . diff --name-only ${BRANCH} ${SHA} -- ${DRIFT_PATHSPEC.join(' ')}`)
  })

  it('a dirty tree (untracked files included) is refused: railway up would upload them', () => {
    const r = runPreflight(prod(), deps({ porcelain: ' M app/page.tsx\n?? notes.txt\n' }))
    expect(r.ok).toBe(false)
    expect(r.plan).toBeNull()
    expect(check(r, 'чистое дерево').detail.join('\n')).toContain('?? notes.txt')
  })

  it('HEAD not on origin/main → refused with the checkout to do', () => {
    const r = runPreflight(prod(), deps({ head: OLD }))
    expect(r.ok).toBe(false)
    expect(check(r, 'коммит').detail.join(' ')).toContain(`git checkout --detach ${SHA}`)
  })

  it('--commit older but in origin/main → allowed with a warning; not in origin/main → refused', () => {
    const older = runPreflight(prod(['--commit', OLD.slice(0, 8)]), deps({ head: OLD }))
    expect(older.ok).toBe(true)
    expect(check(older, 'коммит')).toMatchObject({ ok: true, warn: true })
    expect(older.sha).toBe(OLD)

    const branchOnly = runPreflight(prod(['--commit', OLD]), deps({ head: OLD, inMain: () => false }))
    expect(branchOnly.ok).toBe(false)
    expect(check(branchOnly, 'коммит').detail.join(' ')).toContain('нет в origin/main')
  })

  it('red CI (not Vercel) → refused; a skipped required check → refused (W3B-4); gh not signed in → refused with the hint', () => {
    expect(runPreflight(prod(), deps({ checkRuns: [{ id: 1, name: CI_NAME, status: 'completed', conclusion: 'failure' }] })).ok).toBe(false)
    expect(runPreflight(prod(), deps({ checkRuns: [{ id: 1, name: CI_NAME, status: 'completed', conclusion: 'skipped' }] })).ok).toBe(false)
    const noGh = runPreflight(prod(), deps({ ghFails: true }))
    expect(noGh.ok).toBe(false)
    expect(check(noGh, 'CI').detail[0]).toContain('gh auth status')
  })

  it('W3B-5: without --verified production is refused — the deployed merge commit must be compared with what was checked', () => {
    const r = runPreflight(parseArgs(['--label', 'round4w3']), deps())
    expect(r.ok).toBe(false)
    expect(check(r, 'проверенный код').detail[0]).toContain('--verified')
  })

  it('W3B-5: main moved on after the check (another PR merged) → refused with the files', () => {
    const r = runPreflight(prod(), deps({ drift: 'lib/comm/bot.ts\napp/page.tsx\n' }))
    expect(r.ok).toBe(false)
    expect(r.plan).toBeNull()
    const d = check(r, 'проверенный код').detail.join('\n')
    expect(d).toContain('2 файлов отличаются от проверенного')
    expect(d).toContain('lib/comm/bot.ts')
    expect(d).toContain('--allow-drift')
  })

  it('W3B-5: --allow-drift lets it through with a loud warning; an unknown --verified commit is refused', () => {
    const r = runPreflight(prod(['--allow-drift']), deps({ drift: 'lib/comm/bot.ts\n' }))
    expect(r.ok).toBe(true)
    expect(check(r, 'проверенный код')).toMatchObject({ ok: true, warn: true })
    expect(check(r, 'проверенный код').detail[0]).toContain('!!! ВЫКАТЫВАЕТСЯ НЕ ТОТ КОД')

    const unknown = runPreflight(parseArgs(['--label', 'x', '--verified', 'deadbeef']), deps())
    expect(check(unknown, 'проверенный код')).toMatchObject({ ok: false })
  })

  it('the forbidden window refuses even when everything else is green', () => {
    const r = runPreflight(prod(), deps({}, { now: new Date('2026-11-17T04:30:00Z') }))
    expect(r.ok).toBe(false)
    expect(check(r, 'окно').ok).toBe(false)
  })

  it('a missing tool or a failed fetch refuses', () => {
    expect(runPreflight(prod(), deps({ missingTool: 'railway' })).ok).toBe(false)
    expect(runPreflight(prod(), deps({ fetchFails: true })).ok).toBe(false)
  })

  it('--no-fetch: no fetch call, a warning', () => {
    const { run, calls } = fakeRun()
    const r = runPreflight(prod(['--no-fetch']), { run, now: DAY, tools: TOOLS })
    expect(r.ok).toBe(true)
    expect(calls.some((c) => c.includes(' fetch '))).toBe(false)
    expect(check(r, 'git fetch')).toMatchObject({ ok: true, warn: true })
  })

  it('--since: new migrations go into the bundle command; a changed old migration refuses', () => {
    const added = runPreflight(prod(['--since', OLD]), deps({ diff: 'A\tsupabase/migrations/155_a.sql\nA\tsupabase/migrations/rollback/155_a.down.sql\n' }))
    expect(added.ok).toBe(true)
    expect(check(added, 'миграции')).toMatchObject({ ok: true, warn: true }) // no staging journal given
    const plan = added.plan!.join('\n')
    expect(plan).toContain(`node ${TOOLS}/scripts/deploy/migrations-bundle.mjs --label round4w3 --staging-journal /tmp/staging-journal.txt supabase/migrations/155_a.sql`)
    expect(plan).toContain("WHERE file IN ('155_a.sql')")

    const changed = runPreflight(prod(['--since', OLD]), deps({ diff: 'M\tsupabase/migrations/150_x.sql\n' }))
    expect(changed.ok).toBe(false)
    expect(check(changed, 'миграции').detail[0]).toContain('150_x.sql')
  })

  it('--staging-journal on production: every new migration must be on staging with the sum of its bytes', () => {
    const files = { readFile: () => Buffer.from(MIG_A) }
    const diff = { diff: 'A\tsupabase/migrations/155_a.sql\n' }
    const same = runPreflight(prod(['--since', OLD, '--staging-journal', 'j']), deps(diff, { ...files, readJournal: () => `155_a.sql|${sum(MIG_A)}\n` }))
    expect(same.ok).toBe(true)
    expect(check(same, 'миграции')).toMatchObject({ ok: true, warn: false })

    const absent = runPreflight(prod(['--since', OLD, '--staging-journal', 'j']), deps(diff, { ...files, readJournal: () => '' }))
    expect(absent.ok).toBe(false)
    expect(check(absent, 'миграции').detail[0]).toContain('на staging не применена — сначала staging')

    const other = runPreflight(prod(['--since', OLD, '--staging-journal', 'j']), deps(diff, { ...files, readJournal: () => `155_a.sql|${'0'.repeat(64)}\n` }))
    expect(other.ok).toBe(false)
    expect(check(other, 'миграции').detail[0]).toContain('другая версия')
  })
})

describe('runPreflight — staging is the database, no CI (W3B-2)', () => {
  it('the reviewer’s case: a pushed branch without a PR, no check runs at all → passes, no gh call', () => {
    const { run, calls } = fakeRun({ head: BRANCH, inMain: () => false, checkRuns: [] })
    const r = runPreflight(staging(['--since', OLD]), { run, now: DAY, tools: TOOLS })
    expect(r.ok).toBe(true)
    expect(check(r, 'CI')).toMatchObject({ ok: true })
    expect(check(r, 'CI').detail[0]).toContain('не требуется')
    expect(calls.some((c) => c.startsWith('gh '))).toBe(false)
    expect(calls.some((c) => c.startsWith('railway '))).toBe(false)
    expect(r.sha).toBe(BRANCH)
  })

  it('a branch that is not even pushed passes too; only git is required', () => {
    const r = runPreflight(staging(), deps({ head: BRANCH, missingTool: 'railway' }))
    expect(r.ok).toBe(true)
  })

  it('the plan: migrations to the staging database and the local check — no railway up, no deploy', () => {
    const r = runPreflight(staging(['--since', OLD]), deps({ head: BRANCH, diff: 'A\tsupabase/migrations/155_a.sql\n' }, { now: new Date('2026-11-17T04:00:00Z') }))
    expect(r.ok).toBe(true)
    const plan = r.plan!.join('\n')
    expect(plan).toContain('scripts/staging/apply-migration.sh supabase/migrations/155_a.sql')
    expect(plan).toContain('npm run dev -- -H 127.0.0.1')
    expect(plan).toContain('/api/dev/login')
    expect(plan).toContain(`node ${TOOLS}/scripts/smoke/post-deploy.mjs --base-url http://127.0.0.1:3000`)
    expect(plan).toContain(`--verified ${BRANCH}`)
    expect(plan).not.toMatch(/railway (up|ssh)|pg_dump|-e staging/)
  })

  it('with the staging journal: already applied with the same sum → not in the plan; another version → refused', () => {
    const files = { readFile: () => Buffer.from(MIG_A) }
    const diff = { head: BRANCH, diff: 'A\tsupabase/migrations/155_a.sql\n' }
    const applied = runPreflight(staging(['--since', OLD, '--staging-journal', 'j']), deps(diff, { ...files, readJournal: () => `155_a.sql|${sum(MIG_A)}\n` }))
    expect(applied.ok).toBe(true)
    expect(applied.plan!.join('\n')).toContain('все новые уже применены')
    expect(applied.plan!.join('\n')).not.toContain('apply-migration.sh supabase/migrations/155_a.sql')

    const pending = runPreflight(staging(['--since', OLD, '--staging-journal', 'j']), deps(diff, { ...files, readJournal: () => '' }))
    expect(pending.ok).toBe(true)
    expect(pending.plan!.join('\n')).toContain('apply-migration.sh supabase/migrations/155_a.sql')

    const other = runPreflight(staging(['--since', OLD, '--staging-journal', 'j']), deps(diff, { ...files, readJournal: () => `155_a.sql|${'0'.repeat(64)}\n` }))
    expect(other.ok).toBe(false)
  })

  it('uncommitted migrations refuse (staging must get the committed bytes); other local edits only warn', () => {
    const mig = runPreflight(staging(), deps({ head: BRANCH, porcelain: '?? supabase/migrations/155_a.sql\n' }))
    expect(mig.ok).toBe(false)
    const other = runPreflight(staging(), deps({ head: BRANCH, porcelain: ' M app/page.tsx\n' }))
    expect(other.ok).toBe(true)
    expect(check(other, 'чистое дерево')).toMatchObject({ ok: true, warn: true })
  })
})

describe('runPreflight — rollback, path B (W3B-3)', () => {
  it('--revert --commit <old> --dir <deploy copy>: no --verified, no migrations, the smoke from the tools copy', () => {
    const { run, calls } = fakeRun({ head: OLD })
    const r = runPreflight(parseArgs(['--revert', '--commit', OLD, '--dir', '/deploy', '--label', 'r4w3-revert']), { run, now: DAY, tools: TOOLS })
    expect(r.ok).toBe(true)
    expect(r.sha).toBe(OLD)
    expect(r.checks.find((c: { name: string }) => c.name === 'проверенный код')).toBeUndefined()
    const plan = r.plan!.join('\n')
    expect(plan).toContain('ПЛАН ОТКАТА')
    expect(plan).toContain('cd /deploy')
    expect(plan).toContain(`railway up -e production -s portal --detach -m "${OLD} r4w3-revert"`)
    expect(plan).toContain(`node ${TOOLS}/scripts/smoke/post-deploy.mjs`)
    expect(plan).toContain('нет deploymentId — будет предупреждение')
    expect(plan).not.toContain('pg_dump')
    // git runs against the deploy copy
    expect(calls.filter((c) => c.startsWith('git -C ')).every((c) => c.startsWith('git -C /deploy '))).toBe(true)
  })

  it('a rollback in the forbidden window is allowed with a warning', () => {
    const r = runPreflight(parseArgs(['--revert', '--commit', OLD, '--label', 'x']), deps({ head: OLD }, { now: new Date('2026-11-17T04:30:00Z') }))
    expect(r.ok).toBe(true)
    expect(check(r, 'окно')).toMatchObject({ ok: true, warn: true })
  })
})

describe('buildPlan', () => {
  it('without --since says the migrations are unknown instead of guessing', () => {
    const plan = buildPlan({ env: 'production', label: 'x', sha: SHA, baseUrl: PROD_BASE_URL, stamp: '20261117T1015Z', migrations: null }).join('\n')
    expect(plan).toContain('список не известен')
  })

  it('carries no project or service ids, hosts or ports: services by name, the project as a placeholder', () => {
    for (const env of ['production', 'staging']) {
      const plan = buildPlan({ env, label: 'x', sha: SHA, baseUrl: PROD_BASE_URL, stamp: 's', migrations: ['155_a.sql'] }).join('\n')
      expect(plan).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
      expect(plan).not.toMatch(/rlwy\.net|railway\.internal/)
      if (env === 'production') expect(plan).toContain('<project>')
    }
  })
})

describe('main', () => {
  it('exit 0 with the plan; 1 without it; 2 on bad arguments; --help 0', () => {
    const out: string[] = []
    const log = (l: string) => out.push(l)
    expect(main(['--label', 'round4w3', '--verified', BRANCH], { ...deps(), log })).toBe(0)
    expect(out.join('\n')).toContain('ПЛАН ВЫКАТКИ')

    out.length = 0
    expect(main(['--label', 'round4w3', '--verified', BRANCH], { ...deps({ porcelain: '?? x\n' }), log })).toBe(1)
    expect(out.join('\n')).toContain('ВЫКАТКА ЗАПРЕЩЕНА')
    expect(out.join('\n')).not.toContain('ПЛАН ВЫКАТКИ')

    out.length = 0
    expect(main(['--env', 'staging', '--label', 'w3'], { ...deps({ head: BRANCH }), log })).toBe(0)
    expect(out.join('\n')).toContain('ПЛАН ПРОВЕРКИ')

    expect(main(['--env', 'qa'], { log: () => {} })).toBe(2)
    expect(main(['--help'], { log: () => {} })).toBe(0)
  })
})
