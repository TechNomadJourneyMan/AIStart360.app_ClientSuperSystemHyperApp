/**
 * scripts/deploy/migrations-bundle.mjs — the bundle of migrations for db-tools (R4-A4).
 * Real files in a temp folder and the system `tar`; no database and no Railway: apply.sh is run with a
 * stub `psql` (and `sha256sum`) that records its arguments, the upload script is only parsed.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHUNK,
  UsageError,
  applyScript,
  buildBundle,
  collectFiles,
  compareWithStaging,
  main,
  parseArgs,
  parseJournal,
  transactionProblems,
  uploadScript,
} from '../../../scripts/deploy/migrations-bundle.mjs'

const NOW = new Date('2026-11-17T10:15:42Z')
const A = '-- 155\nCREATE TABLE IF NOT EXISTS public.t155 (id int);\nDO $$\nBEGIN\n  PERFORM 1;\nEND $$;\n'
const B = '-- 156\nALTER TABLE public.t155 ADD COLUMN IF NOT EXISTS x text;\n'
const sum = (s: string) => createHash('sha256').update(s).digest('hex')

let root = ''
let mig = ''
let out = ''

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'a360-bundle-test-'))
  mig = path.join(root, 'supabase', 'migrations')
  mkdirSync(path.join(mig, 'rollback'), { recursive: true })
  writeFileSync(path.join(mig, '155_a.sql'), A)
  writeFileSync(path.join(mig, '156_b.sql'), B)
  writeFileSync(path.join(mig, 'rollback', '155_a.down.sql'), 'DROP TABLE IF EXISTS public.t155;\n')
  writeFileSync(path.join(mig, 'rollback', '156_b.down.sql'), 'ALTER TABLE public.t155 DROP COLUMN IF EXISTS x;\n')
  out = path.join(root, 'out')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const p = (name: string) => path.join(mig, name)
const journalFile = (text: string) => {
  const f = path.join(root, 'journal.txt')
  writeFileSync(f, text)
  return f
}
// The files are passed by each test (`files:`); the placeholder only satisfies the parser.
const opts = (extra: string[] = []) => parseArgs(['--label', 'round4w3', '--out', out, ...extra, 'placeholder.sql'])

function extract(bundle: string): string {
  const dir = mkdtempSync(path.join(root, 'x-'))
  const r = spawnSync('tar', ['xzf', bundle, '-C', dir], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return dir
}

describe('parseArgs', () => {
  it('label required; applied_by defaults to <label>-db-tools; journal and --rollback do not mix', () => {
    expect(() => parseArgs([p('155_a.sql')])).toThrow(/--label/)
    expect(parseArgs(['--label', 'r4', 'x.sql']).appliedBy).toBe('r4-db-tools')
    expect(() => parseArgs(['--label', 'r4'])).toThrow(/файлы/)
    expect(() => parseArgs(['--label', 'r4', '--rollback', '--staging-journal', 'j', 'x'])).toThrow(UsageError)
    expect(() => parseArgs(['--label', 'r4', '--applied-by', "x'; DROP", 'x'])).toThrow(/--applied-by/)
    expect(parseArgs(['--label', 'r4', '--staging-journal', '-', 'x']).stagingJournal).toBe('-')
  })
})

describe('transactionProblems', () => {
  it('plpgsql BEGIN … END; and comments pass; a transaction of its own or CONCURRENTLY does not', () => {
    expect(transactionProblems(A)).toEqual([])
    expect(transactionProblems('-- BEGIN;\n-- CREATE INDEX CONCURRENTLY x\nSELECT 1;')).toEqual([])
    expect(transactionProblems('BEGIN;\nSELECT 1;\nCOMMIT;\n')).toEqual(['свой BEGIN;', 'свой COMMIT;'])
    expect(transactionProblems('CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON t (x);')).toHaveLength(1)
    expect(transactionProblems('REFRESH MATERIALIZED VIEW CONCURRENTLY mv;')).toEqual([])
  })

  it('the real 133 (BEGIN/COMMIT of its own) would be refused — the only one in the folder', () => {
    const real = readFileSync(path.resolve(__dirname, '../../../supabase/migrations/133_documents_bucket_private.sql'), 'utf8')
    expect(transactionProblems(real)).toEqual(['свой BEGIN;', 'свой COMMIT;'])
  })
})

describe('collectFiles', () => {
  it('ascending order and the sums of the bytes', () => {
    const r = collectFiles([p('156_b.sql'), p('155_a.sql')])
    expect(r.ok).toBe(true)
    expect(r.files.map((f: { name: string; sum: string }) => [f.name, f.sum])).toEqual([['155_a.sql', sum(A)], ['156_b.sql', sum(B)]])
  })

  it('refuses a rollback as a migration, a wrong name, a duplicate, a missing file, its own BEGIN', () => {
    writeFileSync(p('157_tx.sql'), 'BEGIN;\nSELECT 1;\nCOMMIT;\n')
    const r = collectFiles([p('rollback/155_a.down.sql'), path.join(root, '155_a.sql'), p('155_a.sql'), p('155_a.sql'), p('158_none.sql'), p('157_tx.sql')])
    expect(r.ok).toBe(false)
    expect(r.problems).toHaveLength(5)
    expect(r.problems.join('\n')).toMatch(/155_a\.down\.sql: не supabase\/migrations/)
    expect(r.problems.join('\n')).toMatch(/указан дважды/)
    expect(r.problems.join('\n')).toMatch(/158_none\.sql: файла нет/)
    expect(r.problems.join('\n')).toMatch(/157_tx\.sql: свой BEGIN;, свой COMMIT;/)
  })

  it('--rollback: only rollback/*.down.sql, in reverse order, each tied to its migration', () => {
    const r = collectFiles([p('rollback/155_a.down.sql'), p('rollback/156_b.down.sql')], { rollback: true })
    expect(r.files.map((f: { name: string; migration: string }) => `${f.name}>${f.migration}`)).toEqual(['156_b.down.sql>156_b.sql', '155_a.down.sql>155_a.sql'])
    expect(collectFiles([p('155_a.sql')], { rollback: true }).ok).toBe(false)
  })
})

describe('the staging journal', () => {
  it('parses psql -At, aligned and CSV output; skips the rest', () => {
    const j = parseJournal([
      `155_a.sql|${sum(A)}`,
      `    file    |                             checksum`,
      `------------+------------------`,
      ` 156_b.sql  | ${sum(B).toUpperCase()}`,
      `157_c.sql,${'a'.repeat(64)}`,
      '(3 rows)',
      `158_d.sql|short`,
    ].join('\n'))
    expect([...j]).toEqual([['155_a.sql', sum(A)], ['156_b.sql', sum(B)], ['157_c.sql', 'a'.repeat(64)]])
  })

  it('match / missing / different sum', () => {
    const files = collectFiles([p('155_a.sql'), p('156_b.sql')]).files
    expect(compareWithStaging(files, new Map([['155_a.sql', sum(A)], ['156_b.sql', sum(B)]])).ok).toBe(true)
    const missing = compareWithStaging(files, new Map([['155_a.sql', sum(A)]]))
    expect(missing.ok).toBe(false)
    expect(missing.lines[1]).toContain('нет в журнале staging')
    const other = compareWithStaging(files, new Map([['155_a.sql', sum(A)], ['156_b.sql', 'f'.repeat(64)]]))
    expect(other.ok).toBe(false)
    expect(other.lines[1]).toContain('сумма в staging другая')
  })
})

describe('buildBundle', () => {
  it('builds the tar.gz: files + apply.sh + SHA256SUMS with the right sums, and the upload script', () => {
    const j = journalFile(`155_a.sql|${sum(A)}\n156_b.sql|${sum(B)}\n`)
    const r = buildBundle({ ...opts(['--staging-journal', j]), files: [p('156_b.sql'), p('155_a.sql')] }, { now: NOW, random: () => 'abc123' })
    expect(r.ok).toBe(true)
    expect(r.bundle).toBe(path.join(out, 'round4w3-20261117T1015Z.tar.gz'))
    const text = r.lines.join('\n')
    expect(text).toContain('совпадает со staging')
    expect(text).toContain(`railway ssh -e production -s db-tools -- sh -c 'sh /tmp/a360-mig-round4w3-20261117t1015z-abc123/apply.sh'`)

    const dir = extract(r.bundle!)
    expect(readdirSync(dir).sort()).toEqual(['155_a.sql', '156_b.sql', 'SHA256SUMS', 'apply.sh'])
    expect(readFileSync(path.join(dir, '155_a.sql'), 'utf8')).toBe(A)
    const sums = readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8')
    expect(sums).toBe(`${sum(A)}  155_a.sql\n${sum(B)}  156_b.sql\n${sum(readFileSync(path.join(dir, 'apply.sh'), 'utf8'))}  apply.sh\n`)

    // the upload script: valid sh, the chunks give back exactly the bundle, the sum of the bundle is checked
    const upload = readFileSync(r.upload!, 'utf8')
    expect(spawnSync('sh', ['-n', r.upload!]).status).toBe(0)
    const b64 = [...upload.matchAll(/printf %s ([A-Za-z0-9+/=]+) >>/g)].map((m) => m[1]).join('')
    expect(Buffer.from(b64, 'base64').equals(readFileSync(r.bundle!))).toBe(true)
    expect(upload).toContain(`echo "${r.tarSum}  b.tgz" | sha256sum -c`)
    expect(upload).toContain('mkdir -m 700 /tmp/a360-mig-round4w3-20261117t1015z-abc123')
    expect(upload).not.toMatch(/rm -rf|psql/)
  })

  it('a different sum in staging → refused, nothing written', () => {
    const j = journalFile(`155_a.sql|${sum(A)}\n156_b.sql|${'0'.repeat(64)}\n`)
    const r = buildBundle({ ...opts(['--staging-journal', j]), files: [p('155_a.sql'), p('156_b.sql')] }, { now: NOW })
    expect(r.ok).toBe(false)
    expect(r.lines.join('\n')).toContain('сумма в staging другая')
    expect(r.lines.join('\n')).toContain('ПАКЕТ НЕ СОБРАН')
    expect(existsSync(out)).toBe(false)
  })

  it('without the staging journal: built, with a loud warning', () => {
    const r = buildBundle({ ...opts(), files: [p('155_a.sql')] }, { now: NOW })
    expect(r.ok).toBe(true)
    expect(r.lines.join('\n')).toContain('СВЕРКА СО STAGING НЕ СДЕЛАНА')
  })

  it('a big bundle goes over in chunks that each fit one sh -c argument', () => {
    const big = 'x'.repeat(CHUNK * 2 + 10)
    const text = uploadScript({ base64: big, tarSum: 'f'.repeat(64), remoteDir: '/tmp/a360-mig-x', env: 'production' })
    const chunks = [...text.matchAll(/printf %s (x+) >>/g)].map((m) => m[1])
    expect(chunks.map((c) => c.length)).toEqual([CHUNK, CHUNK, 10])
    for (const line of text.split('\n')) expect(line.length).toBeLessThan(128 * 1024)
  })
})

describe('apply.sh (run with a stub psql)', () => {
  function stubs(failOn?: string) {
    const bin = mkdtempSync(path.join(root, 'bin-'))
    const log = path.join(bin, 'calls.log')
    // one line per call: the arguments joined by ' ¦ '
    writeFileSync(path.join(bin, 'psql'), `#!/bin/sh\nprintf '%s ¦ ' "$@" >> "${log}"\necho >> "${log}"\n${failOn ? `case "$*" in *${failOn}*) exit 3;; esac\n` : ''}exit 0\n`)
    writeFileSync(path.join(bin, 'sha256sum'), `#!/bin/sh\necho "sha256sum $*" >> "${log}"\nexit 0\n`)
    chmodSync(path.join(bin, 'psql'), 0o755)
    chmodSync(path.join(bin, 'sha256sum'), 0o755)
    return { bin, log }
  }
  const runApply = (dir: string, bin: string, env: Record<string, string>) =>
    spawnSync('sh', [path.join(dir, 'apply.sh')], { encoding: 'utf8', env: { NODE_ENV: 'test', PATH: `${bin}:/usr/bin:/bin`, ...env } })

  it('each migration and its journal row in one psql -1 call, in order; then the journal is printed', () => {
    const r = buildBundle({ ...opts(), files: [p('156_b.sql'), p('155_a.sql')] }, { now: NOW })
    const dir = extract(r.bundle!)
    const { bin, log } = stubs()
    const res = runApply(dir, bin, { TGT_URL: 'postgres://stub' })
    expect(res.status, res.stderr).toBe(0)
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    expect(calls[0]).toBe('sha256sum -c SHA256SUMS')
    expect(calls[1]).toContain('postgres://stub ¦ -X ¦ -q ¦ -v ¦ ON_ERROR_STOP=1 ¦ -1 ¦ -f ¦ 155_a.sql ¦ -c ¦ INSERT INTO public.schema_migrations')
    expect(calls[1]).toContain(`VALUES ('155_a.sql', '${sum(A)}', 'round4w3-db-tools') ON CONFLICT (file) DO UPDATE`)
    expect(calls[2]).toContain('-f ¦ 156_b.sql ¦')
    expect(calls[3]).toContain("WHERE file IN ('155_a.sql', '156_b.sql')")
    expect(calls).toHaveLength(4)
  })

  it('stops at the first failing migration; without TGT_URL it does not start', () => {
    const r = buildBundle({ ...opts(), files: [p('155_a.sql'), p('156_b.sql')] }, { now: NOW })
    const dir = extract(r.bundle!)
    const failing = stubs('155_a.sql')
    expect(runApply(dir, failing.bin, { TGT_URL: 'postgres://stub' }).status).not.toBe(0)
    expect(readFileSync(failing.log, 'utf8')).not.toContain('156_b.sql')

    const none = stubs()
    const res = runApply(dir, none.bin, {})
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('TGT_URL')
    expect(existsSync(none.log)).toBe(false)
  })

  it('--rollback: reverse order, the journal row of the migration deleted in the same transaction', () => {
    const r = buildBundle({ ...parseArgs(['--rollback', '--label', 'undo', '--out', out, 'x']), files: [p('rollback/155_a.down.sql'), p('rollback/156_b.down.sql')] }, { now: NOW })
    expect(r.ok).toBe(true)
    const dir = extract(r.bundle!)
    const { bin, log } = stubs()
    expect(runApply(dir, bin, { TGT_URL: 'postgres://stub' }).status).toBe(0)
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    expect(calls[1]).toContain("-f ¦ 156_b.down.sql ¦ -c ¦ DELETE FROM public.schema_migrations WHERE file = '156_b.sql'")
    expect(calls[2]).toContain("-f ¦ 155_a.down.sql ¦ -c ¦ DELETE FROM public.schema_migrations WHERE file = '155_a.sql'")
  })

  it('the script text never removes files', () => {
    const text = applyScript({ files: collectFiles([p('155_a.sql')]).files, label: 'l', stamp: 's', appliedBy: 'l-db-tools', rollback: false })
    expect(text).not.toMatch(/\brm\b/)
  })
})

describe('main', () => {
  it('0 built, 1 refused, 2 bad arguments', () => {
    const quiet = { log: () => {}, now: NOW }
    expect(main(['--label', 'r4', '--out', out, p('155_a.sql')], quiet)).toBe(0)
    expect(main(['--label', 'r4', '--out', out, p('rollback/155_a.down.sql')], quiet)).toBe(1)
    expect(main([p('155_a.sql')], quiet)).toBe(2)
  })
})
