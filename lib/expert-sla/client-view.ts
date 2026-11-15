/**
 * lib/expert-sla/client-view.ts — what the CLIENT is told about the expert work
 * on his Point A / Point B (R3-SLA, миграция 152), by the data of the SLA task:
 *   «Эксперт проверит до <срок>»          — the AI analysis waits for the expert
 *   «План готовит: <имя>, до <срок>»       — a plan_prep task held by somebody
 *   «Назначаем ответственного»             — a plan_prep task in the queue
 * A promise of a date only while the task is open, the SLA is switched on and the
 * deadline has not passed (the rule of R2-B: no new promise for an overdue task).
 * The name is the profile name of the assignee, never the email
 * (lib/expert-review/server authorNames). Reads with the service role — the
 * caller has authorised the client; a failed read means «no notice», never an error.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { authorNames } from '@/lib/expert-review/server'
import { DEFAULT_EXPERT_SLA, type ExpertSlaConfig, type ExpertSlaSource } from './policy'

type Sb = Pick<SupabaseClient, 'from'>

export interface ClientTaskNotice {
  /** The item of the task (diagnostics id / company id). */
  sourceId: string
  /** The answer deadline (ISO). */
  dueAt: string
  /** The deadline has passed — no date is promised any more. */
  overdue: boolean
  /** Who holds the task (the profile name), null — nobody yet. */
  assignee: string | null
  /** The work was taken up (reaction). */
  inProgress: boolean
}

async function slaEnabled(config?: () => Promise<Pick<ExpertSlaConfig, 'enabled'>>): Promise<boolean> {
  try {
    if (config) return (await config()).enabled
    const { getSetting } = await import('@/lib/settings/store')
    return (await getSetting('expert_sla')).enabled
  } catch {
    return DEFAULT_EXPERT_SLA.enabled
  }
}

export async function loadClientTaskNotice(sb: Sb, input: {
  source: Extract<ExpertSlaSource, 'pa_ai_review' | 'plan_prep'>
  clientId: string
  /** The item (a diagnostics id, a company id); omitted — the client's open task of the source (one at a time). */
  sourceId?: string
  /** Read the assignee's name (one more read). Default true. */
  withName?: boolean
  now?: Date
  config?: () => Promise<Pick<ExpertSlaConfig, 'enabled'>>
}): Promise<ClientTaskNotice | null> {
  try {
    const [enabled, read] = await Promise.all([
      slaEnabled(input.config),
      (() => {
        let q = sb.from('expert_sla_tasks')
          .select('source_id, answer_due_at, assignee_id, first_response_at')
          .eq('source', input.source).eq('client_id', input.clientId).is('closed_at', null)
        if (input.sourceId) q = q.eq('source_id', input.sourceId)
        return q.order('received_at', { ascending: false }).limit(1)
      })(),
    ])
    if (!enabled || read.error) return null // switched off / before migration 152
    const t = ((read.data ?? []) as Array<{ source_id: string; answer_due_at: string; assignee_id: string | null; first_response_at: string | null }>)[0]
    if (!t) return null
    const due = new Date(t.answer_due_at)
    if (!Number.isFinite(due.getTime())) return null
    const assignee = t.assignee_id && input.withName !== false
      ? (await authorNames(sb as SupabaseClient, [t.assignee_id])).get(t.assignee_id) ?? null
      : null
    return {
      sourceId: String(t.source_id),
      dueAt: due.toISOString(),
      overdue: due.getTime() <= (input.now ?? new Date()).getTime(),
      assignee,
      inProgress: !!t.first_response_at,
    }
  } catch {
    return null
  }
}

export { clientDueLabel } from './policy'
