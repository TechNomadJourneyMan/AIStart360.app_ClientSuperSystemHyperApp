/**
 * lib/user-dashboard/summary.ts — turns raw survey answers into the structure
 * the user dashboard (and the GIGA-CRM user profile) renders.
 *
 * The 12 wizard steps are grouped into business themes: a person reading their
 * profile thinks «мои клиенты и продажи», not «шаги 5 и 6». Every answer keeps
 * its wizard step so «Изменить» deep-links to /client/onboarding?step=N.
 */
import { SURVEY_LABELS, formatSurveyValue } from '@/lib/survey-labels'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { hasAnswerValue, stepFillFromAnswers, overallFill, type StepFill } from '@/lib/survey/progress'

export interface ProfileSectionDef {
  id: string
  title: string
  icon: string
  description: string
  steps: number[]
}

export const PROFILE_SECTIONS: ReadonlyArray<ProfileSectionDef> = [
  { id: 'company', title: 'Компания', icon: 'business', description: 'Кто вы: отрасль, размер, география, контакты', steps: [1] },
  { id: 'goals', title: 'Цели', icon: 'flag', description: 'Куда идёте за 12 месяцев и 3 года, что мешает', steps: [2] },
  { id: 'market', title: 'Рынок и маркетинг', icon: 'ads_click', description: 'Клиент, ценность, каналы и конкуренты', steps: [3, 7] },
  { id: 'sales', title: 'Клиенты и продажи', icon: 'contacts', description: 'База, воронка, путь клиента', steps: [5, 6] },
  { id: 'finance', title: 'Финансы и метрики', icon: 'payments', description: 'Выручка, прибыль, ключевые показатели по годам', steps: [8, 9] },
  { id: 'team', title: 'Команда и собственник', icon: 'groups', description: 'Структура, управление, ваша роль и окружение', steps: [4, 10, 11] },
  { id: 'systems', title: 'Системы и инструменты', icon: 'monitoring', description: 'CRM, учёт и сервисы, на которых работает команда', steps: [12] },
]

export interface ProfileAnswer {
  key: string
  label: string
  value: string
  step: number
}

export interface ProfileSection extends ProfileSectionDef {
  answers: ProfileAnswer[]
  filled: number
  total: number
  /** Wizard step to open for editing: the first step of the section that still has gaps. */
  editStep: number
}

export interface ProfileHero {
  company: string
  industry: string
  contact: string
  employees: string
  regions: string
  businessModel: string
  revenue: string
  goal12m: string
  goal3y: string
}

export interface UserProfileSummary {
  hero: ProfileHero
  sections: ProfileSection[]
  fill: StepFill[]
  percent: number
  startedSteps: number
  totalSteps: number
  missingSteps: number[]
  isEmpty: boolean
}

// Answers are listed in the order the form asks them (SURVEY_LABELS follows the
// wizard), not in the alphabetical order of the key table.
const LABEL_ORDER = new Map(Object.keys(SURVEY_LABELS).map((k, i) => [k, i]))
const orderOf = (key: string) => LABEL_ORDER.get(key) ?? Number.MAX_SAFE_INTEGER

const first = (answers: Readonly<Record<string, unknown>>, keys: string[]): string => {
  for (const k of keys) {
    if (!hasAnswerValue(answers[k])) continue
    const v = formatSurveyValue(k, answers[k])
    if (v && v !== '—') return v
  }
  return ''
}

/** `answers` = flat question_key → value map (unwrapped from the `{value}` envelope). */
export function buildUserProfileSummary(answers: Readonly<Record<string, unknown>>): UserProfileSummary {
  const fill = stepFillFromAnswers(answers)
  const overall = overallFill(fill)

  const byStep = new Map<number, ProfileAnswer[]>()
  for (const [key, step] of Object.entries(SURVEY_KEY_STEP)) {
    if (!hasAnswerValue(answers[key])) continue
    const value = formatSurveyValue(key, answers[key])
    if (!value || value === '—') continue
    const list = byStep.get(step) ?? []
    list.push({ key, label: SURVEY_LABELS[key] ?? key, value, step })
    byStep.set(step, list)
  }

  const sections: ProfileSection[] = PROFILE_SECTIONS.map((def) => {
    const stepFill = def.steps.map((n) => fill[n - 1]).filter(Boolean)
    const gap = stepFill.find((s) => s.filled < s.total)
    return {
      ...def,
      answers: def.steps.flatMap((n) => (byStep.get(n) ?? []).slice().sort((a, b) => orderOf(a.key) - orderOf(b.key))),
      filled: stepFill.reduce((n, s) => n + s.filled, 0),
      total: stepFill.reduce((n, s) => n + s.total, 0),
      editStep: gap?.step ?? def.steps[0],
    }
  })

  return {
    hero: {
      company: first(answers, ['s1_company_name', 's1_brand']),
      industry: first(answers, ['s1_industry', 's1_niche']),
      contact: first(answers, ['s1_contact_name']),
      employees: first(answers, ['s1_employee_count']),
      regions: first(answers, ['s1_regions']),
      businessModel: first(answers, ['s1_business_model']),
      revenue: first(answers, ['s1_current_revenue_year', 's9n_revenue_2024', 's1_current_revenue_month']),
      goal12m: first(answers, ['s1_goal_12m_revenue_year', 's2n_goal_12m_what']),
      goal3y: first(answers, ['s1_goal_3y_revenue_year', 's2n_goal_3y_what']),
    },
    sections,
    fill,
    percent: overall.percent,
    startedSteps: overall.startedSteps,
    totalSteps: overall.totalSteps,
    missingSteps: overall.missingSteps,
    isEmpty: overall.startedSteps === 0,
  }
}
