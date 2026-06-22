/**
 * lib/assistant/escalation/telegram-adapter.ts — DEDICATED experts Telegram channel.
 *
 * Posts a Russian alert to a dedicated experts Telegram chat whenever an
 * {@link ExpertCase} is opened (e.g. the client clicks «Позвать эксперта»). This
 * is SEPARATE from the InternalAdapter's notifyAdmins call: admins and the
 * experts team can be different chats.
 *
 * Auto-activates once creds exist — the owner only sets env, no extra flag:
 *   - TELEGRAM_BOT_TOKEN (already used by lib/notifications.ts)
 *   - one of TELEGRAM_EXPERTS_CHAT_IDS / TELEGRAM_ADMIN_CHAT_IDS / TELEGRAM_CHAT_ID
 * The optional ASSISTANT_ESCALATION_TELEGRAM flag can force it on/off.
 *
 * Mirrors the Telegram sender in lib/notifications.ts (POST sendMessage to
 * api.telegram.org with TELEGRAM_BOT_TOKEN, 5s timeout). Fire-and-forget: every
 * failure is caught + logged, notify() always resolves (never throws).
 */

import type { ExpertCase } from '../types'
import type { EscalationAdapter } from './adapter'
import { buildExpertPlainText, parseList, resolveEnabled } from './format'

/** Recipient chat ids: dedicated experts list → admin list → legacy single id. */
function recipientChatIds(): string[] {
  return parseList(
    process.env.TELEGRAM_EXPERTS_CHAT_IDS,
    process.env.TELEGRAM_ADMIN_CHAT_IDS,
    process.env.TELEGRAM_CHAT_ID,
  ).filter((s) => /^-?\d+$/.test(s))
}

export class TelegramEscalationAdapter implements EscalationAdapter {
  readonly name = 'telegram'

  /** On once a bot token AND ≥1 recipient exist, unless explicitly switched off. */
  isEnabled(): boolean {
    const credsReady = Boolean(process.env.TELEGRAM_BOT_TOKEN) && recipientChatIds().length > 0
    return resolveEnabled(process.env.ASSISTANT_ESCALATION_TELEGRAM, credsReady)
  }

  async notify(c: ExpertCase): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatIds = recipientChatIds()
    if (!token || chatIds.length === 0) return

    const text = buildExpertPlainText(c)

    await Promise.allSettled(
      chatIds.map(async (chatId) => {
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              disable_web_page_preview: true,
            }),
            signal: AbortSignal.timeout(5000),
          })
          if (!res.ok) {
            console.error(
              '[escalation/telegram] sendMessage',
              res.status,
              await res.text().catch(() => ''),
            )
          }
        } catch (err) {
          console.error('[escalation/telegram] send failed:', err)
        }
      }),
    )
  }
}
