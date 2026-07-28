export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'

const draftSchema = z.object({
  user_id: z.string().uuid(),
  company_id: z.string().min(1).nullable().optional(),
  current_step: z.number().int().min(1).max(6),
  answers: z.record(z.string(), z.unknown()),
})

const finalStepSchema = z.object({
  user_id: z.string().uuid(),
  company_id: z.string().min(1).nullable().optional(),
  step: z.number().int().min(1).max(6),
  answers: z.record(z.string(), z.object({ value: z.unknown() })),
})

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
}

// Returns finalized answers merged with the newest partial server draft.
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id')
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'user_id required' }, { status: 400 })
  }

  const sb = createServerClient()
  const [answersResult, progressResult] = await Promise.all([
    sb
      .from('survey_answers')
      .select('question_key,answer,step,answered_at')
      .eq('user_id', userId)
      .order('answered_at', { ascending: true }),
    sb
      .from('onboarding_progress')
      .select('company_id,current_step,completed_steps,draft_answers,version,completed_at,saved_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (answersResult.error || progressResult.error) {
    return NextResponse.json(
      { ok: false, error: answersResult.error?.message ?? progressResult.error?.message },
      { status: 500 },
    )
  }

  const finalizedAnswers: Record<string, unknown> = {}
  const finalizedSteps = new Set<number>()
  let finalizedSavedAt: string | null = null

  for (const row of answersResult.data ?? []) {
    finalizedAnswers[row.question_key] = (row.answer as { value: unknown }).value
    finalizedSteps.add(row.step)
    finalizedSavedAt = latestTimestamp(finalizedSavedAt, row.answered_at)
  }

  const progress = progressResult.data
  const completedSteps = [
    ...new Set<number>([
      ...finalizedSteps,
      ...((progress?.completed_steps ?? []) as number[]),
    ]),
  ].sort((a, b) => a - b)
  const draftAnswers = (progress?.draft_answers ?? {}) as Record<string, unknown>
  const derivedStep = Math.min(6, Math.max(1, ...completedSteps.map((step) => step + 1)))

  return NextResponse.json({
    ok: true,
    data: {
      answers: { ...finalizedAnswers, ...draftAnswers },
      finalized_answers: finalizedAnswers,
      completed_steps: completedSteps,
      current_step: progress?.current_step ?? derivedStep,
      company_id: progress?.company_id ?? null,
      version: progress?.version ?? 1,
      completed_at: progress?.completed_at ?? null,
      saved_at: latestTimestamp(finalizedSavedAt, progress?.saved_at),
    },
  })
}

// Saves a partial draft without marking the current step complete.
export async function PATCH(req: NextRequest) {
  const parsed = draftSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    )
  }

  const sb = createServerClient()
  const savedAt = new Date().toISOString()
  const { data: existing, error: readError } = await sb
    .from('onboarding_progress')
    .select('completed_steps,version')
    .eq('user_id', parsed.data.user_id)
    .maybeSingle()

  if (readError) {
    return NextResponse.json({ ok: false, error: readError.message }, { status: 500 })
  }

  const { data, error } = await sb
    .from('onboarding_progress')
    .upsert(
      {
        user_id: parsed.data.user_id,
        company_id: parsed.data.company_id ?? null,
        current_step: parsed.data.current_step,
        completed_steps: existing?.completed_steps ?? [],
        draft_answers: parsed.data.answers,
        version: (existing?.version ?? 0) + 1,
        saved_at: savedAt,
      },
      { onConflict: 'user_id' },
    )
    .select('current_step,completed_steps,version,saved_at')
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data })
}

// Finalizes one validated step and updates resumable progress atomically from
// the application's point of view. Partial answers remain available as draft.
export async function POST(req: NextRequest) {
  const parsed = finalStepSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    )
  }

  const { user_id, company_id, step, answers } = parsed.data
  const sb = createServerClient()
  const answeredAt = new Date().toISOString()
  const rows = Object.entries(answers).map(([question_key, answer]) => ({
    user_id,
    company_id: company_id ?? null,
    step,
    question_key,
    answer,
    answered_at: answeredAt,
  }))

  const { error: answersError } = await sb
    .from('survey_answers')
    .upsert(rows, { onConflict: 'user_id,question_key' })
  if (answersError) {
    return NextResponse.json({ ok: false, error: answersError.message }, { status: 500 })
  }

  const { data: existing, error: progressReadError } = await sb
    .from('onboarding_progress')
    .select('completed_steps,draft_answers,version,completed_at')
    .eq('user_id', user_id)
    .maybeSingle()
  if (progressReadError) {
    return NextResponse.json({ ok: false, error: progressReadError.message }, { status: 500 })
  }

  const completedSteps = [
    ...new Set<number>([...((existing?.completed_steps ?? []) as number[]), step]),
  ].sort((a, b) => a - b)
  const rawAnswers = Object.fromEntries(
    Object.entries(answers).map(([key, answer]) => [key, answer.value]),
  )
  const { data: progress, error: progressError } = await sb
    .from('onboarding_progress')
    .upsert(
      {
        user_id,
        company_id: company_id ?? null,
        current_step: Math.min(6, step + 1),
        completed_steps: completedSteps,
        draft_answers: {
          ...((existing?.draft_answers ?? {}) as Record<string, unknown>),
          ...rawAnswers,
        },
        version: (existing?.version ?? 0) + 1,
        saved_at: answeredAt,
        completed_at: step === 6 ? answeredAt : existing?.completed_at ?? null,
      },
      { onConflict: 'user_id' },
    )
    .select('current_step,completed_steps,version,completed_at,saved_at')
    .single()

  if (progressError) {
    return NextResponse.json({ ok: false, error: progressError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: { saved: rows.length, progress } })
}
