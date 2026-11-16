/**
 * R3-PA (ревью L7, L3): the PDF of Point A (GET /api/export/report?type=point-a)
 * — by behaviour, not by the source text: the AI text goes in with the expert's
 * corrections and the label «Черновик ИИ — эксперт проверит» / «Проверено
 * экспертом: …»; a partial analysis is labelled as such.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const OWNER = '11111111-1111-4111-8111-111111111111'
const h = vi.hoisted(() => ({ diag: {} as Record<string, unknown>, pdf: [] as Array<Record<string, unknown>> }))

function fake() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) },
    from(table: string) {
      const rows: Row[] = table === 'companies' ? [{ id: 'co', user_id: OWNER, name: 'ТОО', industry: 'Розница', stage: 'early' }]
        : table === 'diagnostics' ? [h.diag] : []
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
      }
      return b
    },
  }
}

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fake() }))
vi.mock('@/lib/access/gate', () => ({ gatePaidSection: async () => null }))
vi.mock('@/lib/reports/pdf', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/reports/pdf')),
  renderPointAPdf: async (input: Record<string, unknown>) => { h.pdf.push(input); return Buffer.from('%PDF-1.4') },
}))

const { GET } = await import('@/app/api/export/report/route')
const AI = {
  executive_summary: 'ИИ: бизнес растёт', industry_context: 'норма', strategic_priorities: [{ title: 'П1', rationale: 'r', expected_impact: 'e' }],
  growth_roadmap: [], blocks: { finance: { diagnosis: 'маржа ок', key_risk: 'нет плана' } }, model_used: 'm', generated_at: '2026-11-15T10:00:00Z',
}
const base = { id: 'd-1', user_id: OWNER, is_current: true, overall_score: 61, health_index: 50, stage: 'growth', risks: [], insights: [], quick_wins: [], data_gaps: [], ai_status: 'completed', ai_analysis: AI }
const get = () => GET(new NextRequest('http://localhost/api/export/report?type=point-a'))

beforeEach(() => { h.pdf = [] })

describe('PDF of Point A — the AI part', () => {
  it('an unchecked analysis → the AI text with «Черновик ИИ — эксперт проверит»', async () => {
    h.diag = base
    expect((await get()).status).toBe(200)
    expect(h.pdf[0]).toMatchObject({ executiveSummary: 'ИИ: бизнес растёт', aiNote: expect.stringMatching(/^Черновик ИИ — эксперт проверит\./) })
  })

  it('checked with corrections → the expert\'s text and «Проверено экспертом: Алия, 16.11.2026»', async () => {
    h.diag = { ...base, ai_reviewed_at: '2026-11-16T09:00:00Z', ai_reviewed_by_name: 'Алия', ai_expert_edits: { executive_summary: 'Текст эксперта', blocks: { finance: { key_risk: 'кассовый разрыв' } } } }
    await get()
    expect(h.pdf[0]).toMatchObject({ executiveSummary: 'Текст эксперта', aiNote: 'Проверено экспертом: Алия, 16.11.2026' })
    expect((h.pdf[0].blocks as Array<{ key: string; key_risk?: string }>).find((b) => b.key === 'finance')?.key_risk).toBe('кассовый разрыв')
  })

  it('a partial analysis is labelled partial; no AI text → no label', async () => {
    h.diag = { ...base, ai_status: 'failed', ai_analysis: { ...AI, partial: ['blocksB'] } }
    await get()
    expect(h.pdf[0].aiNote).toContain('Часть разбора не получилась')
    h.diag = { ...base, ai_status: 'none', ai_analysis: null }
    await get()
    expect(h.pdf[1].aiNote).toBeNull()
  })
})
