/**
 * components/point-b/planPrep.ts — what the client is told about his plan while there is no approved one (R3, part of
 * S1). Pure (no React, no DOM) so the wording is unit-tested.
 *
 * The rule of the PO «не имитировать»: nobody is said to be working unless a draft is open, and «от вас ничего не
 * требуется» is never said. The state comes from GET /api/v1/point-b/state (`plan.prep`, lib/point-b/plan/waiting.ts):
 *   in_work     «План готовит команда AIStart360» — a draft is open
 *   in_review   «План на проверке перед публикацией»
 *   waiting     «Данных для плана достаточно» — the team will prepare it, the client is notified when it is approved
 *   needs_data  «Для плана нужны данные» + the list with where to add each item
 * An unknown / missing state (an older server, the state not loaded yet) shows nothing rather than a promise.
 *
 * R3-SLA (migration 152): with the plan_prep task of the client (`prep.task`) the notice names who prepares the plan
 * and until when — «План готовит: <имя>, до <срок>», or «Назначаем ответственного» while nobody took it. A passed
 * deadline is never promised again: the notice says the deadline has passed and the team knows it.
 */
import type { MissingInput } from '@/lib/point-b/model/types'
import { clientDueLabel } from '@/lib/expert-sla/policy'

export type PlanPrepKind = 'published' | 'in_work' | 'in_review' | 'waiting' | 'needs_data'

export interface PlanPrepTaskState {
  assignee: string | null
  dueAt: string
  overdue: boolean
}

export interface PlanPrepState {
  kind: PlanPrepKind
  missing: Array<{ key: string; label: string; actions: MissingInput['actions'] }>
  since: string | null
  /** The plan_prep SLA task (152), when there is one. */
  task?: PlanPrepTaskState | null
}

function parseTask(v: unknown): PlanPrepTaskState | null {
  if (!isObj(v) || typeof v.dueAt !== 'string' || !Number.isFinite(new Date(v.dueAt).getTime())) return null
  return {
    assignee: typeof v.assignee === 'string' && v.assignee.trim() ? v.assignee.trim() : null,
    dueAt: v.dueAt,
    overdue: v.overdue === true,
  }
}

/** The area of the page a notice stands in: what will appear there once the plan is approved. */
export type PlanPrepArea = 'banner' | 'scenarios' | 'strategy' | 'roadmap' | 'history' | 'recs'

const KINDS: readonly PlanPrepKind[] = ['published', 'in_work', 'in_review', 'waiting', 'needs_data']
const ACTIONS: ReadonlyArray<MissingInput['actions'][number]> = ['survey', 'documents', 'expert']

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parsePlanPrep(v: unknown): PlanPrepState | null {
  if (!isObj(v) || !KINDS.includes(v.kind as PlanPrepKind)) return null
  const missing = (Array.isArray(v.missing) ? v.missing : [])
    .filter(isObj)
    .filter((m) => typeof m.key === 'string' && typeof m.label === 'string' && m.label.trim())
    .map((m) => ({
      key: m.key as string,
      label: m.label as string,
      actions: (Array.isArray(m.actions) ? m.actions : []).filter((a): a is MissingInput['actions'][number] => ACTIONS.includes(a as never)),
    }))
  const task = parseTask(v.task)
  return { kind: v.kind as PlanPrepKind, missing, since: typeof v.since === 'string' ? v.since : null, ...(task ? { task } : {}) }
}

const WHAT: Record<PlanPrepArea, string> = {
  banner: 'План',
  scenarios: 'Три темпа движения к цели — осторожный, умеренный и ускоренный —',
  strategy: 'Стратегии, инициативы и задачи',
  roadmap: 'Дорожная карта с вехами и сроками',
  history: 'Сверка «план — факт» по месяцам',
  recs: 'Проверенные рекомендации',
}

export interface PlanPrepView {
  tone: 'progress' | 'action'
  icon: string
  title: string
  text: string
  /** needs_data: what to add (with links); empty otherwise. */
  missing: PlanPrepState['missing']
}

/** null = say nothing (no state, or the plan is published — the area then shows its content). */
export function planPrepView(prep: PlanPrepState | null | undefined, area: PlanPrepArea): PlanPrepView | null {
  if (!prep || prep.kind === 'published') return null
  const what = WHAT[area]
  const after = area === 'banner'
    ? 'Пока вы видите автоматический расчёт по вашим данным.'
    : `${what} появятся здесь после одобрения плана. Пока ориентир — вкладка «Обзор» с автоматическим расчётом.`
  const task = prep.task && prep.kind !== 'needs_data' ? prep.task : null
  if (task) return taskView(prep.kind, task, after)
  switch (prep.kind) {
    case 'in_work':
      return { tone: 'progress', icon: 'edit_note', title: 'План готовит команда AIStart360', text: `Черновик вашего плана уже в работе. ${after}`, missing: [] }
    case 'in_review':
      return { tone: 'progress', icon: 'fact_check', title: 'План на проверке перед публикацией', text: `План собран и проходит проверку. ${after}`, missing: [] }
    case 'waiting':
      return {
        tone: 'progress',
        icon: 'task_alt',
        title: 'Данных для плана достаточно',
        text: `План подготовит команда AIStart360 — мы пришлём уведомление, когда он будет одобрен. ${after}`,
        missing: [],
      }
    case 'needs_data':
      return {
        tone: 'action',
        icon: 'database',
        title: 'Для плана нужны данные',
        text: 'Без них мы не можем рассчитать сценарии и подготовить план. Добавьте их — это займёт несколько минут.',
        missing: prep.missing,
      }
  }
}

/**
 * The notice by the plan_prep task (152): who prepares the plan and until when. «Назначаем ответственного» while the
 * queue waits for Admin / Super Admin; no date once the deadline has passed.
 */
function taskView(kind: PlanPrepKind, task: PlanPrepTaskState, after: string): PlanPrepView {
  const due = task.overdue ? null : clientDueLabel(task.dueAt)
  const deadline = due ? `План будет готов до ${due}.` : 'Срок подготовки прошёл — команда об этом знает.'
  if (kind === 'in_review') {
    return {
      tone: 'progress', icon: 'fact_check', title: 'План на проверке перед публикацией',
      text: `План собран${task.assignee ? ` (${task.assignee})` : ''} и проходит проверку. ${due ? `Срок — до ${due}.` : deadline} ${after}`, missing: [],
    }
  }
  if (task.assignee) {
    return {
      tone: 'progress', icon: 'edit_note', title: `План готовит: ${task.assignee}`,
      text: `${kind === 'in_work' ? 'Черновик вашего плана уже в работе. ' : ''}${deadline} Мы пришлём уведомление, когда план будет одобрен. ${after}`, missing: [],
    }
  }
  return {
    tone: 'progress', icon: 'person_search', title: 'Назначаем ответственного',
    text: `${kind === 'in_work' ? 'Черновик вашего плана уже в работе. ' : 'Данных для плана достаточно — план подготовит команда AIStart360. '}${deadline} ${after}`, missing: [],
  }
}
