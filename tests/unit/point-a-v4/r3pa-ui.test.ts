/**
 * R3-PA — the Point A page for the paying client (rendered to markup):
 *   П1б  «Разбор ИИ» on the main page: «Черновик ИИ — эксперт проверит» until an
 *        expert checks it, then «Проверено экспертом: имя, дата»; готовится /
 *        не удался — «Повторить» (owner and staff only) / частично;
 *   П6   PDF and «Поделиться» in the header of a scored Point A (owner, staff);
 *   П5   «Минимум для Точки А» = the rule, «до оценки осталось N», the button
 *        «Отправить анкету — получить оценку» → the questionnaire's final step;
 *   B6   a failed block panel offers «Повторить»;
 *   GRI on 0–10; «ориентир не проверен экспертом»; stale documents said so.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/client/point-a', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

const { previewState } = await import('@/app/dev/point-a-preview/fixture')
const { AiAnalysisCard } = await import('@/components/point-a-v4/AiAnalysisCard')
const { ScorePathCard, SEND_SURVEY_HREF } = await import('@/components/point-a-v4/ScorePathCard')
const { PointAHeader, canExportPointA } = await import('@/components/point-a-v4/PointAHeader')
const { GriCard, BenchmarksCard, SourcesCard, BENCHMARKS_UNAPPROVED_NOTE } = await import('@/components/point-a-v4/SideCards')
const { BlockLoadError } = await import('@/components/point-a-v4/BlockDetailPanel')
const { aiAnalysisView, AI_DRAFT_LABEL } = await import('@/lib/point-a/ai-review')
const { pointAScorePath } = await import('@/lib/point-a/v4/score-path')

const html = (el: ReactElement) => renderToStaticMarkup(el)
const AI = { executive_summary: 'Бизнес растёт', industry_context: 'Норма', strategic_priorities: [{ title: 'Повторные продажи', rationale: 'r', expected_impact: '+10 %' }], growth_roadmap: [{ horizon: '30_days', actions: ['Посчитать CAC'] }], blocks: { finance: { diagnosis: 'Маржа ок', key_risk: 'Нет плана' } } }
const card = (row: Record<string, unknown>, props: Partial<{ canRetry: boolean; showDiagnosis: boolean }> = {}) =>
  html(createElement(AiAnalysisCard, { ai: aiAnalysisView({ id: 'd-1', ...row })!, canRetry: props.canRetry ?? true, onRetry: () => undefined, showDiagnosis: props.showDiagnosis ?? false }))

describe('«Разбор ИИ» (П1б)', () => {
  it('a completed analysis is shown at once as a DRAFT: summary, priorities, plan 30/90/180, blocks', () => {
    const out = card({ ai_status: 'completed', ai_analysis: AI, ai_generated_at: '2026-11-15T10:00:00Z' })
    expect(out).toContain('Разбор ИИ')
    expect(out).toContain(AI_DRAFT_LABEL)
    expect(out).toContain('data-ai-draft')
    expect(out).toContain('Проверено экспертом') // the place for the future mark is explained
    for (const t of ['Бизнес растёт', 'Повторные продажи', 'План 30 / 90 / 180 дней', '30 дней', 'Посчитать CAC', 'Финансы', 'Маржа ок']) expect(out).toContain(t)
    expect(out).toContain('Подготовлен 15.11.2026')
    expect(out).not.toContain('модель:')
  })

  it('checked by an expert: «Проверено экспертом: Алия, 16.11.2026» instead of the draft mark; corrections marked', () => {
    const out = card({ ai_status: 'completed', ai_analysis: AI, ai_reviewed_at: '2026-11-16T09:00:00Z', ai_reviewed_by_name: 'Алия', ai_expert_edits: { executive_summary: 'Текст эксперта', note: 'Сверил' } })
    expect(out).toContain('Проверено экспертом: Алия, 16.11.2026')
    expect(out).not.toContain('data-ai-draft')
    expect(out).toContain('Текст эксперта')
    expect(out).not.toContain('Бизнес растёт')
    expect(out).toContain('поправлено экспертом')
    expect(out).toContain('Комментарий эксперта к разбору')
  })

  it('готовится → a live status; не удался → «Повторить разбор» for the owner / staff only; the code for staff only', () => {
    expect(card({ ai_status: 'processing', ai_analysis: null })).toContain('Разбор готовится')
    const failed = card({ ai_status: 'failed', ai_analysis: null, ai_error: 'summary:schema' })
    expect(failed).toContain('Разбор ИИ не удался.')
    expect(failed).toMatch(/Повторить разбор<\/button>/)
    expect(failed).not.toContain('summary:schema')
    const member = card({ ai_status: 'failed', ai_analysis: null }, { canRetry: false })
    expect(member).not.toMatch(/Повторить разбор<\/button>/)
    expect(member).toContain('Повторить разбор может владелец компании')
    expect(card({ ai_status: 'failed', ai_analysis: null, ai_error: 'summary:schema', ai_model: 'qwen3-8' }, { showDiagnosis: true })).toMatch(/Причина: summary:schema[\s\S]*модель: qwen3-8/)
  })

  it('partial: what came is shown, what did not is named, with «Повторить»', () => {
    const out = card({ ai_status: 'failed', ai_analysis: { ...AI, partial: ['blocksB'] }, ai_error: 'blocksB:cut' })
    expect(out).toContain('data-ai-status="partial"')
    expect(out).toContain('Часть разбора не получилась: разбор маркетинга и стратегии, план 30/90/180 дней')
    expect(out).toContain('Бизнес растёт')
    expect(out).toContain('Повторить разбор')
  })

  it('status none (not requested) → nothing', () => {
    expect(card({ ai_status: 'none', ai_analysis: AI })).toBe('')
  })
})

describe('the header: PDF and «Поделиться» (П6), «Отправить анкету» (П5)', () => {
  const header = (state: ReturnType<typeof previewState>) => html(createElement(PointAHeader, { state, onRecalc: () => undefined, recalcPending: false, customize: false, onCustomize: () => undefined }))

  it('a scored Point A: the owner gets «Скачать PDF» and «Поделиться»', () => {
    const state = previewState('full')
    expect(canExportPointA(state)).toBe(true)
    const out = header(state)
    expect(out).toContain('data-point-a-pdf')
    expect(out).toContain('Скачать PDF')
    expect(out).toContain('Поделиться')
    expect(out).not.toContain('data-send-survey')
  })

  it('a company member who is not the owner (the export routes refuse) → no PDF / share; staff → yes', () => {
    expect(canExportPointA({ ...previewState('full'), viewerIsOwner: false, role: 'member' })).toBe(false)
    expect(canExportPointA({ ...previewState('full'), viewerIsOwner: false, role: 'staff' })).toBe(true)
  })

  it('preliminary (survey not sent): no PDF, the visible «Отправить анкету — получить оценку» → the final step', () => {
    const state = previewState('preliminary')
    expect(canExportPointA(state)).toBe(false)
    const out = header(state)
    expect(out).not.toContain('data-point-a-pdf')
    expect(out).toContain(`href="${SEND_SURVEY_HREF.replace('&', '&amp;')}"`)
    expect(out).toContain('Отправить анкету — получить оценку')
    expect(SEND_SURVEY_HREF).toBe('/client/onboarding?step=review')
  })
})

describe('«Минимум для Точки А» (П5)', () => {
  const block = (key: string, weight: number, answered: number) => ({
    key, weight, score: answered >= 2 ? 70 : null,
    checks: Array.from({ length: 5 }, (_, i) => ({ id: `${key}${i}`, max: 10, answered: i < answered, missing: `Ответить: ${key} ${i}` })),
  })

  it('names the rule, how many items are left and where; the owner gets the buttons', () => {
    const path = pointAScorePath([block('finance', 0.3, 0), block('marketing', 0.4, 3), block('operations', 0.3, 3)], { surveySent: false })
    const out = html(createElement(ScorePathCard, { path, viewerIsOwner: true }))
    expect(out).toContain('Минимум для Точки А')
    expect(out).toContain('До оценки осталось 2 пункта: «Финансы» — 2 — и отправить анкету.')
    expect(out).toContain('не меньше 60 % веса')
    expect(out).toContain('Ответить: finance 0')
    expect(out).toContain('Отправить анкету — получить оценку')
    expect(out).toContain('Дозаполнить анкету')
    expect(html(createElement(ScorePathCard, { path, viewerIsOwner: false }))).not.toContain('Отправить анкету — получить оценку')
  })

  it('data is enough and the survey sent → nothing to show', () => {
    const path = pointAScorePath([block('finance', 1, 3)], { surveySent: true })
    expect(html(createElement(ScorePathCard, { path, viewerIsOwner: true }))).toBe('')
  })
})

describe('side cards and the block panel', () => {
  it('GRI on 0–10 (5.8 из 10), never «из 100»', () => {
    const out = html(createElement(GriCard, { gri: { index: 5.8, assessedAt: null } }))
    expect(out).toContain('>5.8<')
    expect(out).toContain('из 10')
    expect(out).not.toContain('из 100')
    expect(html(createElement(GriCard, { gri: { index: null, assessedAt: null } }))).toContain('Пройти оценку GRI')
  })

  it('the industry comparison says «ориентир не проверен экспертом» until approved', () => {
    const b = { industry: 'Розница', stage: 'early', source: 'экспертная оценка, не статистика', overall: 55, blocks: [], approved: false }
    expect(html(createElement(BenchmarksCard, { benchmarks: b }))).toContain(BENCHMARKS_UNAPPROVED_NOTE)
    expect(html(createElement(BenchmarksCard, { benchmarks: { ...b, approved: true } }))).not.toContain(BENCHMARKS_UNAPPROVED_NOTE)
    expect(BENCHMARKS_UNAPPROVED_NOTE).toMatch(/^Ориентир не проверен экспертом/)
  })

  it('documents stuck for days: «N не обработаны — загрузите заново», not «в работе»', () => {
    const sources = { ...previewState('full').sources, documents: { parsed: 2, processing: 0, failed: 0, stale: 3 } }
    const out = html(createElement(SourcesCard, { sources }))
    expect(out).toContain('3 не обработаны — загрузите заново')
    expect(out).not.toContain('в работе')
  })

  it('a failed block panel offers «Повторить» (B6)', () => {
    let retried = 0
    const out = html(createElement(BlockLoadError, { onRetry: () => { retried += 1 } }))
    expect(out).toContain('Не удалось загрузить раздел.')
    expect(out).toContain('Повторить')
    expect(retried).toBe(0)
  })
})
