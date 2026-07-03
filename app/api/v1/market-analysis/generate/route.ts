export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import {
  generateMarketAnswers,
  type MarketGenContext,
} from '@/lib/market-analysis/generator'
import { getQuestion } from '@/lib/market-analysis/questions'
import { loadAnswers, rebuildSnapshot } from '@/lib/market-analysis/persist'
import { isRateLimitedKey } from '@/lib/rate-limit'

const UPSTREAM_TIMEOUT_MS = 6000

// =============================================================================
// POST /api/v1/market-analysis/generate
// AI-fills all 50 draft answers, grounded in real context. Never overwrites a
// user/expert/confirmed answer. Rebuilds the snapshot afterwards.
// =============================================================================
export async function POST() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  // Throttle this paid ~50-answer AI generation per user (audit 2026-07-02).
  if (await isRateLimitedKey(userId, 'market-analysis-generate', { max: 5, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' }, { status: 429 })
  }

  // Honest failure if the AI provider is not configured — no fabrication.
  if (!hasOpenRouterKey()) {
    return NextResponse.json(
      { ok: false, error: 'ai_not_configured' },
      { status: 503 },
    )
  }

  // 1. Gather REAL context: survey answers (+ upstream if MARKET_API_URL set).
  const ctx = await buildContext(sb, userId)

  // 2. Generate.
  const gen = await generateMarketAnswers(ctx)
  if (!gen.ok) {
    const status = gen.error === 'ai_unavailable' ? 503 : 502
    return NextResponse.json({ ok: false, error: gen.error }, { status })
  }

  // 3. Upsert ONLY where there is no existing confirmed/user/expert answer.
  let existing: Awaited<ReturnType<typeof loadAnswers>>
  try {
    existing = await loadAnswers(sb, userId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load_failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
  const locked = new Set(
    existing
      .filter((a) => a.source === 'user' || a.source === 'expert' || a.status === 'confirmed')
      .map((a) => a.question_key),
  )

  const rows = gen.answers
    .filter((a) => !locked.has(a.key))
    .map((a) => {
      const q = getQuestion(a.key)
      return q
        ? {
            user_id: userId,
            question_key: a.key,
            block: q.block,
            answer_text: a.answer,
            source: 'ai' as const,
            status: 'draft' as const,
            confidence: a.confidence,
            model: gen.model,
            updated_at: new Date().toISOString(),
          }
        : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  let generated = 0
  if (rows.length > 0) {
    const { error: upErr } = await sb
      .from('market_analysis_answers')
      .upsert(rows, { onConflict: 'user_id,question_key' })
    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })
    }
    generated = rows.length
  }

  // 4. Rebuild snapshot (best-effort).
  await rebuildSnapshot(sb, userId, ctx.niche)

  return NextResponse.json({
    ok: true,
    data: { generated, skipped_confirmed: locked.size, model: gen.model },
  })
}

// ---------------------------------------------------------------------------
// Context gathering
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'

/** Unwraps survey_answers jsonb ({value} or scalar). */
function unwrap(answer: unknown): unknown {
  if (answer && typeof answer === 'object' && 'value' in answer) {
    return (answer as { value: unknown }).value
  }
  return answer
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  return null
}

function parseCompetitors(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => asString(x)).filter((s): s is string => Boolean(s))
  }
  const s = asString(v)
  if (!s) return []
  // Free-text list — split on common separators.
  return s
    .split(/[,\n;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20)
}

async function buildContext(
  sb: SupabaseClient,
  userId: string,
): Promise<MarketGenContext> {
  const survey: Record<string, unknown> = {}
  try {
    const { data } = await sb
      .from('survey_answers')
      .select('question_key, answer')
      .eq('user_id', userId)
    for (const row of data ?? []) {
      const r = row as { question_key: string; answer: unknown }
      survey[r.question_key] = unwrap(r.answer)
    }
  } catch {
    // tolerate — generation still proceeds with empty survey context
  }

  // Survey keys verified against the onboarding forms:
  //   s1_industry, s1_niche (legacy/optional), s1_city (optional), s1_regions,
  //   s1_competitors_list / top_competitors (whichever exists).
  const industry = asString(survey.s1_industry ?? survey.s1n_industry)
  const niche = asString(survey.s1_niche ?? survey.s1n_niche)
  const city = asString(survey.s1_city ?? survey.s1n_city)
  const regionsRaw = survey.s1_regions
  const regions = Array.isArray(regionsRaw)
    ? regionsRaw.map((x) => asString(x)).filter((s): s is string => Boolean(s))
    : []
  const competitors = parseCompetitors(
    survey.s1_competitors_list ?? survey.top_competitors ?? survey.s3n_competitors_better,
  )

  const upstream = await fetchUpstream(sb, industry)

  return { industry, niche, city, regions, competitors, upstream }
}

/**
 * Best-effort, direct server-side fetch to the Mark-analytics FastAPI (we are
 * already server-side, so we bypass the /api/market proxy). All failures are
 * tolerated — the generator degrades to survey-only context.
 */
async function fetchUpstream(
  sb: SupabaseClient,
  industry: string | null,
): Promise<MarketGenContext['upstream']> {
  const base = process.env.MARKET_API_URL?.replace(/\/+$/, '')
  if (!base) return undefined

  const {
    data: { session },
  } = await sb.auth.getSession()
  const token = session?.access_token
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const get = async (path: string): Promise<unknown> => {
    try {
      const res = await fetch(`${base}/${path}`, {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      if (!res.ok) return undefined
      return await res.json()
    } catch {
      return undefined
    }
  }

  const industryQ = industry ? encodeURIComponent(industry) : ''
  const [analyticsOverview, industryDistribution, companies, news] = await Promise.all([
    get('analytics/overview'),
    get('analytics/industry-distribution'),
    industryQ ? get(`companies?query=${industryQ}&limit=10`) : get('companies?limit=10'),
    get('news/recent?limit=10'),
  ])

  const out = { analyticsOverview, industryDistribution, companies, news }
  // If every upstream call failed, return undefined so the prompt notes the gap.
  if (!analyticsOverview && !industryDistribution && !companies && !news) {
    return undefined
  }
  return out
}
