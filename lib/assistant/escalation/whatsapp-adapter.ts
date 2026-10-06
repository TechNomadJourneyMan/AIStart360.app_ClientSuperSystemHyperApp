/**
 * lib/assistant/escalation/whatsapp-adapter.ts — DEDICATED experts WhatsApp channel.
 *
 * When an {@link ExpertCase} is opened, every expert with an opted-in,
 * verified WhatsApp number (whatsapp_links, kind 'expert') and every number
 * the operator listed in WHATSAPP_EXPERTS_TO gets the approved template
 * `expert_notification` through the durable WhatsApp outbox
 * (lib/whatsapp/outbox.ts: idempotent, retried with backoff, never resent
 * after an ambiguous timeout). Cold pushes outside the 24-hour window require
 * a template, so free-form text is no longer sent.
 *
 * Auto-activates once Cloud API is configured (WHATSAPP_TOKEN +
 * WHATSAPP_PHONE_NUMBER_ID); ASSISTANT_ESCALATION_WHATSAPP can force it
 * on/off. Experts never go through the WhatsApp Web bridge.
 * Fire-and-forget: notify() always resolves.
 */

import type { ExpertCase } from '../types'
import type { EscalationAdapter } from './adapter'
import { resolveEnabled } from './format'
import { cloudApiConfigured } from '@/lib/whatsapp/config'
import { optedInRecipients } from '@/lib/whatsapp/links'
import { enqueueWhatsApp, operatorExpertNumbers, outboxKey, sendWhatsAppNow } from '@/lib/whatsapp/outbox'
import { expertNotificationTemplate } from '@/lib/whatsapp/templates'
import type { NotificationLevel } from '@/lib/notifications/levels'
import { EXPERT_ROLES } from '@/lib/expert-auth'

const PRIORITY_LEVEL: Record<ExpertCase['priority'], NotificationLevel> = {
  critical: 'CRITICAL',
  high: 'WARNING',
  medium: 'SUCCESS',
  low: 'INFO',
}

const PRIORITY_RU: Record<ExpertCase['priority'], string> = {
  critical: 'критический',
  high: 'высокий',
  medium: 'средний',
  low: 'низкий',
}

export class WhatsAppEscalationAdapter implements EscalationAdapter {
  readonly name = 'whatsapp'

  /** On once Cloud API is configured, unless explicitly switched off. */
  isEnabled(): boolean {
    return resolveEnabled(process.env.ASSISTANT_ESCALATION_WHATSAPP, cloudApiConfigured())
  }

  async notify(c: ExpertCase): Promise<void> {
    try {
      if (!cloudApiConfigured()) return
      const linked = (await optedInRecipients('expert')).filter((r) => r.role !== null && EXPERT_ROLES.has(r.role))
      const seen = new Set<string>()
      const targets: Array<{ userId: string | null; phone: string }> = []
      for (const r of linked) if (!seen.has(r.phone)) { seen.add(r.phone); targets.push({ userId: r.userId, phone: r.phone }) }
      for (const phone of operatorExpertNumbers()) if (!seen.has(phone)) { seen.add(phone); targets.push({ userId: null, phone }) }
      if (targets.length === 0) return

      const payload = expertNotificationTemplate({
        title: `Обращение к эксперту: ${c.title}`,
        lines: [c.summary, `Приоритет: ${PRIORITY_RU[c.priority] ?? c.priority}`],
        path: 'expert/dashboard',
      })
      const ids: string[] = []
      for (const t of targets) {
        const row = await enqueueWhatsApp({
          idempotencyKey: outboxKey('escalation', c.id, t.userId ?? t.phone.slice(1)),
          kind: 'expert',
          userId: t.userId,
          phoneE164: t.phone,
          payload,
          level: PRIORITY_LEVEL[c.priority] ?? 'WARNING',
        })
        if (row.created) ids.push(row.id)
      }
      await sendWhatsAppNow(ids)
    } catch (err) {
      console.error('[escalation/whatsapp] enqueue failed:', err instanceof Error ? err.message.split('\n')[0] : 'error')
    }
  }
}
