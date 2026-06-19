/**
 * lib/assistant/escalation/email-adapter.ts — OPTIONAL escalation channel.
 *
 * Real class implementing {@link EscalationAdapter}, but a deliberate NO-OP stub
 * today. Gated by ASSISTANT_ESCALATION_EMAIL ('1' | 'true' | 'on'); disabled by
 * default so the dispatcher skips it. The InternalAdapter already emails admins
 * via notifyAdmins, so this is purely a future hook for a DEDICATED experts
 * distribution list.
 *
 * TO IMPLEMENT LATER: send to an experts distro by reusing sendNotificationEmail
 * from lib/email.ts (already wired through lib/notifications.ts sendEmail, which
 * builds subject/title/body/CTA — the 'expert_case_created' arm and the
 * /expert/dashboard CTA exist). The cleanest path is to add an experts address
 * (e.g. EXPERTS_NOTIFICATION_EMAIL) and call sendNotificationEmail with the
 * expert-case copy. Until then notify() must remain a resolved no-op so enabling
 * the flag prematurely cannot break dispatch.
 */

import type { ExpertCase } from '../types'
import type { EscalationAdapter } from './adapter'

const TRUTHY = new Set(['1', 'true', 'on', 'yes'])

export class EmailEscalationAdapter implements EscalationAdapter {
  readonly name = 'email'

  isEnabled(): boolean {
    return TRUTHY.has((process.env.ASSISTANT_ESCALATION_EMAIL ?? '').toLowerCase().trim())
  }

  async notify(_c: ExpertCase): Promise<void> {
    // No-op stub. When implemented, reuse sendNotificationEmail (lib/email.ts)
    // to email a dedicated experts distro with the 'expert_case_created' copy.
    // Must never throw (fire-and-forget contract).
    return
  }
}
