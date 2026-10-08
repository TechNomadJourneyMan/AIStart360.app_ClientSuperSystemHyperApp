/**
 * lib/admin/timeline.ts — единая лента клиента в User 360 («Лента»).
 *
 * История клиента раньше жила в шести вкладках: активность, журнал, письма,
 * заметки, задачи, кейсы. Здесь всё приводится к одному виду
 * `{at, kind, title, body, actor, link}` и сливается по времени (новое сверху).
 *
 * Пагинация — курсором по времени: следующая страница берёт всё строго раньше
 * последнего показанного момента. Чтобы события с одинаковым временем не
 * терялись на стыке страниц, страница дополняется всеми элементами с тем же
 * временем, что у последнего.
 */

import { eventLabel } from '@/lib/events/registry'
import { auditLabel } from '@/lib/admin/labels'

export const TIMELINE_KINDS = ['event', 'audit', 'email', 'note', 'task', 'case', 'comment', 'survey'] as const
export type TimelineKind = (typeof TIMELINE_KINDS)[number]

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  event: 'Действия клиента',
  audit: 'Действия персонала',
  email: 'Письма',
  note: 'Заметки',
  task: 'Задачи',
  case: 'Эскалации',
  comment: 'Комментарии экспертов',
  survey: 'Анкета',
}

export interface TimelineEntry {
  id: string
  at: string
  kind: TimelineKind
  title: string
  body?: string | null
  actor?: string | null
  link?: string | null
}

export function isTimelineKind(v: unknown): v is TimelineKind {
  return typeof v === 'string' && (TIMELINE_KINDS as readonly string[]).includes(v)
}

/** Шумные события — в ленту только по ?all=1. */
export const NOISY_EVENTS = new Set(['PAGE_VIEWED', 'BUTTON_CLICKED', 'GRI_QUESTION_ANSWERED', 'SECTION_OPENED'])

const ts = (iso: string) => {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Слить источники и вырезать страницу.
 * `cursor` — ISO-момент: берутся только элементы строго раньше него.
 */
export function mergeTimeline(
  sources: TimelineEntry[][],
  opts: { limit: number; cursor?: string | null },
): { items: TimelineEntry[]; nextCursor: string | null } {
  const cursorT = opts.cursor ? ts(opts.cursor) : Infinity
  const seen = new Set<string>()
  const all: TimelineEntry[] = []
  for (const src of sources) {
    for (const e of src) {
      if (!e.at || ts(e.at) >= cursorT) continue
      const key = `${e.kind}:${e.id}`
      if (seen.has(key)) continue
      seen.add(key)
      all.push(e)
    }
  }
  all.sort((a, b) => ts(b.at) - ts(a.at) || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))

  const limit = Math.max(1, opts.limit)
  if (all.length <= limit) return { items: all, nextCursor: null }
  let end = limit
  const lastT = ts(all[limit - 1].at)
  while (end < all.length && ts(all[end].at) === lastT) end++
  const items = all.slice(0, end)
  return { items, nextCursor: end < all.length ? items[items.length - 1].at : null }
}

// ─── Нормализаторы источников ───────────────────────────────────────────────

export interface EventRow { id: string | number; event_name: string; page?: string | null; source?: string | null; created_at: string }
export function fromEvents(rows: EventRow[]): TimelineEntry[] {
  return rows.map((r) => ({
    id: String(r.id), at: r.created_at, kind: 'event',
    title: eventLabel(r.event_name),
    body: r.page ?? null,
    actor: r.source === 'admin' || r.source === 'impersonation' ? 'персонал' : null,
  }))
}

export interface AuditRow { id: string | number; action: string; actor_email?: string | null; actor_role?: string | null; metadata?: Record<string, unknown> | null; created_at: string }
export function fromAudit(rows: AuditRow[]): TimelineEntry[] {
  return rows.map((r) => {
    const reason = r.metadata && typeof r.metadata.reason === 'string' ? r.metadata.reason : null
    return {
      id: String(r.id), at: r.created_at, kind: 'audit',
      title: auditLabel(r.action),
      body: reason ? `Причина: ${reason}` : null,
      actor: r.actor_email ?? r.actor_role ?? null,
    }
  })
}

export interface EmailRow { id: string; kind?: string | null; subject?: string | null; status?: string | null; created_at: string }
export function fromEmails(rows: EmailRow[]): TimelineEntry[] {
  return rows.map((r) => ({
    id: r.id, at: r.created_at, kind: 'email',
    title: `Письмо: ${r.subject || r.kind || 'без темы'}`,
    body: r.status ? `статус: ${r.status}` : null,
  }))
}

export interface NoteRow { id: string; body: string; author_email?: string | null; author_role?: string | null; created_at: string }
export function fromNotes(rows: NoteRow[]): TimelineEntry[] {
  return rows.map((r) => ({
    id: r.id, at: r.created_at, kind: 'note',
    title: 'Заметка',
    body: r.body.length > 280 ? `${r.body.slice(0, 280)}…` : r.body,
    actor: r.author_email ?? r.author_role ?? null,
  }))
}

export interface TaskRow { id: string; title: string; status: string; created_at: string; done_at?: string | null; created_by?: string | null }
export function fromTasks(rows: TaskRow[]): TimelineEntry[] {
  const out: TimelineEntry[] = []
  for (const r of rows) {
    out.push({ id: `${r.id}:created`, at: r.created_at, kind: 'task', title: `Задача создана: ${r.title}` })
    if (r.status === 'done' && r.done_at) out.push({ id: `${r.id}:done`, at: r.done_at, kind: 'task', title: `Задача выполнена: ${r.title}` })
  }
  return out
}

const CASE_STATUS_LABEL: Record<string, string> = { new: 'новый', in_progress: 'в работе', resolved: 'решён', closed: 'закрыт' }
export interface CaseRow { id: string; title: string; status: string; priority?: string | null; created_at: string; updated_at?: string | null }
export function fromCases(rows: CaseRow[], casesHref?: string): TimelineEntry[] {
  const out: TimelineEntry[] = []
  for (const r of rows) {
    const link = casesHref ? `${casesHref}?case=${r.id}` : null
    out.push({ id: `${r.id}:created`, at: r.created_at, kind: 'case', title: `Эскалация: ${r.title}`, body: r.priority ? `приоритет: ${r.priority}` : null, link })
    if (r.status !== 'new' && r.updated_at && ts(r.updated_at) > ts(r.created_at)) {
      out.push({ id: `${r.id}:status`, at: r.updated_at, kind: 'case', title: `Эскалация «${r.title}»: ${CASE_STATUS_LABEL[r.status] ?? r.status}`, link })
    }
  }
  return out
}

export interface CommentRow { id: string; text: string; author_title?: string | null; block_key?: string | null; created_at: string }
export function fromComments(rows: CommentRow[]): TimelineEntry[] {
  return rows.map((r) => ({
    id: r.id, at: r.created_at, kind: 'comment',
    title: `Комментарий эксперта${r.block_key ? ` · ${r.block_key}` : ''}`,
    body: r.text.length > 280 ? `${r.text.slice(0, 280)}…` : r.text,
    actor: r.author_title ?? null,
  }))
}

export interface SurveyHistoryRow { id: string | number; question_key: string; source?: string | null; created_at: string }
/** Правки анкеты за день — одним пунктом: «изменено N ответов». */
export function fromSurveyHistory(rows: SurveyHistoryRow[]): TimelineEntry[] {
  const byDay = new Map<string, { at: string; keys: Set<string>; staff: boolean }>()
  for (const r of rows) {
    const day = r.created_at.slice(0, 10)
    const g = byDay.get(day) ?? { at: r.created_at, keys: new Set<string>(), staff: false }
    if (ts(r.created_at) > ts(g.at)) g.at = r.created_at
    g.keys.add(r.question_key)
    if (r.source && r.source !== 'user') g.staff = true
    byDay.set(day, g)
  }
  return Array.from(byDay.entries()).map(([day, g]) => ({
    id: `survey:${day}`, at: g.at, kind: 'survey' as const,
    title: `Анкета: изменено ответов — ${g.keys.size}`,
    body: g.staff ? 'в том числе персоналом' : null,
  }))
}
