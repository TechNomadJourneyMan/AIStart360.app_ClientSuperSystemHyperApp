import { generateObject } from 'ai'
import { z } from 'zod'
import { anthropic, CLAUDE_MODELS } from './anthropic'
import type { PointA, PointB, Company, GapItem } from '@/types/onboarding'

/**
 * Point B AI Analyzer — Bridges the gap between Current (A) and Target (B)
 */

const pointBAISchema = z.object({
  strategic_bridge_summary: z.string().describe('Обзор перехода из Точки А в Точку Б (3-5 предложений)'),
  gap_analysis: z.array(z.object({
    title: z.string().describe('Область разрыва (например, "Финансовая прозрачность")'),
    gap: z.string().describe('В чем именно заключается разрыв'),
    action: z.string().describe('Конкретное действие для закрытия'),
    priority_level: z.enum(['Приоритет 1', 'Приоритет 2', 'Приоритет 3']),
    icon: z.string().describe('Material Symbol Name (e.g. "priority_high", "group", "automation")'),
    color: z.enum(['primary', 'error', 'tertiary-container'])
  })).length(3),
  milestones: z.array(z.object({
    q: z.string().describe('Квартал (например, Q2 2026)'),
    title: z.string().describe('Заголовок вехи'),
    desc: z.string().describe('Описание достижений'),
    icon: z.string().describe('Material Symbol Name'),
    status: z.enum(['current', 'planned', 'future'])
  })).length(4)
})

export async function analyzePointB(
  answers: Record<string, unknown>,
  pointA: PointA,
  pointBBase: PointB,
  company: Company | null
): Promise<Partial<PointB> | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[point-b-analyzer] No ANTHROPIC_API_KEY — skipping AI bridge analysis')
    return null
  }

  try {
    const prompt = `
Анализируй переход компании из Точки А (Текущее состояние) в Точку Б (Целевое состояние).

--- КОМПАНИЯ ---
Название: ${company?.name || answers['s1_company_name']}
Отрасль: ${company?.industry || answers['s1_industry']}
Стадия: ${pointA.stage} (GRI: ${pointA.overall_score}/100)

--- ТОЧКА А (ГДЕ МЫ СЕЙЧАС) ---
Финансы: ${pointA.blocks.finance.score}/100. Проблемы: ${pointA.blocks.finance.top_issues.join(', ')}
Продажи: ${pointA.blocks.sales.score}/100. Проблемы: ${pointA.blocks.sales.top_issues.join(', ')}
Операции: ${pointA.blocks.operations.score}/100. Проблемы: ${pointA.blocks.operations.top_issues.join(', ')}
Риски: ${pointA.risks.map(r => r.text).join('; ')}

--- ТОЧКА Б (КУДА МЫ ИДЕМ - ЦЕЛИ) ---
Цель на 12 месяцев: ${answers['s6_goal_12months']}
Цель на 3 года: ${answers['s6_goal_3years']}
Проекция выручки 2025: ${pointBBase.targets.find(t => t.label.includes('доход'))?.value}
Целевой GRI: 85+ (Excellent)

--- ЗАДАЧА ---
Сгенерируй Gap-анализ и Дорожную карту (milestones).
Будь предельно конкретен. Если в Точке А нет CRM — в Gap-анализе должен быть пункт про CRM. 
Если цель — рост в 2 раза, в Roadmap должны быть шаги по масштабированию маркетинга.
Язык: Русский.
`

    const { object } = await generateObject({
      model: anthropic(CLAUDE_MODELS.sonnet),
      schema: pointBAISchema,
      system: `Ты — ведущий стратег AIStart360. Твоя роль — построить мост между текущим хаосом (Точка А) и масштабируемым бизнесом (Точка Б).
Используй данные скоринга Точки А для выявления реальных препятствий.`,
      prompt,
    })

    return {
      gap_analysis: object.gap_analysis.map(g => ({
        label: g.priority_level,
        title: g.title,
        gap: g.gap,
        action: g.action,
        icon: g.icon,
        color: g.color as any
      })),
      milestones: object.milestones
    }
  } catch (error) {
    console.error('[point-b-analyzer] AI bridge analysis failed:', error)
    return null
  }
}
