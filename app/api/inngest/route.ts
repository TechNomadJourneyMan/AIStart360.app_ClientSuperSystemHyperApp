import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { calculateGri } from '@/lib/functions/calculate-gri'
import { parseDocumentFn } from '@/lib/functions/parse-document'
import { assistantEventsRetention } from '@/lib/functions/assistant-events-retention'
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
    calculateGri,
    parseDocumentFn,
    assistantEventsRetention,
    processOmnichannelMessage,
    backfillOmnichannel,
    omnichannelOutboundDeliveryMaintenance,
    omnichannelMaintenance,
  ],
})
