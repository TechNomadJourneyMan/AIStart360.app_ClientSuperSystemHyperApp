import { NextRequest, NextResponse } from 'next/server'
import { chatWithOpenRouter, extractJson } from '@/lib/ai/openrouter'

/**
 * Financial Analyst for the GRI Calculator.
 * Uses OpenRouter (Claude Sonnet 4.5) if OPENROUTER_API_KEY is set,
 * else returns a heuristic analysis.
 */

interface FinancialAnalystRequest {
  financialData: string
  scores: Record<string, number>
  lang: 'ru' | 'en'
  fileContent?: string
  fileName?: string
}

function buildStaticAnalysis(data: string, lang: 'ru' | 'en') {
  // Simple heuristic looking for numbers/keywords in the pasted data
  const hasRevenue = /revenue|выручк|доход/i.test(data)
  const hasLoss = /loss|убыт|отрицат/i.test(data)
  const hasGrowth = /growth|рост|\+\d+%/i.test(data)

  const cashScore = hasLoss ? 3 : hasRevenue && hasGrowth ? 7 : 5
  const bmScore = hasGrowth ? 7 : 5

  if (lang === 'ru') {
    return {
      gri_updates: {
        cash_stability: {
          score: cashScore,
          justification: hasLoss
            ? 'Обнаружены признаки убытков в данных. Требуется ревизия расходов и работа с кассовым потоком.'
            : 'Базовая оценка на основе общих метрик. Для точного анализа подключите AI через ANTHROPIC_API_KEY.',
        },
        business_model: {
          score: bmScore,
          justification: hasGrowth
            ? 'Видны признаки роста выручки — модель демонстрирует масштабируемость.'
            : 'Модель работает, но нет явных признаков роста. Проверьте монетизацию и CAC/LTV.',
        },
      },
      extracted_metrics: {
        revenue_trend: hasGrowth ? 'Рост' : 'Нет данных',
        gross_margin: 'Нет данных',
        net_profit_margin: hasLoss ? 'Отрицательная' : 'Нет данных',
      },
      mckinsey_insights: [
        'Для детального анализа добавьте переменную окружения ANTHROPIC_API_KEY.',
        hasLoss
          ? 'Приоритет: стабилизация cash flow и сокращение непроизводительных расходов.'
          : 'Приоритет: зафиксировать юнит-экономику и масштабировать ROI-каналы.',
      ],
    }
  }

  return {
    gri_updates: {
      cash_stability: {
        score: cashScore,
        justification: hasLoss
          ? 'Signs of losses detected. Expense review and cash flow work required.'
          : 'Baseline score from overall metrics. For a precise analysis, set ANTHROPIC_API_KEY.',
      },
      business_model: {
        score: bmScore,
        justification: hasGrowth
          ? 'Revenue growth signals visible — model shows scalability.'
          : 'Model is running, but no clear growth. Review monetization and CAC/LTV.',
      },
    },
    extracted_metrics: {
      revenue_trend: hasGrowth ? 'Growth' : 'No data',
      gross_margin: 'No data',
      net_profit_margin: hasLoss ? 'Negative' : 'No data',
    },
    mckinsey_insights: [
      'For a detailed analysis, set the ANTHROPIC_API_KEY environment variable.',
      hasLoss
        ? 'Priority: stabilize cash flow and cut non-productive expenses.'
        : 'Priority: lock in unit economics and scale ROI-positive channels.',
    ],
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: FinancialAnalystRequest = await request.json()
    const { financialData, scores, lang } = body

    if (!financialData || typeof financialData !== 'string') {
      return NextResponse.json(
        { error: 'financialData is required and must be a string' },
        { status: 400 }
      )
    }
    if (!scores || typeof scores !== 'object') {
      return NextResponse.json({ error: 'scores is required' }, { status: 400 })
    }
    if (lang !== 'ru' && lang !== 'en') {
      return NextResponse.json({ error: "lang must be 'ru' or 'en'" }, { status: 400 })
    }

    const systemPrompt =
      lang === 'ru'
        ? `Вы — Старший Финансовый Аналитик (уровня McKinsey) и AI-агент платформы AIStart360. Ваша задача — проанализировать сырые финансовые данные и перевести их в оценки Growth Readiness Index.`
        : `You are a Senior Financial Analyst (McKinsey-level) and AI agent of the AIStart360 platform. Analyze raw financial data and translate it into Growth Readiness Index assessments.`

    const scoresDescription = Object.entries(scores)
      .map(([key, value]) => `${key}: ${value}/10`)
      .join('\n')

    const userPrompt = `Analyze the following financial data and return ONLY a JSON object with this exact structure:

{
  "gri_updates": {
    "cash_stability": { "score": <1-10>, "justification": "<brief>" },
    "business_model": { "score": <1-10>, "justification": "<brief>" }
  },
  "extracted_metrics": {
    "revenue_trend": "<Growth/Decline in % or 'No data'>",
    "gross_margin": "<% or 'No data'>",
    "net_profit_margin": "<% or 'No data'>"
  },
  "mckinsey_insights": ["<insight 1>", "<insight 2>"]
}

FINANCIAL DATA:
${financialData}

CURRENT GRI SCORES:
${scoresDescription}`

    const aiResponse = await chatWithOpenRouter({
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 2000,
      jsonMode: true,
    })

    if (aiResponse) {
      const parsed = extractJson(aiResponse)
      if (parsed) return NextResponse.json(parsed)
    }

    return NextResponse.json(buildStaticAnalysis(financialData, lang))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Financial analysis failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
