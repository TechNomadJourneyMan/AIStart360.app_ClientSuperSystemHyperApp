import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { calculateGri } from '@/lib/functions/calculate-gri'
import { indexKnowledgeDocumentJob } from '@/lib/functions/index-knowledge-document'
import { dispatchSalesOutbox } from '@/lib/functions/dispatch-sales-outbox'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [calculateGri, indexKnowledgeDocumentJob, dispatchSalesOutbox],
})
