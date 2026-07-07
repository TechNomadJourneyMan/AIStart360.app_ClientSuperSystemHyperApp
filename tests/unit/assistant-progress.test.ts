import { describe, it, expect } from 'vitest'
import { formatSurveyProgress } from '@/lib/assistant/answer'
import type { CompletionReport, SectionCompletion } from '@/lib/assistant/types'

function mkSection(step: number, pct: number, label: string): SectionCompletion {
  return {
    section: `s${step}`,
    label,
    step,
    pct,
    missing_required: [],
    missing_recommended: [],
    required_total: 2,
    required_filled: pct === 100 ? 2 : pct === 50 ? 1 : 0,
  }
}

function mkReport(overall_pct: number, sections: SectionCompletion[]): CompletionReport {
  return { overall_pct, sections, status: 'in_progress', missing_required: [], missing_recommended: [] }
}

describe('formatSurveyProgress (GRI-02)', () => {
  it('reports overall %, completed count, and the next incomplete section (ru)', () => {
    const report = mkReport(40, [
      mkSection(1, 100, 'О компании'),
      mkSection(3, 0, 'Позиционирование'),
      mkSection(2, 50, 'Цели'),
    ])
    const out = formatSurveyProgress(report, 'ru')
    expect(out).toContain('ПРОГРЕСС АНКЕТЫ')
    expect(out).toContain('40%')
    expect(out).toContain('1/3')
    // lowest-step section with pct < 100 is step 2 'Цели'
    expect(out).toContain('Цели (шаг 2, 50%)')
  })

  it('says all sections complete when everything is 100% (ru)', () => {
    const report = mkReport(100, [mkSection(1, 100, 'A'), mkSection(2, 100, 'B')])
    expect(formatSurveyProgress(report, 'ru')).toContain('все разделы заполнены')
  })

  it('renders English for the en locale', () => {
    const report = mkReport(20, [mkSection(1, 20, 'Company')])
    const out = formatSurveyProgress(report, 'en')
    expect(out).toContain('SURVEY PROGRESS')
    expect(out).toContain('Next incomplete section')
  })
})
