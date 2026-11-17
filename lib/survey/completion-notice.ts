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
import { pointAClosedFor } from '@/lib/access/recipient'
import { freeSnapshotAvailable } from '@/lib/survey/modes-server'

export const SURVEY_COMPLETED_EVENT = 'survey_completed'
export const SURVEY_NOTICE_CATEGORY = 'survey'

export interface SurveyNoticeInput {
  completedSteps: number
  totalSteps: number
  company: string
}

/**
 * Решение о рассылке: клиент ЯВНО отправил анкету (кнопка «Получить
 * диагностику» → `final: true`) ИЛИ анкета только что стала полной.
 *
 * Раньше триггером был «сохранён шаг ≥ 12»: переключение вкладки с шага 12
 * тоже шлёт сохранение с step=12, и админам уходило «анкета пройдена (1/12)»,
 * а одноразовый маркер потом глушил настоящее уведомление.
 */
export function shouldAnnounceCompletion(opts: {
  finalSubmitted: boolean
  isCompleteNow: boolean
  wasCompleteBefore: boolean
}): boolean {
  const justCompleted = opts.isCompleteNow && !opts.wasCompleteBefore
  return opts.finalSubmitted || justCompleted
}

/**
 * Текст записи в клиентской ленте уведомлений. `snapshot` — открыт ли бесплатный
 * «Снимок бизнеса» (экран способа «Экспресс + блоки», настройка ГИГА survey_modes,
 * R4-B4); по умолчанию да.
 */
export function buildClientNotice(input: SurveyNoticeInput, opts: { pointALocked?: boolean; snapshot?: boolean } = {}): { title: string; body: string; link: string } {
  const full = input.completedSteps >= input.totalSteps
  // R4-B4: no paid Точка А and no snapshot (express switched off) — no promise of an
  // «экспресс-оценка»: the cabinet when the questionnaire is full, the questionnaire otherwise.
  if (opts.pointALocked && opts.snapshot === false) {
    return {
      title: full ? 'Анкета заполнена полностью' : 'Анкета отправлена',
      body: full
        ? `Все ${input.totalSteps} шагов заполнены. Полный разбор «Точки А» и GRI — в платном доступе.`
        : `Заполнено ${input.completedSteps} из ${input.totalSteps} шагов. Незаполненные шаги можно дополнить в любой момент — точность оценки вырастет.`,
      link: full ? '/client/home' : '/client/onboarding',
    }
  }
  // R2-A (ревью L-6): without the paid Точка А — the free «Снимок бизнеса», not a paywall.
  if (opts.pointALocked) {
    return {
      title: full ? 'Анкета заполнена полностью' : 'Анкета отправлена',
      body: full
        ? `Все ${input.totalSteps} шагов заполнены. Экспресс-оценка готова; полный разбор «Точки А» и GRI — в платном доступе.`
        : `Заполнено ${input.completedSteps} из ${input.totalSteps} шагов. Незаполненные шаги можно дополнить в любой момент — точность оценки вырастет.`,
      link: '/client/onboarding/snapshot',
    }
  }
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
  // R2-A: decided before the marker lookup, so nothing awaits between the lookup and the insert.
  const pointALocked = await pointAClosedFor(userId)
  const snapshot = pointALocked ? await freeSnapshotAvailable() : true
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

    const notice = buildClientNotice(input, { pointALocked, snapshot })
    const { error: insErr } = await service.from('app_notifications').insert({
      user_id: userId,
      category: SURVEY_NOTICE_CATEGORY,
      priority: 'high',
      title: notice.title,
      body: notice.body,
      link: notice.link,
      // NB: the client can read its own app_notifications rows through RLS
      // (app_notifications_select_own), so nothing staff-only goes here —
      // in particular NOT the link to the admin spreadsheet.
      metadata: {
        event: SURVEY_COMPLETED_EVENT,
        completed_steps: input.completedSteps,
        total_steps: input.totalSteps,
      },
    })
    if (insErr) {
      // 23505 = the partial unique index (migration 071) caught a parallel
      // save that already claimed the notice → not the first one.
      if ((insErr as { code?: string }).code === '23505') return false
      console.error('[survey/completion-notice] marker insert failed', insErr.message)
      return true
    }
    return true
  } catch (e) {
    console.error('[survey/completion-notice] unexpected', e)
    return true
  }
}
