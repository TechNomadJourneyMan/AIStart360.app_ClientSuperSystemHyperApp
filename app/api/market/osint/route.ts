import { NextResponse } from 'next/server'

/**
 * POST /api/market/osint
 *
 * Unified endpoint for all OSINT sync actions. The live implementation in
 * the source project used Exa.ai + Firecrawl + Gemini; here we return mock
 * data so the UI is fully functional without external credentials.
 *
 * TODO(osint): Wire this up to the real pipeline when the following are
 * available:
 *   - EXA_API_KEY for Exa.ai search + content extraction (news, competitors)
 *   - FIRECRAWL_API_KEY for Firecrawl scraping (intelligence)
 *   - An AI provider for schema-structured extraction. The target project
 *     already exposes Anthropic via @ai-sdk/anthropic in lib/ai/anthropic.ts
 *     and can be used with `generateObject` + a Zod schema, matching the
 *     pattern in lib/ai/point-a-analyzer.ts.
 *
 * Request body:
 *   { action: 'news' | 'competitors' | 'intelligence', ...params }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, url, competitorName } = body ?? {}

    if (action === 'news') {
      return NextResponse.json({ data: buildMockNews() })
    }

    if (action === 'competitors') {
      return NextResponse.json({ data: buildMockCompetitors() })
    }

    if (action === 'intelligence') {
      if (!url || !competitorName) {
        return NextResponse.json(
          { error: 'url and competitorName are required' },
          { status: 400 },
        )
      }
      return NextResponse.json({ data: buildMockIntelligence(competitorName) })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch OSINT data'
    console.error('[market/osint] Error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function buildMockNews() {
  const now = Date.now()
  return [
    {
      source: 'BusinessFM',
      headline: 'IT sector attracts record foreign investment in Kazakhstan Q1',
      summary:
        'International investors poured $180M into Kazakh IT startups in the first quarter, a 42% YoY increase led by fintech and AI companies.',
      timestamp: new Date(now - 1000 * 60 * 90).toISOString(),
      tags: ['Investment', 'Fintech', 'AI'],
    },
    {
      source: 'Atameken Business',
      headline: 'New tax incentives approved for IT-park residents',
      summary:
        'The Parliament extended the 0% corporate income tax regime for Astana Hub residents through 2030, removing a major policy risk for scaling SaaS vendors.',
      timestamp: new Date(now - 1000 * 60 * 60 * 4).toISOString(),
      tags: ['Regulation', 'Astana Hub'],
    },
  ]
}

function buildMockCompetitors() {
  return [
    {
      name: 'NovaByte KZ',
      category: 'Direct',
      bin_iin: '230540051122',
      url: 'https://novabyte.kz',
      estRevenue: 4_600_000_000,
      taxesPaid: 420_000_000,
      b2gDependency: 38,
      tags: ['Consulting', 'Cloud', 'B2B'],
      isTracked: false,
    },
  ]
}

function buildMockIntelligence(competitorName: string) {
  const now = Date.now()
  return [
    {
      type: 'New Vacancy',
      description: `${competitorName} posted 5 new engineering roles focused on AI/ML — signals a new product line is in development.`,
      timestamp: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
    },
    {
      type: 'Tender Win',
      description: `${competitorName} won a state tender worth ₸140M for a digital infrastructure modernization contract.`,
      timestamp: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
    },
  ]
}
