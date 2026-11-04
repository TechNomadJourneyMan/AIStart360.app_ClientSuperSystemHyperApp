/**
 * lib/devtools/tools.ts — справочник вкладки «Инструменты» Dev-tools (без
 * серверных зависимостей: импортирует и страница, и API).
 */

/** Шаблоны писем, которые можно отправить СЕБЕ на проверку. */
export const TEST_EMAIL_TEMPLATES = [
  { key: 'invitation', label: 'Приглашение на платформу' },
  { key: 'questionnaire', label: 'Анкета заполнена' },
  { key: 'survey_reminder', label: 'Напоминание про анкету' },
  { key: 'gri', label: 'GRI-оценка готова' },
  { key: 'access', label: 'Доступ к порталу открыт' },
  { key: 'expert_review', label: 'Эксперт подготовил разбор' },
  { key: 'client_notification', label: 'Уведомление клиенту (универсальное)' },
] as const

export type TestEmailTemplate = (typeof TEST_EMAIL_TEMPLATES)[number]['key']
export const TEST_EMAIL_TEMPLATE_KEYS = TEST_EMAIL_TEMPLATES.map((t) => t.key) as [TestEmailTemplate, ...TestEmailTemplate[]]

export function isTestEmailTemplate(v: unknown): v is TestEmailTemplate {
  return TEST_EMAIL_TEMPLATES.some((t) => t.key === v)
}
