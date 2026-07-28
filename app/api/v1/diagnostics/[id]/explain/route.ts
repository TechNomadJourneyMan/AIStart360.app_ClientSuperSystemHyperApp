export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { gateway } from '@ai-sdk/gateway'
import { generateObject } from 'ai'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase-server'
import type { DiagnosticAiAnalysis, QuickWin, Risk } from '@/types/onboarding'

const MODEL = process.env.AI_MODEL ?? 'anthropic/claude-sonnet-4.6'

const analysisSchema = z.object({
  executive_summary: z.string().min(20).max(1200),
  strengths: z.array(z.string().min(3).max(300)).max(5),
  risks: z.array(z.object({
    title: z.string().min(3).max(180),
    impact: z.string().min(3).max(400),
    evidence: z.array(z.string().min(2).max(240)).max(4),
  })).max(6),
  action_plan: z.array(z.object({
    action: z.string().min(3).max(300),
    owner: z.string().min(2).max(100),
    timeline: z.string().min(2).max(100),
    expected_result: z.string().min(3).max(300),
    evidence: z.array(z.string().min(2).max(240)).max(4),
  })).min(1).max(8),
  questions: z.array(z.string().min(3).max(260)).max(6),
})

type DiagnosticRow = {
  id: string
  user_id: string
  overall_score: number | null
  health_index: number | null
  stage: string | null
  finance_score: unknown
  marketing_score: unknown
  operations_score: unknown
  strategy_score: unknown
  sales_score: unknown
  risks: Risk[] | null
  insights: Array<{ text?: string; area?: string }> | null
  quick_wins: QuickWin[] | null
  data_gaps: Array<{ field?: string; impact?: string }> | null
}

function rulesFallback(diagnostic: DiagnosticRow): DiagnosticAiAnalysis {
  const risks = diagnostic.risks ?? []
  const quickWins = diagnostic.quick_wins ?? []
  const blockEntries = [
    ['Финансы', diagnostic.finance_score],
    ['Продажи', diagnostic.sales_score],
    ['Операции', diagnostic.operations_score],
    ['Маркетинг', diagnostic.marketing_score],
    ['Стратегия', diagnostic.strategy_score],
  ] as const
  const strengths = blockEntries
    .map(([label, value]) => ({ label, score: Number((value as { score?: number } | null)?.score) }))
    .filter((item) => Number.isFinite(item.score) && item.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => `${item.label}: ${Math.round(item.score)}/100 по подтверждённым ответам анкеты.`)

  const actionPlan = quickWins.slice(0, 6).map((item) => ({
    action: item.action,
    owner: 'Владелец бизнеса',
    timeline: item.timeline || '30 дней',
    expected_result: `Снизить риск в направлении «${item.area}» и зафиксировать измеримый результат.`,
    evidence: [`Рекомендация детерминированного расчёта Point A: ${item.area}`],
  }))

  if (actionPlan.length === 0) {
    actionPlan.push({
      action: 'Проверить полноту исходных данных и повторить диагностику',
      owner: 'Владелец бизнеса',
      timeline: '7 дней',
      expected_result: 'Получить подтверждённую базовую оценку для плана улучшений.',
      evidence: ['В текущем расчёте недостаточно быстрых действий.'],
    })
  }

  return {
    executive_summary:
      `Индекс готовности компании — ${diagnostic.overall_score ?? 'не определён'}/100. ` +
      'Рекомендации ниже собраны по правилам Point A и не изменяют исходные оценки.',
    strengths,
    risks: risks.slice(0, 6).map((risk) => ({
      title: risk.text,
      impact: risk.impact,
      evidence: [`Направление: ${risk.area}`, `Уровень: ${risk.level}`],
    })),
    action_plan: actionPlan,
    questions: (diagnostic.data_gaps ?? []).slice(0, 5).map(
      (gap) => `Уточните «${gap.field ?? 'недостающий показатель'}»: ${gap.impact ?? 'это повысит точность диагностики'}.`,
    ),
    source: 'rules',
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const admin = createServerClient()
  const { data, error } = await admin
    .from('diagnostics')
    .select(`
      id,user_id,overall_score,health_index,stage,
      finance_score,marketing_score,operations_score,strategy_score,sales_score,
      risks,insights,quick_wins,data_gaps
    `)
    .eq('id', params.id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Диагностика не найдена' }, { status: 404 })
  }

  const diagnostic = data as DiagnosticRow
  const fallback = rulesFallback(diagnostic)
  let analysis = fallback
  let status: 'completed' | 'fallback' = 'fallback'
  let model = 'deterministic-rules-v1'
  let aiError: string | null = null

  if (process.env.AI_GATEWAY_API_KEY) {
    try {
      const context = JSON.stringify({
        scores: {
          overall: diagnostic.overall_score,
          health: diagnostic.health_index,
          stage: diagnostic.stage,
          finance: diagnostic.finance_score,
          sales: diagnostic.sales_score,
          operations: diagnostic.operations_score,
          marketing: diagnostic.marketing_score,
          strategy: diagnostic.strategy_score,
        },
        risks: diagnostic.risks,
        insights: diagnostic.insights,
        quick_wins: diagnostic.quick_wins,
        data_gaps: diagnostic.data_gaps,
      }).slice(0, 24_000)

      const generated = await generateObject({
        model: gateway(MODEL),
        schema: analysisSchema,
        system: `Ты — бизнес-консультант AIStart360. Объясняй только предоставленный детерминированный расчёт Point A.
Не изменяй и не пересчитывай оценки. Не придумывай цифры, факты, рынок или документы.
Каждый риск и действие связывай с evidence из контекста. Если данных мало, сформулируй вопрос.
Пиши ясным деловым русским языком для владельца малого или среднего бизнеса.`,
        prompt: `Сформируй краткое управленческое объяснение и приоритетный план действий на 30–90 дней.\n\nДанные Point A:\n${context}`,
        maxRetries: 2,
        providerOptions: {
          gateway: { zeroDataRetention: true },
        },
      })
      analysis = { ...generated.object, source: 'ai' }
      status = 'completed'
      model = MODEL
    } catch (generationError) {
      aiError = generationError instanceof Error ? generationError.message.slice(0, 500) : 'AI generation failed'
    }
  } else {
    aiError = 'AI_GATEWAY_API_KEY is not configured'
  }

  const generatedAt = new Date().toISOString()
  const { error: updateError } = await admin
    .from('diagnostics')
    .update({
      ai_status: status,
      ai_analysis: analysis,
      ai_model: model,
      ai_generated_at: generatedAt,
      ai_error: aiError,
    })
    .eq('id', params.id)

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: { analysis, status, model, generated_at: generatedAt },
  })
}
