/**
 * Guard for lib/survey/where-to-find.ts — the «где взять цифру» content
 * (spec 2026-10-23-survey-three-modes-design.md §8.5, §8.10).
 */
import { describe, it, expect } from 'vitest'
import { WHERE_TO_FIND, WHERE_TO_FIND_KEYS, whereToFindFor } from '@/lib/survey/where-to-find'
import { SURVEY_KEY_STEP, AUTO_KEYS } from '@/lib/survey/steps'
import { SURVEY_QUESTIONS, SURVEY_QUESTION_LIST, isNumericQuestion } from '@/lib/survey/questions'

/** Express set, spec Appendix A (29 keys = 26 questions + 3 auto). */
const EXPRESS_NUMERIC_OR_DATA = [
  's1_employee_count',
  's1_current_revenue_month',
  's1_goal_12m_revenue_month',
  's1_goal_3y_revenue_month',
  's5_marketing_budget_pct',
  's3_deal_cycle_days',
  's4m_hours_on_ops',
  's9n_net_margin',
  's9n_breakeven_point',
  's9n_debts_amount',
] as const
/** Express keys that are not numbers / looked-up data: text, choice, yes-no, or computed by the form. */
const EXPRESS_OTHER = [
  's1_company_name',
  's1_industry',
  's1_business_model',
  's1_current_revenue_year',
  's1_goal_12m_revenue_year',
  's1_goal_3y_revenue_year',
  's2n_goal_12m_what',
  's6_main_pain',
  's6_growth_blockers',
  's5_target_audience',
  's5_usp',
  's5_has_competitor_analysis',
  's5_marketing_channels',
  's12_crm_tool',
  's4_has_org_chart',
  's4_has_regular_meetings',
  's4m_control_method',
  's4m_report_automated',
  's12_project_mgmt',
] as const

/** Priority blocks of phase Ф4 (spec §16): Б5, Б10, Б11 — numeric / data keys only. */
const PRIORITY_BLOCK_KEYS = [
  // Б5
  's3_deals_2023', 's3_deals_2024', 's3_deals_2025',
  's3_rejections_2023', 's3_rejections_2024', 's3_rejections_2025',
  's5n_funnel_lead_to_call', 's5n_funnel_call_to_meeting', 's5n_funnel_meeting_to_proposal',
  's5n_funnel_proposal_to_negotiation', 's5n_funnel_negotiation_to_contract',
  's5n_funnel_contract_to_payment', 's5n_funnel_payment_to_delivery', 's5n_funnel_lead_to_sale',
  's7_leads_per_month', 's7_no_show_rate', 's7_missed_calls_rate', 's7_avg_check_target_kzt',
  // Б10
  's8n_metrics_table',
  // Б11
  's9n_revenue_2024', 's9n_change_vs_2023', 's9n_net_profit',
  's9n_expense_cogs', 's9n_expense_marketing', 's9n_expense_rent', 's9n_expense_other',
  's9n_debtor_days',
] as const

/**
 * Latin words allowed in the Russian text: product names and the business
 * terms the questionnaire itself shows (lib/survey/terms.ts, the step-8 table).
 */
const LATIN_ALLOWED = new Set([
  'amoCRM', 'CRM', 'Kaspi', 'Pay', 'Meta', 'Ads', 'Manager', 'Google', 'Sheets',
  'Excel', 'PDF', 'Instagram', 'WhatsApp', 'Business', 'Telegram', 'Binotel', 'Zadarma',
  'SMM', 'KPI', 'NPS', 'ROI', 'CPL', 'CAC', 'LTV',
])

/** No norms or industry comparisons (PO: only after expert verification, spec §9.4). */
const BENCHMARK_WORDS = ['отрасл', 'норматив', 'по рынку', 'бенчмарк', 'у других компаний', 'у конкурентов обычно']

const texts = (key: string): string[] => {
  const e = WHERE_TO_FIND[key]
  return [e.short, e.how, e.ifUnknown, e.example ?? '', ...e.sources]
}

describe('WHERE_TO_FIND', () => {
  it('covers ≈ 70 questions (spec §8.5)', () => {
    expect(WHERE_TO_FIND_KEYS.length).toBeGreaterThanOrEqual(70)
  })

  it('uses only keys that exist in the questionnaire (and no auto «год = месяц × 12» keys)', () => {
    const unknown = WHERE_TO_FIND_KEYS.filter((k) => !(k in SURVEY_KEY_STEP))
    expect(unknown, `keys not in SURVEY_KEY_STEP: ${unknown.join(', ')}`).toEqual([])
    const auto = WHERE_TO_FIND_KEYS.filter((k) => (AUTO_KEYS as readonly string[]).includes(k))
    expect(auto).toEqual([])
  })

  it('uses only keys of the question registry (lib/survey/questions.ts), never auto keys', () => {
    const unknown = WHERE_TO_FIND_KEYS.filter((k) => !SURVEY_QUESTIONS[k])
    expect(unknown, `keys not in the registry: ${unknown.join(', ')}`).toEqual([])
    const auto = WHERE_TO_FIND_KEYS.filter((k) => SURVEY_QUESTIONS[k]?.auto)
    expect(auto).toEqual([])
  })

  it('covers every number, money, percent, table and file question of the registry', () => {
    const missing = SURVEY_QUESTION_LIST
      .filter((q) => !q.auto && (isNumericQuestion(q) || q.type === 'table' || q.type === 'file'))
      .filter((q) => !WHERE_TO_FIND[q.key])
      .map((q) => `${q.key} (${q.type})`)
    expect(missing, `data questions without «где взять»: ${missing.join(', ')}`).toEqual([])
  })

  it('agrees with the registry about the express set', () => {
    const registryExpress = SURVEY_QUESTION_LIST.filter((q) => q.place === 'express').map((q) => q.key).sort()
    expect(registryExpress).toEqual([...EXPRESS_NUMERIC_OR_DATA, ...EXPRESS_OTHER].sort())
  })

  it('has an entry for every numeric / data key of the express set (spec Appendix A)', () => {
    const express = [...EXPRESS_NUMERIC_OR_DATA, ...EXPRESS_OTHER]
    expect(express).toHaveLength(29)
    expect(new Set(express).size).toBe(29)
    for (const k of express) expect(k in SURVEY_KEY_STEP, k).toBe(true)
    const missing = EXPRESS_NUMERIC_OR_DATA.filter((k) => !WHERE_TO_FIND[k])
    expect(missing, `express keys without «где взять»: ${missing.join(', ')}`).toEqual([])
  })

  it('has an entry for every numeric / data key of the priority blocks Б5, Б10, Б11', () => {
    const missing = PRIORITY_BLOCK_KEYS.filter((k) => !WHERE_TO_FIND[k])
    expect(missing, `priority keys without «где взять»: ${missing.join(', ')}`).toEqual([])
  })

  it('keeps `short` to one line of ≤ 90 characters', () => {
    const long = WHERE_TO_FIND_KEYS.filter((k) => WHERE_TO_FIND[k].short.length > 90 || WHERE_TO_FIND[k].short.includes('\n'))
    expect(long, `too long: ${long.map((k) => `${k} (${WHERE_TO_FIND[k].short.length})`).join(', ')}`).toEqual([])
  })

  it('has no empty fields; `how` is 2+ sentences; at least one source', () => {
    for (const k of WHERE_TO_FIND_KEYS) {
      const e = WHERE_TO_FIND[k]
      expect(e.short.trim(), k).not.toBe('')
      expect(e.how.trim(), k).not.toBe('')
      expect(e.ifUnknown.trim(), k).not.toBe('')
      expect(e.sources.length, k).toBeGreaterThan(0)
      for (const s of e.sources) expect(s.trim(), k).not.toBe('')
      if (e.example !== undefined) expect(e.example.trim(), k).not.toBe('')
      const sentences = e.how.split(/[.!?](?:\s|$)/).filter((x) => x.trim().length > 0)
      expect(sentences.length, `${k}: how should be 2–4 sentences`).toBeGreaterThanOrEqual(2)
      expect(e.how.length, `${k}: how is too long`).toBeLessThanOrEqual(700)
    }
  })

  it('is written in Russian: Latin only in well-known product names and shown terms', () => {
    const bad: string[] = []
    for (const k of WHERE_TO_FIND_KEYS) {
      for (const t of texts(k)) {
        for (const w of t.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
          if (w.length > 1 && !LATIN_ALLOWED.has(w)) bad.push(`${k}: ${w}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('makes no benchmark / industry comparisons', () => {
    const bad: string[] = []
    for (const k of WHERE_TO_FIND_KEYS) {
      for (const t of texts(k)) {
        const low = t.toLowerCase()
        for (const w of BENCHMARK_WORDS) if (low.includes(w)) bad.push(`${k}: ${w}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('whereToFindFor returns the entry or null', () => {
    expect(whereToFindFor('s1_current_revenue_month')).toBe(WHERE_TO_FIND.s1_current_revenue_month)
    expect(whereToFindFor('s1_company_name')).toBeNull()
    expect(whereToFindFor('toString')).toBeNull()
  })
})
