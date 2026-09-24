/**
 * lib/platform/visibility.ts — who sees a page, block or platform section.
 * Pure and shared by server routes, middleware and the admin editor preview.
 */
import { z } from 'zod'
import { isSurveyCompleted } from '@/lib/survey/completion'

export const SEGMENTS = {
  new_users: 'Новые (до 14 дней)',
  approved: 'Доступ открыт',
  pending: 'Ожидают одобрения',
  survey_completed: 'Анкета заполнена',
  survey_not_completed: 'Анкета не заполнена',
  gri_completed: 'GRI пройден',
  gri_not_completed: 'GRI не пройден',
  tier_pro: 'Тариф Pro',
  tier_free: 'Тариф Free',
  vertical_generic: 'Общий кабинет',
  vertical_medical: 'Медицина',
  vertical_ecommerce: 'E-commerce',
} as const
export type Segment = keyof typeof SEGMENTS
const SEGMENT_KEYS = Object.keys(SEGMENTS) as [Segment, ...Segment[]]

export const AUDIENCES = {
  all: 'Все пользователи',
  segments: 'Выбранные сегменты',
  staff_only: 'Только персонал',
} as const

export const visibilitySchema = z.object({
  audience: z.enum(['all', 'segments', 'staff_only']),
  segments: z.array(z.enum(SEGMENT_KEYS)).max(12).optional(),
  match: z.enum(['any', 'all']).optional(),
})
export type VisibilityRule = z.infer<typeof visibilitySchema>

export interface UserFacts {
  role: string
  status: string
  tier: string
  vertical: string
  created_at: string | null
  survey_steps: number
  /** Анкета заполнена по единому определению (lib/survey/completion.ts). */
  survey_completed?: boolean
  gri_runs: number
  is_staff: boolean
}

const NEW_USER_DAYS = 14

export function userSegments(f: UserFacts, now = Date.now()): Set<Segment> {
  const s = new Set<Segment>()
  const created = f.created_at ? new Date(f.created_at).getTime() : NaN
  if (Number.isFinite(created) && now - created <= NEW_USER_DAYS * 86_400_000) s.add('new_users')
  s.add(f.status === 'approved' ? 'approved' : 'pending')
  const surveyDone = typeof f.survey_completed === 'boolean'
    ? f.survey_completed || isSurveyCompleted({ filledSteps: f.survey_steps })
    : isSurveyCompleted({ filledSteps: f.survey_steps })
  s.add(surveyDone ? 'survey_completed' : 'survey_not_completed')
  s.add(f.gri_runs > 0 ? 'gri_completed' : 'gri_not_completed')
  s.add(f.tier === 'pro' ? 'tier_pro' : 'tier_free')
  const v = f.vertical === 'medical' || f.vertical === 'ecommerce' ? f.vertical : 'generic'
  s.add(`vertical_${v}` as Segment)
  return s
}

/** Unknown / malformed rules fall back to «all» only if they are empty; otherwise deny. */
export function parseRule(raw: unknown): VisibilityRule | null {
  if (raw == null) return { audience: 'all' }
  const r = visibilitySchema.safeParse(raw)
  return r.success ? r.data : null
}

export function isVisible(raw: unknown, facts: UserFacts | null, now = Date.now()): boolean {
  const rule = parseRule(raw)
  if (!rule) return false // fail closed on a broken rule
  if (facts?.is_staff) return true // staff preview everything
  if (rule.audience === 'all') return true
  if (rule.audience === 'staff_only' || !facts) return false
  const wanted = rule.segments ?? []
  if (!wanted.length) return false
  const have = userSegments(facts, now)
  return rule.match === 'all' ? wanted.every((x) => have.has(x)) : wanted.some((x) => have.has(x))
}

export function describeRule(raw: unknown): string {
  const rule = parseRule(raw)
  if (!rule) return 'Некорректное правило (скрыто)'
  if (rule.audience !== 'segments') return AUDIENCES[rule.audience]
  const names = (rule.segments ?? []).map((s) => SEGMENTS[s])
  return names.length ? `${rule.match === 'all' ? 'Все условия' : 'Любое из'}: ${names.join(', ')}` : 'Никто (сегменты не выбраны)'
}
