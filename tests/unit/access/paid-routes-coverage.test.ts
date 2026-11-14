/**
 * R2-A contract: every API route of a paid section goes through the ONE gate
 * (lib/access/gate.ts / lib/access/decision.ts) with its own feature, or is
 * listed below with the reason it is not gated. A new route under these
 * folders fails this test until it is gated or explicitly listed — so the data
 * of Точка А / Точка Б / Рынок / полный GRI cannot leak through a forgotten API.
 * (Behaviour — 402 for Free before any read — is in paid-api-gates.test.ts.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SECTIONS: Array<{ dir: string; feature: string }> = [
  { dir: 'app/api/v1/point-a', feature: 'point_a' },
  { dir: 'app/api/v1/point-b', feature: 'point_b' },
  { dir: 'app/api/v1/diagnostics/point-b', feature: 'point_b' },
  { dir: 'app/api/market', feature: 'market' },
  { dir: 'app/api/v1/market-analysis', feature: 'market' },
  { dir: 'app/api/v1/gri', feature: 'gri_full' },
  { dir: 'app/api/gri', feature: 'gri_full' },
]
/** Point A routes outside its folder (the v1 diagnostics row). */
const EXTRA: Array<{ file: string; feature: string }> = [
  { file: 'app/api/v1/diagnostics/current/route.ts', feature: 'point_a' },
  { file: 'app/api/v1/diagnostics/ai-status/route.ts', feature: 'point_a' },
  { file: 'app/api/v1/diagnostics/retry-ai/route.ts', feature: 'point_a' },
  { file: 'app/api/v1/diagnostics/recalculate/route.ts', feature: 'point_a' },
  // public links and PDFs of the paid sections
  { file: 'app/api/share/route.ts', feature: 'point_a' },
  { file: 'app/api/export/report/route.ts', feature: 'point_a' },
]

/** Not gated on purpose — each with its reason. */
const NOT_GATED: Record<string, string> = {
  'app/api/v1/diagnostics/point-b/current-revenue/route.ts': 'writes the current revenue into the questionnaire (survey data, free)',
  'app/api/v1/gri/expert-notes/route.ts': 'staff only (requireStaff / getSessionStaff), not a client surface',
  'app/api/v1/gri/pulse/route.ts': 'Пульс — free by decision (lib/access/entitlements.ts: Пульс и мини-CRM не гейтятся)',
  'app/api/v1/gri/trust/route.ts': 'data-confidence signal of the own rows, no GRI result; no client page calls it',
  'app/api/gri/baseline/route.ts': 'expert / staff only (requireExpert + guardExpertClient)',
}

/** whatif routes gate through lib/point-b/whatif-http.ts authorize() → gateFeature(point_b). */
const GATE_CALLS = [/gatePaidSection\(/, /gateFeature\(/, /resolveFeature\(/, /\bauthorize\(\{/]

function routes(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...routes(p))
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

const all = [
  ...SECTIONS.flatMap((s) => routes(s.dir).map((file) => ({ file, feature: s.feature }))),
  ...EXTRA,
]

describe('every route of a paid section is gated', () => {
  it('the scan finds the routes', () => {
    expect(all.length).toBeGreaterThan(40)
  })

  for (const { file, feature } of all) {
    it(`${file} → ${feature}`, () => {
      if (NOT_GATED[file]) return
      const src = readFileSync(file, 'utf8')
      expect(GATE_CALLS.some((re) => re.test(src)), `${file} has no gate call`).toBe(true)
      if (!/\bauthorize\(\{/.test(src)) expect(src).toContain(`'${feature}'`)
    })
  }

  it('the exceptions still exist (a stale entry is removed)', () => {
    for (const file of Object.keys(NOT_GATED)) expect(() => statSync(file)).not.toThrow()
  })
})
