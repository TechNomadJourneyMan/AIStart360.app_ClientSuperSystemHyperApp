import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { calculateGri } from '@/lib/functions/calculate-gri'
import {
  aiOrchestrate,
  aiReExtractOnDocChange,
  aiReSlotMapOnSurveyChange,
} from '@/lib/functions/ai-orchestrate'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    calculateGri,
    aiOrchestrate,
    aiReExtractOnDocChange,
    aiReSlotMapOnSurveyChange,
  ],
})
