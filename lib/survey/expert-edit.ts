/**
 * lib/survey/expert-edit.ts — an expert changes the answers of an ASSIGNED
 * client (PO decision 2026-10-23, spec §18.3 item 3): the client is told who
 * changed what. The edit itself goes through adminEditSurvey (audit with the
 * reason, author «эксперт», path «staff», history by trigger).
 */
import { notifyClient, type NotifyClientResult } from '@/lib/notifications/notify'
import { SURVEY_QUESTIONS } from './questions'

const MAX_LISTED = 3

/** «Выручка в месяц, Цикл сделки и ещё 2» — the changed questions in plain words. */
export function changedQuestionsText(keys: readonly string[]): string {
  const labels = keys.map((k) => SURVEY_QUESTIONS[k]?.label ?? k)
  if (labels.length <= MAX_LISTED) return labels.join(', ')
  return `${labels.slice(0, MAX_LISTED).join(', ')} и ещё ${labels.length - MAX_LISTED}`
}

export function expertEditNotice(input: { expertName: string | null; keys: readonly string[]; reason?: string | null }): { title: string; body: string } {
  const who = input.expertName?.trim() ? `Эксперт ${input.expertName.trim()}` : 'Ваш эксперт'
  const reason = input.reason?.trim() ? ` Причина: ${input.reason.trim()}.` : ''
  return {
    title: 'Эксперт изменил ответы анкеты',
    body: `${who} изменил ответы: ${changedQuestionsText(input.keys)}.${reason} Все изменения видны в «Мои ответы», прежние значения сохранены в истории.`,
  }
}

/**
 * The in-app / email / Telegram notice to the client (category «Эксперт»).
 * One notice per expert and client per hour: several quick edits in a row are
 * one message. Never throws.
 */
export async function notifyClientOfExpertEdit(input: {
  clientId: string
  expertId: string
  expertName: string | null
  keys: readonly string[]
  reason?: string | null
  now?: Date
}): Promise<NotifyClientResult | null> {
  if (!input.keys.length) return null
  const { title, body } = expertEditNotice(input)
  const hour = (input.now ?? new Date()).toISOString().slice(0, 13)
  try {
    return await notifyClient({
      userId: input.clientId,
      category: 'expert',
      event: 'survey_edited_by_expert',
      title,
      body,
      ctaUrl: '/client/onboarding/answers?filter=staff',
      ctaLabel: 'Мои ответы',
      dedupeKey: `survey_expert_edit:${input.clientId}:${input.expertId}:${hour}`,
      metadata: { keys: input.keys.slice(0, 50) },
    })
  } catch (err) {
    console.error('[survey/expert-edit] notify failed', err instanceof Error ? err.message : err)
    return null
  }
}
