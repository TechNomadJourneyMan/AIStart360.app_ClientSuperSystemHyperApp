/**
 * lib/dashboard/next-best-action.ts — «1 действие сейчас» (Фаза 5, идея №2).
 *
 * Чистый селектор: из состояния анкеты, диагностики, красных зон и CRM выбирает
 * ОДНО следующее лучшее действие с рабочей кнопкой. Сигналы собирает роут
 * (переиспользуя buildAssistantContext + completion + CRM-сигналы Фазы 4B).
 * Приоритет — от фундамента к оптимизации: доделать анкету → получить
 * диагностику → обзвон клиентов (время-зависимо) → красная зона → топ-ограничение.
 */

export type NbaKind =
  | 'finish_survey'
  | 'run_diagnostic'
  | 'call_clients'
  | 'fix_red_zone'
  | 'work_top_limit'
  | 'all_good'

export interface NbaInput {
  /** 0..100 заполненность анкеты. */
  completionPct: number
  /** Первый незавершённый раздел анкеты (для CTA), либо null. */
  nextSectionLabel: string | null
  hasDiagnostic: boolean
  /** Клиентов в зоне риска (просроченные напоминания ∪ churn=high). */
  overdueClients: number
  /** RU-лейбл критического блока Point A, либо null. */
  criticalBlockLabel: string | null
  /** Топ-ограничение GRI, либо null. */
  griTopLimit: string | null
}

export interface NextBestAction {
  kind: NbaKind
  title: string
  detail: string
  ctaLabel: string
  href: string
}

export function pickNextBestAction(i: NbaInput): NextBestAction {
  // 1. Фундамент: анкета не заполнена — без неё всё остальное неточно.
  if (i.completionPct < 100 && i.nextSectionLabel) {
    return {
      kind: 'finish_survey',
      title: 'Доделайте анкету',
      detail: `Раздел «${i.nextSectionLabel}» ещё ждёт ответов — без него диагностика неточна.`,
      ctaLabel: 'Продолжить анкету',
      href: '/client/onboarding',
    }
  }

  // 2. Анкета есть, диагностики нет — получить GRI/Точку А.
  if (!i.hasDiagnostic) {
    return {
      kind: 'run_diagnostic',
      title: 'Пройдите GRI-диагностику',
      detail: 'Данные собраны — получите индекс готовности и карту роста.',
      ctaLabel: 'Пройти диагностику',
      href: '/gri?tab=assess',
    }
  }

  // 3. Время-зависимое: клиенты в зоне риска — деньги уходят сегодня.
  if (i.overdueClients > 0) {
    const n = i.overdueClients
    return {
      kind: 'call_clients',
      title: `Свяжитесь с клиентами (${n})`,
      detail: 'Есть клиенты в зоне риска — обзвон сегодня удержит выручку.',
      ctaLabel: 'Кому звонить',
      href: '/pulse',
    }
  }

  // 4. Красная зона диагностики — самый быстрый рост.
  if (i.criticalBlockLabel) {
    return {
      kind: 'fix_red_zone',
      title: `Закройте красную зону: ${i.criticalBlockLabel}`,
      detail: 'Это самый слабый блок — работа с ним быстрее всего поднимает индекс.',
      ctaLabel: 'Смотреть результат',
      href: '/gri?tab=result',
    }
  }

  // 5. Оптимизация: топ-ограничение GRI.
  if (i.griTopLimit) {
    return {
      kind: 'work_top_limit',
      title: `Займитесь ограничением: ${i.griTopLimit}`,
      detail: 'Главное ограничение роста по вашей диагностике — начните с него.',
      ctaLabel: 'Разобрать результат',
      href: '/gri?tab=result',
    }
  }

  // 6. Всё в порядке — держите привычку.
  return {
    kind: 'all_good',
    title: 'Отличная форма 🐾',
    detail: 'Ничего срочного. Снимите недельный пульс, чтобы динамика оставалась точной.',
    ctaLabel: 'Снять пульс',
    href: '/pulse',
  }
}
