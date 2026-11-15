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
 */
import type { MissingInput } from '@/lib/point-b/model/types'

export type PlanPrepKind = 'published' | 'in_work' | 'in_review' | 'waiting' | 'needs_data'

export interface PlanPrepState {
  kind: PlanPrepKind
  missing: Array<{ key: string; label: string; actions: MissingInput['actions'] }>
  since: string | null
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
  return { kind: v.kind as PlanPrepKind, missing, since: typeof v.since === 'string' ? v.since : null }
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
