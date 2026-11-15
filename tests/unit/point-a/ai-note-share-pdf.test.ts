/**
 * R3-PA: the AI analysis is a draft everywhere the client can take it away —
 * the share link (/r/[token]) and the PDF carry «Черновик ИИ — эксперт
 * проверит» (or «Проверено экспертом: …») and show the expert's corrections
 * over the AI text, the same as the Point A page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPointAView } from '@/lib/share/report-data'
import { renderPointAPdf } from '@/lib/reports/pdf'
import { AI_DRAFT_LABEL } from '@/lib/point-a/ai-review'

const OWNER = '11111111-1111-4111-8111-111111111111'
const AI = {
  executive_summary: 'ИИ: бизнес растёт', industry_context: 'норма',
  strategic_priorities: [{ title: 'Повторные продажи', rationale: 'r', expected_impact: 'e' }],
  growth_roadmap: [{ horizon: '30_days', actions: ['a'] }],
  blocks: { finance: { diagnosis: 'маржа ок', benchmark_comparison: '', key_risk: 'нет плана', top_recommendation: 'бюджет' } },
  model_used: 'm', generated_at: '2026-11-15T10:00:00Z',
}

function stubRest(diag: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/rest/v1/diagnostics')) return new Response(JSON.stringify([diag]), { status: 200 })
    return new Response('[]', { status: 200 })
  }))
}

const subject = { companyId: 'co', userId: OWNER, companyName: 'ТОО', industry: 'Розница', stage: 'early' }
const base = { id: 'd-1', user_id: OWNER, is_current: true, overall_score: 61, health_index: 50, stage: 'growth', risks: [], insights: [], quick_wins: [], data_gaps: [], ai_status: 'completed', ai_analysis: AI }

afterEach(() => vi.unstubAllGlobals())

describe('share link view of Point A', () => {
  it('an unchecked analysis is labelled a draft', async () => {
    stubRest(base)
    const v = await loadPointAView(subject)
    expect(v?.executiveSummary).toBe('ИИ: бизнес растёт')
    expect(v?.aiNote).toContain(AI_DRAFT_LABEL)
  })

  it('checked by an expert: «Проверено экспертом: …» and the expert\'s text', async () => {
    stubRest({ ...base, ai_reviewed_at: '2026-11-16T09:00:00Z', ai_reviewed_by_name: 'Алия', ai_expert_edits: { executive_summary: 'Текст эксперта', blocks: { finance: { key_risk: 'кассовый разрыв' } } } })
    const v = await loadPointAView(subject)
    expect(v?.aiNote).toBe('Проверено экспертом: Алия, 16.11.2026')
    expect(v?.executiveSummary).toBe('Текст эксперта')
    expect(v?.blocks.find((b) => b.key === 'finance')?.key_risk).toBe('кассовый разрыв')
  })

  it('no AI text → no label', async () => {
    stubRest({ ...base, ai_status: 'none', ai_analysis: null })
    const v = await loadPointAView(subject)
    expect(v?.aiNote).toBeNull()
  })
})

describe('the PDF', () => {
  it('renders with the AI label', async () => {
    const buf = await renderPointAPdf({
      meta: { companyName: 'ТОО', industry: null, stage: null }, overallScore: 61, healthIndex: 50,
      executiveSummary: 'Резюме', blocks: [], aiNote: `${AI_DRAFT_LABEL}. Разбор подготовлен ИИ.`,
    })
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('the export route passes the label (source)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/api/export/report/route.ts', 'utf8')
    expect(src).toContain('aiNote: ai ? aiAnalysisNote(aiView) : null')
    expect(readFileSync('lib/reports/pdf.ts', 'utf8')).toMatch(/if \(input\.aiNote\) paragraph\(doc, input\.aiNote/)
  })
})
