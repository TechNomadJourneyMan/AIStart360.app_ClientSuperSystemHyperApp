/**
 * lib/expert-sla/links.ts — куда ведёт задача SLA: в кабинете эксперта и в
 * ГИГА / кабинете SuperExpert. Чистые функции (клиентские компоненты).
 */
import type { ExpertSlaSource } from './policy'

interface LinkTask { source: ExpertSlaSource; source_id: string; client_id: string }

/** Кабинет эксперта (/expert): карточка клиента или отчёты на проверке. */
export function expertTaskHref(t: LinkTask): string {
  if (t.source === 'report_review') return '/expert/reports'
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
  }
}
