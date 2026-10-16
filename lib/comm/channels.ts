/**
 * lib/comm/channels.ts — which channels a message goes to (pure, no IO).
 *
 * Explicit choice (checkboxes in GIGA): every ticked channel gets a row; one
 * that cannot be used right now (no email, Telegram not linked, no phone,
 * WhatsApp opt-out, bridge off…) is recorded as `skipped` with the reason, so
 * the expert sees in the feed why it did not arrive.
 *
 * «Авто»: the user's notification preferences of the «Эксперт» category
 * (lib/notifications/preferences.ts: in_app → app, email, telegram) plus the
 * channel the user last wrote from (that is where he expects the answer —
 * also the only way WhatsApp gets into «Авто», it has no preference switch),
 * intersected with what is available. Unavailable candidates are dropped
 * silently. Nothing left → the platform feed («app»): the message is never lost.
 */
import { categoryPrefs } from '@/lib/notifications/preferences'
import { COMM_CHANNELS, type CommChannel } from './types'

export type ChannelSkipReason =
  | 'no_email'
  | 'telegram_not_linked'
  | 'telegram_not_configured'
  | 'no_phone'
  | 'whatsapp_opt_out'
  | 'whatsapp_not_configured'

export const SKIP_REASON_LABELS: Record<ChannelSkipReason, string> = {
  no_email: 'нет email',
  telegram_not_linked: 'Telegram не привязан',
  telegram_not_configured: 'бот Telegram не настроен',
  no_phone: 'нет телефона',
  whatsapp_opt_out: 'пользователь отписался от WhatsApp',
  whatsapp_not_configured: 'WhatsApp (QR-номер) не подключён',
}

export interface AvailabilityInput {
  hasEmail: boolean
  hasTelegramChat: boolean
  telegramBotConfigured: boolean
  hasPhone: boolean
  whatsappOptOut: boolean
  whatsappTransport: boolean
}

export type ChannelAvailability = Record<CommChannel, { ok: true } | { ok: false; reason: ChannelSkipReason }>

export function channelAvailability(i: AvailabilityInput): ChannelAvailability {
  return {
    app: { ok: true },
    email: i.hasEmail ? { ok: true } : { ok: false, reason: 'no_email' },
    telegram: !i.hasTelegramChat
      ? { ok: false, reason: 'telegram_not_linked' }
      : !i.telegramBotConfigured ? { ok: false, reason: 'telegram_not_configured' } : { ok: true },
    whatsapp: !i.hasPhone
      ? { ok: false, reason: 'no_phone' }
      : i.whatsappOptOut
        ? { ok: false, reason: 'whatsapp_opt_out' }
        : !i.whatsappTransport ? { ok: false, reason: 'whatsapp_not_configured' } : { ok: true },
  }
}

export type ChannelRequest = CommChannel[] | 'auto'

export interface ResolvedCommChannels {
  send: CommChannel[]
  skipped: Array<{ channel: CommChannel; reason: ChannelSkipReason }>
}

/** Channels «Авто» would pick from the preferences alone (before availability). */
export function autoCandidates(prefs: unknown, lastInboundChannel: CommChannel | null): CommChannel[] {
  const p = categoryPrefs(prefs, 'expert')
  const out = new Set<CommChannel>()
  if (p.in_app) out.add('app')
  if (p.email) out.add('email')
  if (p.telegram) out.add('telegram')
  if (lastInboundChannel) out.add(lastInboundChannel)
  return COMM_CHANNELS.filter((c) => out.has(c))
}

export function resolveCommChannels(
  request: ChannelRequest,
  ctx: { availability: ChannelAvailability; prefs: unknown; lastInboundChannel: CommChannel | null },
): ResolvedCommChannels {
  if (request === 'auto') {
    const send = autoCandidates(ctx.prefs, ctx.lastInboundChannel).filter((c) => ctx.availability[c].ok)
    return { send: send.length ? send : ['app'], skipped: [] }
  }
  const wanted = COMM_CHANNELS.filter((c) => request.includes(c))
  const send: CommChannel[] = []
  const skipped: ResolvedCommChannels['skipped'] = []
  for (const c of wanted) {
    const a = ctx.availability[c]
    if (a.ok) send.push(c)
    else skipped.push({ channel: c, reason: a.reason })
  }
  return { send, skipped }
}
