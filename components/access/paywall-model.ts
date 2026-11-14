/**
 * components/access/paywall-model.ts — framework-free part of the ONE paywall
 * (components/access/Paywall.tsx), so it is testable without a DOM.
 *
 * Copy is honest on purpose (decision of the founder, 2026-11): what the paid
 * section contains, what stays free, and that online payment is not connected
 * yet — access is opened by a manager after the request (payment is an
 * intentional stub, lib/payments). The only action is «Оставить заявку на
 * доступ» → POST /api/v1/upgrade-request (the user comes from the session; one
 * open request per user, a repeat does not create a duplicate).
 */

export type PaywallFeature = 'point_a' | 'point_b' | 'market' | 'gri_full' | 'pdf_export' | 'ai_chat' | 'benchmarks'

export interface PaywallCopy {
  /** Section name for the request and the heading. */
  name: string
  title: string
  lead: string
  includes: ReadonlyArray<{ icon: string; text: string }>
  /** What stays free instead (links inside the cabinet). */
  free?: ReadonlyArray<{ href: string; label: string }>
}

export const PAYWALL_COPY: Record<PaywallFeature, PaywallCopy> = {
  point_a: {
    name: 'Точка А',
    title: 'Точка А — в платном доступе',
    lead: 'Полная картина бизнеса сейчас: где он находится и что мешает расти.',
    includes: [
      { icon: 'grid_view', text: 'Оценка по блокам с разбором каждого показателя' },
      { icon: 'priority_high', text: 'Что требует внимания: риски, потери, расхождения в данных' },
      { icon: 'history', text: 'Цели, история изменений и сравнение с отраслью' },
      { icon: 'fact_check', text: 'Проверка и комментарии эксперта' },
    ],
    free: [{ href: '/client/onboarding', label: 'Анкета и экспресс-оценка' }],
  },
  point_b: {
    name: 'Точка Б',
    title: 'Точка Б — в платном доступе',
    lead: 'Куда расти и как туда прийти — вместе с полным GRI и Точкой А.',
    includes: [
      { icon: 'flag', text: 'Цели и план: что сделать, чтобы прийти к целевой выручке' },
      { icon: 'fact_check', text: 'Проверка целей и плана экспертом перед тем, как вы их увидите' },
      { icon: 'route', text: 'Сценарии «Что если», финмодель, дорожная карта и отслеживание прогресса' },
    ],
    free: [{ href: '/client/onboarding', label: 'Цели в анкете' }],
  },
  market: {
    name: 'Рынок',
    title: 'Рынок — в платном доступе',
    lead: 'Данные о рынке и конкурентах для решений о росте.',
    includes: [
      { icon: 'public', text: 'Карта рынка и каталог компаний' },
      { icon: 'donut_large', text: 'Анализ ниши: объём рынка и конкуренты' },
      { icon: 'checklist', text: 'Чек-лист «50 вопросов» по анализу рынка' },
      { icon: 'newspaper', text: 'Новости и тендеры по отрасли' },
    ],
  },
  gri_full: {
    name: 'Полный GRI',
    title: 'Полный GRI — в платном доступе',
    lead: 'Полная диагностика готовности бизнеса к росту.',
    includes: [
      { icon: 'checklist', text: 'Полная GRI-диагностика по всем блокам' },
      { icon: 'insights', text: 'Результат: главные ограничения и план на 90 дней' },
      { icon: 'monitoring', text: 'Динамика индекса и повторные пересчёты' },
      { icon: 'auto_awesome', text: 'AI-аналитик и калькулятор сценариев' },
    ],
    free: [
      { href: '/client/onboarding', label: 'Экспресс-оценка в анкете' },
      { href: '/gri-free', label: 'Мини-GRI' },
    ],
  },
  pdf_export: {
    name: 'PDF-экспорт',
    title: 'PDF-экспорт — в платном доступе',
    lead: 'Брендированный PDF-отчёт по диагностике для банка, партнёров или команды.',
    includes: [],
  },
  ai_chat: {
    name: 'AI-чат по отчёту',
    title: 'AI-чат по вашему отчёту — в платном доступе',
    lead: 'Свободные вопросы по вашим данным: разбор результатов, приоритеты, план.',
    includes: [],
  },
  benchmarks: {
    name: 'Бенчмарки отрасли',
    title: 'Бенчмарки отрасли — в платном доступе',
    lead: 'Сравнение каждого блока с лучшими компаниями вашей отрасли.',
    includes: [],
  },
}

/** Shown under every paywall: payment is an intentional stub, nothing pretends otherwise. */
export const PAYMENT_NOTE = 'Онлайн-оплата пока не подключена: доступ открывает менеджер после связи с вами.'

export const REQUEST_LABEL = 'Оставить заявку на доступ'
export const SENT_TEXT = 'Заявка отправлена, с вами свяжутся.'
export const ERROR_TEXT = 'Не удалось отправить заявку. Попробуйте ещё раз.'

export function paywallCopy(feature: string): PaywallCopy {
  return (PAYWALL_COPY as Record<string, PaywallCopy>)[feature] ?? {
    name: 'Платная функция',
    title: 'Функция в платном доступе',
    lead: 'Оставьте заявку — менеджер свяжется с вами и откроет доступ.',
    includes: [],
  }
}

/** A response of a paid API that means «show the paywall» (402 upgrade_required). */
export function isUpgradeRequired(status: number, body: { error?: unknown } | null | undefined): boolean {
  return status === 402 || body?.error === 'upgrade_required'
}

export type RequestState = 'idle' | 'checking' | 'sending' | 'sent' | 'error'

/** POST /api/v1/upgrade-request. 'sent' also when the request already existed (no duplicate is created). */
export async function sendAccessRequest(fetchFn: typeof fetch, feature: string): Promise<'sent' | 'error'> {
  try {
    const res = await fetchFn('/api/v1/upgrade-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ featureKey: feature }),
    })
    return res.ok ? 'sent' : 'error'
  } catch {
    return 'error'
  }
}

/** GET /api/v1/upgrade-request — is there an open request of this user already? null when unknown. */
export async function readAccessRequest(fetchFn: typeof fetch): Promise<boolean | null> {
  try {
    const res = await fetchFn('/api/v1/upgrade-request', { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as { requested?: unknown } | null
    return typeof body?.requested === 'boolean' ? body.requested : null
  } catch {
    return null
  }
}
