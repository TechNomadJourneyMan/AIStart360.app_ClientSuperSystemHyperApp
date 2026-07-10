export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isGigaSuperAdmin } from '@/lib/admin/giga-actor'
import {
  BLOCKS,
  isValidQuestionKey,
  getQuestion,
  TOTAL_QUESTIONS,
} from '@/lib/market-analysis/questions'
import {
  loadAnswers,
  rebuildSnapshot,
  upsertAnswer,
  type AnswerRecord,
} from '@/lib/market-analysis/persist'
import { hasOpenRouterKey } from '@/lib/ai/openrouter'
import {
  generateMarketAnswers,
  type MarketGenContext,
} from '@/lib/market-analysis/generator'

// ─────────────────────────────────────────────────────────────────────────────
// Auth — verify the HMAC-signed giga super-admin cookie (Node runtime).
// (Same gate as every other /api/giga-admin/* route, e.g. clients/route.ts.)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Service-role Supabase client (bypasses RLS). Admins author/read insights for
 * OTHER users, so the session-scoped (owner=auth.uid) client cannot be used —
 * we go through the service role exactly like other privileged routes (e.g.
 * app/api/reports/upload/route.ts).
 */
function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

// =============================================================================
// GET
//   ?user_id=<uuid> → that client's 6 blocks (questions + current answer) + progress
//   (no user_id)    → list of client-role profiles with answer counts
// =============================================================================
export async function GET(req: NextRequest) {
  if (!(await isGigaSuperAdmin(req))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const sb = serviceClient()
  if (!sb) {
    return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 500 })
  }

  const userId = req.nextUrl.searchParams.get('user_id')?.trim() || null

  // ── Single client: blocks + answers + progress ──────────────────────────────
  if (userId) {
    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ ok: false, error: 'invalid_user_id' }, { status: 400 })
    }

    let answers: AnswerRecord[]
    try {
      answers = await loadAnswers(sb, userId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'load_failed'
      return NextResponse.json({ ok: false, error: msg }, { status: 500 })
    }

    const byKey = new Map<string, AnswerRecord>()
    for (const a of answers) byKey.set(a.question_key, a)

    const blocks = BLOCKS.map((b) => ({
      id: b.id,
      code: b.code,
      title: b.title,
      questions: b.questions.map((q) => {
        const a = byKey.get(q.key)
        return {
          key: q.key,
          idx: q.idx,
          text: q.text,
          answer: a
            ? {
                text: a.answer_text,
                source: a.source,
                status: a.status,
                confidence: a.confidence,
                updated_at: a.updated_at,
              }
            : null,
        }
      }),
    }))

    const answered = answers.filter((a) => (a.answer_text ?? '').trim().length > 0).length
    const confirmed = answers.filter((a) => a.status === 'confirmed').length

    return NextResponse.json({
      ok: true,
      data: {
        blocks,
        progress: { answered, confirmed, total: TOTAL_QUESTIONS },
      },
    })
  }

  // ── Client list with answer counts ──────────────────────────────────────────
  try {
    const { data: profiles, error: pErr } = await sb
      .from('profiles')
      .select('id, full_name, organization, email')
      .eq('role', 'client')
      .order('created_at', { ascending: false })
    if (pErr) {
      return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })
    }

    const { data: rows, error: aErr } = await sb
      .from('market_analysis_answers')
      .select('user_id, answer_text, status')
    if (aErr) {
      return NextResponse.json({ ok: false, error: aErr.message }, { status: 500 })
    }

    // Merge counts in JS (two queries, one map).
    const counts = new Map<string, { answered: number; confirmed: number }>()
    for (const r of rows ?? []) {
      const row = r as { user_id: string; answer_text: string | null; status: string }
      const c = counts.get(row.user_id) ?? { answered: 0, confirmed: 0 }
      if ((row.answer_text ?? '').trim().length > 0) c.answered += 1
      if (row.status === 'confirmed') c.confirmed += 1
      counts.set(row.user_id, c)
    }

    const clients = (profiles ?? []).map((p) => {
      const c = counts.get(p.id) ?? { answered: 0, confirmed: 0 }
      return {
        id: p.id,
        full_name: p.full_name ?? p.email ?? null,
        organization: p.organization ?? null,
        answered: c.answered,
        confirmed: c.confirmed,
      }
    })

    return NextResponse.json({ ok: true, data: { clients } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load_failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// =============================================================================
// PATCH — admin authors/overwrites an answer (source 'expert').
// Body: { user_id, question_key, text, status? }
// Default status 'confirmed'. Rebuilds the user's snapshot afterwards.
// =============================================================================
export async function PATCH(req: NextRequest) {
  if (!(await isGigaSuperAdmin(req))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  const { user_id, question_key, text, status } = body as {
    user_id?: unknown
    question_key?: unknown
    text?: unknown
    status?: unknown
  }

  if (typeof user_id !== 'string' || !UUID_RE.test(user_id)) {
    return NextResponse.json({ ok: false, error: 'invalid_user_id' }, { status: 400 })
  }
  if (typeof question_key !== 'string' || !isValidQuestionKey(question_key)) {
    return NextResponse.json({ ok: false, error: 'invalid_question_key' }, { status: 400 })
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'text_required' }, { status: 400 })
  }
  const nextStatus =
    status === 'draft' || status === 'disputed' || status === 'confirmed'
      ? status
      : 'confirmed'

  const sb = serviceClient()
  if (!sb) {
    return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 500 })
  }

  const res = await upsertAnswer(sb, user_id, {
    question_key,
    answer_text: text.trim(),
    source: 'expert',
    status: nextStatus,
    confidence: null,
    model: null,
  })
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 500 })
  }

  // Rebuild the derived market snapshot (best-effort — never blocks the write).
  await rebuildSnapshot(sb, user_id)

  return NextResponse.json({ ok: true, data: { user_id, question_key, status: nextStatus } })
}

// =============================================================================
// POST — { user_id, action: 'generate' } → run the AI generator for that user.
// Mirrors app/api/v1/market-analysis/generate/route.ts but with admin-chosen
// user_id + service-role client. Honest ai_not_configured when no key.
// =============================================================================
export async function POST(req: NextRequest) {
  if (!(await isGigaSuperAdmin(req))) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const { user_id, action } = body as { user_id?: unknown; action?: unknown }
  if (typeof user_id !== 'string' || !UUID_RE.test(user_id)) {
    return NextResponse.json({ ok: false, error: 'invalid_user_id' }, { status: 400 })
  }
  if (action !== 'generate') {
    return NextResponse.json({ ok: false, error: 'invalid_action' }, { status: 400 })
  }

  // Honest failure if the AI provider is not configured — no fabrication.
  if (!hasOpenRouterKey()) {
    return NextResponse.json({ ok: false, error: 'ai_not_configured' }, { status: 503 })
  }

  const sb = serviceClient()
  if (!sb) {
    return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 500 })
  }

  // 1. Gather REAL context from the user's survey answers (upstream optional).
  const ctx = await buildContext(sb, user_id)

  // 2. Generate.
  const gen = await generateMarketAnswers(ctx)
  if (!gen.ok) {
    const status = gen.error === 'ai_unavailable' ? 503 : 502
    return NextResponse.json({ ok: false, error: gen.error }, { status })
  }

  // 3. Upsert ONLY where there is no existing confirmed/user/expert answer.
  let existing: AnswerRecord[]
  try {
    existing = await loadAnswers(sb, user_id)
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
            user_id,
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
  await rebuildSnapshot(sb, user_id, ctx.niche)

  return NextResponse.json({
    ok: true,
    data: { generated, skipped_confirmed: locked.size, model: gen.model },
  })
}

// ---------------------------------------------------------------------------
// Context gathering (survey-only; upstream is omitted here — the generator
// degrades gracefully and the v1 generate route owns the upstream fetch).
// ---------------------------------------------------------------------------

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

  return { industry, niche, city, regions, competitors }
}
