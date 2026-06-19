'use server'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseDocument } from '@/lib/documents/parse'
import { generateObjectViaOpenRouter } from '@/lib/ai/structured'
import { OPENROUTER_MODELS } from '@/lib/ai/openrouter'
import { z } from 'zod'
import { withTrace } from '@/lib/langfuse'
import { revalidatePath } from 'next/cache'

const GriSchema = z.object({
  score: z.number().min(0).max(1000),
  domains: z.object({
    strategy: z.number().min(0).max(1000),
    finance: z.number().min(0).max(1000),
    operations: z.number().min(0).max(1000),
    team: z.number().min(0).max(1000),
    market: z.number().min(0).max(1000),
    technology: z.number().min(0).max(1000),
  }),
  summary: z.string(),
  recommendations: z.array(z.string()),
})

export async function runPointADiagnostic(formData: FormData) {
  const session = await auth()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }

  const clientId = formData.get('clientId') as string
  const file = formData.get('file') as File

  if (!clientId || !file) {
    throw new Error('Missing client identity or document file')
  }

  const result = await withTrace({
    name: 'runPointADiagnostic',
    userId: session.user?.id || 'unknown',
    metadata: { clientId, fileName: file.name },
    fn: async () => {
      try {
        // Step 1: Parse Document
        const buffer = Buffer.from(await file.arrayBuffer())
        const doc = await parseDocument(buffer, file.name)

        // Step 2: AI Analysis (via OpenRouter — single OPENROUTER_API_KEY)
        const analysis = await generateObjectViaOpenRouter({
          label: 'gri-document-diagnostic',
          model: OPENROUTER_MODELS.sonnet,
          maxTokens: 2000,
          schema: GriSchema,
          system: `You are a high-level business consultant specializing in the GRI (Growth Readiness Index) framework.
          Your task is to analyze the provided document and evaluate the company across 6 key domains: Strategy, Finance, Operations, Team, Market, and Technology.
          Provide a score from 0-1000 for each domain and an overall aggregate score.
          Also provide a brief summary and 3-5 actionable recommendations based on the data.`,
          user: `Analyze the following business document for GRI diagnostic.

Return ONLY a valid JSON object with this exact shape (no markdown, no commentary):
{
  "score": <number 0-1000>,
  "domains": {
    "strategy": <0-1000>, "finance": <0-1000>, "operations": <0-1000>,
    "team": <0-1000>, "market": <0-1000>, "technology": <0-1000>
  },
  "summary": "<string>",
  "recommendations": ["<string>", "<string>", "<string>"]
}

Document Content:
${doc.text.substring(0, 30000)}`,
        })

        if (!analysis) {
          throw new Error('AI GRI analysis unavailable (OPENROUTER_API_KEY not set or model error)')
        }

        // Step 3: Save to Database
        const report = await prisma.griReport.create({
          data: {
            clientId,
            score: analysis.score,
            domains: analysis.domains as any,
          },
        })

        // (Optionally) create a notification
        await prisma.notification.create({
          data: {
            userId: session.user?.id || '',
            type: 'gri_updated',
            title: 'Диагностика завершена',
            body: `GRI Score: ${analysis.score}/1000 для файла ${file.name}`,
            priority: 'medium',
          }
        })

        revalidatePath('/point-a')
        
        return { success: true, report, analysis }
      } catch (error) {
        console.error('Diagnostic error:', error)
        throw error
      }
    }
  })

  return result
}
