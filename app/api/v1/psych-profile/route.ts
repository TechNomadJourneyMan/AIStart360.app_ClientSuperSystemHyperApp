export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/api-error'
import { interpretStep10 } from '@/lib/psych/interpret'

/**
 * GET    /api/v1/psych-profile → { ok, consent, profile }
 * POST   /api/v1/psych-profile → (re)compute from Step-10 answers; needs consent
 * DELETE /api/v1/psych-profile → reset (delete the profile)
 *
 * Business/leadership profile, never clinical (spec 07). Highest-privacy data:
 * self-only RLS (migration 047), and computation is gated on an explicit
 * `psych_profile` consent. Cookie session only.
 */

async function hasConsent(sb: ReturnType<typeof createServerClient>, userId: string): Promise<boolean> {
  const { data } = await sb.from('user_consents').select('granted').eq('user_id', userId).eq('kind', 'psych_profile').maybeSingle()
  return !!data?.granted
}

export async function GET(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const consent = await hasConsent(sb, user.id)
  const { data } = await sb.from('founder_psych_profiles').select('result, updated_at').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ ok: true, consent, profile: data?.result ?? null, updatedAt: data?.updated_at ?? null })
}

export async function POST(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  if (await isRateLimitedKey(user.id, 'psych-post', { max: 20, windowMs: 60_000 })) {
    return NextResponse.json({ ok: false, error: 'Слишком часто. Попробуйте позже.' }, { status: 429 })
  }
  if (!(await hasConsent(sb, user.id))) {
    return NextResponse.json({ ok: false, error: 'consent_required', message: 'Нужно согласие на психопрофиль.' }, { status: 403 })
  }

  // Read the existing Step-10 answers (s10_*) from the survey.
  const { data: rows } = await sb.from('survey_answers').select('question_key, answer').eq('user_id', user.id).like('question_key', 's10_%')
  const answers: Record<string, unknown> = {}
  for (const r of (rows ?? []) as Array<{ question_key: string; answer: unknown }>) {
    answers[r.question_key] = (r.answer as { value?: unknown } | null)?.value ?? r.answer
  }

  const interpretation = interpretStep10(answers)
  const result = { version: 1, source: 'step10', ...interpretation, computed_at: new Date().toISOString() }

  const { error } = await sb.from('founder_psych_profiles').upsert(
    { user_id: user.id, version: 1, answers, result, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  return NextResponse.json({ ok: true, profile: result })
}

export async function DELETE(_req: NextRequest) {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { error } = await sb.from('founder_psych_profiles').delete().eq('user_id', user.id)
  if (error) return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  return NextResponse.json({ ok: true })
}
