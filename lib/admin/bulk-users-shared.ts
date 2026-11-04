import type { Permission } from '@/lib/admin/rbac'

/**
 * Массовые действия над пользователями — общее для сервера и интерфейса
 * (без серверных зависимостей). Логика — в lib/admin/bulk-users.ts.
 */

export const BULK_ACTIONS = ['approve', 'reject', 'set_tier', 'assign', 'block', 'unblock', 'archive', 'remind_survey', 'purge'] as const
export type BulkAction = (typeof BULK_ACTIONS)[number]
export const BULK_MAX = 200
/** Полное удаление — необратимо и тяжело (транзакция + файлы), поэтому пачка меньше. */
export const BULK_PURGE_MAX = 50
/** Слово, которое нужно ввести для массового удаления. */
export const BULK_PURGE_CONFIRM = 'УДАЛИТЬ'

/** Право, которое нужно на действие (то же, что у одиночного маршрута). */
export const BULK_PERMISSIONS: Record<BulkAction, Permission[]> = {
  approve: ['users.approve'],
  reject: ['users.approve'],
  set_tier: ['users.manage'],
  assign: ['users.view', 'users.sensitive'],
  block: ['users.manage'],
  unblock: ['users.manage'],
  archive: ['users.archive'],
  remind_survey: ['users.invite', 'users.sensitive'],
  purge: ['users.delete'],
}

export const BULK_ACTION_LABELS: Record<BulkAction, string> = {
  approve: 'Одобрить заявку',
  reject: 'Отклонить заявку',
  set_tier: 'Сменить тариф',
  assign: 'Назначить ответственного',
  block: 'Заблокировать',
  unblock: 'Разблокировать',
  archive: 'Архивировать',
  remind_survey: 'Напомнить про анкету',
  purge: 'Удалить навсегда',
}
