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
// Real OSINT requires external providers (Exa.ai for search/news/competitors,
// Firecrawl for scraping). Until those credentials are configured we return
// EMPTY results with `source: 'not_connected'` — never fabricated news,
// competitors, or "intelligence". The UI must render an explicit empty state
// ("Источник данных не подключён"). See docs/technical-audit.md (D5).
function osintConnected(): boolean {
  return Boolean(process.env.EXA_API_KEY && process.env.FIRECRAWL_API_KEY)
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action, url, competitorName } = body ?? {}

    if (action !== 'news' && action !== 'competitors' && action !== 'intelligence') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (action === 'intelligence' && (!url || !competitorName)) {
      return NextResponse.json(
        { error: 'url and competitorName are required' },
        { status: 400 },
      )
    }

    if (!osintConnected()) {
      // No real source wired → honest empty payload, not mock data.
      return NextResponse.json({ source: 'not_connected', data: [] })
    }

    // TODO(osint): real Exa.ai + Firecrawl pipeline goes here, returning the
    // same { source, data } shape with live results.
    return NextResponse.json({ source: 'not_connected', data: [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch OSINT data'
    console.error('[market/osint] Error:', error)
    return NextResponse.json({ error: message, data: [] }, { status: 500 })
  }
}
