/**
 * lib/survey/completion.ts — ЕДИНОЕ определение «анкета заполнена» (F-065).
 *
 * Раньше везде стояло `survey_steps >= 12`. Но последний шаг мастера
 * («Системы и инструменты») можно пройти, ничего не введя, — тогда прогресс
 * навсегда 11/12 и человек, реально отправивший анкету, в воронке, фильтрах и
 * сегментах числился «не заполнившим» (см. lib/survey/completion-notice.ts).
 *
 * Анкета заполнена, если выполнено ЛЮБОЕ из трёх условий (время — самое раннее):
 *   1. маркер в `app_notifications` (category = 'survey',
 *      metadata.event = 'survey_completed') — канонический факт: ставится ровно
 *      один раз (уникальный индекс 071), когда клиент отправил финальный шаг
 *      мастера («Получить диагностику», `final: true`) или когда анкета впервые
 *      стала полной. Его же видит клиент в ленте уведомлений;
 *   2. событие `QUESTIONNAIRE_COMPLETED` в `user_events` (та же финальная
 *      отправка; страхует случай, когда фоновая запись маркера не успела);
 *   3. заполнены все 12 шагов — старое правило, чтобы анкеты, заполненные до
 *      появления маркера и события, не «потерялись».
 *
 * SQL-эквивалент (миграция 090) — используйте его, а не `steps >= 12`:
 *
 *   -- все пользователи:
 *   SELECT user_id, completed_at FROM public.admin_survey_completions();
 *   -- один пользователь:
 *   SELECT public.survey_completed_at(:user_id) IS NOT NULL;
 *
 *   -- тело admin_survey_completions():
 *   SELECT user_id, min(at) FROM (
 *     SELECT user_id, created_at AS at FROM app_notifications
 *      WHERE category = 'survey' AND metadata->>'event' = 'survey_completed'
 *     UNION ALL
 *     SELECT user_id, created_at FROM user_events WHERE event_name = 'QUESTIONNAIRE_COMPLETED'
 *     UNION ALL
 *     SELECT user_id, last_at FROM admin_survey_steps() WHERE steps >= 12
 *   ) x GROUP BY user_id;
 *
 * `survey_steps` (сколько шагов заполнено) остаётся отдельной величиной для
 * прогресса и сегментов «не начата / в процессе».
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SURVEY_COMPLETED_EVENT, SURVEY_NOTICE_CATEGORY } from './completion-notice'
import { SURVEY_TOTAL_STEPS } from './steps'

export const SURVEY_COMPLETED_EVENT_NAME = 'QUESTIONNAIRE_COMPLETED' as const

export interface SurveyCompletionFacts {
  /** created_at маркера app_notifications(survey_completed), если есть. */
  noticeMarkerAt?: string | null
  /** Самое раннее QUESTIONNAIRE_COMPLETED, если есть. */
  completedEventAt?: string | null
  /** Сколько шагов мастера содержит хотя бы один непустой ответ. */
  filledSteps?: number | null
  /** Время последнего ответа (используется только для правила «все 12 шагов»). */
  lastAnswerAt?: string | null
}

/**
 * Когда анкета стала заполненной (самое раннее из известных времён); null —
 * не заполнена или время неизвестно. Для да/нет используйте isSurveyCompleted.
 */
export function surveyCompletedAt(f: SurveyCompletionFacts): string | null {
  const candidates: string[] = []
  if (f.noticeMarkerAt) candidates.push(f.noticeMarkerAt)
  if (f.completedEventAt) candidates.push(f.completedEventAt)
  if ((f.filledSteps ?? 0) >= SURVEY_TOTAL_STEPS && f.lastAnswerAt) candidates.push(f.lastAnswerAt)
  if (!candidates.length) return null
  return candidates.reduce((a, b) => (new Date(a).getTime() <= new Date(b).getTime() ? a : b))
}

/** Единый предикат «анкета заполнена». */
export function isSurveyCompleted(f: SurveyCompletionFacts): boolean {
  return !!f.noticeMarkerAt || !!f.completedEventAt || (f.filledSteps ?? 0) >= SURVEY_TOTAL_STEPS
}

/**
 * Прочитать маркер и событие для одного пользователя (service-клиент).
 * Ошибки чтения = «фактов нет»: предикат тогда опирается на число шагов.
 */
export async function loadSurveyCompletionMarkers(
  sb: SupabaseClient,
  userId: string,
): Promise<Pick<SurveyCompletionFacts, 'noticeMarkerAt' | 'completedEventAt'>> {
  const firstAt = async (run: () => PromiseLike<{ data: unknown }>): Promise<string | null> => {
    try {
      const r = await run()
      const rows = Array.isArray(r?.data) ? (r.data as Array<{ created_at?: string | null }>) : []
      return rows[0]?.created_at ?? null
    } catch {
      return null
    }
  }
  const [noticeMarkerAt, completedEventAt] = await Promise.all([
    firstAt(() => sb.from('app_notifications')
      .select('created_at')
      .eq('user_id', userId)
      .eq('category', SURVEY_NOTICE_CATEGORY)
      .contains('metadata', { event: SURVEY_COMPLETED_EVENT })
      .order('created_at', { ascending: true })
      .limit(1)),
    firstAt(() => sb.from('user_events')
      .select('created_at')
      .eq('user_id', userId)
      .eq('event_name', SURVEY_COMPLETED_EVENT_NAME)
      .order('created_at', { ascending: true })
      .limit(1)),
  ])
  return { noticeMarkerAt, completedEventAt }
}
