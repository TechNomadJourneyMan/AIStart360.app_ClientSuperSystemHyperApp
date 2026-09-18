import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import {
  SURVEY_KEY_STEP,
  SURVEY_TOTAL_STEPS,
  stepForQuestionKey,
  completedStepsFromRows,
  surveyProgressFromRows,
} from '@/lib/survey/steps'

const STEPS_DIR = path.resolve(__dirname, '../../../components/onboarding/steps')

/** Re-scan the step forms: every `'sN_*'` / `'sNn_*'` key they write must be mapped to THAT form's step. */
function keysFromForms(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const file of readdirSync(STEPS_DIR)) {
    const m = file.match(/^Step(\d+)/)
    if (!m || !file.endsWith('.tsx')) continue
    const step = Number(m[1])
    const src = readFileSync(path.join(STEPS_DIR, file), 'utf8')
    // Any quote style and any one-letter generation suffix (s2n_, s4m_ …) —
    // the narrower /'(s\d+n?_…)'/ silently missed 18 keys (s4m_*, nameKey="…").
    for (const hit of src.matchAll(/["'`](s\d+[a-z]?_[a-z0-9_]+)["'`]/g)) {
      if (!(hit[1] in out)) out[hit[1]] = step
    }
  }
  return out
}

describe('SURVEY_KEY_STEP', () => {
  it('matches every key written by the 12 step forms (guard against drift)', () => {
    const fromForms = keysFromForms()
    expect(Object.keys(fromForms).length).toBeGreaterThan(100)
    const missing = Object.keys(fromForms).filter((k) => SURVEY_KEY_STEP[k] !== fromForms[k])
    expect(missing, `keys whose step differs from the form that writes them: ${missing.join(', ')}`).toEqual([])
    const stale = Object.keys(SURVEY_KEY_STEP).filter((k) => !(k in fromForms))
    expect(stale, `keys in the map that no form writes anymore: ${stale.join(', ')}`).toEqual([])
  })

  it('does not rely on the key prefix (mixed-generation forms)', () => {
    expect(stepForQuestionKey('s6_main_pain')).toBe(2) // legacy s6_ key lives on step 2
    expect(stepForQuestionKey('s2n_goal_12m_what')).toBe(2)
    expect(stepForQuestionKey('s3_deals_2024')).toBe(5)
    expect(stepForQuestionKey('s5_marketing_budget_pct')).toBe(7)
    expect(stepForQuestionKey('s11_influence_map')).toBe(11)
    expect(stepForQuestionKey('s4m_control_method')).toBe(4)
    expect(stepForQuestionKey('s5_competitor_1')).toBe(7)
    expect(stepForQuestionKey('s7n_competitor_2_analysis')).toBe(7)
  })

  it('falls back for keys outside the wizard', () => {
    expect(stepForQuestionKey('ec_gross_margin')).toBeNull()
    expect(stepForQuestionKey('ec_gross_margin', 4)).toBe(4)
  })
})

describe('completedStepsFromRows', () => {
  it('ignores the (possibly corrupted) stored step for known keys', () => {
    // E2E bug: every row got step=1 after the wizard re-saved from step 1.
    const rows = [
      { question_key: 's1_company_name', step: 1, answer: { value: 'ТОО kOtaq' } },
      { question_key: 's2n_goal_12m_what', step: 1, answer: { value: '24 млн' } },
      { question_key: 's9n_revenue_2024', step: 1, answer: { value: 4000000 } },
      { question_key: 's11_influence_map', step: 1, answer: { value: [{ category: 'Клиенты' }] } },
    ]
    expect(completedStepsFromRows(rows)).toEqual([1, 2, 9, 11])
  })

  it('uses the stored step only for older-generation survey keys and never counts step 0', () => {
    const rows = [
      { question_key: 's2_revenue_2024', step: 3, answer: { value: 34 } }, // legacy survey key → stored step
      { question_key: 'ec_gross_margin', step: 5, answer: { value: 34 } }, // other intake → not wizard progress
      { question_key: 'gri_expert_finance', step: 7, answer: { value: 'note' } }, // re-stamped staff note → ignored
      { question_key: 'goal_week', step: 0, answer: { value: 'x' } },
      { question_key: 'unknown_key', step: null, answer: { value: 'x' } },
    ]
    expect(completedStepsFromRows(rows)).toEqual([3])
  })

  it('isWritableSurveyKey rejects staff notes and widget data', async () => {
    const { isWritableSurveyKey, isWizardVisibleKey } = await import('@/lib/survey/steps')
    expect(isWritableSurveyKey('s4m_control_method')).toBe(true)
    expect(isWritableSurveyKey('s2_revenue_2024')).toBe(true)
    expect(isWritableSurveyKey('ec_gross_margin')).toBe(true)
    expect(isWritableSurveyKey('gri_expert_finance')).toBe(false)
    expect(isWritableSurveyKey('goal_week_v2')).toBe(false)
    expect(isWizardVisibleKey('ec_gross_margin')).toBe(false)
    expect(isWizardVisibleKey('gri_expert_finance')).toBe(false)
  })

  it('skips empty answers', () => {
    const rows = [
      { question_key: 's1_company_name', step: 1, answer: { value: '   ' } },
      { question_key: 's12_crm_tool', step: 12, answer: { value: [] } },
      { question_key: 's4_org_chart', step: 4, answer: { value: false } },
    ]
    expect(completedStepsFromRows(rows)).toEqual([4])
  })

  it('reports 12/12 when all wizard steps have an answer', () => {
    const rows = Object.entries(SURVEY_KEY_STEP).map(([question_key]) => ({
      question_key, step: 1, answer: { value: 'ok' },
    }))
    const p = surveyProgressFromRows(rows)
    expect(p.completed).toBe(SURVEY_TOTAL_STEPS)
    expect(p.percent).toBe(100)
    expect(p.is_complete).toBe(true)
  })
})

describe('step tabs match the survey vocabulary', () => {
  it('STEPS titles equal SURVEY_STEP_LABELS (tab «Финансы» used to open marketing)', async () => {
    const { STEPS } = await import('@/components/onboarding/constants/step-config')
    const { SURVEY_STEP_LABELS } = await import('@/lib/survey-labels')
    for (const s of STEPS) expect(s.title, `step ${s.n}`).toBe(SURVEY_STEP_LABELS[s.n])
  })
})
