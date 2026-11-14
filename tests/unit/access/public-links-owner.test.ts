/**
 * R2-C (M-4 + п.2): public links decide by the CURRENT right of the data's
 * owner (companies.user_id), lib/access/owner-access.ts:
 *   • /r/v/<token> (one version of the expert's report) and its PDF — Точка А;
 *   • /r/<token> shares of Точка А / Точка Б / GRI — their section (the
 *     questionnaire share stays free).
 * Closed → «Ссылка недоступна» without any data (no company, no numbers), the
 * PDF → 403 without the file; the link itself is not deleted. Open → as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'

const COMPANY = 'company-secret-1'
const OWNER = '33333333-3333-4333-8333-333333333333'

const s = vi.hoisted(() => ({
  open: true,
  ownerCalls: [] as Array<{ owner: string | null; section: string }>,
  companyCalls: [] as Array<{ company: string; section: string }>,
  shareType: 'point_a' as string,
  loads: [] as string[],
  views: 0,
  pdfRendered: 0,
}))

vi.mock('@/lib/access/owner-access', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/access/owner-access')>()
  return {
    ...real,
    ownerSectionOpen: async (owner: string | null, section: string) => { s.ownerCalls.push({ owner, section }); return s.open },
    companyOwnerSectionOpen: async (company: string, section: string) => { s.companyCalls.push({ company, section }); return s.open },
  }
})

const version = {
  id: '44444444-4444-4444-8444-444444444444', company_id: COMPANY, company_name: 'ТОО Секретная', session_id: null,
  report_type: 'point_a', version: 3, status: 'published', title: 'Точка А: ТОО Секретная', confidence: 0.9,
  data_hash: 'h', published_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  content: { findings: [] }, provenance: {}, pdf_storage_path: null, pdf_rendered_at: null,
}
vi.mock('@/lib/reports/version-link', () => ({
  resolveVersionLink: async () => ({ ok: true, version, expiresAt: '2026-12-01T00:00:00Z' }),
}))
vi.mock('@/lib/reports/pdf-store', () => ({ versionPdf: async () => { s.pdfRendered++; return { bytes: Buffer.from('%PDF') } } }))
vi.mock('@/components/reports/PublishedReports', () => ({ ReportDetails: () => React.createElement('div', { id: 'report-details' }, 'REPORT-CONTENT') }))
vi.mock('@/components/ui/Logo', () => ({ Logo: () => null }))

vi.mock('@/lib/share/tokens', () => ({
  getShareByToken: async () => ({ id: 's1', token: 'tok', type: s.shareType, companyId: COMPANY, createdById: null, audienceRoles: [], expiresAt: null, revoked: false, views: 0, createdAt: new Date() }),
  incrementShareViews: async () => { s.views++ },
}))
vi.mock('@/lib/share/report-data', () => ({
  loadSubject: async () => ({ companyId: COMPANY, userId: OWNER, companyName: 'ТОО Секретная', industry: 'retail', stage: 'growth' }),
  loadGriView: async () => { s.loads.push('gri'); return null },
  loadPointAView: async () => { s.loads.push('point_a'); return null },
  loadPointBView: async () => { s.loads.push('point_b'); return null },
  loadSurveyView: async () => { s.loads.push('survey'); return null },
}))

const { default: VersionLinkPage } = await import('@/app/r/v/[token]/page')
const { GET: versionPdfGET } = await import('@/app/r/v/[token]/pdf/route')
const sharedPage = await import('@/app/r/[token]/page')

/** Render a server page (async components inside are awaited by hand). */
async function html(el: unknown): Promise<string> {
  const resolve = async (node: unknown): Promise<unknown> => {
    if (!node || typeof node !== 'object') return node
    const n = node as { type?: unknown; props?: Record<string, unknown> }
    if (typeof n.type === 'function' && (n.type as { constructor: { name: string } }).constructor.name === 'AsyncFunction') {
      return resolve(await (n.type as (p: unknown) => Promise<unknown>)(n.props))
    }
    if (n.props && 'children' in n.props) {
      const kids = n.props.children
      const next = Array.isArray(kids) ? await Promise.all(kids.map(resolve)) : await resolve(kids)
      return { ...n, props: { ...n.props, children: next } }
    }
    return node
  }
  return renderToStaticMarkup((await resolve(el)) as React.ReactElement)
}

beforeEach(() => {
  s.open = true
  s.ownerCalls = []
  s.companyCalls = []
  s.shareType = 'point_a'
  s.loads = []
  s.views = 0
  s.pdfRendered = 0
})

describe('/r/v/<token> — a version of the expert\'s report', () => {
  it('Точка А closed for the owner → «Ссылка недоступна», no data of the report', async () => {
    s.open = false
    const out = await html(await VersionLinkPage({ params: { token: 'tok' } }))
    expect(out).toContain('Ссылка недоступна')
    expect(out).not.toContain('Секретная')
    expect(out).not.toContain('REPORT-CONTENT')
    expect(out).not.toContain('/pdf')
    expect(s.companyCalls).toEqual([{ company: COMPANY, section: 'point_a' }])
  })

  it('open → the version as before', async () => {
    const out = await html(await VersionLinkPage({ params: { token: 'tok' } }))
    expect(out).toContain('Точка А: ТОО Секретная')
    expect(out).toContain('REPORT-CONTENT')
    expect(out).not.toContain('Ссылка недоступна')
  })

  it('its PDF: closed → 403 without rendering the file; open → the PDF', async () => {
    s.open = false
    const closed = await versionPdfGET(new NextRequest('http://t/r/v/tok/pdf'), { params: { token: 'tok' } })
    expect(closed.status).toBe(403)
    expect(await closed.json()).toMatchObject({ ok: false, error: 'link_unavailable' })
    expect(s.pdfRendered).toBe(0)
    s.open = true
    const ok = await versionPdfGET(new NextRequest('http://t/r/v/tok/pdf'), { params: { token: 'tok' } })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('application/pdf')
  })
})

describe('/r/<token> — old share links of the paid sections', () => {
  it.each([['point_a', 'point_a'], ['point_b', 'point_b'], ['gri', 'gri_full']])('%s share, section closed for the owner → «Ссылка недоступна», nothing loaded', async (type, section) => {
    s.shareType = type
    s.open = false
    const out = await html(await sharedPage.default({ params: { token: 'tok' } }))
    expect(out).toContain('Ссылка недоступна')
    expect(out).not.toContain('Секретная')
    expect(s.loads).toEqual([])
    expect(s.views).toBe(0)
    expect(s.ownerCalls).toEqual([{ owner: OWNER, section }])
  })

  it('open → the report as before (the data is loaded, the view counted)', async () => {
    s.shareType = 'point_a'
    const out = await html(await sharedPage.default({ params: { token: 'tok' } }))
    expect(out).not.toContain('Ссылка недоступна')
    expect(out).toContain('ТОО Секретная')
    expect(s.loads).toEqual(['point_a'])
    expect(s.views).toBe(1)
  })

  it('the questionnaire share stays free: no owner check, the data is shown', async () => {
    s.shareType = 'survey'
    s.open = false
    const out = await html(await sharedPage.default({ params: { token: 'tok' } }))
    expect(out).not.toContain('Ссылка недоступна')
    expect(s.ownerCalls).toEqual([])
    expect(s.loads).toEqual(['survey'])
  })

  it('the GRI share card (OpenGraph) has no numbers of a closed section', async () => {
    s.shareType = 'gri'
    s.open = false
    const meta = await sharedPage.generateMetadata({ params: { token: 'tok' } })
    expect(meta.openGraph).toBeUndefined()
    expect(s.loads).toEqual([])
  })
})
