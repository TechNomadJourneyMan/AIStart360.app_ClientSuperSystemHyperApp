import type { Tone } from '@/components/giga-panel/kit'

export const PROFILE_STATUS: Record<string, { label: string; tone: Tone }> = {
  approved: { label: 'Одобрен', tone: 'green' },
  pending_approval: { label: 'Ожидает', tone: 'amber' },
  requires_clarification: { label: 'Уточнение', tone: 'amber' },
  rejected: { label: 'Отклонён', tone: 'red' },
  blocked: { label: 'Заблокирован', tone: 'red' },
  archived: { label: 'В архиве', tone: 'neutral' },
}

export const PROFILE_ROLE: Record<string, string> = {
  client: 'Клиент', expert: 'Эксперт', admin: 'Админ', super_admin: 'Super Admin', manager: 'Менеджер', analyst: 'Аналитик',
}

export const EVENT_SOURCE: Record<string, { label: string; tone: Tone }> = {
  web: { label: 'пользователь', tone: 'neutral' },
  server: { label: 'сервер', tone: 'blue' },
  admin: { label: 'админ', tone: 'violet' },
  impersonation: { label: 'админ в кабинете', tone: 'amber' },
  backfill: { label: 'история', tone: 'neutral' },
}

export const AUDIT_ACTION: Record<string, string> = {
  'admin.login': 'Вход в панель',
  'admin.login_failed': 'Неудачный вход в панель',
  'admin.logout': 'Выход из панели',
  'request.approved': 'Заявка одобрена',
  'request.rejected': 'Заявка отклонена',
  'request.status_changed': 'Статус заявки изменён',
  'user.blocked': 'Пользователь заблокирован',
  'user.unblocked': 'Пользователь разблокирован',
  'user.archived': 'Пользователь в архиве',
  'user.restored': 'Пользователь восстановлен',
  'user.survey_edited': 'Анкета изменена',
  'user.access_changed': 'Доступ / тариф изменён',
  'user.widgets_changed': 'Виджеты изменены',
  'user.2fa_reset': 'Сброс 2FA',
  'user.impersonated': 'Вход от имени (старый способ)',
  'impersonation.started': 'Открыт кабинет от имени',
  'impersonation.ended': 'Выход из кабинета пользователя',
  'impersonation.terminated': 'Сессия от имени завершена',
  'impersonation.request': 'Действие в кабинете пользователя',
  'impersonation.survey_edited': 'Анкета изменена из кабинета',
  'gri.assessment_edited': 'GRI: ответы изменены',
  'gri.assessment_deleted': 'GRI: результат удалён',
  'gri.assessment_made_current': 'GRI: результат сделан текущим',
  'gri.draft_deleted': 'GRI: черновик сброшен',
  'staff.role_granted': 'Роль выдана',
  'staff.role_revoked': 'Роль снята',
  'content.page_created': 'Страница создана',
  'content.page_updated': 'Страница изменена',
  'content.page_published': 'Страница опубликована',
  'content.page_unpublished': 'Страница снята с публикации',
  'content.page_archived': 'Страница в архиве',
  'content.page_deleted': 'Страница удалена',
  'content.media_uploaded': 'Файл загружен',
  'content.media_deleted': 'Файл удалён',
  'platform.section_updated': 'Раздел платформы изменён',
  'settings.registration_mode_changed': 'Режим регистрации изменён',
  'settings.access_changed': 'Настройки доступа изменены',
  'user.invited': 'Приглашение отправлено',
  'settings.changed': 'Настройки платформы изменены',
  'system.events_purged': 'Старые события удалены',
  'insight.published': 'Инсайт опубликован',
  'insight.rejected': 'Инсайт отклонён',
  'insight.edited': 'Инсайт отредактирован',
}

export function auditLabel(action: string): string {
  return AUDIT_ACTION[action] ?? action
}
