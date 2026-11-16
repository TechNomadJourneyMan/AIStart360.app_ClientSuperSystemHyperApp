/**
 * R3-PA (решение PO «гибрид», П1а/П1б): the AI analysis as the client sees it —
 * a draft until an expert checks it, the expert's corrections laid over the AI
 * text, a partial analysis named as such; the diagnosis codes of a generation.
 * lib/point-a/ai-review.ts (pure).
 */
import { describe, expect, it } from 'vitest'
import {
  AI_DRAFT_LABEL, AI_ERROR_MAX, AiExpertEditsSchema, aiAnalysisNote, aiAnalysisView, aiErrorOf, aiFailureText, aiModelOf,
  applyExpertEdits, analysisContent, clipAiError, missingPartsOf, readExpertEdits, type PointAAnalysisReport,
} from '@/lib/point-a/ai-review'

const AI = {
  executive_summary: 'Бизнес растёт, маржа 22 %.',
  industry_context: 'Для отрасли норма 20–25 %.',
  strategic_priorities: [{ title: 'Повторные продажи', rationale: 'База есть', expected_impact: '+10 %' }],
  growth_roadmap: [{ horizon: '30_days', actions: ['Посчитать CAC', 'Письмо выпускникам'] }],
  blocks: { finance: { diagnosis: 'Маржа ок', benchmark_comparison: 'На уровне', key_risk: 'Нет плана', top_recommendation: 'Бюджет' } },
  model_used: 'anthropic/claude-haiku-4.5 + qwen3-8',
  generated_at: '2026-11-15T10:00:00.000Z',
}

const report = (parts: Partial<PointAAnalysisReport['parts']>): PointAAnalysisReport => ({
  parts: {
    summary: { ok: true, failure: null, model: 'anthropic/claude-haiku-4.5' },
    priorities: { ok: true, failure: null, model: 'anthropic/claude-haiku-4.5' },
    blocksA: { ok: true, failure: null, model: 'qwen3-8' },
    blocksB: { ok: true, failure: null, model: 'qwen3-8' },
    ...parts,
  },
  startedAt: '2026-11-15T10:00:00.000Z',
  finishedAt: '2026-11-15T10:00:40.000Z',
})

describe('diagnosis codes of a generation (ai_error / ai_model)', () => {
  it('names the failed part and the kind: «part:kind; …»; null when every part came', () => {
    expect(aiErrorOf(report({}))).toBeNull()
    expect(aiErrorOf(report({ blocksB: { ok: false, failure: 'cut', model: 'qwen3-8' } }))).toBe('blocksB:cut')
    expect(aiErrorOf(report({ summary: { ok: false, failure: 'schema', model: null }, blocksA: { ok: false, failure: 'http_502', model: null } }))).toBe('summary:schema; blocksA:http_502')
    expect(aiErrorOf(report({ priorities: { ok: false, failure: null, model: null } }))).toBe('priorities:error')
  })

  it('the models that answered, in part order, without repeats', () => {
    expect(aiModelOf(report({}))).toBe('anthropic/claude-haiku-4.5 + qwen3-8')
    expect(aiModelOf(report({ summary: { ok: false, failure: 'timeout', model: null }, priorities: { ok: false, failure: 'timeout', model: null }, blocksA: { ok: false, failure: 'x', model: null }, blocksB: { ok: false, failure: 'x', model: null } }))).toBeNull()
  })

  it('a code is one line within the column limit (CHECK of migration 150)', () => {
    const long = clipAiError(`a\nb ${'x'.repeat(600)}`)
    expect(long.length).toBe(AI_ERROR_MAX)
    expect(long).not.toContain('\n')
  })
})

describe('the view of a diagnostics row', () => {
  it('a completed analysis without a review is a DRAFT («Черновик ИИ — эксперт проверит»)', () => {
    const v = aiAnalysisView({ id: 'd1', ai_status: 'completed', ai_analysis: AI, ai_model: 'm', ai_generated_at: '2026-11-15T10:00:40Z' })!
    expect(v).toMatchObject({ diagnosticId: 'd1', status: 'completed', draft: true, review: null, editedByExpert: [], model: 'm', generatedAt: '2026-11-15T10:00:40Z' })
    expect(v.analysis?.executive_summary).toBe(AI.executive_summary)
    expect(v.analysis?.growth_roadmap[0].actions).toEqual(['Посчитать CAC', 'Письмо выпускникам'])
    expect(aiAnalysisNote(v)).toContain(AI_DRAFT_LABEL)
  })

  it('checked by an expert: «Проверено экспертом: имя, дата», the corrections over the AI text, the AI text itself untouched', () => {
    const edits = { executive_summary: 'Текст эксперта', blocks: { finance: { key_risk: 'Кассовый разрыв в марте' } }, note: 'Сверил с ОПиУ' }
    const row = { id: 'd1', ai_status: 'completed', ai_analysis: AI, ai_reviewed_at: '2026-11-16T09:00:00Z', ai_reviewed_by_name: 'Алия', ai_expert_edits: edits }
    const v = aiAnalysisView(row)!
    expect(v.draft).toBe(false)
    expect(v.review).toEqual({ by: 'Алия', at: '2026-11-16T09:00:00Z' })
    expect(v.analysis?.executive_summary).toBe('Текст эксперта')
    expect(v.analysis?.blocks.finance).toMatchObject({ diagnosis: 'Маржа ок', key_risk: 'Кассовый разрыв в марте' })
    expect(v.editedByExpert).toEqual(['executive_summary', 'blocks.finance'])
    expect(v.expertNote).toBe('Сверил с ОПиУ')
    expect(row.ai_analysis.executive_summary).toBe(AI.executive_summary)
    expect(aiAnalysisNote(v)).toMatch(/^Проверено экспертом: Алия, 16\.11\.2026$/)
  })

  it('a partial analysis (ai_status failed + ai_analysis.partial) shows what came and names what did not', () => {
    const partial = { ...AI, growth_roadmap: [], blocks: { finance: AI.blocks.finance }, partial: ['blocksB'] }
    const v = aiAnalysisView({ id: 'd1', ai_status: 'failed', ai_analysis: partial, ai_error: 'blocksB:cut' })!
    expect(v.status).toBe('partial')
    expect(v.missingParts).toEqual(['blocksB'])
    expect(v.errorCode).toBe('blocksB:cut')
    expect(v.analysis?.executive_summary).toBe(AI.executive_summary)
    expect(aiFailureText(v)).toContain('разбор маркетинга и стратегии, план 30/90/180 дней')
  })

  it('failed without text → «не удался»; failed keeping an earlier analysis → says it is the previous one', () => {
    expect(aiAnalysisView({ id: 'd1', ai_status: 'failed', ai_analysis: null })).toMatchObject({ status: 'failed', analysis: null })
    expect(aiFailureText(aiAnalysisView({ id: 'd1', ai_status: 'failed', ai_analysis: null })!)).toBe('Разбор ИИ не удался.')
    const kept = aiAnalysisView({ id: 'd1', ai_status: 'failed', ai_analysis: AI })!
    expect(kept.status).toBe('failed')
    expect(aiFailureText(kept)).toContain('предыдущий вариант')
  })

  it('processing / none; a narrative stored in ai_analysis before 091 is not an analysis; no id → null', () => {
    expect(aiAnalysisView({ id: 'd1', ai_status: 'processing', ai_analysis: null })?.status).toBe('processing')
    expect(aiAnalysisView({ id: 'd1', ai_status: 'none', ai_analysis: AI })).toMatchObject({ status: 'none', analysis: null })
    expect(aiAnalysisView({ id: 'd1', ai_status: 'completed', ai_analysis: { executive_summary: 'x', strengths_text: 'y' } })?.analysis).toBeNull()
    expect(aiAnalysisView(null)).toBeNull()
    expect(aiAnalysisView({ ai_status: 'completed' })).toBeNull()
  })
})

describe('the expert corrections (ai_expert_edits)', () => {
  it('only known fields; an invalid value is ignored by readers, never thrown', () => {
    expect(AiExpertEditsSchema.safeParse({ executive_summary: 'ok' }).success).toBe(true)
    expect(AiExpertEditsSchema.safeParse({ unknown_field: 'x' }).success).toBe(false)
    expect(AiExpertEditsSchema.safeParse({ growth_roadmap: [{ horizon: '7_days', actions: ['a'] }] }).success).toBe(false)
    expect(readExpertEdits(['not', 'an', 'object'])).toBeNull()
    expect(readExpertEdits({ blocks: { finance: { key_risk: '' } } })).toBeNull()
  })

  it('an expert may write the whole text where the AI gave none', () => {
    const { content, edited } = applyExpertEdits(null, { executive_summary: 'Только эксперт' })
    expect(content?.executive_summary).toBe('Только эксперт')
    expect(edited).toEqual(['executive_summary'])
    expect(applyExpertEdits(analysisContent(AI as never), null).edited).toEqual([])
  })

  it('the partial marker is read only from a list of known parts', () => {
    expect(missingPartsOf({ partial: ['blocksB', 'nope'] })).toEqual(['blocksB'])
    expect(missingPartsOf({ partial: 'blocksB' })).toEqual([])
  })
})
