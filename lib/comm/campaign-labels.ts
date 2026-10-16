/**
 * lib/comm/campaign-labels.ts — statuses of broadcasts and their recipients
 * with Russian labels (pure: used by the GIGA page, the server and the tests).
 */

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'done' | 'cancelled'
export type RecipientStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled'

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Черновик',
  scheduled: 'Подготовка',
  running: 'Идёт',
  paused: 'На паузе',
  done: 'Завершена',
  cancelled: 'Отменена',
}

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: 'в очереди',
  sending: 'отправляется',
  sent: 'отправлено',
  failed: 'ошибка',
  skipped: 'не отправлено',
  cancelled: 'отменено',
}
