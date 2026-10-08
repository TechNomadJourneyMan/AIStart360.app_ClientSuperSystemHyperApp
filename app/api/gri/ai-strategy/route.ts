import { NextRequest, NextResponse } from 'next/server'
import { chatWithOpenRouter } from '@/lib/ai/openrouter'
import { createServerClient } from '@/lib/supabase-server'
import { isRateLimitedKey } from '@/lib/rate-limit'
import { guardAiBudget } from '@/lib/ai/budget'
import { safeErrorMessage } from '@/lib/api-error'
import { hasAllScores, knownScores } from '@/lib/gri-calculator/assessment-seed'

/**
 * AI Growth Strategy generator for the GRI Calculator (OpenRouter).
 *
 * The strategy is the model's or nothing: when the model gives no answer
 * (no key, provider error, timeout, budget spent) the route answers 503
 * AI_UNAVAILABLE instead of a template dressed up as AI output with an
 * invented forecast.
 */

interface StrategyRequest {
  scores: unknown
  lang?: 'ru' | 'en'
  format?: 'default' | 'action_plan'
}

const AI_UNAVAILABLE = {
  ru: 'ИИ-стратегия сейчас недоступна (модель не ответила или исчерпан лимит). Попробуйте позже.',
  en: 'The AI strategy is unavailable right now (the model did not answer or the limit is spent). Try again later.',
}

export async function POST(request: NextRequest) {
  try {
    // BE-01: this fires paid Claude Sonnet calls and is only invoked from the
    // authenticated GRI Calculator (app/(dashboard)/gri). Require a Supabase
    // session and throttle PER USER — anonymous / IP-only is bypassable via IP
    // rotation to run up the model budget.
    const sb = createServerClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (await isRateLimitedKey(user.id, 'gri-ai-strategy', { max: 6, windowMs: 60_000 })) {
      return NextResponse.json({ error: 'Слишком много запросов. Попробуйте через минуту.' }, { status: 429 })
    }
    const overBudget = await guardAiBudget(user.id, 'gri_ai_strategy')
    if (overBudget) return overBudget

    const body: StrategyRequest = await request.json()
    const lang: 'ru' | 'en' = body.lang === 'en' ? 'en' : 'ru'
    // Only the seven categories with 0–10 values reach the prompt; the
    // strategy needs all of them (no template values filling the gaps).
    const scores = knownScores(body.scores)
    if (!hasAllScores(scores)) {
      return NextResponse.json({ error: 'Нужны оценки GRI по всем 7 категориям' }, { status: 400 })
    }

    const scoresDescription = Object.entries(scores)
      .map(([category, score]) => `${category}: ${score}/10`)
      .join('\n')

    const systemPrompt = `You are a senior McKinsey-level strategy consultant. Analyze the provided GRI (Growth Readiness Index) scores and generate a concise, actionable growth strategy. ${lang === 'ru' ? 'Ответь на русском языке.' : 'Answer in English.'}

For each category with a score below 7, provide:
1. Root cause analysis (1-2 sentences)
2. Specific action steps (2-3 bullet points)
3. Expected effect in words (which other categories it supports). Do not give numeric forecasts of GRI points, revenue or timelines — there is no data behind such numbers.

Keep the response structured, professional, and actionable. Use markdown formatting.`

    const aiResponse = await chatWithOpenRouter({
      feature: 'gri_ai_strategy',
      label: 'gri.ai_strategy',
      system: systemPrompt,
      user: `Analyze these GRI scores and generate a growth strategy:\n\n${scoresDescription}`,
      maxTokens: 2000,
    })

    if (!aiResponse || !aiResponse.trim()) {
      return NextResponse.json({ error: AI_UNAVAILABLE[lang], code: 'AI_UNAVAILABLE' }, { status: 503 })
    }
    return NextResponse.json({ strategy: aiResponse })
  } catch (error) {
    // BE-09: never return the raw error to the client in production.
    return NextResponse.json({ error: safeErrorMessage(error, 'Не удалось сгенерировать стратегию') }, { status: 500 })
  }
}
