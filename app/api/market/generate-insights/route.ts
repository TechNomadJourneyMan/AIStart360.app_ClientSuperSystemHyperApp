import { NextResponse } from 'next/server'
import { z } from 'zod'
import { chatWithOpenRouter, extractJson } from '@/lib/ai/openrouter'

/**
 * POST /api/market/generate-insights
 *
 * Takes the current market snapshot + competitor list + user company profile
 * and returns 3 strategic directives shaped as { title, description, impact,
 * category }. Uses Anthropic via the Vercel AI SDK (generateObject with a
 * Zod schema) — matching the pattern in lib/ai/point-a-analyzer.ts.
 *
 * If no AI key is configured (or the model returns an invalid response) we
 * return an honest empty { source:'not_connected', directives:[] } payload
 * instead of fabricated data.
 */

const directiveSchema = z.object({
  title: z.string().describe('Strong, action-oriented title'),
  description: z
    .string()
    .describe('Detailed explanation of why this is recommended based on the data'),
  impact: z.enum(['High', 'Medium', 'Low']).describe('Expected business impact'),
  category: z
    .enum(['Opportunity', 'Risk', 'Optimization'])
    .describe('Directive category'),
})

const responseSchema = z.object({
  directives: z.array(directiveSchema).min(1).max(6),
})

const SYSTEM_INSTRUCTION = `You are a senior market analyst at MBB (McKinsey, BCG, Bain) with deep expertise in corporate intelligence in the CIS and Kazakhstan markets.
Your task is to analyze the raw market data and the user's current business profile to generate personalized, actionable strategic recommendations.
Format the output as an object containing an array of 'directives'.
Each directive should have:
- title: A strong, action-oriented title.
- description: A detailed explanation of why this is recommended based on the data.
- impact: 'High', 'Medium', or 'Low'.
- category: 'Opportunity', 'Risk', or 'Optimization'.`

export async function POST(req: Request) {
  try {
    const { userProfile, marketData, competitorsData } = await req.json()

    const prompt = `User Profile:
${JSON.stringify(userProfile ?? {}, null, 2)}

Market Overview:
${JSON.stringify(marketData ?? {}, null, 2)}

Competitors:
${JSON.stringify(competitorsData ?? [], null, 2)}

Based on this data, provide 3 strategic directives. Return ONLY a JSON object with this structure:
{
  "directives": [
    {
      "title": "string",
      "description": "string",
      "impact": "High" | "Medium" | "Low",
      "category": "Opportunity" | "Risk" | "Optimization"
    }
  ]
}`

    const aiResponse = await chatWithOpenRouter({
      system: SYSTEM_INSTRUCTION,
      user: prompt,
      maxTokens: 2000,
      jsonMode: true,
    })

    if (aiResponse) {
      const parsed = extractJson<{ directives: unknown }>(aiResponse)
      if (parsed) {
        const validation = responseSchema.safeParse(parsed)
        if (validation.success) return NextResponse.json(validation.data)
      }
    }

    // No AI key configured or invalid response — return an honest empty payload
    // rather than fabricated directives. Mirrors the not_connected shape used by
    // app/api/market/osint/route.ts.
    return NextResponse.json({ source: 'not_connected', directives: [] })
  } catch (error) {
    console.error('[market/generate-insights] Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to generate insights'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
