/**
 * Platform domain events (docs/platform/05-agents.md, "Event-driven").
 * Names are stored in platform_events.name and drive agent subscriptions.
 */
export const PLATFORM_EVENTS = [
  'CLIENT_CREATED',
  'ONBOARDING_COMPLETED',
  'QUESTIONNAIRE_COMPLETED',
  'FILE_UPLOADED',
  'FILE_PROCESSED',
  'DIAGNOSTIC_STARTED',
  'DIAGNOSTIC_COMPLETED',
  'METRIC_UPDATED',
  'REPORT_GENERATED',
  'AGENT_FAILED',
  'INTEGRATION_FAILED',
  'CRITICAL_RISK_FOUND',
  'APPROVAL_REQUESTED',
  // Point A data layer (spec 2026-10-12): any change of the client's data
  // re-calculates Point A.
  'SURVEY_ANSWER_CHANGED',
  'DOCUMENT_DELETED',
  'DISCREPANCY_FOUND',
  'DISCREPANCY_RESOLVED',
  'TARGET_CHANGED',
  'BLOCK_CONFIG_CHANGED',
  'POINT_A_UPDATED',
] as const

export type PlatformEventName = (typeof PLATFORM_EVENTS)[number]

export function isPlatformEventName(value: unknown): value is PlatformEventName {
  return typeof value === 'string' && (PLATFORM_EVENTS as readonly string[]).includes(value)
}

export const PLATFORM_EVENT_LABELS: Record<PlatformEventName, string> = {
  CLIENT_CREATED: 'Создан клиент',
  ONBOARDING_COMPLETED: 'Онбординг завершён',
  QUESTIONNAIRE_COMPLETED: 'Анкета заполнена',
  FILE_UPLOADED: 'Загружен файл',
  FILE_PROCESSED: 'Файл обработан',
  DIAGNOSTIC_STARTED: 'Диагностика запущена',
  DIAGNOSTIC_COMPLETED: 'Диагностика завершена',
  METRIC_UPDATED: 'Метрики обновлены',
  REPORT_GENERATED: 'Отчёт сформирован',
  AGENT_FAILED: 'Сбой агента',
  INTEGRATION_FAILED: 'Сбой интеграции',
  CRITICAL_RISK_FOUND: 'Найден критический риск',
  APPROVAL_REQUESTED: 'Требуется одобрение',
  SURVEY_ANSWER_CHANGED: 'Анкета изменена',
  DOCUMENT_DELETED: 'Документ удалён',
  DISCREPANCY_FOUND: 'Найдено расхождение в данных',
  DISCREPANCY_RESOLVED: 'Расхождение в данных закрыто',
  TARGET_CHANGED: 'Цель изменена',
  BLOCK_CONFIG_CHANGED: 'Конфигурация блоков изменена',
  POINT_A_UPDATED: 'Точка А обновлена',
}
