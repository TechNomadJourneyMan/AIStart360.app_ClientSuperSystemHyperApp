import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
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

export const runtime = 'nodejs'
// A stuck run must release its DB connections soon (runs are budgeted to ~45 s).
export const maxDuration = 120

export const { GET, POST, PUT } = serve({
  client: inngest,
  // Document parsing runs as the document_intelligence agent (agentsTaskRequested
  // / agentsMaintenance); the old `document/parse` function never had a trigger
  // under inngest 4 and was removed.
  functions: [
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
  ],
})
