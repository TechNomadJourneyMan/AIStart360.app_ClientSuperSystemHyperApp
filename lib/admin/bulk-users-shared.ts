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
