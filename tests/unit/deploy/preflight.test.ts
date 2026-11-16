/**
 * scripts/deploy/preflight.mjs — the checks before a deploy and the printed plan (R4-A4, R-019).
 * No git, gh or network here: `run` is a fake that answers the exact commands the script may call
 * and records them, so the tests also prove the script never runs anything that changes a system.
 */
import { describe, expect, it } from 'vitest'
import {
  PROD_BASE_URL,
  UsageError,
  buildPlan,
  evaluateCi,
  main,
  migrationsFromDiff,
  parseArgs,
  runPreflight,
  utcStamp,
  windowCheck,
} from '../../../scripts/deploy/preflight.mjs'

const SHA = '91b68374aa0e1f2b3c4d5e6f708192a3b4c5d6e7'
const OLD = '0aa6f3ab11223344556677889900aabbccddeeff'
const DAY = new Date('2026-11-17T10:15:00Z')
const CI_NAME = 'typecheck · lint · tests (with prod-mirror DB)'

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
  remoteBranches?: string
  diff?: string
  missingTool?: string
  fetchFails?: boolean
}

function fakeRun(w: World = {}) {
  const calls: string[] = []
  const head = w.head ?? SHA
  const originMain = w.originMain ?? SHA
  const known = new Set([SHA, OLD, head, originMain])
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
      case 'branch': return ok(w.remoteBranches ?? '  origin/claude/round4-entry\n')
      case 'diff': return ok(w.diff ?? '')
      default: return fail(`unexpected git ${g[0]}`)
    }
  }
  return { run, calls }
}

const prod = (extra: string[] = []) => parseArgs(['--label', 'round4w3', ...extra])

describe('parseArgs', () => {
  it('defaults: production, the prod domain, fetch on', () => {
    expect(prod()).toMatchObject({ env: 'production', label: 'round4w3', baseUrl: PROD_BASE_URL, fetch: true, commit: null, since: null })
  })

  it('staging has no default URL; https only; the URL is reduced to its origin', () => {
    expect(parseArgs(['--env', 'staging']).baseUrl).toBeNull()
    expect(parseArgs(['--env', 'staging', '--base-url', 'https://stg.example.test/x?y=1']).baseUrl).toBe('https://stg.example.test')
    expect(() => parseArgs(['--base-url', 'http://portal.example.test'])).toThrow(UsageError)
  })

  it('refuses bad input', () => {
    expect(() => parseArgs(['--env', 'prod'])).toThrow(/production или staging/)
    expect(() => parseArgs(['--label', 'Round 4'])).toThrow(/--label/)
    expect(() => parseArgs(['--commit', 'main'])).toThrow(/SHA/)
    expect(() => parseArgs(['--since'])).toThrow(/нужно значение/)
    expect(() => parseArgs(['--yes'])).toThrow(/неизвестный аргумент/)
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

  it('staging is not limited', () => {
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
    expect(v.lines.filter((l) => l.startsWith('– игнорирую'))).toHaveLength(2)
    expect(v.lines.join('\n')).toContain('аккаунт Vercel заблокирован')
  })

  it('no CI check run for the commit → refused', () => {
    expect(evaluateCi([], []).ok).toBe(false)
    expect(evaluateCi([{ id: 1, name: 'Vercel', status: 'completed', conclusion: 'success' }], []).ok).toBe(false)
  })

  it('CI still running, failed, or another red check / status → refused', () => {
    expect(evaluateCi([{ ...green, status: 'in_progress', conclusion: null }], []).ok).toBe(false)
    expect(evaluateCi([{ ...green, conclusion: 'failure' }], []).ok).toBe(false)
    expect(evaluateCi([green, { id: 9, name: 'CodeQL', status: 'completed', conclusion: 'cancelled' }], []).ok).toBe(false)
    expect(evaluateCi([green], [{ context: 'security/snyk', state: 'pending' }]).ok).toBe(false)
  })

  it('a re-run counts, not the run it replaced; skipped and neutral are fine', () => {
    expect(evaluateCi([{ ...green, id: 1, conclusion: 'failure' }, { ...green, id: 2 }], []).ok).toBe(true)
    expect(evaluateCi([green, { id: 3, name: 'optional', status: 'completed', conclusion: 'skipped' }], []).ok).toBe(true)
  })
})

describe('migrationsFromDiff', () => {
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
})

describe('utcStamp', () => {
  it('YYYYMMDDTHHMMZ, as the backup names in the runbook', () => {
    expect(utcStamp(new Date('2026-11-16T18:01:59.123Z'))).toBe('20261116T1801Z')
  })
})

describe('runPreflight', () => {
  it('all green: the plan, and nothing but reads was called', () => {
    const { run, calls } = fakeRun()
    const r = runPreflight(prod(), { run, now: DAY })
    expect(r.checks.filter((c) => !c.ok)).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.sha).toBe(SHA)
    const plan = r.plan!.join('\n')
    expect(plan).toContain(`railway up -e production -s portal --detach -m "${SHA} round4w3"`)
    expect(plan).toContain(`railway up -e production -s agents --detach -m "${SHA} round4w3"`)
    expect(plan).toContain(`curl -fsS -X PUT ${PROD_BASE_URL}/api/inngest`)
    expect(plan).toContain('prod-before-round4w3-20261117T1015Z.dump')
    expect(plan).toContain('node scripts/smoke/post-deploy.mjs')
    // what it called: versions, git reads, one fetch, two gh GETs — nothing else
    for (const c of calls) {
      expect(c).toMatch(/^(git|gh|railway) --version$|^git -C \. (fetch --quiet origin main|status|rev-parse|merge-base|rev-list|branch|diff)\b|^gh api -H Accept: application\/vnd\.github\+json repos\/\{owner\}\/\{repo\}\/commits\/[0-9a-f]{40}\/(check-runs\?per_page=100|status)$/)
    }
    expect(calls.some((c) => /railway (up|ssh|deployment)|psql|curl/.test(c))).toBe(false)
  })

  it('a dirty tree (untracked files included) is refused: railway up would upload them', () => {
    const { run } = fakeRun({ porcelain: ' M app/page.tsx\n?? notes.txt\n' })
    const r = runPreflight(prod(), { run, now: DAY })
    expect(r.ok).toBe(false)
    expect(r.plan).toBeNull()
    const tree = r.checks.find((c) => c.name === 'чистое дерево')!
    expect(tree.ok).toBe(false)
    expect(tree.detail.join('\n')).toContain('?? notes.txt')
  })

  it('HEAD not on origin/main → refused with the checkout to do', () => {
    const { run } = fakeRun({ head: OLD })
    const r = runPreflight(prod(), { run, now: DAY })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'коммит')!.detail.join(' ')).toContain(`git checkout --detach ${SHA}`)
  })

  it('--commit older but in origin/main → allowed with a warning; not in origin/main → refused', () => {
    const older = runPreflight(prod(['--commit', OLD.slice(0, 8)]), { run: fakeRun({ head: OLD }).run, now: DAY })
    expect(older.ok).toBe(true)
    expect(older.checks.find((c) => c.name === 'коммит')).toMatchObject({ ok: true, warn: true })
    expect(older.sha).toBe(OLD)

    const branchOnly = runPreflight(prod(['--commit', OLD]), { run: fakeRun({ head: OLD, inMain: () => false }).run, now: DAY })
    expect(branchOnly.ok).toBe(false)
    expect(branchOnly.checks.find((c) => c.name === 'коммит')!.detail.join(' ')).toContain('нет в origin/main')
  })

  it('red CI (not Vercel) → refused; gh not signed in → refused with the hint', () => {
    const red = runPreflight(prod(), { run: fakeRun({ checkRuns: [{ id: 1, name: CI_NAME, status: 'completed', conclusion: 'failure' }] }).run, now: DAY })
    expect(red.ok).toBe(false)
    const noGh = runPreflight(prod(), { run: fakeRun({ ghFails: true }).run, now: DAY })
    expect(noGh.ok).toBe(false)
    expect(noGh.checks.find((c) => c.name === 'CI')!.detail[0]).toContain('gh auth status')
  })

  it('the forbidden window refuses even when everything else is green', () => {
    const r = runPreflight(prod(), { run: fakeRun().run, now: new Date('2026-11-17T04:30:00Z') })
    expect(r.ok).toBe(false)
    expect(r.checks.find((c) => c.name === 'окно')!.ok).toBe(false)
  })

  it('a missing tool or a failed fetch refuses', () => {
    expect(runPreflight(prod(), { run: fakeRun({ missingTool: 'railway' }).run, now: DAY }).ok).toBe(false)
    expect(runPreflight(prod(), { run: fakeRun({ fetchFails: true }).run, now: DAY }).ok).toBe(false)
  })

  it('--no-fetch: no fetch call, a warning', () => {
    const { run, calls } = fakeRun()
    const r = runPreflight(prod(['--no-fetch']), { run, now: DAY })
    expect(r.ok).toBe(true)
    expect(calls.some((c) => c.includes(' fetch '))).toBe(false)
    expect(r.checks.find((c) => c.name === 'git fetch')).toMatchObject({ ok: true, warn: true })
  })

  it('--since: new migrations go into the bundle command; a changed old migration refuses', () => {
    const added = runPreflight(prod(['--since', OLD]), {
      run: fakeRun({ diff: 'A\tsupabase/migrations/155_a.sql\nA\tsupabase/migrations/rollback/155_a.down.sql\n' }).run, now: DAY,
    })
    expect(added.ok).toBe(true)
    const plan = added.plan!.join('\n')
    expect(plan).toContain('node scripts/deploy/migrations-bundle.mjs --label round4w3 --staging-journal /tmp/staging-journal.txt supabase/migrations/155_a.sql')
    expect(plan).toContain("WHERE file IN ('155_a.sql')")

    const changed = runPreflight(prod(['--since', OLD]), { run: fakeRun({ diff: 'M\tsupabase/migrations/150_x.sql\n' }).run, now: DAY })
    expect(changed.ok).toBe(false)
    expect(changed.checks.find((c) => c.name === 'миграции')!.detail[0]).toContain('150_x.sql')
  })

  it('staging: HEAD must be pushed; the plan targets staging and applies migrations with the staging script', () => {
    const notPushed = runPreflight(parseArgs(['--env', 'staging', '--label', 'w3']), { run: fakeRun({ remoteBranches: '' }).run, now: DAY })
    expect(notPushed.ok).toBe(false)

    const r = runPreflight(parseArgs(['--env', 'staging', '--label', 'w3', '--since', OLD]), {
      run: fakeRun({ diff: 'A\tsupabase/migrations/155_a.sql\n', inMain: () => false }).run, now: new Date('2026-11-17T04:00:00Z'),
    })
    expect(r.ok).toBe(true)
    const plan = r.plan!.join('\n')
    expect(plan).toContain('railway up -e staging -s portal --detach')
    expect(plan).toContain('scripts/staging/apply-migration.sh supabase/migrations/155_a.sql')
    expect(plan).toContain('<staging-url>/api/inngest')
    expect(plan).not.toContain('pg_dump')
  })
})

describe('buildPlan', () => {
  it('without --since says the migrations are unknown instead of guessing', () => {
    const plan = buildPlan({ env: 'production', label: 'x', sha: SHA, baseUrl: PROD_BASE_URL, stamp: '20261117T1015Z', migrations: null }).join('\n')
    expect(plan).toContain('список не известен')
  })

  it('carries no project or service ids, hosts or ports: services by name, the project as a placeholder', () => {
    const plan = buildPlan({ env: 'production', label: 'x', sha: SHA, baseUrl: PROD_BASE_URL, stamp: 's', migrations: ['155_a.sql'] }).join('\n')
    expect(plan).toContain('<project>')
    expect(plan).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
    expect(plan).not.toMatch(/rlwy\.net|railway\.internal|:\d{4,5}\b/)
  })
})

describe('main', () => {
  it('exit 0 with the plan; 1 without it; 2 on bad arguments; --help 0', () => {
    const out: string[] = []
    const log = (l: string) => out.push(l)
    expect(main(['--label', 'round4w3'], { run: fakeRun().run, now: DAY, log })).toBe(0)
    expect(out.join('\n')).toContain('ПЛАН ВЫКАТКИ')

    out.length = 0
    expect(main(['--label', 'round4w3'], { run: fakeRun({ porcelain: '?? x\n' }).run, now: DAY, log })).toBe(1)
    expect(out.join('\n')).toContain('ВЫКАТКА ЗАПРЕЩЕНА')
    expect(out.join('\n')).not.toContain('ПЛАН ВЫКАТКИ')

    expect(main(['--env', 'qa'], { log: () => {} })).toBe(2)
    expect(main(['--help'], { log: () => {} })).toBe(0)
  })
})
