import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { z } from 'zod'
import { anthropic, CLAUDE_MODELS } from '@/lib/ai/anthropic'

/**
 * POST /api/market/generate-insights
 *
 * Takes the current market snapshot + competitor list + user company profile
 * and returns 3 strategic directives shaped as { title, description, impact,
 * category }. Uses Anthropic via the Vercel AI SDK (generateObject with a
 * Zod schema) — matching the pattern in lib/ai/point-a-analyzer.ts.
 *
 * The original source project used Google Gemini. If ANTHROPIC_API_KEY is
 * not set, we fall back to a deterministic mock response so the Insights tab
 * remains demoable in any environment.
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

    // Fallback path when no Anthropic key is configured — keeps the UI demoable.
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ directives: buildFallbackDirectives(userProfile?.customQuery) })
    }

    const prompt = `User Profile:
${JSON.stringify(userProfile ?? {}, null, 2)}

Market Overview:
${JSON.stringify(marketData ?? {}, null, 2)}

Competitors:
${JSON.stringify(competitorsData ?? [], null, 2)}

Based on this data, provide 3 strategic directives for the user.`

    const { object } = await generateObject({
      model: anthropic(CLAUDE_MODELS.sonnet),
      schema: responseSchema,
      system: SYSTEM_INSTRUCTION,
      prompt,
    })

    return NextResponse.json(object)
  } catch (error) {
    console.error('[market/generate-insights] Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to generate insights'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

type FallbackDirective = z.infer<typeof directiveSchema>

function buildFallbackDirectives(customQuery?: string): FallbackDirective[] {
  const base: FallbackDirective[] = [
    {
      title: 'Expand into the B2G digital-services segment',
      description:
        'Government digitalization (Digital Kazakhstan) creates a predictable revenue channel. Your low B2G dependency combined with the sector\'s 18.5% YoY growth indicates strong upside if you build compliance and tender-response capabilities.',
      impact: 'High',
      category: 'Opportunity',
    },
    {
      title: 'Harden data-localization compliance before Q3',
      description:
        'The new Kazakhstan data-localization law materially raises operating costs for SaaS vendors without local infrastructure. Start provisioning KZ-region storage and publish a compliance one-pager for enterprise buyers.',
      impact: 'Medium',
      category: 'Risk',
    },
    {
      title: 'Segment pricing for mid-market vs. enterprise',
      description:
        'Top competitors (Kolesa, Chocofamily) show a growing divergence between B2C and B2B pricing tiers. A mid-market tier priced 30-40% below enterprise would capture underserved 50-200 employee companies.',
      impact: 'Medium',
      category: 'Optimization',
    },
  ]
  if (customQuery && customQuery.trim().length > 0) {
    base.unshift({
      title: `Tailored take: "${customQuery.slice(0, 80)}"`,
      description:
        'Live AI generation is disabled (no ANTHROPIC_API_KEY configured), so this is a mock response seeded with your query. Configure ANTHROPIC_API_KEY to receive model-generated, data-grounded directives.',
      impact: 'Low',
      category: 'Optimization',
    })
  }
  return base
}
