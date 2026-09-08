/**
 * lib/survey/completion-notice.ts — «анкета пройдена» ровно один раз.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ: триггер «все 12 шагов заполнены» ненадёжен —
 * последний шаг («Системы и инструменты») можно проехать, ничего не введя,
 * и тогда в БД просто нет строк s12_*, прогресс навсегда 11/12, а
 * уведомление админам не уходит. Проверено на QA-аккаунте: 171 ответ,
 * шаги 1–11, ни одного s12_*.
 *
 * Поэтому уведомление шлётся, когда клиент ОТПРАВИЛ финальный шаг мастера
 * (или когда анкета впервые стала полной), а повторы гасятся маркером в
 * `public.app_notifications` — он же показывается клиенту в ленте уведомлений.
 * Маркер живёт вне survey_answers специально: любая строка в survey_answers
 * вернулась бы в браузер через GET и была бы переотправлена обратно, испортив
 * подсчёт шагов.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const SURVEY_COMPLETED_EVENT = 'survey_completed'
export const SURVEY_NOTICE_CATEGORY = 'survey'

export interface SurveyNoticeInput {
  completedSteps: number
  totalSteps: number
  company: string
  sheetUrl: string | null
}

/** Решение о рассылке: финальный шаг отправлен ИЛИ анкета только что стала полной. */
export function shouldAnnounceCompletion(opts: {
  submittedStep: number
  totalSteps: number
  isCompleteNow: boolean
  wasCompleteBefore: boolean
}): boolean {
  const finalStepSubmitted = opts.submittedStep >= opts.totalSteps
  const justCompleted = opts.isCompleteNow && !opts.wasCompleteBefore
  return finalStepSubmitted || justCompleted
}

/** Текст записи в клиентской ленте уведомлений. */
export function buildClientNotice(input: SurveyNoticeInput): { title: string; body: string; link: string } {
  const full = input.completedSteps >= input.totalSteps
  return {
    title: full ? 'Анкета заполнена полностью' : 'Анкета отправлена',
    body: full
      ? `Все ${input.totalSteps} шагов заполнены. Точка А пересчитана — откройте дашборд, чтобы увидеть снимок и GRI.`
      : `Заполнено ${input.completedSteps} из ${input.totalSteps} шагов. Незаполненные шаги можно дополнить в любой момент — точность диагностики вырастет.`,
    link: '/client/point-a',
  }
}

/**
 * Ставит маркер в app_notifications и возвращает true, если это первый раз
 * (то есть админам ещё не сообщали). Идемпотентно: повторные сохранения
 * финального шага вернут false. Любая ошибка БД → true (лучше лишнее
 * уведомление, чем потерянное).
 */
export async function claimCompletionNotice(
  service: SupabaseClient,
  userId: string,
  input: SurveyNoticeInput,
): Promise<boolean> {
  try {
    const { data: existing, error: selErr } = await service
      .from('app_notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('category', SURVEY_NOTICE_CATEGORY)
      .contains('metadata', { event: SURVEY_COMPLETED_EVENT })
      .limit(1)

    if (selErr) {
      console.error('[survey/completion-notice] marker lookup failed', selErr.message)
      return true
    }
    if (existing && existing.length > 0) return false

    const notice = buildClientNotice(input)
    const { error: insErr } = await service.from('app_notifications').insert({
      user_id: userId,
      category: SURVEY_NOTICE_CATEGORY,
      priority: 'high',
      title: notice.title,
      body: notice.body,
      link: notice.link,
      metadata: {
        event: SURVEY_COMPLETED_EVENT,
        completed_steps: input.completedSteps,
        total_steps: input.totalSteps,
        sheet_url: input.sheetUrl,
      },
    })
    if (insErr) {
      console.error('[survey/completion-notice] marker insert failed', insErr.message)
      return true
    }
    return true
  } catch (e) {
    console.error('[survey/completion-notice] unexpected', e)
    return true
  }
}
