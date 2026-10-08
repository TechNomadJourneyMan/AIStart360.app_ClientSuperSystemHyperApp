/**
 * lib/agents/automation.ts — automation switches of the agent runtime.
 *
 * Settings live in system_settings (lib/settings/registry.ts, group
 * 'agents') and are changed in GIGA «Настройки» → «Автоматизация агентов» or
 * in the admin bot «🤖 Агенты» → «⚙️ Автоматизация» (settings.manage, audited):
 *
 *   agents_notify_lifecycle  lifecycle news to the admin bot (lifecycle.ts)   ON
 *   agents_auto_retry        retryable failures go back to the queue with
 *                            exponential backoff (agent_finish_task, 086)      ON
 *   agents_auto_diagnostic   survey / document events start a company
 *                            diagnostic, at most once per company per day      ON
 *   agents_daily_digest      09:00 Almaty summary to the admin bot (digest.ts) ON
 *   agents_stuck_alerts      CRITICAL once per stuck task (lifecycle.ts)       ON
 *   agents_stuck_minutes     no progress for N minutes = stuck                 20
 *
 * Readers are fail-safe: any problem reading a setting resolves to its
 * default, so the runtime never stops because of this module. No static
 * import of the queue: the runner imports this file.
 */
import type { AuditWriter } from '@/lib/admin/staff-actions'
import { prisma } from '@/lib/db'
import { ORCHESTRATOR_KEY } from '@/lib/diagnostics/pipeline'
import type { PlatformEventRow } from '@/lib/events/platform'
import { addDays, localDate, startOfLocalDay } from '@/lib/automation/time'
import { SETTINGS, validateSetting, type SettingKey, type SettingValue } from '@/lib/settings/registry'
import { getAllSettings, getSetting, saveSettings } from '@/lib/settings/store'

export const AUTOMATION_TOGGLES = [
  'agents_notify_lifecycle',
  'agents_auto_retry',
  'agents_auto_diagnostic',
  'agents_daily_digest',
  'agents_stuck_alerts',
] as const
export type AutomationToggle = (typeof AUTOMATION_TOGGLES)[number]
export const AUTOMATION_KEYS = [...AUTOMATION_TOGGLES, 'agents_stuck_minutes'] as const
export type AutomationKey = (typeof AUTOMATION_KEYS)[number]

export function isAutomationKey(v: unknown): v is AutomationKey {
  return typeof v === 'string' && (AUTOMATION_KEYS as readonly string[]).includes(v)
}

/** Time zone of the agent calendar (the digest, «once per day»): the notification zone. */
export function agentsTimeZone(): string {
  return process.env.NOTIFY_TIMEZONE?.trim() || 'Asia/Almaty'
}

/** Cached (5 s) read of one automation setting; its default on any failure. */
export async function automationSetting<K extends AutomationKey>(key: K): Promise<SettingValue<K>> {
  try {
    return await getSetting(key)
  } catch {
    return SETTINGS[key].default as SettingValue<K>
  }
}

export async function automationEnabled(key: AutomationToggle): Promise<boolean> {
  return (await automationSetting(key)) === true
}

/** Current values of every automation setting (fresh: the bot / admin UI). */
export async function automationSnapshot(): Promise<{ [K in AutomationKey]: SettingValue<K> }> {
  try {
    const { values } = await getAllSettings({ fresh: true })
    return Object.fromEntries(AUTOMATION_KEYS.map((k) => [k, values[k]])) as { [K in AutomationKey]: SettingValue<K> }
  } catch {
    return Object.fromEntries(AUTOMATION_KEYS.map((k) => [k, SETTINGS[k].default])) as { [K in AutomationKey]: SettingValue<K> }
  }
}

export type SetAutomationResult = { ok: true; changed: boolean } | { ok: false; error: string }

/**
 * Change one automation setting on behalf of a staff member (the caller has
 * checked settings.manage). Same contract as PUT /api/giga-admin/settings:
 * validated, audited with before/after BEFORE the write (required), saved.
 */
export async function setAutomationSetting(args: {
  key: AutomationKey
  value: unknown
  actorId: string
  audit: AuditWriter
}): Promise<SetAutomationResult> {
  const v = validateSetting(args.key, args.value)
  if (!v.ok) return { ok: false, error: v.error }
  const { values: before } = await getAllSettings({ fresh: true })
  if (JSON.stringify(before[args.key]) === JSON.stringify(v.value)) return { ok: true, changed: false }
  await args.audit({
    action: 'settings.changed',
    entityType: 'system_settings',
    entityId: args.key,
    oldValue: { [args.key]: before[args.key] },
    newValue: { [args.key]: v.value },
    metadata: { critical: SETTINGS[args.key as SettingKey].critical ? [args.key] : [] },
  }, { required: true })
  await saveSettings({ [args.key]: v.value }, args.actorId)
  return { ok: true, changed: true }
}

// ─── Auto-start of a company diagnostic ──────────────────────────────────────

/** Events that start a company diagnostic (the orchestrator's subscriptions). */
export const AUTO_DIAGNOSTIC_EVENTS = ['ONBOARDING_COMPLETED', 'QUESTIONNAIRE_COMPLETED', 'FILE_PROCESSED'] as const

/** A processed document that yielded no data changes nothing — no diagnostic. */
export function documentHasData(payload: Record<string, unknown> | null | undefined): boolean {
  const p = payload ?? {}
  return Number(p.field_count ?? 0) + Number(p.row_count ?? 0) + Number(p.bound_count ?? 0) > 0
}

/**
 * Idempotency keys of the automatic diagnostic of a company: one per local
 * day. A second event on the same day goes to the next day's slot, starting
 * at local midnight, so the change is analysed without running twice a day.
 */
export function autoDiagnosticSlots(companyId: string, now: Date, timeZone = agentsTimeZone()) {
  const today = localDate(now, timeZone)
  const tomorrow = addDays(today, 1)
  return {
    today: { key: `auto-diagnostic:${companyId}:${today}`, runAfter: null as Date | null },
    next: { key: `auto-diagnostic:${companyId}:${tomorrow}`, runAfter: startOfLocalDay(tomorrow, timeZone) },
  }
}

export type AutoDiagnosticOutcome = 'disabled' | 'no_company' | 'empty_document' | 'duplicate_event' | 'started' | 'deferred' | 'already_deferred'

/** Enqueue function of the queue (passed in: this module must not import the queue). */
export type EnqueueSlot = (slot: { idempotencyKey: string; runAfter: Date | null }) => Promise<{ id: string; created: boolean }>

/**
 * An orchestrator-trigger event arrived: start the company diagnostic, at
 * most once per company per local day (agents_auto_diagnostic). A
 * re-dispatched event (redispatchPending) never books a second slot.
 */
export async function enqueueAutoDiagnostic(
  event: Pick<PlatformEventRow, 'id' | 'name' | 'company_id' | 'payload'>,
  enqueue: EnqueueSlot,
  now = new Date(),
): Promise<AutoDiagnosticOutcome> {
  if (!(await automationEnabled('agents_auto_diagnostic'))) return 'disabled'
  if (!event.company_id) return 'no_company'
  if (event.name === 'FILE_PROCESSED' && !documentHasData(event.payload)) return 'empty_document'
  const seen = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.agent_tasks
    WHERE agent_key = ${ORCHESTRATOR_KEY} AND company_id = ${event.company_id} AND trigger = 'event'
      AND created_at > now() - interval '3 days'
      AND input -> 'event' ->> 'id' = ${String(event.id)}
    LIMIT 1`
  if (seen[0]) return 'duplicate_event'
  const slots = autoDiagnosticSlots(event.company_id, now)
  const today = await enqueue({ idempotencyKey: slots.today.key, runAfter: null })
  if (today.created) return 'started'
  const next = await enqueue({ idempotencyKey: slots.next.key, runAfter: slots.next.runAfter })
  return next.created ? 'deferred' : 'already_deferred'
}
