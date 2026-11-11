/**
 * lib/functions/registry.ts — the Inngest functions a process serves at /api/inngest, by its role
 * (PORTAL_ROLE, lib/runtime/role.ts).
 *
 * Inngest calls back whatever the last sync (PUT /api/inngest) registered. After the role of the
 * portal changes, sync again: until then Inngest keeps invoking functions this process no longer
 * serves (docs/railway-agents-service.md).
 */
import type { InngestFunction } from 'inngest'
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
]

/**
 * The functions /api/inngest serves in a process of `role`:
 *   'all'    - the full list (one process for everything, as before);
 *   'web'    - the same without the agent runtime;
 *   'agents' - none: the agents service has no public domain and no Inngest.
 */
export function inngestFunctionsForRole(role: PortalRole): InngestFunction.Like[] {
  if (role === 'agents') return []
  if (role === 'web') return ALL.filter((fn) => !AGENT_RUNTIME.includes(fn))
  return [...ALL]
}
