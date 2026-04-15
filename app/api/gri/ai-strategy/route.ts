import { NextRequest, NextResponse } from 'next/server'
import { chatWithOpenRouter } from '@/lib/ai/openrouter'

/**
 * AI Growth Strategy generator for the GRI Calculator.
 * Uses OpenRouter (Claude Sonnet 4.5) if OPENROUTER_API_KEY is set,
 * else falls back to a static template built from the scores.
 */

interface StrategyRequest {
  scores: Record<string, number>
  lang?: 'ru' | 'en'
  format?: 'default' | 'action_plan'
}

function buildStaticStrategy(scores: Record<string, number>, lang: 'ru' | 'en', format: string): string {
  const sorted = Object.entries(scores).sort((a, b) => a[1] - b[1])
  const weakest = sorted.slice(0, 3)
  const strongest = sorted.slice(-2).reverse()

  if (lang === 'ru') {
    const parts: string[] = []
    parts.push(`## ${format === 'action_plan' ? 'План действий' : 'AI Стратегия Роста'}\n`)
    parts.push(`### Критические зоны\n`)
    weakest.forEach(([cat, score]) => {
      parts.push(`**${cat}** (${score}/10)`)
      parts.push(`- Провести аудит процессов и выделить 2-3 приоритетные задачи`)
      parts.push(`- Назначить ответственного и зафиксировать дедлайн в 30 дней`)
      parts.push(`- Измерить результат в конце месяца и скорректировать подход\n`)
    })
    parts.push(`### Сильные стороны\n`)
    strongest.forEach(([cat, score]) => {
      parts.push(`**${cat}** (${score}/10) — используйте эту зону как фундамент для роста.\n`)
    })
    parts.push(`### Ожидаемый эффект на GRI\n`)
    parts.push(`При фокусе на 3 слабых зонах ожидаемый рост общего GRI +1.5 балла за 90 дней.`)
    return parts.join('\n')
  }

  const parts: string[] = []
  parts.push(`## ${format === 'action_plan' ? 'Action Plan' : 'AI Growth Strategy'}\n`)
  parts.push(`### Critical zones\n`)
  weakest.forEach(([cat, score]) => {
    parts.push(`**${cat}** (${score}/10)`)
    parts.push(`- Audit current processes and pick 2-3 priority tasks`)
    parts.push(`- Assign an owner and set a 30-day deadline`)
    parts.push(`- Measure the outcome at month-end and adjust the approach\n`)
  })
  parts.push(`### Strengths\n`)
  strongest.forEach(([cat, score]) => {
    parts.push(`**${cat}** (${score}/10) — leverage this as a growth foundation.\n`)
  })
  parts.push(`### Expected GRI impact\n`)
  parts.push(`Focusing on the 3 weakest zones can yield +1.5 GRI points in 90 days.`)
  return parts.join('\n')
}

export async function POST(request: NextRequest) {
  try {
    const body: StrategyRequest = await request.json()
    const { scores, lang = 'ru', format = 'default' } = body

    if (!scores || typeof scores !== 'object') {
      return NextResponse.json({ error: 'scores is required' }, { status: 400 })
    }

    const scoresDescription = Object.entries(scores)
      .map(([category, score]) => `${category}: ${score}/10`)
      .join('\n')

    const systemPrompt = `You are a senior McKinsey-level strategy consultant. Analyze the provided GRI (Growth Readiness Index) scores and generate a concise, actionable growth strategy. ${lang === 'ru' ? 'Ответь на русском языке.' : 'Answer in English.'}

For each category with a score below 7, provide:
1. Root cause analysis (1-2 sentences)
2. Specific action steps (2-3 bullet points)
3. Expected impact on the overall GRI

Keep the response structured, professional, and actionable. Use markdown formatting.`

    const aiResponse = await chatWithOpenRouter({
      system: systemPrompt,
      user: `Analyze these GRI scores and generate a growth strategy:\n\n${scoresDescription}`,
      maxTokens: 2000,
    })

    const strategy = aiResponse ?? buildStaticStrategy(scores, lang, format)
    return NextResponse.json({ strategy })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate strategy'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
