/**
 * lib/comm/labels.ts — Russian labels of delivery statuses and reasons
 * (pure; used by the GIGA feed and the tests).
 */
import { SKIP_REASON_LABELS, type ChannelSkipReason } from './channels'
import type { CommMessageStatus } from './types'

export const MESSAGE_STATUS_LABELS: Record<CommMessageStatus, string> = {
  queued: 'в очереди',
  sending: 'отправляется',
  sent: 'отправлено',
  delivered: 'доставлено',
  failed: 'ошибка',
  skipped: 'не отправлено',
}

const EXTRA_REASONS: Record<string, string> = {
  whatsapp_pull_needs_recent_reply: 'WhatsApp в режиме очереди: ответить можно только на сообщение пользователя за последние 24 ч',
  whatsapp_pull_no_bot: 'WhatsApp в режиме очереди не принимает ответы бота',
  invalid_delivery_mode: 'неверный режим доставки WhatsApp',
  notification_insert_failed: 'не удалось создать уведомление',
  configuration_error: 'WhatsApp (QR-номер) не подключён',
  timeout: 'сервис не ответил вовремя',
  network_error: 'нет связи с сервисом',
}

export function deliveryReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return SKIP_REASON_LABELS[code as ChannelSkipReason] ?? EXTRA_REASONS[code] ?? code
}
