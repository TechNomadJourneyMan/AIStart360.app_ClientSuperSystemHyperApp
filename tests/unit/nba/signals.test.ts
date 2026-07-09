import { describe, it, expect } from 'vitest'
import { buildNbaSignals, type NbaSignalInput } from '@/lib/nba/signals'

const keys = (r: ReturnType<typeof buildNbaSignals>) => r.map((s) => s.key)

describe('buildNbaSignals', () => {
  it('emits nothing but onboarding help for an empty new user', () => {
    const sig = buildNbaSignals({ surveyCompletion: 0 })
    expect(keys(sig)).toContain('survey_incomplete')
    // no report/crm/plan yet
    expect(keys(sig)).not.toContain('red_zone')
    expect(keys(sig)).not.toContain('crm_overdue')
  })

  it('builds a CRM-overdue signal with the item count for the bonus', () => {
    const sig = buildNbaSignals({ crmOverdue: { count: 3, sampleName: 'Иван' } })
    const s = sig.find((x) => x.key === 'crm_overdue')!
    expect(s.active).toBe(true)
    expect(s.count).toBe(3)
    expect(s.reason).toContain('Иван')
    expect(s.cta.href).toContain('/')
  })

  it('picks only the single worst red block, not every weak block', () => {
    const sig = buildNbaSignals({
      redBlocks: [
        { key: 'sales', label: 'Продажи', score: 48 },
        { key: 'finance', label: 'Финансы', score: 30 },
      ],
    })
    const reds = sig.filter((s) => s.key === 'red_zone')
    expect(reds).toHaveLength(1)
    expect(reds[0].actionKey).toBe('red_zone:finance') // 30 < 48
  })

  it('maps the GRI main limitation to a gri_limit signal', () => {
    const sig = buildNbaSignals({
      griMainLimit: { criterionText: 'Нет скриптов продаж', blockName: 'Продажи' },
    })
    const s = sig.find((x) => x.key === 'gri_limit')!
    expect(s.title.length).toBeGreaterThan(0)
    expect(s.reason).toContain('Продажи')
  })

  it('flags an unfinished survey below 70%', () => {
    expect(keys(buildNbaSignals({ surveyCompletion: 0.5 }))).toContain('survey_incomplete')
    expect(keys(buildNbaSignals({ surveyCompletion: 0.8 }))).not.toContain('survey_incomplete')
  })

  it('surfaces the next plan task with a stable actionKey', () => {
    const sig = buildNbaSignals({ planNextTask: { id: 't42', title: 'Позвонить лидам' } })
    const s = sig.find((x) => x.key === 'plan_task')!
    expect(s.actionKey).toBe('plan_task:t42')
  })

  it('flags a stale pulse (>14 days) and a due re-scan (>90 days)', () => {
    expect(keys(buildNbaSignals({ daysSincePulse: 20 }))).toContain('pulse_stale')
    expect(keys(buildNbaSignals({ daysSincePulse: 5 }))).not.toContain('pulse_stale')
    expect(keys(buildNbaSignals({ griAssessmentAgeDays: 100 }))).toContain('gri_rescan')
  })

  it('suggests the psych profile only when a report exists but the profile does not', () => {
    expect(keys(buildNbaSignals({ hasReport: true, hasPsychProfile: false }))).toContain('psych_missing')
    expect(keys(buildNbaSignals({ hasReport: true, hasPsychProfile: true }))).not.toContain('psych_missing')
    expect(keys(buildNbaSignals({ hasReport: false, hasPsychProfile: false }))).not.toContain('psych_missing')
  })

  it('suggests uploading documents only once the survey is largely done', () => {
    expect(keys(buildNbaSignals({ surveyCompletion: 0.9, documentsCount: 0 }))).toContain('docs_missing')
    expect(keys(buildNbaSignals({ surveyCompletion: 0.9, documentsCount: 2 }))).not.toContain('docs_missing')
    expect(keys(buildNbaSignals({ surveyCompletion: 0.3, documentsCount: 0 }))).not.toContain('docs_missing')
  })

  it('every emitted signal is active and carries a title, reason and cta', () => {
    const sig = buildNbaSignals({
      crmOverdue: { count: 1 },
      redBlocks: [{ key: 'finance', label: 'Финансы', score: 20 }],
      griMainLimit: { criterionText: 'X', blockName: 'Y' },
      surveyCompletion: 0.5,
      planNextTask: { id: 't1', title: 'Z' },
      daysSincePulse: 30,
    })
    for (const s of sig) {
      expect(s.active).toBe(true)
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.reason.length).toBeGreaterThan(0)
      expect(s.cta.href.length).toBeGreaterThan(0)
    }
  })
})
