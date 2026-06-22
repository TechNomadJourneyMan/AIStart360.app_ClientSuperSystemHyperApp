/**
 * lib/assistant/escalation/whatsapp-adapter.ts — DEDICATED experts WhatsApp channel.
 *
 * Pushes a Russian alert to the experts team over the WhatsApp Cloud API (Meta
 * Graph) whenever an {@link ExpertCase} is opened. Lets the owner reach experts
 * on WhatsApp instead of (or alongside) Telegram.
 *
 * Auto-activates once all three creds exist — the owner only sets env, no extra
 * flag:
 *   - WHATSAPP_TOKEN            (Graph access token)
 *   - WHATSAPP_PHONE_NUMBER_ID  (the sending number's id)
 *   - WHATSAPP_EXPERTS_TO       (comma list of E.164 recipient numbers)
 * The optional ASSISTANT_ESCALATION_WHATSAPP flag can force it on/off.
 *
 * NOTE: WhatsApp Cloud API only delivers a free-form text message inside the
 * 24-hour customer-service window; for cold pushes a pre-approved template is
 * required. We send type:'text' as specced; if Meta rejects it (outside window)
 * the error is logged. Fire-and-forget: every failure is caught + logged,
 * notify() always resolves (never throws).
 */

import type { ExpertCase } from '../types'
import type { EscalationAdapter } from './adapter'
import { buildExpertPlainText, parseList, resolveEnabled } from './format'

const GRAPH_VERSION = 'v21.0'

/** Recipient phone numbers (E.164), comma-separated in WHATSAPP_EXPERTS_TO. */
function recipientNumbers(): string[] {
  return parseList(process.env.WHATSAPP_EXPERTS_TO)
}

export class WhatsAppEscalationAdapter implements EscalationAdapter {
  readonly name = 'whatsapp'

  /** On once all three Cloud-API creds exist, unless explicitly switched off. */
  isEnabled(): boolean {
    const credsReady =
      Boolean(process.env.WHATSAPP_TOKEN) &&
      Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID) &&
      recipientNumbers().length > 0
    return resolveEnabled(process.env.ASSISTANT_ESCALATION_WHATSAPP, credsReady)
  }

  async notify(c: ExpertCase): Promise<void> {
    const token = process.env.WHATSAPP_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const numbers = recipientNumbers()
    if (!token || !phoneNumberId || numbers.length === 0) return

    const body = buildExpertPlainText(c)
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`

    await Promise.allSettled(
      numbers.map(async (to) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to,
              type: 'text',
              text: { body },
            }),
            signal: AbortSignal.timeout(5000),
          })
          if (!res.ok) {
            console.error(
              '[escalation/whatsapp] messages',
              res.status,
              await res.text().catch(() => ''),
            )
          }
        } catch (err) {
          console.error('[escalation/whatsapp] send failed:', err)
        }
      }),
    )
  }
}
