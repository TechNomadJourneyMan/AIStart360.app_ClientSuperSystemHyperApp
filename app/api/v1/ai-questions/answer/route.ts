export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/ai-questions/answer
 * Body: { question_id: string, answer: string }
 *
 * Updates a single question's status to 'answered' and saves the text.
 * Stored in profiles.branding.ai_questions[].
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

interface AiQuestion {
  id: string
  category: string
  question: string
  context: string
  status: 'pending' | 'answered'
  answer?: string | null
  generated_at: string
  answered_at?: string | null
}

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

export async function POST(req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

  let body: { question_id?: string; answer?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }
  const questionId = (body.question_id ?? '').toString()
  const answerText = (body.answer ?? '').toString().trim().slice(0, 2000)
  if (!questionId) return NextResponse.json({ ok: false, error: 'question_id required' }, { status: 400 })

  const { url, key } = srBase()
  const profRes = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}&select=branding`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!profRes.ok) return NextResponse.json({ ok: false, error: 'profile_read_failed' }, { status: 500 })
  const rows = (await profRes.json()) as Array<{ branding: { ai_questions?: AiQuestion[] } | null }>
  const branding = (rows[0]?.branding ?? {}) as Record<string, unknown>
  const questions = ((branding.ai_questions ?? []) as AiQuestion[]).slice()

  const idx = questions.findIndex((q) => q.id === questionId)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'question_not_found' }, { status: 404 })

  questions[idx] = {
    ...questions[idx],
    answer: answerText,
    status: answerText.length > 0 ? 'answered' : 'pending',
    answered_at: answerText.length > 0 ? new Date().toISOString() : null,
  }

  const patchRes = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ branding: { ...branding, ai_questions: questions } }),
  })
  if (!patchRes.ok) return NextResponse.json({ ok: false, error: 'write_failed' }, { status: 500 })

  return NextResponse.json({ ok: true, question: questions[idx] })
}
