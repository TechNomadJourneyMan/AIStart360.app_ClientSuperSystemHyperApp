/**
 * Actions of the admin bot's assistant.
 *
 * The model never changes anything. A `propose_*` tool validates its
 * arguments, checks the permission (the same as the GIGA route) and the client
 * scope, and shows a card with ✅ / ✖️ through ctx.confirm (one-time nonce,
 * 5 minutes, one card per answer). Only the person's ✅ reaches
 * `executeBrainAction` (router.confirmed['ai.act']), which re-reads the
 * person (the dispatcher re-resolves them on every press), re-checks the
 * permission and the scope, and runs the EXISTING shared function with the
 * staff member as the actor and an audit entry (auditFor, via 'telegram').
 *
 *   access    users.approve                 lib/users/access-requests.ts decideAccessRequest
 *   remind    users.invite + users.sensitive lib/admin/client-actions.ts sendSurveyReminder (one or a group)
 *   task      users.view + users.sensitive  lib/admin/client-actions.ts createClientTask
 *   assign    users.view + users.sensitive  lib/admin/client-actions.ts setClientAssignment
 *   note      users.view + users.sensitive  lib/admin/client-actions.ts addClientNote
 *   approval  approvals.decide              lib/agents/approvals.ts decideApproval (+ cards closed)
 *   retry     agents.run                    lib/admin/staff-actions.ts agentTaskAction('retry')
 *   attach    users.view + users.sensitive  ./attach.ts → storage + lib/documents/finalize.ts finalizeUpload
 */
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { hasPermission, type Permission } from '@/lib/admin/rbac'
import { createServiceClient } from '@/lib/supabase-service'
import { decideAccessRequest } from '@/lib/users/access-requests'
import { addClientNote, createClientTask, sendSurveyReminder, setClientAssignment } from '@/lib/admin/client-actions'
import { agentTaskAction } from '@/lib/admin/staff-actions'
import { decideApproval } from '@/lib/agents/approvals'
import { DOCUMENT_TYPES, isDocumentType } from '@/lib/documents/doc-types'
import { userCard, type UserCard } from '../bots/data'
import { downloadTelegramFile } from '../bots/registry'
import { cut, dt, esc } from '../bots/ui'
import { auditFor, permLabel, type AdminCtx, type AdminEntry } from '../bots/admin/context'
import { requestIdFor } from '../bots/admin/users'
import { attachFileToClient } from './attach'
import { brainDeps } from './deps'
import { NOT_ASSIGNED, userAllowed, type BrainScope } from './scope'
import { findStuckOnSurvey } from './tools-read'
import { BrainToolError, roleCan, type BrainRole, type BrainTool, type ToolRunContext } from './types'

export const BRAIN_CONFIRM_ACTION = 'ai.act'

type ActionName = 'access' | 'remind' | 'task' | 'assign' | 'note' | 'approval' | 'retry' | 'attach'

export const ACTION_PERMS: Record<ActionName, Permission[]> = {
  access: ['users.approve'],
  remind: ['users.invite', 'users.sensitive'],
  task: ['users.view', 'users.sensitive'],
  assign: ['users.view', 'users.sensitive'],
  note: ['users.view', 'users.sensitive'],
  approval: ['approvals.decide'],
  retry: ['agents.run'],
  attach: ['users.view', 'users.sensitive'],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_GROUP = 20

const allows = (name: ActionName) => (role: BrainRole) => ACTION_PERMS[name].every((p) => roleCan(role, p))

function requirePerms(t: ToolRunContext, name: ActionName): void {
  const missing = ACTION_PERMS[name].filter((p) => !roleCan(t.role, p))
  if (missing.length) throw new BrainToolError(`Недостаточно прав: ${missing.map(permLabel).join(', ')}`)
}

function onePerTurn(t: ToolRunContext): void {
  if (t.turn.proposed) throw new BrainToolError('В одном ответе можно предложить только одно действие — дождитесь решения по первому')
}

const personName = (u: Pick<UserCard, 'full_name' | 'email' | 'company_name'>, pii: boolean) =>
  `<b>${esc(u.full_name ?? (pii ? u.email : null) ?? 'без имени')}</b>${u.company_name ? ` (${esc(cut(u.company_name, 60))})` : ''}`

/** A client the person may act on: exists, is a client (not staff), within the scope. */
async function clientTarget(t: Pick<ToolRunContext, 'scope'>, userId: string): Promise<UserCard> {
  if (!userAllowed(t.scope, userId)) throw new BrainToolError(NOT_ASSIGNED)
  const u = await userCard(userId)
  if (!u) throw new BrainToolError('Пользователь не найден')
  if (u.staff_role || (u.role !== 'client' && u.role !== 'owner')) throw new BrainToolError('Действие доступно только для клиентов')
  return u
}

interface StaffRef { id: string; name: string }

/** 'me', a staff user id or a staff e-mail → the staff member. */
async function staffRef(ref: string, me: string): Promise<StaffRef> {
  if (ref === 'me') return { id: me, name: 'вы' }
  type Row = { user_id: string; full_name: string | null; email: string | null }
  const rows = UUID_RE.test(ref)
    ? await prisma.$queryRaw<Row[]>`
        SELECT s.user_id::text, p.full_name, p.email FROM public.staff_roles s JOIN public.profiles p ON p.id = s.user_id
        WHERE s.user_id = ${ref}::uuid`
    : await prisma.$queryRaw<Row[]>`
        SELECT s.user_id::text, p.full_name, p.email FROM public.staff_roles s JOIN public.profiles p ON p.id = s.user_id
        WHERE lower(p.email) = ${ref.toLowerCase()} LIMIT 2`
  if (rows.length !== 1) throw new BrainToolError('Ответственным может быть только сотрудник — укажите «me», его user_id или email')
  return { id: rows[0].user_id, name: rows[0].full_name ?? rows[0].email ?? rows[0].user_id }
}

/** ISO date-time or YYYY-MM-DD (end of that day in Almaty, UTC+5) → ISO string. */
export function dueAtOf(v: string | undefined | null): string | null {
  if (!v) return null
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T18:00:00+05:00`) : new Date(v)
  if (Number.isNaN(d.getTime())) throw new BrainToolError('due_at: дата в формате YYYY-MM-DD или ISO 8601')
  return d.toISOString()
}

async function propose(t: ToolRunContext, html: string, action: ActionName, args: string[]): Promise<Record<string, unknown>> {
  await t.ctx.confirm(html, BRAIN_CONFIRM_ACTION, [action, ...args])
  t.turn.proposed = true
  return { status: 'proposed', note: 'Карточка с кнопками «Подтвердить» / «Отмена» показана пользователю. Ничего не выполнено, пока он не нажмёт «Подтвердить». Не утверждай, что действие выполнено.' }
}

// ─── propose_* tools ─────────────────────────────────────────────────────────

export const PROPOSE_TOOLS: BrainTool[] = [
  {
    name: 'propose_access_decision',
    description: 'Предложить одобрить или отклонить заявку на доступ (покажет карточку подтверждения; само ничего не делает). user_id — из list_access_requests.',
    kind: 'propose',
    input: z.object({ user_id: z.string().uuid(), decision: z.enum(['approve', 'reject']), reason: z.string().trim().max(300).optional().describe('Причина отказа — уйдёт пользователю в письме') }).strict(),
    available: allows('access'),
    async run(raw, t) {
      const a = raw as { user_id: string; decision: 'approve' | 'reject'; reason?: string }
      requirePerms(t, 'access')
      onePerTurn(t)
      const u = await userCard(a.user_id)
      if (!u) throw new BrainToolError('Пользователь не найден')
      if (u.status !== 'pending_approval') throw new BrainToolError(`Заявка не ждёт решения (статус ${u.status})`)
      const html = a.decision === 'approve'
        ? `✅ Открыть доступ к платформе: ${personName(u, t.pii)}?`
        : `❌ Отклонить заявку ${personName(u, t.pii)}${a.reason ? ` с причиной «${esc(cut(a.reason, 200))}»` : ' без причины'}? Пользователь получит письмо.`
      return propose(t, html, 'access', [a.user_id, a.decision, a.reason ?? ''])
    },
  },
  {
    name: 'propose_survey_reminder',
    description: 'Предложить отправить письмо «допройдите анкету» одному клиенту или группе: user_ids (до 20) или фильтр stuck_min_idle_days (клиенты, бросившие анкету). Не чаще раза в сутки на клиента.',
    kind: 'propose',
    input: z.object({
      user_ids: z.array(z.string().uuid()).min(1).max(MAX_GROUP).optional(),
      stuck_min_idle_days: z.number().int().min(0).max(180).optional().describe('Все клиенты, не трогавшие анкету столько дней (до 20 человек)'),
      note: z.string().trim().max(300).optional().describe('Короткая приписка в письме'),
    }).strict().refine((v) => Boolean(v.user_ids) !== (v.stuck_min_idle_days !== undefined), { message: 'Укажите либо user_ids, либо stuck_min_idle_days' }),
    available: allows('remind'),
    async run(raw, t) {
      const a = raw as { user_ids?: string[]; stuck_min_idle_days?: number; note?: string }
      requirePerms(t, 'remind')
      onePerTurn(t)
      let targets: Array<{ id: string; label: string }>
      if (a.user_ids) {
        const uniq = [...new Set(a.user_ids)]
        targets = []
        for (const id of uniq) {
          const u = await clientTarget(t, id)
          targets.push({ id, label: personName(u, t.pii) })
        }
      } else {
        const stuck = (await findStuckOnSurvey(a.stuck_min_idle_days ?? 3)).filter((r) => userAllowed(t.scope, r.user_id)).slice(0, MAX_GROUP)
        if (!stuck.length) throw new BrainToolError('Под фильтр никто не попал')
        targets = stuck.map((r) => ({ id: r.user_id, label: `<b>${esc(r.full_name ?? 'без имени')}</b>${r.company_name ? ` (${esc(cut(r.company_name, 40))})` : ''} — ${Number(r.survey_steps)} шаг.` }))
      }
      const html = [
        `✉️ Напомнить про анкету (${targets.length}):`,
        ...targets.map((x) => `• ${x.label}`),
        a.note ? `\nПриписка: «${esc(cut(a.note, 300))}»` : '',
      ].join('\n')
      return propose(t, html, 'remind', [a.note ?? '', ...targets.map((x) => x.id)])
    },
  },
  {
    name: 'propose_task',
    description: 'Предложить создать задачу по клиенту: что сделать, срок, исполнитель («me», user_id или email сотрудника; по умолчанию — вы).',
    kind: 'propose',
    input: z.object({
      user_id: z.string().uuid().describe('user_id клиента (owner.user_id)'),
      title: z.string().trim().min(1).max(300),
      due_at: z.string().max(40).optional().describe('Срок: YYYY-MM-DD или ISO 8601'),
      assignee: z.string().trim().max(200).optional(),
    }).strict(),
    available: allows('task'),
    async run(raw, t) {
      const a = raw as { user_id: string; title: string; due_at?: string; assignee?: string }
      requirePerms(t, 'task')
      onePerTurn(t)
      const u = await clientTarget(t, a.user_id)
      const due = dueAtOf(a.due_at)
      const who = a.assignee ? await staffRef(a.assignee, t.role.userId) : { id: t.role.userId, name: 'вы' }
      const html = `📌 Задача по клиенту ${personName(u, t.pii)}:\n«${esc(a.title)}»\nСрок: ${due ? dt(due) : 'без срока'} · исполнитель: ${esc(who.name)}`
      return propose(t, html, 'task', [a.user_id, a.title, due ?? '', who.id])
    },
  },
  {
    name: 'propose_assign_owner',
    description: 'Предложить назначить ответственного сотрудника за клиента («me», user_id или email сотрудника) или снять ответственного (assignee = "none").',
    kind: 'propose',
    input: z.object({ user_id: z.string().uuid(), assignee: z.string().trim().min(1).max(200) }).strict(),
    available: allows('assign'),
    async run(raw, t) {
      const a = raw as { user_id: string; assignee: string }
      requirePerms(t, 'assign')
      onePerTurn(t)
      const u = await clientTarget(t, a.user_id)
      const who = a.assignee === 'none' ? null : await staffRef(a.assignee, t.role.userId)
      const html = who
        ? `👤 Назначить ответственным за клиента ${personName(u, t.pii)}: <b>${esc(who.name)}</b>?`
        : `👤 Снять ответственного с клиента ${personName(u, t.pii)}?`
      return propose(t, html, 'assign', [a.user_id, who?.id ?? ''])
    },
  },
  {
    name: 'propose_note',
    description: 'Предложить добавить заметку о клиенте (видна сотрудникам в карточке клиента).',
    kind: 'propose',
    input: z.object({ user_id: z.string().uuid(), body: z.string().trim().min(1).max(2000), pinned: z.boolean().default(false) }).strict(),
    available: allows('note'),
    async run(raw, t) {
      const a = raw as { user_id: string; body: string; pinned: boolean }
      requirePerms(t, 'note')
      onePerTurn(t)
      const u = await clientTarget(t, a.user_id)
      const html = `🗒 ${a.pinned ? 'Закреплённая заметка' : 'Заметка'} о клиенте ${personName(u, t.pii)}:\n<blockquote>${esc(a.body)}</blockquote>`
      return propose(t, html, 'note', [a.user_id, a.body, a.pinned ? '1' : '0'])
    },
  },
  {
    name: 'propose_approval_decision',
    description: 'Предложить одобрить или отклонить действие ИИ-агента, ждущее решения (approval_id из list_pending_approvals).',
    kind: 'propose',
    input: z.object({ approval_id: z.string().uuid(), decision: z.enum(['approve', 'reject']) }).strict(),
    available: allows('approval'),
    async run(raw, t) {
      const a = raw as { approval_id: string; decision: 'approve' | 'reject' }
      requirePerms(t, 'approval')
      onePerTurn(t)
      const rows = await prisma.$queryRaw<Array<{ agent_key: string; summary: string; status: string; company_name: string | null; expires_at: Date | null }>>`
        SELECT a.agent_key, a.summary, a.status, c.name AS company_name, a.expires_at
        FROM public.agent_approvals a LEFT JOIN public.companies c ON c.id = a.company_id
        WHERE a.id = ${a.approval_id}::uuid`
      const ap = rows[0]
      if (!ap) throw new BrainToolError('Запрос на одобрение не найден')
      if (ap.status !== 'pending' || (ap.expires_at && ap.expires_at < t.now)) throw new BrainToolError('Решение уже принято или срок истёк')
      const html = `${a.decision === 'approve' ? '✅ Одобрить' : '❌ Отклонить'} действие агента <b>${esc(ap.agent_key)}</b>${ap.company_name ? ` (${esc(ap.company_name)})` : ''}:\n«${esc(cut(ap.summary, 300))}»`
      return propose(t, html, 'approval', [a.approval_id, a.decision])
    },
  },
  {
    name: 'propose_retry_task',
    description: 'Предложить перезапустить задачу ИИ-агента, завершившуюся неуспешно (failed / dead / cancelled). task_id из list_agent_tasks.',
    kind: 'propose',
    input: z.object({ task_id: z.string().uuid() }).strict(),
    available: allows('retry'),
    async run(raw, t) {
      const a = raw as { task_id: string }
      requirePerms(t, 'retry')
      onePerTurn(t)
      const rows = await prisma.$queryRaw<Array<{ agent_key: string; status: string; last_error_code: string | null; company_name: string | null }>>`
        SELECT t.agent_key, t.status, t.last_error_code, c.name AS company_name
        FROM public.agent_tasks t LEFT JOIN public.companies c ON c.id = t.company_id
        WHERE t.id = ${a.task_id}::uuid`
      const task = rows[0]
      if (!task) throw new BrainToolError('Задача не найдена')
      if (!['failed', 'dead', 'cancelled'].includes(task.status)) throw new BrainToolError(`Повторить можно только неуспешную задачу (сейчас ${task.status})`)
      const html = `🔁 Перезапустить задачу <code>${esc(a.task_id.slice(0, 8))}</code> агента <b>${esc(task.agent_key)}</b>${task.company_name ? ` (${esc(task.company_name)})` : ''}?${task.last_error_code ? `\nПоследняя ошибка: <code>${esc(task.last_error_code)}</code>` : ''}`
      return propose(t, html, 'retry', [a.task_id])
    },
  },
  {
    name: 'propose_attach_file',
    description: `Предложить прикрепить последний файл, присланный в этот чат, к документам клиента (уйдёт в обработку как загрузка клиента). doc_type — тип документа: ${DOCUMENT_TYPES.join(', ')}.`,
    kind: 'propose',
    input: z.object({ user_id: z.string().uuid().describe('user_id клиента (owner.user_id)'), doc_type: z.string().max(40).default('other') }).strict(),
    available: allows('attach'),
    async run(raw, t) {
      const a = raw as { user_id: string; doc_type: string }
      requirePerms(t, 'attach')
      onePerTurn(t)
      if (!isDocumentType(a.doc_type)) throw new BrainToolError(`Неизвестный doc_type — один из: ${DOCUMENT_TYPES.join(', ')}`)
      const file = t.turn.file
      if (!file) throw new BrainToolError('В этом чате нет присланного файла за последние 24 часа — попросите прислать файл')
      const u = await clientTarget(t, a.user_id)
      const html = `📎 Прикрепить файл <b>${esc(cut(file.fileName, 80))}</b> к документам клиента ${personName(u, t.pii)} как «${esc(a.doc_type)}»? Он пройдёт ту же проверку и обработку, что загрузка клиента.`
      return propose(t, html, 'attach', [a.user_id, file.id, a.doc_type])
    },
  },
]

// ─── Execution (only through the ✅ button) ──────────────────────────────────

async function scopeCheck(scope: BrainScope, ids: string[]): Promise<string | null> {
  for (const id of ids) {
    if (!UUID_RE.test(id)) return 'Некорректный идентификатор'
    if (!userAllowed(scope, id)) return NOT_ASSIGNED
  }
  return null
}

const ok = (s: string) => `✅ ${s}`
const fail = (s: string) => `⚠️ ${esc(s)}`

async function run(ctx: AdminCtx, name: ActionName, args: string[], scope: BrainScope): Promise<string> {
  const audit = auditFor(ctx)
  const actorId = ctx.principal.userId
  switch (name) {
    case 'access': {
      const [userId, decision, reason] = args
      if (!UUID_RE.test(userId) || (decision !== 'approve' && decision !== 'reject')) return fail('Некорректное действие')
      await audit({ action: `request.${decision}`, entityType: 'user', entityId: userId, targetUserId: userId, newValue: { action: decision, reason: reason || null }, metadata: { assistant: true } }, { required: true })
      const res = await decideAccessRequest(createServiceClient(), {
        requestId: await requestIdFor(userId), action: decision, reason: reason || undefined, actor: { id: actorId, kind: 'telegram' },
      })
      return res.ok ? ok(decision === 'approve' ? 'Доступ открыт.' : 'Заявка отклонена, пользователю ушло письмо.') : fail('Профиль не найден — статус не изменён')
    }
    case 'remind': {
      const [note, ...ids] = args
      const denied = await scopeCheck(scope, ids)
      if (denied) return fail(denied)
      const lines: string[] = []
      let sent = 0
      for (const userId of ids.slice(0, MAX_GROUP)) {
        const u = await userCard(userId)
        const res = await sendSurveyReminder({ userId, note: note || null, fromLabel: ctx.principal.email ?? null, audit })
        if (res.ok) sent += 1
        lines.push(`${res.ok ? '✅' : '⚠️'} ${esc(u?.full_name ?? userId.slice(0, 8))}${res.ok ? '' : ` — ${esc(res.error)}`}`)
      }
      return [`✉️ Напоминания про анкету: отправлено ${sent} из ${ids.length}.`, ...lines].join('\n')
    }
    case 'task': {
      const [userId, title, due, assigneeId] = args
      const denied = await scopeCheck(scope, [userId])
      if (denied) return fail(denied)
      const res = await createClientTask({ userId, title, dueAt: due || null, assigneeId: UUID_RE.test(assigneeId ?? '') ? assigneeId : null, actorId, audit })
      return res.ok ? ok(`Задача создана: «${esc(cut(title, 200))}».`) : fail(res.error)
    }
    case 'assign': {
      const [userId, assigneeId] = args
      const denied = await scopeCheck(scope, [userId])
      if (denied) return fail(denied)
      const res = await setClientAssignment({ userId, assigneeId: UUID_RE.test(assigneeId ?? '') ? assigneeId : null, actorId, audit })
      return res.ok ? ok(assigneeId ? 'Ответственный назначен.' : 'Ответственный снят.') : fail(res.error)
    }
    case 'note': {
      const [userId, body, pinned] = args
      const denied = await scopeCheck(scope, [userId])
      if (denied) return fail(denied)
      const res = await addClientNote({ userId, body, pinned: pinned === '1', author: { id: actorId, email: ctx.principal.email, role: ctx.principal.role }, audit })
      return res.ok ? ok('Заметка сохранена в карточке клиента.') : fail(res.error)
    }
    case 'approval': {
      const [approvalId, decision] = args
      if (!UUID_RE.test(approvalId) || (decision !== 'approve' && decision !== 'reject')) return fail('Некорректное действие')
      // Written before the decision and required: no journal entry → no decision.
      await audit({ action: 'agent.approval.decide', entityType: 'agent_approval', entityId: approvalId, newValue: { decision }, metadata: { assistant: true } }, { required: true })
      const res = await decideApproval({ approvalId, decision, actorId, via: 'telegram' })
      if (!res.ok) return fail(res.reason === 'not_pending' ? 'Решение уже принято или срок истёк.' : 'Запрос не найден.')
      void import('@/lib/notifications/approval-cards')
        .then((m) => m.closeApprovalCards({ approvalId, status: res.status!, decidedBy: ctx.principal.email ?? actorId, via: 'telegram', summary: res.summary, fetchImpl: ctx.deps.fetchImpl }))
        .catch(() => {})
      return ok(res.status === 'approved' ? 'Действие агента одобрено, задача снова в очереди.' : 'Действие агента отклонено, задача отменена.')
    }
    case 'retry': {
      const [taskId] = args
      if (!UUID_RE.test(taskId)) return fail('Некорректный идентификатор')
      const res = await agentTaskAction({ taskId, action: 'retry', actorId, audit })
      return res.ok ? ok(`Задача <code>${esc(taskId.slice(0, 8))}</code> снова в очереди.`) : fail(res.error)
    }
    case 'attach': {
      const [userId, fileRowId, docType] = args
      const denied = await scopeCheck(scope, [userId])
      if (denied) return fail(denied)
      if (!isDocumentType(docType)) return fail('Неизвестный тип документа')
      const deps = brainDeps()
      const file = await deps.memory.fileById('admin', ctx.chatId, fileRowId)
      if (!file) return fail('Файл больше недоступен (храним 24 часа) — пришлите его ещё раз')
      const dl = await downloadTelegramFile('admin', file.fileId, { fetchImpl: ctx.deps.fetchImpl })
      if (!dl.ok) return fail(dl.reason === 'too_large' ? 'Файл больше 20 МБ — Telegram не отдаёт такие боту' : 'Не удалось скачать файл из Telegram')
      await audit({ action: 'document.attach_via_bot', entityType: 'user', entityId: userId, targetUserId: userId, newValue: { fileName: file.fileName, docType, size: dl.bytes.length }, metadata: { assistant: true } }, { required: true })
      const res = await attachFileToClient({ clientUserId: userId, bytes: dl.bytes, fileName: file.fileName, mime: file.mime, docType, deps: deps.attach() })
      if (!res.ok) return fail(res.error)
      return ok(res.duplicate
        ? `Такой файл у клиента уже есть («${esc(res.fileName)}») — повторно не добавлен.`
        : `Файл «${esc(res.fileName)}» прикреплён к клиенту и отправлен в обработку.`)
    }
  }
}

/** router.confirmed['ai.act']: the ✅ of an assistant card. */
export async function executeBrainAction(ctx: AdminCtx, args: string[]): Promise<void> {
  const [name, ...rest] = args
  if (!(name in ACTION_PERMS)) {
    await ctx.show('Действие устарело.')
    return
  }
  const action = name as ActionName
  // The dispatcher re-resolved the person for this press; the role is current.
  const missing = ACTION_PERMS[action].filter((p) => !hasPermission(ctx.principal.role, p))
  if (missing.length) {
    await ctx.show(`⛔ Недостаточно прав: ${missing.map(permLabel).join(', ')}`)
    return
  }
  const scope = await brainDeps().scope(ctx.principal.userId)
  let text: string
  try {
    text = await run(ctx, action, rest, scope)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    console.error('[telegram/brain] action failed:', action, msg.split('\n')[0])
    text = /audit log unavailable/i.test(msg) ? fail('Журнал аудита недоступен — действие не выполнено. Попробуйте позже.') : fail('Не удалось выполнить действие. Попробуйте позже.')
  }
  await ctx.show(text)
  await ctx.toast(text.startsWith('✅') ? 'Готово' : 'Не выполнено')
}

export const brainConfirmed: Record<string, AdminEntry> = {
  [BRAIN_CONFIRM_ACTION]: { run: (ctx, args) => executeBrainAction(ctx, args) },
}
