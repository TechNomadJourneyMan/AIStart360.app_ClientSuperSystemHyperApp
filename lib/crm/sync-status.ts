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

/**
 * How the sync runs, in words for the UI. True at every hour: the first sync is started by the
 * screen right after connecting; the automatic one (lib/crm/sync-cron.ts, lib/cron/schedule.ts)
 * runs at :17 and :47 outside 21:00–22:59 UTC (02:00–03:59 Astana), every connection about every
 * 6 h, a CRM larger than one run (2000 contacts / deals) continued at the next run.
 */
export const CRM_AUTO_SYNC_DESCRIPTION =
  'Первая синхронизация запускается сразу после подключения. Дальше — автоматически, примерно раз в 6 часов; ' +
  'CRM, где больше 2000 контактов или сделок, догружается частями — следующая часть через полчаса. ' +
  'Ночью, 02:00–04:00 по времени Астаны, автоматических запусков нет. Кнопка «Синхронизировать» обновляет сразу.'

/** What avg_check of a CRM client means (lib/crm/provider-sync.ts, crm_sync_apply_deal_totals). */
export const CRM_AVG_CHECK_DESCRIPTION =
  'Средний чек клиента из CRM — среднее по суммам его открытых и выигранных сделок в тенге (проигранные и сделки ' +
  'в другой валюте не считаются); он обновляется, когда прочитаны все сделки. Средний чек, который вы ввели сами, ' +
  'синхронизация не меняет.'
