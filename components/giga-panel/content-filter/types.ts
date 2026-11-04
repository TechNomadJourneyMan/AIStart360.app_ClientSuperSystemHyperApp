import type { ProfanityCategory } from '@/lib/moderation/profanity'

export type EventStatus = 'open' | 'reviewed' | 'false_positive'

export interface ModerationEventRow {
  id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  user_status: string | null
  source: string
  field: string
  field_label: string | null
  categories: ProfanityCategory[]
  terms: string[]
  excerpt: string | null
  status: EventStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export interface EventsResponse {
  ok: true
  data: ModerationEventRow[]
  total: number
  page: number
  pageSize: number
  counts: Record<EventStatus, number>
  filterEnabled: boolean
}

export interface FilterTerm {
  id: string
  term: string
  kind: 'block' | 'allow'
  note: string | null
  created_at: string
}

/** Где был заблокирован текст (source из lib/moderation/guard.ts). */
export const SOURCE_LABELS: Record<string, string> = {
  register: 'Регистрация',
  profile: 'Профиль',
  company: 'Компания',
  survey: 'Анкета',
  goal: 'Цели',
  task_comment: 'План: комментарий',
  insight: 'Точка А: вопросы',
  escalation: 'Запрос эксперту',
  crm_client: 'CRM клиента',
  expert_profile: 'Профиль эксперта',
  admin_user_edit: 'Правка персоналом',
}

export const STATUS_LABELS: Record<EventStatus, string> = {
  open: 'Новое',
  reviewed: 'Проверено',
  false_positive: 'Ложное срабатывание',
}
