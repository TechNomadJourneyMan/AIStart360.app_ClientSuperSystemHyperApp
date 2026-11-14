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

/**
 * R2-A (ревью п.7): not only the folders of the sections — ANY route / page /
 * layout that reads the tables of a paid section (Точка А: diagnostics incl.
 * ai_analysis, point_a_*; Точка Б: pb_*, point_b_*, the action plan; Рынок:
 * market_*; полный GRI: gri_assessments, drafts, calc sessions, plan progress)
 * must go through the one decision, or be an explicit exception with a reason.
 * The assistant snapshot (buildAssistantContext) is filtered inside itself.
 */
const PAID_READ = new RegExp(
  [
    String.raw`from\(\s*['"](?:gri_assessments|diagnostics|point_a_[a-z_]+|pb_[a-z_]+|point_b_[a-z_]+|market_[a-z_]+|gri_assessment_drafts|gri_calc_sessions|gri_plan_progress|action_items)['"]`,
    String.raw`rest/v1/(?:gri_assessments|diagnostics|point_a_|pb_|point_b_|market_|action_items)`,
    String.raw`\bai_analysis\b`,
    String.raw`loadPointAState\(`,
    String.raw`getOfficialPointA\(`,
    String.raw`loadPointAOverview\(`,
    // lib loaders that return paid data to their caller (a page reads through them)
    String.raw`loadMetricsPageData\(`,
    String.raw`loadPointBInputs\(`,
    String.raw`loadOfficialSnapshot\(`,
  ].join('|'),
)
const DECISION = /gatePaidSection\(|gateFeature\(|resolveFeature\(|resolveAccess\(|getRequestAccess\(|<FeatureGate|\bauthorize\(\{|isPaidSectionOpen\(/

/** Staff / internal surfaces: paid sections are a CLIENT-side limit (staff are exempt by the decision itself). */
const STAFF_PREFIXES: Record<string, string> = {
  'app/api/giga-admin/': 'GIGA panel API — requireGiga / staff permissions (lib/admin/rbac.ts)',
  'app/admin-giga-panel/': 'GIGA panel pages — staff gate in middleware + RequirePermission',
  'app/api/expert/': 'expert cabinet API — requireExpert / guardExpertClient',
  'app/(expert)/': 'expert cabinet pages — middleware sends clients away',
  'app/super-expert/': 'SuperExpert cabinet — staff only (middleware)',
  'app/api/super-expert/': 'SuperExpert API — staff only',
  'app/api/cron/': 'scheduler secret, no client caller',
  'app/dev/': 'local development only',
}

/** Client-reachable readers that are NOT gated on purpose — each with its reason. */
const READ_EXCEPTIONS: Record<string, string> = {
  'app/api/v1/diagnostics/point-b/current-revenue/route.ts': 'reads only diagnostics.company_id to scope a questionnaire write (no Point A data out)',
  'app/api/v1/gri/trust/route.ts': 'counts / dates of the own GRI rows and market answers (data-confidence signal), no result',
  'app/api/clients/[id]/analysis/point-b/route.ts': 'expert / staff only (requireExpert + guardExpertClient)',
  'app/(dashboard)/clients/[id]/page.tsx': 'staff page — /clients is in middleware ADMIN_PATHS, clients are redirected',
  'app/(dashboard)/profile/page.tsx': 'checks only whether a diagnostics row exists (select=id)',
  'app/api/v1/diagnostics/ai-analyze/route.ts': 'internal token from the fan-out (paid AI decided for the owner, lib/point-a/diagnostic-row.ts paidFanOutPaths); the direct session path is gated',
}

function appFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...appFiles(p))
    else if (name === 'route.ts' || name === 'page.tsx' || name === 'layout.tsx') out.push(p)
  }
  return out
}

describe('every reader of paid-section tables goes through the one decision (or is an explained exception)', () => {
  const readers = appFiles('app').filter((f) => PAID_READ.test(readFileSync(f, 'utf8')))

  it('the scan finds the readers', () => {
    expect(readers.length).toBeGreaterThan(60)
  })

  it('no client-reachable reader is left ungated', () => {
    const ungated = readers.filter((f) => {
      if (Object.keys(STAFF_PREFIXES).some((p) => f.startsWith(p))) return false
      if (READ_EXCEPTIONS[f]) return false
      return !DECISION.test(readFileSync(f, 'utf8'))
    })
    expect(ungated, `ungated readers of paid tables:\n${ungated.join('\n')}`).toEqual([])
  })

  it('the exceptions still exist and still read paid tables (a stale entry is removed)', () => {
    for (const f of Object.keys(READ_EXCEPTIONS)) expect(readers, f).toContain(f)
  })

  it('the assistant snapshot filters closed sections inside buildAssistantContext; only staff routes pass an override', () => {
    const src = readFileSync('lib/assistant/context.ts', 'utf8')
    expect(src).toContain('scrubAssistantContext(')
    expect(src).toContain('resolveAccess(')
    const overriders = appFiles('app').filter((f) => /buildAssistantContext\([^)]*sections:/.test(readFileSync(f, 'utf8')))
    expect(overriders.every((f) => f.startsWith('app/api/giga-admin/')), overriders.join('\n')).toBe(true)
    // the personal Telegram account and the messages bot use the default (client) decision
    expect(readFileSync('lib/telegram/personal-sync.ts', 'utf8')).not.toMatch(/buildAssistantContext\([^)]*sections:/)
    expect(readFileSync('lib/comm/bot.ts', 'utf8')).toContain("resolveFeature(sb, userId, 'point_a')")
  })
})
