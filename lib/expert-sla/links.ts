/**
 * lib/expert-sla/links.ts — куда ведёт задача SLA: в кабинете эксперта и в
 * ГИГА / кабинете SuperExpert. Чистые функции (клиентские компоненты).
 */
import type { ExpertSlaSource } from './policy'

interface LinkTask { source: ExpertSlaSource; source_id: string; client_id: string }

/** Якорь панели «Проверка разбора ИИ» (components/expert-review/AiReviewPanel.tsx). */
export const AI_REVIEW_ANCHOR = 'ai-review'

/** Кабинет эксперта (/expert): карточка клиента, отчёты на проверке, проверка разбора ИИ. */
export function expertTaskHref(t: LinkTask): string {
  if (t.source === 'report_review') return '/expert/reports'
  if (t.source === 'pa_ai_review') return `/expert/clients/${t.client_id}?tab=point-a#${AI_REVIEW_ANCHOR}`
  return `/expert/clients/${t.client_id}`
}

/** ГИГА (`/admin-giga-panel`) или кабинет SuperExpert (`/super-expert`). */
export function staffTaskHref(t: LinkTask, base: string): string {
  const superExpert = base.startsWith('/super-expert')
  switch (t.source) {
    case 'case': return `${base}/cases?case=${t.source_id}`
    case 'report_review': return `${base}/reports`
    case 'plan_review': return superExpert ? `${base}/users/${t.client_id}` : `${base}/point-b-queue`
    case 'rec_review': return `${base}/users/${t.client_id}`
    case 'pa_ai_review': return `${base}/users/${t.client_id}?tab=point-a#${AI_REVIEW_ANCHOR}`
    // «Собрать черновик плана» — в «Точке Б» клиента (User 360, R3-PB).
    case 'plan_prep': return superExpert ? `${base}/users/${t.client_id}` : `${base}/users/${t.client_id}?tab=point-b`
    default: return `${base}/users/${t.client_id}`
  }
}

/** «Собрать черновик плана» для задачи plan_prep (ГИГА → User 360 → «Точка Б»). */
export function planDraftHref(clientId: string, base: string): string {
  return `${base}/users/${clientId}?tab=point-b`
}
