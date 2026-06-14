export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import {
  BLOCKS,
  isValidQuestionKey,
  TOTAL_QUESTIONS,
} from '@/lib/market-analysis/questions'
import {
  loadAnswers,
  loadLatestSnapshot,
  rebuildSnapshot,
  upsertAnswer,
  type AnswerRecord,
} from '@/lib/market-analysis/persist'

// =============================================================================
// GET /api/v1/market-analysis
// Returns the 6 blocks with each question's current answer (or null), overall
// progress, and the latest derived snapshot.
// =============================================================================
export async function GET() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

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

  const snapshot = await loadLatestSnapshot(sb, userId)

  return NextResponse.json({
    ok: true,
    data: {
      blocks,
      progress: { answered, confirmed, total: TOTAL_QUESTIONS },
      snapshot: snapshot ?? null,
    },
  })
}

// =============================================================================
// PATCH /api/v1/market-analysis
// Body: { question_key, action: 'confirm' | 'dispute' | 'edit', text? }
//   - edit:    requires text → upsert { source:'user', status:'confirmed' }
//   - confirm: flips existing draft → confirmed
//   - dispute: status → disputed
// After any mutation the snapshot is rebuilt (best-effort).
// =============================================================================
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  const { question_key, action, text } = body as {
    question_key?: unknown
    action?: unknown
    text?: unknown
  }

  if (typeof question_key !== 'string' || !isValidQuestionKey(question_key)) {
    return NextResponse.json({ ok: false, error: 'invalid_question_key' }, { status: 400 })
  }
  if (action !== 'confirm' && action !== 'dispute' && action !== 'edit') {
    return NextResponse.json({ ok: false, error: 'invalid_action' }, { status: 400 })
  }

  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  // Staff (admin / expert / manager / analyst / super_admin) edits are saved with
  // source 'expert' so the checklist can surface them as expert-authored insights.
  // Clients (and missing profiles) fall back to 'user'.
  const STAFF_ROLES = new Set(['admin', 'expert', 'manager', 'analyst', 'super_admin'])
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  const profileRole = typeof profile?.role === 'string' ? profile.role : null
  const editSource: 'user' | 'expert' =
    profileRole && STAFF_ROLES.has(profileRole) ? 'expert' : 'user'

  if (action === 'edit') {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ ok: false, error: 'text_required' }, { status: 400 })
    }
    const res = await upsertAnswer(sb, userId, {
      question_key,
      answer_text: text.trim(),
      source: editSource,
      status: 'confirmed',
      confidence: null,
      model: null,
    })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 500 })
    }
  } else {
    // confirm / dispute require an existing answer row to flip.
    const { data: existing, error: exErr } = await sb
      .from('market_analysis_answers')
      .select('id, status')
      .eq('user_id', userId)
      .eq('question_key', question_key)
      .maybeSingle()
    if (exErr) {
      return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'answer_not_found' }, { status: 404 })
    }

    const nextStatus = action === 'confirm' ? 'confirmed' : 'disputed'
    const { error: updErr } = await sb
      .from('market_analysis_answers')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('question_key', question_key)
    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })
    }
  }

  // Rebuild the derived snapshot (best-effort — never blocks the mutation).
  await rebuildSnapshot(sb, userId)

  return NextResponse.json({ ok: true, data: { question_key, action } })
}
