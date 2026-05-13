export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/ai-questions/generate
 *
 * Asks Sonnet to generate 3-6 clarifying questions tailored to gaps in
 * the user's data. Context fed to the model:
 *   - profile (full_name, organization, vertical, status)
 *   - branding.goals (current/1y/3y if set)
 *   - medical totals (patients, ltv, sleeping, loss) when vertical='medical'
 *   - existing survey_answers (so we don't re-ask what's already known)
 *
 * Persists generated array into profiles.branding.ai_questions and returns it.
 * Cost: ~$0.015 per call (Sonnet, ~3-5k tokens roundtrip).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import { CLAUDE_MODELS } from '@/lib/ai/anthropic'
import { extractWithCache } from '@/lib/ai/prompt-cache'

const QUESTION_SCHEMA = z.object({
  questions: z.array(z.object({
    category: z.enum(['финансы', 'продажи', 'клиенты', 'операции', 'маркетинг', 'стратегия', 'команда']),
    question: z.string().max(280),
    context: z.string().max(200),
  })).min(3).max(6),
})

const SYSTEM_PROMPT = `Ты бизнес-консультант платформы AIStart360. Твоя задача — сформулировать 3-6 коротких уточняющих вопросов для владельца бизнеса.

Цель вопросов — заполнить пробелы в Точке А (текущей диагностике), чтобы AI смог точнее оценить разрыв до целей и предложить рычаги роста.

Правила:
- Каждый вопрос должен быть конкретным, измеримым, отвечаемым ОДНИМ числом или коротким текстом.
- Не задавай вопросы которые ВИДНО из контекста (например если вертикаль медицина и есть 2745 пациентов — не спрашивай "сколько у вас клиентов").
- Фокус на: маржа, CAC, retention, средний цикл повторной покупки, NPS, время отклика, no-show rate, marketing channels.
- Категория — одна из: финансы, продажи, клиенты, операции, маркетинг, стратегия, команда.
- context — одно короткое предложение ПОЧЕМУ это важно для расчёта рычагов роста.

Верни строгий JSON.`

function srBase() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  }
}

interface Profile {
  full_name?: string | null
  organization?: string | null
  vertical?: string | null
  status?: string | null
  branding?: Record<string, unknown> | null
}

export async function POST() {
  const sb = createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })

  const { url, key } = srBase()

  // Read context: profile + survey answers + (medical) totals
  const [profRes, survRes, segRes] = await Promise.all([
    fetch(`${url}/rest/v1/profiles?id=eq.${user.id}&select=full_name,organization,vertical,status,branding`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store',
    }),
    fetch(`${url}/rest/v1/survey_answers?user_id=eq.${user.id}&select=question_key,answer&limit=200`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store',
    }),
    fetch(`${url}/rest/v1/patient_segments?client_id=eq.${user.id}&select=monetary_kzt,frequency,recency_days&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store',
    }),
  ])

  const profiles = profRes.ok ? (await profRes.json()) as Profile[] : []
  const profile = profiles[0] ?? null
  const answers = survRes.ok ? (await survRes.json()) as Array<{ question_key: string; answer: { value?: string } | null }> : []
  const hasMedical = segRes.ok && ((await segRes.json()) as unknown[]).length > 0

  // Build context string for Sonnet
  const contextLines: string[] = []
  if (profile?.organization) contextLines.push(`Компания: ${profile.organization}`)
  if (profile?.vertical) contextLines.push(`Вертикаль: ${profile.vertical}`)
  if (hasMedical) contextLines.push('AI-аудит медицинской базы пациентов проведён (есть patient_segments).')

  const goals = (profile?.branding as { goals?: { current_revenue_monthly_kzt?: number; goal_1y_monthly_kzt?: number; goal_3y_monthly_kzt?: number } } | null)?.goals
  if (goals) {
    if (goals.current_revenue_monthly_kzt) contextLines.push(`Факт выручки/мес: ${goals.current_revenue_monthly_kzt} ₸`)
    if (goals.goal_1y_monthly_kzt) contextLines.push(`Цель 12 мес: ${goals.goal_1y_monthly_kzt} ₸/мес`)
    if (goals.goal_3y_monthly_kzt) contextLines.push(`Цель 3 года: ${goals.goal_3y_monthly_kzt} ₸/мес`)
  }
  if (answers.length > 0) {
    const filled = answers
      .filter((a) => (a.answer?.value ?? '').toString().trim().length > 0)
      .map((a) => `- ${a.question_key}: ${(a.answer?.value ?? '').toString().slice(0, 80)}`)
      .slice(0, 30)
    if (filled.length > 0) {
      contextLines.push('Уже заполнено в анкете:')
      contextLines.push(...filled)
    }
  }

  const userPrompt = contextLines.length > 0
    ? contextLines.join('\n')
    : 'Юзер только зарегистрировался, данных почти нет. Задай базовые установочные вопросы про выручку, число клиентов, основной канал привлечения.'

  try {
    const result = await extractWithCache({
      model: CLAUDE_MODELS.sonnet,
      schema: QUESTION_SCHEMA,
      schemaName: 'ai_clarifying_questions',
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 1200,
    })

    const now = new Date().toISOString()
    const questions = result.data.questions.map((q, idx) => ({
      id: `q_${Date.now()}_${idx}`,
      category: q.category,
      question: q.question,
      context: q.context,
      status: 'pending' as const,
      answer: null,
      generated_at: now,
      answered_at: null,
    }))

    // Persist into profiles.branding.ai_questions (replaces existing)
    const existingBranding = (profile?.branding ?? {}) as Record<string, unknown>
    const newBranding = { ...existingBranding, ai_questions: questions }
    const patchRes = await fetch(`${url}/rest/v1/profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ branding: newBranding }),
    })
    if (!patchRes.ok) {
      return NextResponse.json({ ok: false, error: 'write_failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, questions })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ai-questions/generate] error', msg)
    return NextResponse.json({ ok: false, error: 'generation_failed' }, { status: 500 })
  }
}
