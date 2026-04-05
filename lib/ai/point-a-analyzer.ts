import { generateObject } from 'ai'
import { z } from 'zod'
import { anthropic, CLAUDE_MODELS } from './anthropic'
import type { PointA, AIAnalysis, Company } from '@/types/onboarding'

// ─── Zod schema for structured AI output ─────────────────────────────────────

const aiBlockSchema = z.object({
  diagnosis: z.string().describe('2-3 предложения: что показывают данные по этому блоку'),
  benchmark_comparison: z.string().describe('Сравнение с типичными показателями отрасли/стадии в Казахстане/СНГ'),
  key_risk: z.string().describe('Главный риск в этом блоке'),
  top_recommendation: z.string().describe('Конкретная рекомендация с цифрами и сроками'),
})

const aiAnalysisSchema = z.object({
  executive_summary: z.string().describe('3-5 предложений: общая картина бизнеса, сильные стороны и ключевые проблемы'),
  blocks: z.object({
    finance: aiBlockSchema,
    sales: aiBlockSchema,
    operations: aiBlockSchema,
    marketing: aiBlockSchema,
    strategy: aiBlockSchema,
  }),
  strategic_priorities: z.array(z.object({
    title: z.string().describe('Короткое название приоритета'),
    rationale: z.string().describe('Почему это приоритет — на основе данных'),
    expected_impact: z.string().describe('Ожидаемый эффект при реализации'),
  })).min(2).max(3).describe('Топ-3 стратегических приоритета'),
  growth_roadmap: z.array(z.object({
    horizon: z.enum(['30_days', '90_days', '180_days']),
    actions: z.array(z.string()).min(2).max(3).describe('Конкретные шаги'),
  })).length(3).describe('Дорожная карта: 30, 90 и 180 дней'),
  industry_context: z.string().describe('Отраслевой контекст: бенчмарки, тренды, позиция компании на рынке'),
})

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(
  answers: Record<string, unknown>,
  pointA: PointA,
  company: Company | null
): string {
  const get = (key: string) => {
    const v = answers[key]
    if (v === null || v === undefined) return '—'
    if (Array.isArray(v)) return v.join(', ')
    return String(v)
  }
  const num = (key: string) => {
    const v = answers[key]
    return typeof v === 'number' ? v : 0
  }

  const revGrowth = num('s2_revenue_2023') > 0
    ? (((num('s2_revenue_2024') - num('s2_revenue_2023')) / num('s2_revenue_2023')) * 100).toFixed(1)
    : '—'
  const ltvCac = num('s2_cac') > 0
    ? (num('s2_ltv') / num('s2_cac')).toFixed(1)
    : '—'

  const repeatRate2024 = (num('s2_new_clients_2024') + num('s2_repeat_clients_2024')) > 0
    ? ((num('s2_repeat_clients_2024') / (num('s2_new_clients_2024') + num('s2_repeat_clients_2024'))) * 100).toFixed(1)
    : '—'

  const rejectionRate = (num('s3_deals_2024') + num('s3_rejections_2024')) > 0
    ? ((num('s3_rejections_2024') / (num('s3_deals_2024') + num('s3_rejections_2024'))) * 100).toFixed(1)
    : '—'

  const blockStatus = (score: number) => {
    if (score >= 85) return 'Отлично'
    if (score >= 70) return 'Сильно'
    if (score >= 50) return 'Средне'
    if (score >= 30) return 'Слабо'
    return 'Критично'
  }

  return `Вот данные компании и результаты правилового скоринга. Проведи глубокий анализ.

--- КОМПАНИЯ ---
Название: ${company?.name || get('s1_company_name')}
Отрасль: ${company?.industry || get('s1_industry')}
Стадия: ${company?.stage || get('s1_stage')}
Сотрудников: ${get('s1_employee_count')}
Бизнес-модель: ${company?.business_model || get('s1_business_model')}
География: ${get('s1_regions')}
Год основания: ${get('s1_founded_at')}

--- ФИНАНСЫ (${pointA.blocks.finance.score}/100 — ${blockStatus(pointA.blocks.finance.score)}) ---
Выручка: 2023: ${get('s2_revenue_2023')} ₸ → 2024: ${get('s2_revenue_2024')} ₸ → 2025: ${get('s2_revenue_2025')} ₸
Рост YoY (2023→2024): ${revGrowth}%
Новые клиенты: 2023: ${get('s2_new_clients_2023')}, 2024: ${get('s2_new_clients_2024')}, 2025: ${get('s2_new_clients_2025')}
Повторные клиенты: 2023: ${get('s2_repeat_clients_2023')}, 2024: ${get('s2_repeat_clients_2024')}, 2025: ${get('s2_repeat_clients_2025')}
Средний чек: ${get('s2_avg_check')} ₸
Маржинальность: ${get('s2_gross_margin')}%
CAC: ${get('s2_cac')} ₸, LTV: ${get('s2_ltv')} ₸, LTV/CAC: ${ltvCac}
Долговая нагрузка: ${get('s2_debt_load')}
Знает точку безубыточности: ${get('s2_knows_breakeven')}

--- ПРОДАЖИ (${pointA.blocks.sales.score}/100 — ${blockStatus(pointA.blocks.sales.score)}) ---
CRM: ${get('s3_has_crm')}
Продукты: ${get('s3_products_description')} (${get('s3_product_count')} шт.)
Продукт-локомотив: ${get('s3_flagship_product')}
Сделки: 2023: ${get('s3_deals_2023')}, 2024: ${get('s3_deals_2024')}, 2025: ${get('s3_deals_2025')}
Отказы: 2023: ${get('s3_rejections_2023')}, 2024: ${get('s3_rejections_2024')}, 2025: ${get('s3_rejections_2025')}
Процент отказов (2024): ${rejectionRate}%
Доля повторных клиентов (2024): ${repeatRate2024}%
Цикл сделки: ${get('s3_deal_cycle_days')} дней
Каналы продвижения: ${get('s3_promo_channels')}
Программа лояльности: ${get('s3_has_loyalty')}

--- ОПЕРАЦИИ (${pointA.blocks.operations.score}/100 — ${blockStatus(pointA.blocks.operations.score)}) ---
Отделов: ${get('s4_dept_count')}
Оргструктура: ${get('s4_has_org_chart')}
Метод управления: ${get('s4_management_method')}
Регулярные совещания: ${get('s4_has_regular_meetings')}
Инструмент отчётности: ${get('s4_reporting_tool')}
Таск-менеджер: ${get('s4_task_manager')}
KPI по отделам: ${get('s4_has_dept_kpi')}

--- МАРКЕТИНГ (${pointA.blocks.marketing.score}/100 — ${blockStatus(pointA.blocks.marketing.score)}) ---
Целевая аудитория: ${get('s5_target_audience')}
Сегменты: ${get('s5_audience_segments')}
Топ-регионы: ${get('s5_top_regions')}
Каналы маркетинга: ${get('s5_marketing_channels')}
Бюджет маркетинга: ${get('s5_marketing_budget_pct')}% от выручки
Анализ конкурентов: ${get('s5_has_competitor_analysis')}
Конкуренты: ${get('s5_competitor_1')}, ${get('s5_competitor_2')}, ${get('s5_competitor_3')}
УТП: ${get('s5_usp')}

--- СТРАТЕГИЯ (${pointA.blocks.strategy.score}/100 — ${blockStatus(pointA.blocks.strategy.score)}) ---
Главная боль: ${get('s6_main_pain')}
Цель на 12 месяцев: ${get('s6_goal_12months')}
Цель на 3 года: ${get('s6_goal_3years')}
Барьеры роста: ${get('s6_growth_blockers')}
Ожидания от платформы: ${get('s6_expectations')}

--- ПРАВИЛОВЫЙ СКОРИНГ (итог) ---
Общий балл: ${pointA.overall_score}/100
Индекс здоровья: ${pointA.health_index}/100
Стадия: ${pointA.stage}
Риски: ${pointA.risks.map(r => `[${r.level}] ${r.area}: ${r.text}`).join('; ')}
Пробелы в данных: ${pointA.data_gaps.map(g => g.field).join(', ') || 'нет'}

--- ЗАДАЧА ---
Сгенерируй структурированный анализ Точки А для этой компании.
Будь конкретен: используй цифры из данных, сравнивай с реальными бенчмарками для отрасли "${company?.industry || get('s1_industry')}" и стадии "${company?.stage || get('s1_stage')}" в Казахстане/СНГ.
Рекомендации должны быть действенными, с конкретными шагами, инструментами и сроками.`
}

// ─── Main analyzer function ──────────────────────────────────────────────────

export async function analyzePointA(
  answers: Record<string, unknown>,
  pointA: PointA,
  company: Company | null,
): Promise<AIAnalysis | null> {
  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[point-a-analyzer] No ANTHROPIC_API_KEY — skipping AI analysis')
    return null
  }

  try {
    const prompt = buildPrompt(answers, pointA, company)

    const { object } = await generateObject({
      model: anthropic(CLAUDE_MODELS.sonnet),
      schema: aiAnalysisSchema,
      system: `Ты — старший бизнес-консультант платформы AIStart360 (Казахстан).
Анализируешь данные компании из 6 блоков онбординг-анкеты и результаты автоматического скоринга.
Отвечай строго на русском языке. Будь конкретен — используй цифры из данных, не общие фразы.
Сравнивай с реальными бенчмарками для отрасли и стадии развития в Казахстане/СНГ.
Рекомендации должны быть actionable: с конкретными инструментами, метриками и сроками.
Не повторяй то, что уже сказал правиловый скоринг — добавляй ценность через контекст, связи между метриками и стратегический взгляд.`,
      prompt,
    })

    return {
      ...object,
      // Normalize blocks to Record<string, AIBlockAnalysis>
      blocks: object.blocks as unknown as Record<string, import('@/types/onboarding').AIBlockAnalysis>,
      model_used: CLAUDE_MODELS.sonnet,
      generated_at: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[point-a-analyzer] AI analysis failed:', error)
    return null
  }
}
