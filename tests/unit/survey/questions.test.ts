/**
 * Guards of the question registry (lib/survey/questions.ts, spec 2026-10-23
 * §5.5, appendix A): it covers the 174 keys of the 12-step questionnaire,
 * agrees with the step forms (labels, options, number fields) and places every
 * key exactly once in the express flow or a deepening block.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXPRESS_SCREENS, SURVEY_BLOCKS, SURVEY_BLOCK_IDS, SURVEY_QUESTIONS, SURVEY_QUESTION_LIST, SURVEY_QUESTION_TYPES,
  isMinimumKey, optionLabel, whereToFindLine, questionsOfPlace, questionsOfStep, surveyQuestion,
} from '@/lib/survey/questions'
import { AUTO_KEYS, SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { minimumChecks } from '@/lib/survey/point-a-minimum'
import { stepForQuestionKey } from '@/lib/survey/steps'
import { FIELD_NOTES } from '@/components/onboarding/constants/step-config'
import { SURVEY_TERMS } from '@/lib/survey/terms'
import { WHERE_TO_FIND } from '@/lib/survey/where-to-find'

const STEPS_DIR = path.resolve(__dirname, '../../../components/onboarding/steps')
const OPTIONS_SRC = readFileSync(path.resolve(__dirname, '../../../components/onboarding/constants/options.ts'), 'utf8')

const FORM_SRC: Record<number, string> = {}
for (const file of readdirSync(STEPS_DIR)) {
  const m = file.match(/^Step(\d+)/)
  if (m && file.endsWith('.tsx')) FORM_SRC[Number(m[1])] = readFileSync(path.join(STEPS_DIR, file), 'utf8')
}

/** The source of every <NumberField … /> element (up to its self-closing end). */
function numberFieldElements(src: string): string[] {
  return src.split('<NumberField').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('/>')))
}

/** Keys the form renders with <NumberField id="…"> (directly or through a helper / list). */
function numberFieldKeys(src: string): Set<string> {
  const out = new Set<string>()
  for (const el of numberFieldElements(src)) {
    const id = el.match(/\bid="([a-z0-9_]+)"/)
    if (id) out.add(id[1])
  }
  // Step 9 helpers: num('key', …) / money('key', …).
  for (const m of src.matchAll(/\b(?:num|money)\('([a-z0-9_]+)'/g)) out.add(m[1])
  // Step 5 funnel list rendered through NumberField.
  if (/FUNNEL_FIELDS\.map[\s\S]*?<NumberField/.test(src)) {
    for (const m of src.matchAll(/\{ key: '(s5n_funnel_[a-z_]+)'/g)) out.add(m[1])
  }
  return out
}

describe('registry coverage', () => {
  it('has exactly the 174 keys of SURVEY_KEY_STEP, each on its own step', () => {
    const keys = SURVEY_QUESTION_LIST.map((q) => q.key)
    expect(keys).toHaveLength(174)
    expect(new Set(keys).size).toBe(174)
    expect([...keys].sort()).toEqual(Object.keys(SURVEY_KEY_STEP).sort())
    for (const q of SURVEY_QUESTION_LIST) expect(q.step, q.key).toBe(SURVEY_KEY_STEP[q.key])
  })

  it('per step counts match appendix A (1—21, 2—9, 3—17, 4—19, 5—32, 6—6, 7—17, 8—1, 9—24, 10—17, 11—1, 12—10)', () => {
    const want = { 1: 21, 2: 9, 3: 17, 4: 19, 5: 32, 6: 6, 7: 17, 8: 1, 9: 24, 10: 17, 11: 1, 12: 10 }
    for (const [step, n] of Object.entries(want)) expect(questionsOfStep(Number(step)), `step ${step}`).toHaveLength(n)
  })

  it('every question has a label, a known type, and order is 1..n inside a step', () => {
    for (const q of SURVEY_QUESTION_LIST) {
      expect(q.label.trim(), q.key).not.toBe('')
      expect(SURVEY_QUESTION_TYPES).toContain(q.type)
    }
    for (let s = 1; s <= 12; s++) expect(questionsOfStep(s).map((q) => q.order)).toEqual(questionsOfStep(s).map((_, i) => i + 1))
  })

  it('lookups', () => {
    expect(surveyQuestion('s1_current_revenue_month')).toMatchObject({ type: 'money', unit: '₸/мес', allowApprox: true, allowUnknown: true })
    expect(surveyQuestion('nope')).toBeNull()
    expect(optionLabel(SURVEY_QUESTIONS.s12_crm_tool, 'amocrm')).toBe('AmoCRM')
    expect(optionLabel(SURVEY_QUESTIONS.s12_crm_tool, 'нечто')).toBe('нечто')
  })
})

describe('agrees with the 12 step forms', () => {
  it('formLabel appears in the form of its step (null only for labels the form computes)', () => {
    const nullable = new Set(['s3_deals_2023', 's3_deals_2024', 's3_deals_2025', 's3_rejections_2023', 's3_rejections_2024', 's3_rejections_2025',
      's9n_revenue_2024', 's9n_change_vs_2023', 's9n_net_profit', 's9n_net_margin', 's5_competitor_1', 's5_competitor_2', 's5_competitor_3'])
    const missing: string[] = []
    for (const q of SURVEY_QUESTION_LIST) {
      if (q.formLabel === null) {
        expect(nullable.has(q.key), `${q.key}: formLabel null is reserved for computed labels`).toBe(true)
        continue
      }
      if (!FORM_SRC[q.step].includes(q.formLabel)) missing.push(`${q.key}: «${q.formLabel}»`)
    }
    expect(missing).toEqual([])
  })

  it('every option value is stored by the form (in the form file or the shared options)', () => {
    const missing: string[] = []
    for (const q of SURVEY_QUESTION_LIST) {
      for (const o of q.options ?? []) {
        const quoted = [`'${o.value}'`, `"${o.value}"`]
        if (!quoted.some((s) => FORM_SRC[q.step].includes(s) || OPTIONS_SRC.includes(s))) missing.push(`${q.key}=${o.value}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('select / multiselect questions have options; scales have a range', () => {
    for (const q of SURVEY_QUESTION_LIST) {
      if (q.type === 'select' || q.type === 'multiselect') expect(q.options?.length, q.key).toBeGreaterThan(1)
      else expect(q.options, q.key).toBeUndefined()
      if (q.type === 'scale') expect(q.range).toEqual([1, 10])
    }
  })

  it('number fields of the forms are numeric questions and vice versa', () => {
    const formNumbers = new Set<string>()
    for (const src of Object.values(FORM_SRC)) for (const k of numberFieldKeys(src)) formNumbers.add(k)
    const registryNumbers = SURVEY_QUESTION_LIST.filter((q) => ['number', 'money', 'percent'].includes(q.type)).map((q) => q.key).sort()
    expect(registryNumbers).toEqual([...formNumbers].sort())
  })

  it('«Не знаю» follows NumberField: on by default, off where the form says allowUnknown={false}', () => {
    const off = new Set<string>()
    for (const src of Object.values(FORM_SRC)) {
      for (const el of numberFieldElements(src)) {
        const id = el.match(/\bid="([a-z0-9_]+)"/)
        if (id && /allowUnknown=\{false\}/.test(el)) off.add(id[1])
      }
    }
    for (const q of SURVEY_QUESTION_LIST.filter((x) => ['number', 'money', 'percent'].includes(x.type))) {
      expect(q.allowUnknown, q.key).toBe(!off.has(q.key))
    }
    // Text questions: only the breakeven point (the engine reads «не знаю» there).
    expect(SURVEY_QUESTION_LIST.filter((q) => q.allowUnknown && !['number', 'money', 'percent'].includes(q.type)).map((q) => q.key)).toEqual(['s9n_breakeven_point'])
  })

  it('«Примерно» only on money questions', () => {
    for (const q of SURVEY_QUESTION_LIST) if (q.allowApprox) expect(q.type, q.key).toBe('money')
    expect(SURVEY_QUESTION_LIST.filter((q) => q.type === 'money').every((q) => q.allowApprox)).toBe(true)
  })

  it('terms exist in SURVEY_TERMS', () => {
    for (const q of SURVEY_QUESTION_LIST) if (q.term) expect(SURVEY_TERMS, q.key).toHaveProperty(q.term)
  })
})

describe('mode 2 placement (appendix A)', () => {
  it('express = 29 keys (26 questions + 3 auto) on 15 screens', () => {
    expect(EXPRESS_SCREENS.map((s) => s.screen)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    const express = EXPRESS_SCREENS.flatMap((s) => s.keys)
    expect(express).toHaveLength(29)
    expect(express.filter((k) => (AUTO_KEYS as readonly string[]).includes(k))).toHaveLength(3)
    for (const q of questionsOfPlace('express')) expect(q.express?.screen, q.key).toBeGreaterThan(0)
  })

  it('15 blocks hold the other 145 keys; block sizes as in appendix A', () => {
    expect(SURVEY_BLOCKS.map((b) => b.id)).toEqual([...SURVEY_BLOCK_IDS])
    const sizes = SURVEY_BLOCKS.map((b) => b.keys.length)
    expect(sizes).toEqual([9, 9, 14, 7, 19, 11, 6, 5, 10, 1, 21, 16, 9, 1, 7])
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(145)
    for (const b of SURVEY_BLOCKS) expect(questionsOfPlace(b.id).every((q) => q.place === b.id)).toBe(true)
  })

  it('every key has exactly one place', () => {
    const seen = new Map<string, number>()
    for (const k of [...EXPRESS_SCREENS.flatMap((s) => s.keys), ...SURVEY_BLOCKS.flatMap((b) => b.keys)]) seen.set(k, (seen.get(k) ?? 0) + 1)
    expect([...seen.values()].every((n) => n === 1)).toBe(true)
    expect([...seen.keys()].sort()).toEqual(Object.keys(SURVEY_KEY_STEP).sort())
  })

  it('the express flow closes all 15 «Минимум для Точки А» checks', () => {
    const express = new Set(EXPRESS_SCREENS.flatMap((s) => s.keys))
    const checks = minimumChecks((k) => stepForQuestionKey(k))
    expect(checks).toHaveLength(15)
    const open = checks.filter((c) => !c.keys.some((k) => express.has(k))).map((c) => `${c.block}.${c.check}`)
    expect(open).toEqual([])
  })
})

describe('derived fields', () => {
  it('minimum refs come from CHECK_INPUTS', () => {
    expect(SURVEY_QUESTIONS.s4m_control_method.minimum).toEqual([{ block: 'operations', check: 'dept_kpi' }])
    expect(SURVEY_QUESTIONS.s1_goal_12m_revenue_month.minimum).toEqual([{ block: 'strategy', check: 'goal_12m' }])
    expect(isMinimumKey('s9n_breakeven_point')).toBe(true)
    expect(isMinimumKey('s10_why_opened')).toBe(false)
  })

  it('delicate = FIELD_NOTES keys, with the note as «why»', () => {
    const delicate = SURVEY_QUESTION_LIST.filter((q) => q.delicate).map((q) => q.key).sort()
    expect(delicate).toEqual(Object.keys(FIELD_NOTES).sort())
    expect(SURVEY_QUESTIONS.s9n_transparency_pct.why).toBe(FIELD_NOTES.s9n_transparency_pct)
  })

  it('auto keys are «год = месяц × 12», skipped by the chat', () => {
    const autos = SURVEY_QUESTION_LIST.filter((q) => q.auto)
    expect(autos.map((q) => q.key).sort()).toEqual([...AUTO_KEYS].sort())
    for (const q of autos) {
      expect(q.type).toBe('auto')
      expect(q.chat).toBe('skip')
      expect(q.autoFrom).toBe(q.key.replace(/_year$/, '_month'))
    }
  })

  it('chat: tables, files, contacts and the company name go to the form (appendix A)', () => {
    const formOnly = SURVEY_QUESTION_LIST.filter((q) => q.chat === 'form_only').map((q) => q.key).sort()
    expect(formOnly).toEqual([
      's11_influence_map', 's1_company_name', 's1_contact_email', 's1_contact_name', 's1_contact_phone', 's1_contact_position',
      's1_uploaded_files', 's4n_staffing_table', 's6n_journey_table', 's6n_script_first_contact', 's6n_script_meeting',
      's6n_script_proposal', 's7n_channels_table', 's8n_metrics_table',
    ])
  })

  it('twins are symmetric and of the same type', () => {
    const twins = SURVEY_QUESTION_LIST.filter((q) => q.twin)
    expect(twins.map((q) => q.key).sort()).toEqual(['s10_delegation_ready', 's10_hours_on_ops', 's4m_delegation_readiness', 's4m_hours_on_ops'])
    for (const q of twins) {
      const other = SURVEY_QUESTIONS[q.twin as string]
      expect(other.twin).toBe(q.key)
      expect(other.type).toBe(q.type)
    }
  })

  it('«где взять цифру» is merged only for known keys', () => {
    for (const key of Object.keys(WHERE_TO_FIND)) expect(SURVEY_QUESTIONS, `where-to-find: ${key}`).toHaveProperty(key)
    for (const q of SURVEY_QUESTION_LIST) if (q.whereToFind) expect(q.whereToFind).toBe(whereToFindLine(q.key))
    // Every entry of the content file reaches the registry as one line.
    for (const key of Object.keys(WHERE_TO_FIND)) if (SURVEY_QUESTIONS[key] && !SURVEY_QUESTIONS[key].auto) expect(SURVEY_QUESTIONS[key].whereToFind, key).toBeTruthy()
  })

  it('express questions read in plain words', () => {
    for (const q of questionsOfPlace('express')) if (!q.auto) expect(q.plain, q.key).toBeTruthy()
  })
})
