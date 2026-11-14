/**
 * lib/expert-sla/policy.ts — правила SLA экспертов (решение PO, Раунд 2):
 * экспертов 1–2; эксперт отвечает клиенту за 48 ч; нет реакции за 24 ч —
 * эскалация. Чистые функции, без сети: срок, состояние задачи, текст таймера
 * «осталось N ч» и честный текст клиенту.
 *
 * Определения (они же — в миграции 145 и в отчёте R2-B):
 *   поступление  received_at — когда работа появилась у эксперта (но не раньше
 *                старта часов SLA, system_settings.expert_sla_clock_start);
 *   реакция      first_response_at — эксперт взял обращение в работу (статус
 *                ушёл из «новых»), проверил хотя бы одну рекомендацию, принял
 *                решение по отчёту / плану;
 *   ответ        closed_at — клиент получил ответ: обращение решено / закрыто,
 *                отчёт опубликован или отправлен на доработку, рекомендаций на
 *                проверке не осталось, план одобрен или возвращён;
 *   эскалация    нет реакции к reaction_due_at (24 ч) — SuperExpert и Admin;
 *   просрочка    нет ответа к answer_due_at (48 ч) — повторно и видно в ГИГА.
 */
import { SETTINGS } from '@/lib/settings/registry'

export const EXPERT_SLA_SOURCES = ['case', 'report_review', 'rec_review', 'plan_review'] as const
export type ExpertSlaSource = (typeof EXPERT_SLA_SOURCES)[number]

/** Работа эксперта — её назначают эксперту. План Точки Б одобряют Admin / Super Admin (очередь одобрения). */
export const EXPERT_WORK_SOURCES: readonly ExpertSlaSource[] = ['case', 'report_review', 'rec_review']

export const SOURCE_LABELS: Record<ExpertSlaSource, string> = {
  case: 'Обращение клиента',
  report_review: 'Отчёт на проверке',
  rec_review: 'Рекомендации на проверке',
  plan_review: 'План Точки Б на одобрении',
}

export function isExpertSlaSource(v: unknown): v is ExpertSlaSource {
  return typeof v === 'string' && (EXPERT_SLA_SOURCES as readonly string[]).includes(v)
}

export function isExpertWorkSource(v: unknown): boolean {
  return isExpertSlaSource(v) && EXPERT_WORK_SOURCES.includes(v)
}

export interface ExpertSlaConfig {
  enabled: boolean
  reaction_hours: number
  answer_hours: number
  auto_assign: boolean
}

export const DEFAULT_EXPERT_SLA: ExpertSlaConfig = SETTINGS.expert_sla.default

/** Задача «скоро срок»: до ближайшего срока осталось не больше стольких часов. */
export const DUE_SOON_HOURS = 6

const HOUR = 3_600_000

export interface SlaTimes {
  received_at: string
  reaction_due_at: string
  answer_due_at: string
  first_response_at: string | null
  closed_at: string | null
  /** 146: closed with an answer (true) or without one — superseded / stale / withdrawn (false). */
  answered?: boolean | null
  escalated_at?: string | null
  breached_at?: string | null
}

/** Сроки реакции и ответа от момента поступления. */
export function slaDeadlines(receivedAt: Date | string, cfg: Pick<ExpertSlaConfig, 'reaction_hours' | 'answer_hours'> = DEFAULT_EXPERT_SLA): {
  reaction_due_at: string
  answer_due_at: string
} {
  const base = (typeof receivedAt === 'string' ? new Date(receivedAt) : receivedAt).getTime()
  const react = Math.max(1, cfg.reaction_hours)
  const answer = Math.max(react, cfg.answer_hours)
  return {
    reaction_due_at: new Date(base + react * HOUR).toISOString(),
    answer_due_at: new Date(base + answer * HOUR).toISOString(),
  }
}

/**
 * Состояние задачи на момент `now`:
 *   closed    — клиент получил ответ;
 *   breached  — срок ответа прошёл (просрочка SLA);
 *   escalated — срок реакции прошёл, реакции нет;
 *   due_soon  — до ближайшего срока (реакции, если её нет, иначе ответа) ≤ 6 ч;
 *   ok        — в срок.
 */
export type SlaStage = 'closed' | 'breached' | 'escalated' | 'due_soon' | 'ok'

export function slaStage(t: SlaTimes, now: Date = new Date()): SlaStage {
  if (t.closed_at) return 'closed'
  const n = now.getTime()
  const answer = new Date(t.answer_due_at).getTime()
  if (n >= answer) return 'breached'
  const reaction = new Date(t.reaction_due_at).getTime()
  if (!t.first_response_at && n >= reaction) return 'escalated'
  const next = t.first_response_at ? answer : reaction
  return next - n <= DUE_SOON_HOURS * HOUR ? 'due_soon' : 'ok'
}

/** Часов до срока ответа (отрицательное — просрочено), с точностью до минуты. */
export function hoursLeft(t: Pick<SlaTimes, 'answer_due_at'>, now: Date = new Date()): number {
  return Math.round((new Date(t.answer_due_at).getTime() - now.getTime()) / 60_000) / 60
}

function span(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000))
  if (minutes < 60) return `${minutes} мин`
  return `${Math.floor(minutes / 60)} ч`
}

/**
 * Текст таймера: «осталось 31 ч», «осталось 40 мин», «просрочено на 5 ч»,
 * «ответ дан». Часы округляются вниз — «осталось 1 ч» значит не меньше часа.
 */
export function slaTimerLabel(t: SlaTimes, now: Date = new Date()): string {
  if (t.closed_at) return t.answered === false ? 'закрыта без ответа' : 'ответ дан'
  const left = new Date(t.answer_due_at).getTime() - now.getTime()
  return left > 0 ? `осталось ${span(left)}` : `просрочено на ${span(left)}`
}

/** «часа» / «часов» после «в течение N …». */
export function hoursGenitive(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'часа' : 'часов'
}

/** Честный текст клиенту — только там, где задача реально поставлена в очередь. */
export function clientPromiseText(answerHours: number = DEFAULT_EXPERT_SLA.answer_hours): string {
  const h = Math.max(1, Math.round(answerHours))
  return `Эксперт ответит в течение ${h} ${hoursGenitive(h)}.`
}

/** Колонки expert_sla_tasks, которые читают проход, ГИГА и кабинет эксперта. */
export const TASK_COLUMNS =
  'id, source, source_id, client_id, company_id, title, assignee_id, assigned_at, assigned_via, received_at, reaction_due_at, answer_due_at, first_response_at, closed_at, close_reason, escalated_at, breached_at, created_at, answered, lineage, assign_notified_at, queue_notified_at, escalation_notified_at, breach_notified_at, notify_attempts, info_attempts, notify_error'

/** Повторы недоставленного уведомления (outbox, миграция 146): дальше — только отметка в ГИГА. */
export const MAX_NOTIFY_ATTEMPTS = 5

/** Списки id в фильтрах PostgREST (`in.(…)`) — не длиннее этого, чтобы не упереться в длину URL. */
export const ID_CHUNK = 100

export function chunked<T>(items: readonly T[], size: number = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export const STAGE_LABELS: Record<SlaStage, string> = {
  closed: 'Ответ дан',
  breached: 'Просрочено',
  escalated: 'Нет реакции',
  due_soon: 'Скоро срок',
  ok: 'В срок',
}
