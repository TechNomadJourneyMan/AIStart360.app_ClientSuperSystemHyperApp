/**
 * lib/admin/client-actions.ts — staff actions on one client, shared by the
 * GIGA routes /api/giga-admin/users/:id/{remind-survey,tasks,notes,assignment}
 * and the admin Telegram bot's assistant (lib/telegram/brain).
 *
 * The CALLER authorises (requireGiga in a route, the bot's rbac check for a
 * linked staff member — the same permissions either way) and checks the
 * client scope (guardClientAccess / the bot's scope), then passes an `audit`
 * writer bound to its actor and request. Each function keeps the route's
 * order exactly: validation → write → audit entry (best-effort, as the route
 * always did) and returns a typed result the route maps to its HTTP status.
 */
import type { AuditEntry } from '@/lib/admin/audit'
import { createServiceClient } from '@/lib/supabase-service'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { sendSurveyReminderEmail } from '@/lib/email'
import { buildUserProfileSummary } from '@/lib/user-dashboard/summary'
import { isWizardVisibleKey, SURVEY_TOTAL_STEPS } from '@/lib/survey/steps'

export type ClientAuditWriter = (entry: AuditEntry, opts?: { required?: boolean }) => Promise<boolean>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Fail<C extends string> = { ok: false; code: C; status: number; error: string }

// ─── Survey reminder ─────────────────────────────────────────────────────────

export type SurveyReminderResult =
  | { ok: true; completedSteps: number; missingSections: string[] }
  | Fail<'rate_limited' | 'no_email' | 'complete' | 'send_failed'>

/**
 * E-mail «допройдите анкету» with the list of empty sections (the same
 * buildUserProfileSummary the card shows). At most once a day per client.
 */
export async function sendSurveyReminder(args: {
  userId: string
  note?: string | null
  fromLabel: string | null
  audit: ClientAuditWriter
}): Promise<SurveyReminderResult> {
  // Не чаще раза в сутки на человека: напоминание, приходящее каждый час,
  // перестаёт быть напоминанием.
  if (await isRateLimitedKey(args.userId, 'survey-reminder', { max: 1, windowMs: 24 * 60 * 60_000 })) {
    return { ok: false, code: 'rate_limited', status: 429, error: 'Этому клиенту уже напоминали за последние сутки' }
  }

  const sb = createServiceClient()
  const [{ data: profile }, { data: answerRows }, { data: company }] = await Promise.all([
    sb.from('profiles').select('email, full_name').eq('id', args.userId).maybeSingle(),
    sb.from('survey_answers').select('question_key, answer').eq('user_id', args.userId),
    sb.from('companies').select('name').eq('user_id', args.userId).maybeSingle(),
  ])
  const person = profile as { email?: string | null; full_name?: string | null } | null
  if (!person?.email) return { ok: false, code: 'no_email', status: 409, error: 'У клиента нет email' }

  const answers: Record<string, unknown> = {}
  for (const r of (answerRows ?? []) as Array<{ question_key: string; answer: { value?: unknown } | null }>) {
    if (!isWizardVisibleKey(r.question_key)) continue
    answers[r.question_key] = r.answer?.value
  }
  const summary = buildUserProfileSummary(answers)
  if (summary.startedSteps >= summary.totalSteps) {
    return { ok: false, code: 'complete', status: 409, error: 'Анкета уже заполнена полностью' }
  }
  const missingSections = summary.sections.filter((s) => s.filled === 0).map((s) => s.title)

  const sent = await sendSurveyReminderEmail(person.email, {
    userId: args.userId,
    name: person.full_name ?? null,
    company: (company as { name?: string | null } | null)?.name ?? null,
    completedSteps: summary.startedSteps,
    totalSteps: summary.totalSteps || SURVEY_TOTAL_STEPS,
    missingSections,
    fromLabel: args.fromLabel,
    note: args.note ?? null,
  })
  if (!sent.ok) return { ok: false, code: 'send_failed', status: 502, error: sent.error ?? 'Письмо не отправилось' }

  await args.audit({
    action: 'user.survey_reminded',
    entityType: 'user',
    entityId: args.userId,
    targetUserId: args.userId,
    metadata: { completedSteps: summary.startedSteps, missingSections, note: args.note ?? null },
  })
  return { ok: true, completedSteps: summary.startedSteps, missingSections }
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const TASK_COLUMNS = 'id, title, due_at, status, assignee_id, created_by, created_at, done_at'

export type CreateTaskResult = { ok: true; task: Record<string, unknown> & { id: string } } | Fail<'db_write'>

/** A staff task about a client; without an explicit assignee it stays with its author. */
export async function createClientTask(args: {
  userId: string
  title: string
  dueAt?: string | null
  assigneeId?: string | null
  actorId: string
  audit: ClientAuditWriter
}): Promise<CreateTaskResult> {
  const { data, error } = await createServiceClient()
    .from('staff_tasks')
    .insert({
      user_id: args.userId,
      title: args.title,
      due_at: args.dueAt ?? null,
      // Без явного исполнителя задача остаётся за тем, кто её завёл, —
      // задача без владельца не делается никогда.
      assignee_id: args.assigneeId ?? (UUID_RE.test(args.actorId) ? args.actorId : null),
      created_by: args.actorId,
    })
    .select(TASK_COLUMNS)
    .single()
  if (error) return { ok: false, code: 'db_write', status: 500, error: 'Не удалось создать задачу' }
  const task = data as Record<string, unknown> & { id: string }

  await args.audit({
    action: 'user.task_created', entityType: 'user', entityId: args.userId, targetUserId: args.userId,
    metadata: { taskId: task.id, title: args.title },
  })
  return { ok: true, task }
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export const NOTE_COLUMNS = 'id, body, pinned, author_id, author_email, author_role, created_at, updated_at'

export type AddNoteResult = { ok: true; note: Record<string, unknown> & { id: string } } | Fail<'db_write'>

/** A staff note about a client, signed by its author. */
export async function addClientNote(args: {
  userId: string
  body: string
  pinned?: boolean
  author: { id: string; email: string | null; role: string | null }
  audit: ClientAuditWriter
}): Promise<AddNoteResult> {
  const { data, error } = await createServiceClient()
    .from('user_notes')
    .insert({
      user_id: args.userId,
      author_id: args.author.id,
      author_email: args.author.email ?? null,
      author_role: args.author.role,
      body: args.body,
      pinned: args.pinned ?? false,
    })
    .select(NOTE_COLUMNS)
    .single()
  if (error) return { ok: false, code: 'db_write', status: 500, error: 'Не удалось сохранить заметку' }
  const note = data as Record<string, unknown> & { id: string }

  await args.audit({
    action: 'user.note_added', entityType: 'user', entityId: args.userId, targetUserId: args.userId,
    metadata: { noteId: note.id },
  })
  return { ok: true, note }
}

// ─── Assignment ──────────────────────────────────────────────────────────────

export type AssignmentResult = { ok: true } | Fail<'not_staff' | 'db_write'>

/** Who leads the client (null — nobody). Only a staff member can be the owner. */
export async function setClientAssignment(args: {
  userId: string
  assigneeId: string | null
  actorId: string
  audit: ClientAuditWriter
}): Promise<AssignmentResult> {
  const sb = createServiceClient()
  if (args.assigneeId) {
    // Ответственным может быть только сотрудник: иначе клиента «назначат» на
    // другого клиента, и задача уйдёт в никуда.
    const { data: staff } = await sb.from('staff_roles').select('user_id').eq('user_id', args.assigneeId).maybeSingle()
    if (!staff) return { ok: false, code: 'not_staff', status: 400, error: 'Ответственным может быть только сотрудник' }
  }

  const { data: before } = await sb.from('user_assignments').select('assignee_id').eq('user_id', args.userId).maybeSingle()

  const now = new Date().toISOString()
  const { error } = await sb.from('user_assignments').upsert({
    user_id: args.userId,
    assignee_id: args.assigneeId,
    assigned_by: args.actorId,
    assigned_at: now,
    updated_at: now,
  }, { onConflict: 'user_id' })
  if (error) return { ok: false, code: 'db_write', status: 500, error: 'Не удалось назначить' }

  await args.audit({
    action: args.assigneeId ? 'user.assigned' : 'user.unassigned',
    entityType: 'user', entityId: args.userId, targetUserId: args.userId,
    oldValue: { assignee_id: (before as { assignee_id?: string } | null)?.assignee_id ?? null },
    newValue: { assignee_id: args.assigneeId },
  })
  return { ok: true }
}
