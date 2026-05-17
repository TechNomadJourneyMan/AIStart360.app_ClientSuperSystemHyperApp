import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { calculateGri } from '@/lib/functions/calculate-gri'
import { parseDocumentFn } from '@/lib/functions/parse-document'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [calculateGri, parseDocumentFn],
})
