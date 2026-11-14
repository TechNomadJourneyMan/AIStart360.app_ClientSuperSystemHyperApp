/**
 * lib/automation/maintenance-gate.ts — no automatic client messages during maintenance (R-026).
 *
 * While «Режим технических работ» is on (system_settings.maintenance, the same switch middleware
 * reads through lib/settings/edge.ts and /api/v1/platform/maintenance shows), the client cabinet is
 * a «Ведутся работы» page: a reminder or a digest that says «зайдите в кабинет» only leads there.
 * The automatic client mailings ask this gate first and skip the whole run when it says so; the
 * next run (a day / a week later) sends what is still due — their touches are idempotent.
 *
 * The setting is read fresh (not the 5 s cache). When it cannot be read the gate says «skip»: the
 * cabinet may well be closed, and a missed run costs one day's reminder at most.
 */
import { getSetting } from '@/lib/settings/store'

export type MaintenanceSkipReason = 'maintenance' | 'maintenance_unknown'

/** Why the client mailing `job` must not run now, or null when it may. Logs the reason. */
export async function maintenanceSkipReason(job: string): Promise<MaintenanceSkipReason | null> {
  let reason: MaintenanceSkipReason | null
  try {
    const m = (await getSetting('maintenance', { fresh: true })) as { enabled?: unknown } | null | undefined
    reason = m && typeof m === 'object' && m.enabled === true ? 'maintenance' : null
  } catch {
    reason = 'maintenance_unknown'
  }
  if (reason) console.warn(JSON.stringify({ event: 'automation_skipped', job, reason }))
  return reason
}

export async function maintenanceBlocksClientMessages(job: string): Promise<boolean> {
  return (await maintenanceSkipReason(job)) !== null
}
