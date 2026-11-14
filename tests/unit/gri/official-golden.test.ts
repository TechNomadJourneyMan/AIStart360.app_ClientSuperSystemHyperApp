/**
 * R-036 golden test: ONE client → ONE GRI on every migrated path.
 *
 * The client answers the 7 GRI sections; the canonical formula
 * (lib/gri-assessment/score.ts) gives the stored gri_index. Every reader and
 * every screen / text must then show the same value through lib/format/gri.ts:
 * the official reader, the portfolio, the expert list, the expert GRI tab,
 * the staff panel, the client hero, the e-mail. Point A (0–100) never leaks
 * in as «GRI», and the old «GRI < 40» filter is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('framer-motion', () => ({ motion: new Proxy({}, { get: () => 'div' }) }))
vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/survey/staff-status-load', () => ({ loadSurveyStaffStatuses: async () => new Map() }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))

const g = vi.hoisted(() => ({ srRows: null as unknown }))
vi.mock('@/lib/expert-auth', () => ({
  resolveExpert: async () => ({ ok: true, viewer: { id: 'expert-1', role: 'admin', email: null, clientScope: 'all' } }),
  expertBlockResponse: () => new Response(null, { status: 403 }),
  // Scope (SR-03) is covered by tests/unit/access/actor-scope-routes.test.ts.
  guardExpertClient: async () => null,
  expertSeesAllClients: () => true,
  srGet: async () => g.srRows,
}))

import { computeGriIndex, computeSectionAvgs, type GriScores } from '@/lib/gri-assessment/score'
import { formatGri, griZone, griFromPercent, GRI_ATTENTION_BELOW } from '@/lib/format/gri'
import { getOfficialGri, officialGriFromRows, pickOfficialRow, type GriRowLike } from '@/lib/gri/official'
import { aggregatePortfolioGri } from '@/lib/portfolio-gri'
import { PortfolioGriPanel } from '@/components/dashboard/PortfolioGriPanel'
import { heroStatus } from '@/components/gri/page/GriHero'
import { buildGriCompletedEmail } from '@/lib/email/templates'
import { computeMiniGri, miniGriZone } from '@/lib/gri/mini'

const { GET: listGET } = await import('@/app/api/expert/clients/route')
const { GET: tabGET } = await import('@/app/api/expert/clients/[id]/gri/route')

const USER = 'a0000000-0000-4000-8000-000000000001'

// 7 sections, criteria 1–10 (0 = not answered): section means 8, 7, 6.5, 5, 6, 7, 5.5
const SCORES: GriScores = {
  'product-demand': { a: 8, b: 8 },
  'trust-positioning': { a: 7, b: 7, c: 0 },
  'business-model': { a: 6, b: 7 },
  'cash-stability': { a: 5 },
  operations: { a: 6, b: 6 },
  team: { a: 7 },
  'owner-readiness': { a: 5, b: 6 },
}
const SECTION_AVGS = computeSectionAvgs(SCORES)
const GRI_INDEX = computeGriIndex(SECTION_AVGS) // 6.43 stored
const SHOWN = formatGri(GRI_INDEX) // «6.4» everywhere

const CURRENT: GriRowLike = { id: 'g2', user_id: USER, gri_index: GRI_INDEX, section_avgs: SECTION_AVGS, is_current: true, created_at: '2026-11-01T00:00:00Z' }
// An older run and a NEWER non-current run (staff pinned the current one) — neither is official.
const OLD: GriRowLike = { id: 'g1', user_id: USER, gri_index: 3.1, section_avgs: {}, is_current: false, created_at: '2026-10-01T00:00:00Z' }
const NEWER_UNPINNED: GriRowLike = { id: 'g3', user_id: USER, gri_index: 9.9, section_avgs: {}, is_current: false, created_at: '2026-11-10T00:00:00Z' }
const ROWS = [OLD, CURRENT, NEWER_UNPINNED]

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input)
    const table = url.pathname.split('/').pop() as string
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 })
    if (table === 'profiles') return json(url.searchParams.get('offset') === '0' ? [{ id: USER, full_name: 'Клиент', email: null, avatar_url: null, status: 'approved', created_at: '2026-10-01' }] : [])
    // Point A = 58/100 — must never show up as GRI.
    if (table === 'diagnostics') return json(url.searchParams.get('offset') === '0' ? [{ user_id: USER, overall_score: 58, health_index: 40, stage: 'early', calculated_at: '2026-10-01' }] : [])
    if (table === 'gri_assessments') return json(url.searchParams.get('offset') === '0' ? ROWS : [])
    return json([])
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('R-036 golden: one client → one GRI', () => {
  it('the canonical formula is on 0–10', () => {
    expect(GRI_INDEX).toBe(6.43)
    expect(SHOWN).toBe('6.4')
  })

  it('official reader: the current row, not the newest or an older one', async () => {
    expect(pickOfficialRow(ROWS)?.id).toBe('g2')
    expect(officialGriFromRows(ROWS).get(USER)?.index).toBe(GRI_INDEX)

    const sb = {
      from: () => {
        const b = {
          select: () => b, eq: () => b, in: () => b,
          order: () => b,
          limit: async () => ({ data: [CURRENT], error: null }),
        }
        return b
      },
    }
    const official = await getOfficialGri(sb as never, USER)
    expect(official?.index).toBe(GRI_INDEX)
    expect(official?.sectionAvgs['cash-stability']).toBe(5)
  })

  it('a missing current row falls back to the newest; 0 is «нет данных»', () => {
    expect(pickOfficialRow([OLD, { ...NEWER_UNPINNED }])?.id).toBe('g3')
    const zero = officialGriFromRows([{ user_id: USER, gri_index: 0, section_avgs: { team: 0 }, is_current: true, created_at: null }]).get(USER)
    expect(zero?.index).toBeNull()
    expect(zero?.sectionAvgs.team).toBeNull()
  })

  it('portfolio of this one client = the same GRI', () => {
    const p = aggregatePortfolioGri([CURRENT as never])
    expect(p?.overall).toBe(GRI_INDEX)
    expect(formatGri(p?.overall)).toBe(SHOWN)
    const html = renderToStaticMarkup(createElement(PortfolioGriPanel, { data: p }))
    expect(html).toContain(`>${SHOWN}<`)
  })

  it('expert client list: GRI from gri_assessments (not Point A 58), same value', async () => {
    const res = await listGET()
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].griIndex).toBe(GRI_INDEX)
    expect(data[0].overallScore).toBe(58) // Point A stays a separate field
    expect(formatGri(data[0].griIndex)).toBe(SHOWN)
    // «Требует внимания» is on 0–10 now: 6.4 is not critical (the old «< 40» flagged it).
    expect(data[0].griIndex < GRI_ATTENTION_BELOW).toBe(false)
  })

  it('expert GRI tab: same value', async () => {
    g.srRows = [{ gri_index: GRI_INDEX, section_avgs: SECTION_AVGS, updated_at: null, created_at: CURRENT.created_at }]
    const res = await tabGET(new Request('http://x'), { params: { id: USER } })
    const body = await res.json()
    expect(body.data.overall).toBe(GRI_INDEX)
    expect(formatGri(body.data.overall)).toBe(SHOWN)
  })

  it('client hero status and e-mail use the same value and zone', () => {
    expect(heroStatus(GRI_INDEX).label).toBe(griZone(GRI_INDEX)?.label)
    const { content } = buildGriCompletedEmail({ griIndex: GRI_INDEX, url: 'https://x.io/gri' })
    expect(JSON.stringify(content)).toContain(`${SHOWN} из 10`)
  })
})

describe('R-036: Mini-GRI is shown on the GRI scale', () => {
  it('62/100 → 6.2 / 10 with the GRI zone', () => {
    const r = computeMiniGri({ margin: 40, ltvCacRatio: 3, runwayMonths: 6, conversionRate: 20, hasScripts: true, steadyDemand: true })
    expect(r.index).toBe(griFromPercent(r.overall))
    for (const b of r.blocks) expect(b.index).toBe(griFromPercent(b.score))
    expect(miniGriZone(r.overall).key).toBe(griZone(r.index)?.key ?? 'critical')
    expect(miniGriZone(62).key).toBe(griZone(6.2)?.key)
    expect(miniGriZone(0).key).toBe('critical')
  })
})
