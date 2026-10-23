/**
 * Field calculations (survey Ф3): the registry, the guards — no industry
 * comparison, nothing written, no database / network anywhere in the import
 * graph of lib/survey/calcs.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { CALC_IDS, CALCS, CALCS_BY_KEY, calcsForKey, computeCalcs, isCalcReady } from '@/lib/survey/calcs'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { previewAnswers } from '@/app/dev/survey-preview/fixture'

const ROOT = resolve(__dirname, '../../..')

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

describe('calcs registry', () => {
  it('has the 14 calculations of spec §9.2', () => {
    expect(CALC_IDS).toHaveLength(14)
    expect(Object.keys(CALCS).sort()).toEqual([...CALC_IDS].sort())
  })

  it('every field key is a real question key, every calc sits under some field', () => {
    for (const key of Object.keys(CALCS_BY_KEY)) expect(SURVEY_KEY_STEP[key], key).toBeTypeOf('number')
    const placed = new Set(Object.values(CALCS_BY_KEY).flat())
    for (const id of CALC_IDS) expect(placed.has(id), id).toBe(true)
  })

  it('on the «filled» fixture all 14 are ready', () => {
    const results = computeCalcs(CALC_IDS, previewAnswers('filled'))
    expect(results.map((r) => r.id)).toEqual([...CALC_IDS])
    for (const r of results) {
      expect(isCalcReady(r), r.id).toBe(true)
      expect(r.sources.length, r.id).toBeGreaterThan(0)
      expect(r.how.length, r.id).toBeGreaterThan(10)
    }
  })

  it('nothing answered → nothing shown (no hint noise on an empty form)', () => {
    expect(computeCalcs(CALC_IDS, {})).toEqual([])
    expect(calcsForKey('s1_company_name', previewAnswers('filled'))).toEqual([])
  })

  it('«unknown» fixture: some hidden with a hint, some with ≈ and a range', () => {
    const results = computeCalcs(CALC_IDS, previewAnswers('unknown'))
    expect(results.some((r) => !isCalcReady(r) && r.missing.length > 0)).toBe(true)
    expect(results.some((r) => r.approx && r.lines.some((l) => /≈ .*\(диапазон .* – .*\)/.test(l)))).toBe(true)
  })

  it('calcsForKey passes the field key (owner hours of the field it sits under)', () => {
    const a = { s4m_hours_on_ops: 9, s10_hours_on_ops: 6 }
    expect(calcsForKey('s10_hours_on_ops', a)[0].lines[0]).toMatch(/^≈ 132 ч/)
    expect(calcsForKey('s4m_hours_on_ops', a)[0].lines[0]).toMatch(/^≈ 198 ч/)
  })

  it('no industry comparison, no norms, no benchmarks in any text', () => {
    for (const variant of ['filled', 'half', 'unknown'] as const) {
      for (const r of computeCalcs(CALC_IDS, previewAnswers(variant))) {
        const text = [r.title, ...r.lines, r.how, ...r.missing].join(' ').toLowerCase()
        expect(text, r.id).not.toMatch(/отрасл|норм[аы ]|бенчмарк|benchmark|рынк|в среднем по|конкурент/)
      }
    }
  })

  it('never changes the answers (frozen input works, same output twice)', () => {
    const a = deepFreeze(previewAnswers('filled'))
    const first = computeCalcs(CALC_IDS, a)
    expect(computeCalcs(CALC_IDS, a)).toEqual(first)
  })
})

// ─── Static guard: the import graph of lib/survey/calcs ─────────────────────

const FORBIDDEN_IMPORT = /supabase|prisma|next\/headers|next\/server|server-only|@\/lib\/ai\/|openrouter|node:|^fs$|^pg$/
const FORBIDDEN_CODE = /\bfetch\s*\(|\.from\(\s*['"]survey_answers|\.insert\(|\.upsert\(|\.update\(\s*\{/

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(c)) return c
  return null
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  // `import type` is erased at build time — it brings no code in.
  return [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
}

describe('calcs: no database, no network', () => {
  it('no module reachable from lib/survey/calcs imports a DB client or calls fetch', () => {
    const dir = join(ROOT, 'lib/survey/calcs')
    const queue = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f))
    const seen = new Set<string>()
    while (queue.length) {
      const file = queue.pop() as string
      if (seen.has(file)) continue
      seen.add(file)
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(FORBIDDEN_CODE)
      for (const spec of importsOf(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(FORBIDDEN_IMPORT)
        const next = resolveImport(file, spec)
        if (next) queue.push(next)
      }
    }
    expect(seen.size).toBeGreaterThan(8)
  })
})
