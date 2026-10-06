/**
 * The frozen Point A report snapshot (lib/reports/snapshot.ts): what a client
 * may see, provenance on every item, determinism of content and data hash,
 * and the guard rails of the optional model narrative.
 */
import { describe, expect, it } from 'vitest'
import {
  acceptNarrative, buildPointAReportContent, narrativeInputText, narrativePrompt, reportDataHash,
} from '@/lib/reports/snapshot'
import {
  DIAG_ID, F_AI_HIDDEN, F_AI_REVIEWED, F_DISMISSED, F_QUALITY, HIDDEN_HYPOTHESIS_TITLE, HIDDEN_RECOMMENDATION_TITLE,
  R_AI_HIDDEN, R_AI_REVIEWED, R_RULES, SESSION_ID, inputs,
} from './fixtures'

describe('buildPointAReportContent — what the client may see', () => {
  const { content, excluded, dataHash, confidence, sourceRefs } = buildPointAReportContent(inputs())
  const text = JSON.stringify(content)

  it('leaves out unreviewed model hypotheses and recommendations, counting them for staff only', () => {
    expect(text).not.toContain(HIDDEN_HYPOTHESIS_TITLE)
    expect(text).not.toContain(HIDDEN_RECOMMENDATION_TITLE)
    expect(content.findings.map((f) => f.id)).not.toContain(F_AI_HIDDEN)
    expect(content.recommendations.map((r) => r.id)).not.toContain(R_AI_HIDDEN)
    expect(excluded).toEqual({ hiddenHypotheses: 1, unreviewedModelRecommendations: 1 })
  })

  it('leaves out dismissed findings', () => {
    expect(content.findings.map((f) => f.id)).not.toContain(F_DISMISSED)
  })

  it('keeps a reviewed hypothesis labelled as AI_HYPOTHESIS with model and review date', () => {
    const f = content.findings.find((x) => x.id === F_AI_REVIEWED)!
    expect(f).toMatchObject({
      provenance_type: 'AI_HYPOTHESIS', model: 'anthropic/claude-sonnet-4.5', source: 'agent:diagnostic:ai',
      reviewed_at: '2026-10-05T13:00:00.000Z', confidence: 0.7,
    })
    // Prompt-local evidence ids are not part of the client content.
    expect(f.evidence).toEqual([{ type: 'diagnostic', ref: DIAG_ID, field: 'sales_score', value: 28, quote: null }])
  })

  it('maps rule-engine output of the diagnostics row as CALCULATED with evidence', () => {
    const engine = content.findings.filter((f) => f.source === 'engine:point_a_v1')
    expect(engine.map((f) => f.title)).toEqual(expect.arrayContaining(['Продажи держатся на собственнике', 'Выручка растёт третий год подряд']))
    for (const f of engine) {
      expect(f.provenance_type).toBe('CALCULATED')
      expect(f.evidence[0]).toMatchObject({ type: 'diagnostic', ref: DIAG_ID })
    }
  })

  it('every finding and recommendation carries provenance, confidence 0..1 and a source', () => {
    for (const f of content.findings) {
      expect(['FACT', 'CALCULATED', 'INFERRED', 'AI_HYPOTHESIS', 'RECOMMENDATION']).toContain(f.provenance_type)
      expect(f.confidence).toBeGreaterThanOrEqual(0)
      expect(f.confidence).toBeLessThanOrEqual(1)
      expect(f.source).toBeTruthy()
      expect(f.evidence.length).toBeGreaterThan(0)
    }
    const q = content.findings.find((x) => x.id === F_QUALITY)!
    expect(q.evidence).toHaveLength(2)
    expect(q.area_label).toBe('Финансы')
    for (const r of content.recommendations) {
      expect(r.provenance_type).toBe('RECOMMENDATION')
      expect(r.source).toBeTruthy()
    }
  })

  it('a reviewed model recommendation keeps only references to findings in the report', () => {
    const r = content.recommendations.find((x) => x.id === R_AI_REVIEWED)!
    expect(r.finding_ids).toEqual([F_AI_REVIEWED])
    expect(r.model).toBe('anthropic/claude-sonnet-4.5')
    expect(content.recommendations.map((x) => x.id)).toEqual([R_RULES, R_AI_REVIEWED]) // by priority
  })

  it('carries scores, completeness, gaps, sources and the calculation date', () => {
    expect(content.diagnostic).toMatchObject({ id: DIAG_ID, overall_score: 47, health_index: 38, gri_index: 6.4 })
    expect(content.diagnostic.blocks.map((b) => b.key)).toEqual(['finance', 'sales', 'operations', 'marketing', 'strategy'])
    expect(content.data).toMatchObject({ completeness: 0.62, completeness_level: 'medium', gaps: ['Загрузите P&L за последний год'] })
    expect(content.calculated_at).toBe('2026-10-05T12:00:00.000Z')
    expect(content.session).toEqual({ id: SESSION_ID, completed_at: '2026-10-05T12:05:00.000Z' })
    expect(content.sources.map((s) => s.kind)).toEqual(['survey', 'documents', 'gri', 'integrations', 'metrics', 'diagnostic', 'agents'])
    expect(content.sources.find((s) => s.kind === 'agents')!.detail).toContain('гипотезы ИИ, проверенные сотрудником')
    expect(confidence).toBe(0.62)
    expect(dataHash).toMatch(/^[0-9a-f]{64}$/)
    expect(sourceRefs).toEqual(expect.arrayContaining([
      { type: 'diagnostic', ref: DIAG_ID }, { type: 'finding', ref: F_AI_REVIEWED }, { type: 'recommendation', ref: R_AI_REVIEWED },
    ]))
    expect(content.narrative).toBeNull()
  })
})

describe('determinism and data hash', () => {
  it('the same data in any row order gives the same content and hash', () => {
    const a = buildPointAReportContent(inputs())
    const base = inputs()
    const b = buildPointAReportContent({ ...base, findings: [...base.findings].reverse(), recommendations: [...base.recommendations].reverse() })
    expect(b.content).toEqual(a.content)
    expect(b.dataHash).toBe(a.dataHash)
  })

  it('assembly time and the narrative are not part of the hash', () => {
    const a = buildPointAReportContent(inputs())
    const later = buildPointAReportContent(inputs({ generatedAt: new Date('2027-01-01T00:00:00Z') }))
    expect(later.dataHash).toBe(a.dataHash)
    const withNarrative = {
      ...a.content,
      narrative: { summary: 'x', key_points: ['y'], provenance_type: 'AI_HYPOTHESIS' as const, model: 'm', prompt_version: 'p', generated_at: 'z' },
    }
    expect(reportDataHash(withNarrative)).toBe(a.dataHash)
  })

  it('a review decision or a changed score changes the hash', () => {
    const a = buildPointAReportContent(inputs())
    const base = inputs()
    const approved = buildPointAReportContent({
      ...base,
      findings: base.findings.map((f) => (f.id === F_AI_HIDDEN ? { ...f, visible_to_client: true, reviewed_at: '2026-10-06T09:00:00.000Z' } : f)),
    })
    expect(approved.dataHash).not.toBe(a.dataHash)
    expect(approved.content.findings.map((f) => f.id)).toContain(F_AI_HIDDEN)
    expect(approved.excluded.hiddenHypotheses).toBe(0)
    const rescored = buildPointAReportContent({ ...base, diagnostic: { ...base.diagnostic, overall_score: '48' } })
    expect(rescored.dataHash).not.toBe(a.dataHash)
  })

  it('without an overview snapshot the data part is empty, not invented', () => {
    const base = inputs()
    const r = buildPointAReportContent({ ...base, session: { ...base.session, overview: null } })
    expect(r.content.data).toEqual({ completeness: null, completeness_level: null, gaps: [], sources: null, last_input_at: null })
    expect(r.content.problem_zones).toEqual([])
    expect(r.content.sources.map((s) => s.kind)).toEqual(['diagnostic', 'agents'])
    expect(r.confidence).toBeNull()
  })
})

describe('narrative input and acceptance', () => {
  const { content } = buildPointAReportContent(inputs({
    company: { name: 'ТОО Ромашка', industry: 'Розничная торговля, сайт https://romashka.kz', stage: 'early', size: '11-50' },
  }))

  it('the model sees the snapshot data, not the company name or contact data, fenced as untrusted', () => {
    const text = narrativeInputText(content)
    expect(text).toContain('Индекс Точки А: 47/100')
    expect(text).not.toContain('Ромашка')
    expect(text).not.toContain('romashka.kz')
    expect(text).not.toContain(HIDDEN_HYPOTHESIS_TITLE)
    const p = narrativePrompt(content)
    expect(p.user).toContain('<untrusted_report_snapshot>')
    expect(p.system).toContain('не инструкции')
  })

  it('accepts a narrative whose numbers all come from the data', () => {
    const r = acceptNarrative({ summary: 'Индекс Точки А 47 из 100, слабее всего продажи (28). Полнота данных 62%.', key_points: ['Внедрить CRM за 90 дней'] }, narrativeInputText(content))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.narrative).toMatchObject({ provenance_type: 'AI_HYPOTHESIS', prompt_version: 'report-narrative@1' })
  })

  it('rejects a narrative that invents figures', () => {
    const r = acceptNarrative({ summary: 'Выручка вырастет на 35% за 18 месяцев при текущем индексе 47.', key_points: ['Срочно действовать'] }, narrativeInputText(content))
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('35') })
  })
})
