import { generateObject } from 'ai'
import { z } from 'zod'
import { anthropic, CLAUDE_MODELS } from './anthropic'
import type { PointA, AIAnalysis, Company } from '@/types/onboarding'

// ─── Zod schema for structured AI output ─────────────────────────────────────

const aiBlockSchema = z.object({
  diagnosis: z.string().describe('2-3 sentences: what the data shows for this block'),
  benchmark_comparison: z.string().describe('Comparison with typical industry/stage benchmarks in Kazakhstan/CIS'),
  key_risk: z.string().describe('Main risk in this block'),
  top_recommendation: z.string().describe('Specific recommendation with numbers and timelines'),
})

const aiAnalysisSchema = z.object({
  executive_summary: z.string().describe('3-5 sentences: overall business picture, strengths and key issues'),
  blocks: z.object({
    finance: aiBlockSchema,
    sales: aiBlockSchema,
    operations: aiBlockSchema,
    marketing: aiBlockSchema,
    strategy: aiBlockSchema,
  }),
  strategic_priorities: z.array(z.object({
    title: z.string().describe('Short priority title'),
    rationale: z.string().describe('Why this is a priority — based on data'),
    expected_impact: z.string().describe('Expected impact upon implementation'),
  })).min(2).max(3).describe('Top 3 strategic priorities'),
  growth_roadmap: z.array(z.object({
    horizon: z.enum(['30_days', '90_days', '180_days']),
    actions: z.array(z.string()).min(2).max(3).describe('Specific action steps'),
  })).length(3).describe('Roadmap: 30, 90, and 180 days'),
  industry_context: z.string().describe('Industry context: benchmarks, trends, company market position'),
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
    if (score >= 85) return 'Excellent'
    if (score >= 70) return 'Strong'
    if (score >= 50) return 'Average'
    if (score >= 30) return 'Weak'
    return 'Critical'
  }

  return `Here is the company data and rule-based scoring results. Conduct an in-depth analysis.

--- COMPANY ---
Name: ${company?.name || get('s1_company_name')}
Industry: ${company?.industry || get('s1_industry')}
Stage: ${company?.stage || get('s1_stage')}
Employees: ${get('s1_employee_count')}
Business Model: ${company?.business_model || get('s1_business_model')}
Geography: ${get('s1_regions')}
Year Founded: ${get('s1_founded_at')}

--- FINANCE (${pointA.blocks.finance.score}/100 — ${blockStatus(pointA.blocks.finance.score)}) ---
Revenue: 2023: ${get('s2_revenue_2023')} ₸ → 2024: ${get('s2_revenue_2024')} ₸ → 2025: ${get('s2_revenue_2025')} ₸
YoY Growth (2023→2024): ${revGrowth}%
New Clients: 2023: ${get('s2_new_clients_2023')}, 2024: ${get('s2_new_clients_2024')}, 2025: ${get('s2_new_clients_2025')}
Repeat Clients: 2023: ${get('s2_repeat_clients_2023')}, 2024: ${get('s2_repeat_clients_2024')}, 2025: ${get('s2_repeat_clients_2025')}
Average Check: ${get('s2_avg_check')} ₸
Gross Margin: ${get('s2_gross_margin')}%
CAC: ${get('s2_cac')} ₸, LTV: ${get('s2_ltv')} ₸, LTV/CAC: ${ltvCac}
Debt Load: ${get('s2_debt_load')}
Knows Breakeven Point: ${get('s2_knows_breakeven')}

--- SALES (${pointA.blocks.sales.score}/100 — ${blockStatus(pointA.blocks.sales.score)}) ---
CRM: ${get('s3_has_crm')}
Products: ${get('s3_products_description')} (${get('s3_product_count')} items)
Flagship Product: ${get('s3_flagship_product')}
Deals: 2023: ${get('s3_deals_2023')}, 2024: ${get('s3_deals_2024')}, 2025: ${get('s3_deals_2025')}
Rejections: 2023: ${get('s3_rejections_2023')}, 2024: ${get('s3_rejections_2024')}, 2025: ${get('s3_rejections_2025')}
Rejection Rate (2024): ${rejectionRate}%
Repeat Client Rate (2024): ${repeatRate2024}%
Deal Cycle: ${get('s3_deal_cycle_days')} days
Promotion Channels: ${get('s3_promo_channels')}
Loyalty Program: ${get('s3_has_loyalty')}

--- OPERATIONS (${pointA.blocks.operations.score}/100 — ${blockStatus(pointA.blocks.operations.score)}) ---
Departments: ${get('s4_dept_count')}
Org Chart: ${get('s4_has_org_chart')}
Management Method: ${get('s4_management_method')}
Regular Meetings: ${get('s4_has_regular_meetings')}
Reporting Tool: ${get('s4_reporting_tool')}
Task Manager: ${get('s4_task_manager')}
Department KPIs: ${get('s4_has_dept_kpi')}

--- MARKETING (${pointA.blocks.marketing.score}/100 — ${blockStatus(pointA.blocks.marketing.score)}) ---
Target Audience: ${get('s5_target_audience')}
Segments: ${get('s5_audience_segments')}
Top Regions: ${get('s5_top_regions')}
Marketing Channels: ${get('s5_marketing_channels')}
Marketing Budget: ${get('s5_marketing_budget_pct')}% of revenue
Competitor Analysis: ${get('s5_has_competitor_analysis')}
Competitors: ${get('s5_competitor_1')}, ${get('s5_competitor_2')}, ${get('s5_competitor_3')}
USP: ${get('s5_usp')}

--- STRATEGY (${pointA.blocks.strategy.score}/100 — ${blockStatus(pointA.blocks.strategy.score)}) ---
Main Pain: ${get('s6_main_pain')}
12-Month Goal: ${get('s6_goal_12months')}
3-Year Goal: ${get('s6_goal_3years')}
Growth Blockers: ${get('s6_growth_blockers')}
Platform Expectations: ${get('s6_expectations')}

--- RULE-BASED SCORING (summary) ---
Overall Score: ${pointA.overall_score}/100
Health Index: ${pointA.health_index}/100
Stage: ${pointA.stage}
Risks: ${pointA.risks.map(r => `[${r.level}] ${r.area}: ${r.text}`).join('; ')}
Data Gaps: ${pointA.data_gaps.map(g => g.field).join(', ') || 'none'}

--- TASK ---
Generate a structured Point A analysis for this company.
Be specific: use numbers from the data, compare with real benchmarks for the "${company?.industry || get('s1_industry')}" industry and "${company?.stage || get('s1_stage')}" stage in Kazakhstan/CIS.
Recommendations must be actionable, with specific steps, tools, and timelines.`
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
      system: `You are a senior business consultant for the AIStart360 platform (Kazakhstan).
You analyze company data from 6 blocks of the onboarding survey and the results of automatic scoring.
Respond strictly in English. Be specific — use numbers from the data, not generic phrases.
Compare with real benchmarks for the industry and development stage in Kazakhstan/CIS.
Recommendations must be actionable: with specific tools, metrics, and timelines.
Do not repeat what the rule-based scoring already said — add value through context, cross-metric insights, and strategic perspective.`,
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
