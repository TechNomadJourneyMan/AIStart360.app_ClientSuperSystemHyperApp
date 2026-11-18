/**
 * lib/crm/sync-status.ts — the one vocabulary of crm_provider_connections.last_sync_status (M7).
 *
 * Written by the sync (lib/crm/sync.ts), read by the Pulse «Интеграции» tab and Settings ›
 * Интеграции › CRM. Before migration 155 the sync route wrote 'ok' while the tab knew only
 * success / partial / error and showed «—» after a successful sync; 'ok' is read as success.
 * No imports: client components use it.
 */

export type CrmSyncStatus = 'success' | 'partial' | 'error'

export const CRM_SYNC_STATUS_LABEL: Record<CrmSyncStatus, string> = {
  success: 'Успешно',
  partial: 'Частично',
  error: 'Ошибка',
}

/** The stored value in the one vocabulary; null when there was no sync yet (or the value is unknown). */
export function normaliseSyncStatus(value: unknown): CrmSyncStatus | null {
  if (value === 'success' || value === 'ok') return 'success'
  if (value === 'partial') return 'partial'
  if (value === 'error') return 'error'
  return null
}

/** How the automatic sync runs (lib/crm/sync-cron.ts, lib/cron/schedule.ts), in words for the UI. */
export const CRM_AUTO_SYNC_DESCRIPTION =
  'Автосинхронизация: каждое подключение обновляется примерно раз в 6 часов (проверка — дважды в час, кроме ночного ' +
  'перерыва 02:00–04:00 по времени Астаны), новое — в течение получаса. Кнопка «Синхронизировать» обновляет сразу.'
