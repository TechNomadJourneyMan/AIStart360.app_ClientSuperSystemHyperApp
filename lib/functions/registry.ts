/**
 * lib/functions/registry.ts — the Inngest functions a process serves at /api/inngest, by its role
 * (PORTAL_ROLE, lib/runtime/role.ts).
 *
 * Inngest calls back whatever the last sync (PUT /api/inngest) registered. After the role of the
 * portal changes, sync again: until then Inngest keeps invoking functions this process no longer
 * serves (docs/railway-agents-service.md).
 *
 * R4-A1: every function on a cron writes the end of each run to the journal of job outcomes
 * (withRunJournal, lib/functions/ops-ping.ts), and `ops-ping` is the heartbeat of our Inngest every
 * 10 minutes. The watchdog (lib/ops/job-watchdog.ts) reads both against inngestCronSchedules().
 */
import type { InngestFunction } from 'inngest'
import { inngestEnabled } from '@/lib/inngest-target'
import { cronTriggersOf, functionIdOf, opsPing, withRunJournal } from '@/lib/functions/ops-ping'
import { assistantEventsRetention } from '@/lib/functions/assistant-events-retention'
import { agentsMaintenance, agentsTaskRequested } from '@/lib/functions/agents'
import { demoAccountsCleanup } from '@/lib/functions/demo-cleanup'
import { pointANightly, pointARecalc } from '@/lib/functions/point-a'
import { pbInviteExternal, pbMonthlyCheckpoint, pbRecompute, pbRecomputeCompany } from '@/lib/functions/point-b'
import { commCampaignRun, commCampaignWatchdog } from '@/lib/functions/comm-campaigns'
import { commBotReply, commEscalations } from '@/lib/functions/comm'
import { processOmnichannelMessage } from '@/lib/functions/process-omnichannel-message'
import { backfillOmnichannel } from '@/lib/functions/backfill-omnichannel'
import {
  omnichannelMaintenance,
  omnichannelOutboundDeliveryMaintenance,
} from '@/lib/functions/omnichannel-maintenance'
import type { PortalRole } from '@/lib/runtime/role'

/**
 * The agent runtime: the fast path of a queued task and the per-minute maintenance. Only a process
 * that runs agent work serves them; with a separate agents service that service does both itself
 * (POST /api/internal/agents/kick and GET /api/cron/agents) and the portal serves neither.
 */
const AGENT_RUNTIME: readonly InngestFunction.Like[] = [agentsTaskRequested, agentsMaintenance]

// Document parsing runs as the document_intelligence agent (agentsTaskRequested
// / agentsMaintenance); the old `document/parse` function never had a trigger
// under inngest 4 and was removed.
const ALL: readonly InngestFunction.Like[] = [
  assistantEventsRetention,
  processOmnichannelMessage,
  backfillOmnichannel,
  omnichannelOutboundDeliveryMaintenance,
  omnichannelMaintenance,
  agentsTaskRequested,
  agentsMaintenance,
  demoAccountsCleanup,
  pointARecalc,
  pointANightly,
  // Broadcasts «Рассылки» (lib/comm/campaigns.ts): one short step per recipient, sleeps between.
  commCampaignRun,
  commCampaignWatchdog,
  // «Сообщения»: the 30-minute rule (cron */5, cheap) and the client bot in auto mode (one reply at a time).
  commEscalations,
  commBotReply,
  // Point B: the plan-fact recompute (hourly wake-up, runs on the pb_recompute_cron hours; ≤ 10 companies a run,
  // one short step each), the button's single-company run and the monthly reconciliation on the 1st.
  pbRecompute,
  pbRecomputeCompany,
  pbMonthlyCheckpoint,
  // Point B invites created outside the working hours: email / Telegram in the next window (*/15, ≤ 10 per step).
  pbInviteExternal,
  // Expert SLA (R2-B, lib/expert-sla) is NOT here: it runs from the portal's own scheduler
  // (/api/cron/expert-sla, lib/cron/schedule.ts) — Inngest Cloud does not call the portal on Railway.
  // The heartbeat of our Inngest (R4-A1): writes its own journal row every 10 minutes.
  opsPing,
]

// Scheduled functions report the end of every run to the journal; ops-ping writes its row itself.
for (const fn of ALL) {
  if (fn !== opsPing && cronTriggersOf(fn).length > 0) withRunJournal(fn)
}

/**
 * The functions /api/inngest serves in a process of `role`:
 *   'all'    - the full list (one process for everything, as before);
 *   'web'    - the same without the agent runtime;
 *   'agents' - none: the agents service has no public domain and no Inngest.
 */
export function inngestFunctionsForRole(role: PortalRole, env: NodeJS.ProcessEnv = process.env): InngestFunction.Like[] {
  if (role === 'agents') return []
  const disabled = disabledFunctionIds(env)
  const served = role === 'web' ? ALL.filter((fn) => !AGENT_RUNTIME.includes(fn)) : [...ALL]
  return disabled.size ? served.filter((fn) => !disabled.has(functionId(fn))) : served
}

/**
 * INNGEST_DISABLED_FUNCTIONS — ids of functions the route does NOT serve (comma or space separated),
 * e.g. «assistant-events-retention». A function that is not served is removed from the Inngest
 * server on the next sync, so it neither runs on schedule nor on events. Used to hold back a job
 * that deletes data until the PO allows it; unknown ids are ignored.
 */
export function disabledFunctionIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.INNGEST_DISABLED_FUNCTIONS ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))
}

function functionId(fn: InngestFunction.Like): string {
  return (fn as unknown as { opts?: { id?: string } }).opts?.id ?? ''
}

/**
 * The cron functions this process serves, with their schedules (Inngest syntax): what the watchdog
 * expects in the journal. None when no Inngest is configured (events and crons go nowhere then).
 */
export function inngestCronSchedules(role: PortalRole, env: NodeJS.ProcessEnv = process.env): Array<{ id: string; cron: string }> {
  if (!inngestEnabled(env)) return []
  return inngestFunctionsForRole(role, env).flatMap((fn) => cronTriggersOf(fn).map((cron) => ({ id: functionIdOf(fn), cron })))
}
