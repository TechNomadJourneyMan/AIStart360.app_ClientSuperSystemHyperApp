import type { Permission } from '@/lib/admin/rbac'

/**
 * Массовые действия над пользователями — общее для сервера и интерфейса
 * (без серверных зависимостей). Логика — в lib/admin/bulk-users.ts.
 */

export const BULK_ACTIONS = ['approve', 'reject', 'set_tier', 'assign', 'block', 'archive', 'remind_survey'] as const
export type BulkAction = (typeof BULK_ACTIONS)[number]
export const BULK_MAX = 200

/** Право, которое нужно на действие (то же, что у одиночного маршрута). */
export const BULK_PERMISSIONS: Record<BulkAction, Permission[]> = {
  approve: ['users.approve'],
  reject: ['users.approve'],
  set_tier: ['users.manage'],
  assign: ['users.view', 'users.sensitive'],
  block: ['users.manage'],
  archive: ['users.archive'],
  remind_survey: ['users.invite', 'users.sensitive'],
}

export const BULK_ACTION_LABELS: Record<BulkAction, string> = {
  approve: 'Одобрить заявку',
  reject: 'Отклонить заявку',
  set_tier: 'Сменить тариф',
  assign: 'Назначить ответственного',
  block: 'Заблокировать',
  archive: 'Архивировать',
  remind_survey: 'Напомнить про анкету',
}

/**
 * R2-C (verify Н-4): what the bulk «Сменить тариф» really does — the plan goes
 * through the billing writer (lib/payments/billing.ts setPlan): Free cancels the
 * clients' paid subscriptions, Kaspi ones included; Pro is open-ended, closes
 * their access requests and notifies each «Доступ открыт».
 */
export function bulkTierNote(tier: 'free' | 'pro'): string {
  return tier === 'free'
    ? 'Платные подписки выбранных клиентов будут отменены, в том числе оплаченные через Kaspi; платные разделы закроются. Пробные периоды тоже завершатся.'
    : 'Pro назначается бессрочно. Открытые заявки клиентов на платный доступ закроются как одобренные, каждый получит уведомление «Доступ открыт»; ИИ-разбор для них запустится в фоне.'
}
