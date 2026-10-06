import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { parseDocumentFn } from '@/lib/functions/parse-document'
import { assistantEventsRetention } from '@/lib/functions/assistant-events-retention'
import { agentsMaintenance, agentsTaskRequested } from '@/lib/functions/agents'
import { demoAccountsCleanup } from '@/lib/functions/demo-cleanup'
import { processOmnichannelMessage } from '@/lib/functions/process-omnichannel-message'
import { backfillOmnichannel } from '@/lib/functions/backfill-omnichannel'
import {
  omnichannelMaintenance,
  omnichannelOutboundDeliveryMaintenance,
} from '@/lib/functions/omnichannel-maintenance'

export const runtime = 'nodejs'
export const maxDuration = 300

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    parseDocumentFn,
    assistantEventsRetention,
    processOmnichannelMessage,
    backfillOmnichannel,
    omnichannelOutboundDeliveryMaintenance,
    omnichannelMaintenance,
    agentsTaskRequested,
    agentsMaintenance,
    demoAccountsCleanup,
  ],
})
