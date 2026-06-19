/**
 * lib/assistant/escalation/telegram-adapter.ts — OPTIONAL escalation channel.
 *
 * Real class implementing {@link EscalationAdapter}, but a deliberate NO-OP stub
 * today. Gated by ASSISTANT_ESCALATION_TELEGRAM ('1' | 'true' | 'on'); disabled
 * by default so the dispatcher skips it. The InternalAdapter already alerts
 * admins over Telegram via notifyAdmins, so this is purely a future hook for a
 * DEDICATED experts channel.
 *
 * TO IMPLEMENT LATER: send to an experts Telegram chat by reusing the existing
 * sender. lib/notifications.ts already builds + posts Telegram messages
 * (buildTelegramMessage + sendMessage to api.telegram.org using
 * TELEGRAM_BOT_TOKEN). The cleanest path is to add an experts chat id (e.g.
 * TELEGRAM_EXPERTS_CHAT_ID) and call a small exported sender, or extend
 * notifyAdmins to target an experts channel. Until then notify() must remain a
 * resolved no-op so enabling the flag prematurely cannot break dispatch.
 */

import type { ExpertCase } from '../types'
import type { EscalationAdapter } from './adapter'

const TRUTHY = new Set(['1', 'true', 'on', 'yes'])

export class TelegramEscalationAdapter implements EscalationAdapter {
  readonly name = 'telegram'

  isEnabled(): boolean {
    return TRUTHY.has((process.env.ASSISTANT_ESCALATION_TELEGRAM ?? '').toLowerCase().trim())
  }

  async notify(_c: ExpertCase): Promise<void> {
    // No-op stub. When implemented, reuse the Telegram sender from
    // lib/notifications.ts to post to a dedicated experts channel. Must never
    // throw (fire-and-forget contract).
    return
  }
}
