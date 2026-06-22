/**
 * lib/assistant/escalation/email-adapter.ts — DEDICATED experts email channel.
 *
 * Emails the experts team (a distro that may differ from the admin distro)
 * whenever an {@link ExpertCase} is opened. Reuses sendNotificationEmail from
 * lib/email.ts (Resend), so the message gets the same dark-themed wrapper +
 * CTA button as the rest of the platform's transactional mail.
 *
 * Auto-activates once creds exist — the owner only sets env, no extra flag:
 *   - RESEND_API_KEY (already used by lib/notifications.ts)
 *   - one of EXPERTS_NOTIFICATION_EMAIL / ADMIN_NOTIFICATION_EMAIL / ADMIN_EMAIL
 * The optional ASSISTANT_ESCALATION_EMAIL flag can force it on/off.
 *
 * Fire-and-forget: every failure is caught + logged, notify() always resolves
 * (never throws).
 */

import type { ExpertCase } from '../types'
import type { EscalationAdapter } from './adapter'
import { sendNotificationEmail } from '@/lib/email'
import { buildExpertEmailBody, expertDashboardUrl, firstNonEmpty, resolveEnabled } from './format'

/** Recipient: dedicated experts distro → admin distro → legacy single admin. */
function recipientEmail(): string | undefined {
  return firstNonEmpty(
    process.env.EXPERTS_NOTIFICATION_EMAIL,
    process.env.ADMIN_NOTIFICATION_EMAIL,
    process.env.ADMIN_EMAIL,
  )
}

export class EmailEscalationAdapter implements EscalationAdapter {
  readonly name = 'email'

  /** On once RESEND_API_KEY AND a recipient exist, unless explicitly switched off. */
  isEnabled(): boolean {
    const credsReady = Boolean(process.env.RESEND_API_KEY) && Boolean(recipientEmail())
    return resolveEnabled(process.env.ASSISTANT_ESCALATION_EMAIL, credsReady)
  }

  async notify(c: ExpertCase): Promise<void> {
    const to = recipientEmail()
    if (!to || !process.env.RESEND_API_KEY) return

    try {
      await sendNotificationEmail({
        to,
        subject: `AIStart360: новое обращение к эксперту — ${c.title}`,
        title: 'Новое обращение к эксперту',
        body: buildExpertEmailBody(c),
        ctaLabel: 'Открыть портал эксперта',
        ctaUrl: expertDashboardUrl(),
      })
    } catch (err) {
      console.error('[escalation/email] send failed:', err)
    }
  }
}
