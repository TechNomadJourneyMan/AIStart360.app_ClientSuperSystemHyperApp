import { z } from 'zod'
import { generateObjectViaOpenRouter } from './structured'
import { OPENROUTER_MODELS, hasOpenRouterKey } from './openrouter'
import type { PointA, AIAnalysis, Company } from '@/types/onboarding'

// GRI expert note type for prompt enrichment
export interface GriExpertNotes {
  product?: string
  trust?: string
  bizmodel?: string
  cash?: string
  ops?: string
  team?: string
  founder?: string
}

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
  })).min(2).max(4).describe('Top strategic priorities'),
  growth_roadmap: z.array(z.object({
    horizon: z.enum(['30_days', '90_days', '180_days']),
    actions: z.array(z.string()).min(2).max(6).describe('Specific action steps'),
  })).length(3).describe('Roadmap: 30, 90, and 180 days'),
  industry_context: z.string().describe('Industry context: benchmarks, trends, company market position'),
})

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(
  answers: Record<string, unknown>,
  pointA: PointA,
  company: Company | null,
  expertNotes?: GriExpertNotes | null
): string {
  const get = (key: string) => {
    const v = answers[key]
    if (v === null || v === undefined) return '—'
    if (Array.isArray(v)) return v.join(', ')
    if (typeof v === 'object') {
      try { return JSON.stringify(v) } catch { return '—' }
    }
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

  // Build expert notes section if available
  const expertSection = expertNotes ? Object.entries(expertNotes)
    .filter(([, note]) => note && note.trim().length > 0)
    .map(([block, note]) => `  ${block}: ${note}`)
    .join('\n') : ''

  return `Here is the company data from ALL 12 onboarding survey steps and rule-based scoring results. Conduct an in-depth analysis.

--- STEP 1: COMPANY ---
Name: ${company?.name || get('s1_company_name')}
Industry: ${company?.industry || get('s1_industry')}
Stage: ${company?.stage || get('s1_stage')}
Employees: ${get('s1_employee_count')}
Business Model: ${company?.business_model || get('s1_business_model')}
Geography: ${get('s1_regions')}
Year Founded: ${get('s1_founded_at')}
Years on Market: ${get('s1_years_on_market')}
Website: ${get('s1_website')}
Products/Services: ${get('s1_products_list')}
Main Competitors: ${get('s1_competitors_list')}

--- STEP 2: GOALS ---
12-Month Goal (What): ${get('s2n_goal_12m_what')}
12-Month Goal (Metrics): ${get('s2n_goal_12m_metrics')}
3-Year Goal (What): ${get('s2n_goal_3y_what')}
3-Year Goal (Metrics): ${get('s2n_goal_3y_metrics')}
Tried for Growth: ${get('s2n_tried_for_growth')}
Growth Blockers: ${get('s2n_what_blocks_growth')}

--- STEP 3: POSITIONING ---
Client Portrait: ${get('s3n_client_portrait')}
Price Segment: ${get('s3n_price_segment')}
Decision Maker: ${get('s3n_decision_maker')}
Client Problem: ${get('s3n_client_problem')}
Problem Impact: ${get('s3n_problem_impact')}
Current Solution: ${get('s3n_current_solution')}
If Unsolved: ${get('s3n_if_unsolved')}
Life After Solution: ${get('s3n_life_after_solution')}
Measurable Results: ${get('s3n_measurable_results')}
Quick Wins: ${get('s3n_short_wins')}
Why Us Over Competitors: ${get('s3n_competitor_why_us')}
What Cannot Be Copied: ${get('s3n_cannot_copy')}
Where Competitors Excel: ${get('s3n_competitors_better')}

--- STEP 4: ORG STRUCTURE & MANAGEMENT ---
Departments: ${get('s4_dept_count')}
Org Chart: ${get('s4_has_org_chart')}
Management Method: ${get('s4_management_method')}
Regular Meetings: ${get('s4_has_regular_meetings')}
Reporting Tool: ${get('s4_reporting_tool')}
Task Manager: ${get('s4_task_manager')}
Department KPIs: ${get('s4_has_dept_kpi')}
Staffing Table: ${get('s4n_staffing_table')}
Structure Matches Objectives: ${get('s4n_structure_matches')}
Open Vacancies: ${get('s4n_open_vacancies')}
Role Overlap: ${get('s4n_multi_roles')}
Team Fit 12 Months: ${get('s4n_team_fit_12m')}
Team Fit 3 Years: ${get('s4n_team_fit_3y')}
Strategic Planning: ${get('s4m_strategic_planning')}
Department Sync: ${get('s4m_dept_sync')}
Control Method: ${get('s4m_control_method')}
Feedback Culture: ${get('s4m_feedback_culture')}
Report Types: ${get('s4m_report_types')}
Reports Automated: ${get('s4m_report_automated')}
Hours on Operations: ${get('s4m_hours_on_ops')}
Delegation Readiness: ${get('s4m_delegation_readiness')}

--- STEP 5: CLIENT BASE & FUNNEL ---
Lead-to-Call: ${get('s5n_funnel_lead_to_call')}%
Call-to-Meeting: ${get('s5n_funnel_call_to_meeting')}%
Meeting-to-Proposal: ${get('s5n_funnel_meeting_to_kp')}%
Proposal-to-Sale: ${get('s5n_funnel_kp_to_sale')}%
Lead-to-Sale: ${get('s5n_funnel_lead_to_sale')}%
ABC Analysis: ${get('s5n_abc_analysis')}
RFM Analysis: ${get('s5n_rfm_analysis')}
Flagship Product: ${get('s5n_product_locomotive')}
Highest Margin Product: ${get('s5n_most_marginal')}
Entry Product: ${get('s5n_entry_product')}
Why Clients Buy: ${get('s5n_why_bought')}
Deciding Factor: ${get('s5n_deciding_factor')}
Purchase Barriers: ${get('s5n_barriers')}
How They Found Us: ${get('s5n_how_found_us')}
Will Return (NPS): ${get('s5n_will_return_nps')}
Upsell/Cross-sell: ${get('s5n_upsell_crosssell')}

--- STEP 6: CUSTOMER JOURNEY MAP ---
Journey Table: ${get('s6n_journey_table')}
Weak Funnel Points: ${get('s6n_weak_funnel_points')}
Post-Sale Touchpoints: ${get('s6n_post_sale_touchpoints')}
First Contact Script: ${get('s6n_script_first_contact')}
Meeting Script: ${get('s6n_script_meeting')}
Proposal Script: ${get('s6n_script_proposal')}

--- STEP 7: MARKETING ---
Marketing Channels Table: ${get('s7n_channels_table')}
Content Strategy: ${get('s7n_content_strategy')}
Competitor 1 Analysis: ${get('s7n_competitor_1_analysis')}
Competitor 2 Analysis: ${get('s7n_competitor_2_analysis')}
Competitor 3 Analysis: ${get('s7n_competitor_3_analysis')}

--- STEP 8: KEY METRICS ---
Metrics Table: ${get('s8n_metrics_table')}

--- STEP 9: FINANCE ---
Revenue 2024: ${get('s9n_revenue_2024')}
Change vs 2023: ${get('s9n_change_vs_2023')}
Net Profit: ${get('s9n_net_profit')}
Net Margin: ${get('s9n_net_margin')}
Revenue Sources: ${get('s9n_revenue_sources')}
Seasonality: ${get('s9n_seasonality')}
Breakeven Point: ${get('s9n_breakeven_point')}
Dividend Policy: ${get('s9n_dividend_policy')}
Expenses COGS: ${get('s9n_expense_cogs')}
Expenses Marketing: ${get('s9n_expense_marketing')}
Accounting Method: ${get('s9n_accounting_method')}
Planning Frequency: ${get('s9n_planning_frequency')}
Tracked KPIs: ${get('s9n_tracked_kpis')}
Debtor Days: ${get('s9n_debtor_days')}
Debts Amount: ${get('s9n_debts_amount')}
Tax System: ${get('s9n_tax_system')}
Business Transparency: ${get('s9n_transparency_pct')}%
Financial Blockers: ${get('s9n_financial_blockers')}

--- STEP 10: FOUNDER & PERSONAL ---
Why Started Business: ${get('s10_why_opened')}
Best Result 2Y: ${get('s10_best_result_2y')}
Best Result 5Y: ${get('s10_best_result_5y')}
Company Vision 2Y: ${get('s10_company_vision_2y')}
Company Vision 5Y: ${get('s10_company_vision_5y')}
Problems Faced: ${get('s10_problems_faced')}
Department Assessment: ${get('s10_dept_assessment')}
What Departments Lack: ${get('s10_what_depts_lack')}
Competitor Comparison: ${get('s10_competitor_comparison')}
Brand Perception: ${get('s10_brand_perception')}
Hours on Operations: ${get('s10_hours_on_ops')}
Delegation Ready: ${get('s10_delegation_ready')}
What Stops Delegating: ${get('s10_what_stops_delegating')}

--- STEP 11: INFLUENCE MAP ---
Influence Map: ${get('s11_influence_map')}

--- STEP 12: SYSTEMS & TOOLS ---
CRM Tool: ${get('s12_crm_tool')}
EDM: ${get('s12_edm')}
ERP: ${get('s12_erp')}
BI Tool: ${get('s12_bi_tool')}
Messengers: ${get('s12_messengers')}
Telephony: ${get('s12_telephony')}
Project Management: ${get('s12_project_mgmt')}
Marketing Platforms: ${get('s12_marketing_platforms')}
Automation Details: ${get('s12_automation_details')}
IT Support: ${get('s12_it_support')}

--- LEGACY FINANCE DATA (Steps 2-6 old format) ---
Revenue: 2023: ${get('s2_revenue_2023')} ₸ | 2024: ${get('s2_revenue_2024')} ₸ | 2025: ${get('s2_revenue_2025')} ₸
YoY Growth (2023-2024): ${revGrowth}%
New Clients: 2023: ${get('s2_new_clients_2023')}, 2024: ${get('s2_new_clients_2024')}, 2025: ${get('s2_new_clients_2025')}
Repeat Clients: 2023: ${get('s2_repeat_clients_2023')}, 2024: ${get('s2_repeat_clients_2024')}, 2025: ${get('s2_repeat_clients_2025')}
Average Check: ${get('s2_avg_check')} ₸
Gross Margin: ${get('s2_gross_margin')}%
CAC: ${get('s2_cac')} ₸, LTV: ${get('s2_ltv')} ₸, LTV/CAC: ${ltvCac}
Debt Load: ${get('s2_debt_load')}
Knows Breakeven Point: ${get('s2_knows_breakeven')}
CRM: ${get('s3_has_crm')}
Products: ${get('s3_products_description')} (${get('s3_product_count')} items)
Flagship Product: ${get('s3_flagship_product')}
Deals: 2023: ${get('s3_deals_2023')}, 2024: ${get('s3_deals_2024')}, 2025: ${get('s3_deals_2025')}
Rejections: 2023: ${get('s3_rejections_2023')}, 2024: ${get('s3_rejections_2024')}, 2025: ${get('s3_rejections_2025')}
Rejection Rate (2024): ${rejectionRate}%
Repeat Client Rate (2024): ${repeatRate2024}%
Deal Cycle: ${get('s3_deal_cycle_days')} days
Target Audience: ${get('s5_target_audience')}
Marketing Budget: ${get('s5_marketing_budget_pct')}% of revenue
USP: ${get('s5_usp')}
Main Pain: ${get('s6_main_pain')}
12-Month Goal: ${get('s6_goal_12months')}
3-Year Goal: ${get('s6_goal_3years')}

--- RULE-BASED SCORING (Point A Engine) ---
Overall Score: ${pointA.overall_score}/100
Health Index: ${pointA.health_index}/100
Stage: ${pointA.stage}
Finance Block: ${pointA.blocks.finance.score}/100 (${blockStatus(pointA.blocks.finance.score)})
Sales Block: ${pointA.blocks.sales.score}/100 (${blockStatus(pointA.blocks.sales.score)})
Operations Block: ${pointA.blocks.operations.score}/100 (${blockStatus(pointA.blocks.operations.score)})
Marketing Block: ${pointA.blocks.marketing.score}/100 (${blockStatus(pointA.blocks.marketing.score)})
Strategy Block: ${pointA.blocks.strategy.score}/100 (${blockStatus(pointA.blocks.strategy.score)})
Risks: ${pointA.risks.map(r => `[${r.level}] ${r.area}: ${r.text}`).join('; ')}
Data Gaps: ${pointA.data_gaps.map(g => g.field).join(', ') || 'none'}
${expertSection ? `
--- GRI EXPERT NOTES (from analyst/manager) ---
These notes are written by a human expert who reviewed the GRI (Growth Readiness Index) blocks.
They represent professional judgment that should SUPPLEMENT and ENHANCE your analysis. Where expert notes
identify specific issues or recommendations, integrate them into your analysis.
${expertSection}
` : ''}
--- GRI 7-BLOCK MODEL ---
The company is evaluated across 7 GRI blocks for $2M/year readiness:
1. Product & Demand — Does demand sustain $2M/year velocity
2. Trust & Positioning — Are you chosen immediately, and why you over a competitor
3. Business Model — Does profit scale, not just revenue
4. Cash Stability — Who finances growth: clients or the owner
5. Operations — Repeatability, standards, predictability of results
6. Team — Staffing, culture, discipline, hiring
7. Founder Readiness — Decision speed, financial maturity, stress tolerance

--- TASK ---
Generate a structured Point A analysis for this company using ALL data from 12 survey steps.
Cross-reference data between steps for deeper insights (e.g. funnel data from Step 5 with marketing spend from Step 7, finance metrics from Step 9 with legacy data from Step 2).
Map findings to the GRI 7-block model where relevant.
Be specific: use numbers from the data, compare with real benchmarks for the "${company?.industry || get('s1_industry')}" industry and "${company?.stage || get('s1_stage')}" stage in Kazakhstan/CIS.
Recommendations must be actionable, with specific steps, tools, and timelines.
${expertSection ? 'IMPORTANT: Integrate the GRI Expert Notes into your analysis. These represent human expert judgment and should be given high weight.' : ''}`
}

// ─── Main analyzer function ──────────────────────────────────────────────────

/*
 * PERFORMANCE + MODEL ROUTING: a single Sonnet call generating the full analysis
 * (~4-5K tokens) takes 90-150s — far too long for a user to wait. We split the
 * work into FOUR small parts that run concurrently (Promise.all):
 *
 *   1. summary    — executive_summary + industry_context        → Sonnet (high)
 *   2. priorities — strategic_priorities                         → Sonnet (high)
 *   3. blocksA    — finance, sales, operations                  → Haiku  (medium)
 *   4. blocksB    — marketing, strategy + growth_roadmap        → Haiku  (medium)
 *
 * The model is auto-selected by complexity: the strategic narrative is quality-
 * sensitive (Sonnet) but kept small; per-block diagnostics are lighter and
 * latency-critical (Haiku, ~2x faster). Wall-clock ≈ the slowest part (~15s).
 */

const SHARED_SYSTEM = `You are a senior business consultant for the AIStart360 platform (Kazakhstan).
You analyze company data from ALL 12 blocks of the onboarding survey, the results of automatic scoring, and the GRI (Growth Readiness Index) 7-block framework.
The 12 survey steps are: Company, Goals, Positioning, Org Structure, Client Base, CJM, Marketing, Key Metrics, Finance, Personal/Founder, Influence Map, Systems & Tools.
The GRI 7 blocks are: Product & Demand, Trust & Positioning, Business Model, Cash Stability, Operations, Team, Founder Readiness.
If GRI Expert Notes from human analysts are provided, integrate them prominently — they represent professional judgment and carry high weight.
Respond strictly in English.
BREVITY IS MANDATORY: every string field is ONE sentence of at most 25 words. Roadmap actions are at most 12 words each. Never exceed these limits — be dense and specific, not verbose.
Be specific: use real numbers from the data, name concrete tools, give timelines. Compare with real benchmarks for the industry and stage in Kazakhstan/CIS.
Do not repeat what the rule-based scoring already said. Output must be a single minified JSON object and nothing else.`

const summarySchema = z.object({
  executive_summary: aiAnalysisSchema.shape.executive_summary,
  industry_context: aiAnalysisSchema.shape.industry_context,
})

const prioritiesSchema = z.object({
  strategic_priorities: aiAnalysisSchema.shape.strategic_priorities,
})

const blocksASchema = z.object({
  finance: aiBlockSchema,
  sales: aiBlockSchema,
  operations: aiBlockSchema,
})

const blocksBSchema = z.object({
  marketing: aiBlockSchema,
  strategy: aiBlockSchema,
  growth_roadmap: aiAnalysisSchema.shape.growth_roadmap,
})

const SUMMARY_FORMAT = `

--- OUTPUT FORMAT (summary only) ---
Return ONLY one valid JSON object (no markdown, no commentary):
{
  "executive_summary": "string (3-5 sentences: overall picture, strengths, key issues)",
  "industry_context": "string (benchmarks, trends, market position)"
}`

const PRIORITIES_FORMAT = `

--- OUTPUT FORMAT (priorities only) ---
Return ONLY one valid JSON object (no markdown, no commentary):
{
  "strategic_priorities": [ { "title": "string", "rationale": "string", "expected_impact": "string" } ]
}
Rule: "strategic_priorities" must have 2 to 4 items.`

const BLOCK_FIELDS = `{ "diagnosis": "string", "benchmark_comparison": "string", "key_risk": "string", "top_recommendation": "string" }`

const BLOCKS_A_FORMAT = `

--- OUTPUT FORMAT (3 blocks only) ---
Return ONLY one valid JSON object (no markdown, no commentary):
{
  "finance":    ${BLOCK_FIELDS},
  "sales":      ${BLOCK_FIELDS},
  "operations": ${BLOCK_FIELDS}
}`

const BLOCKS_B_FORMAT = `

--- OUTPUT FORMAT (2 blocks + roadmap only) ---
Return ONLY one valid JSON object (no markdown, no commentary):
{
  "marketing": ${BLOCK_FIELDS},
  "strategy":  ${BLOCK_FIELDS},
  "growth_roadmap": [
    { "horizon": "30_days",  "actions": ["string", "string"] },
    { "horizon": "90_days",  "actions": ["string", "string"] },
    { "horizon": "180_days", "actions": ["string", "string"] }
  ]
}
Rule: "growth_roadmap" must have exactly 3 items with horizons "30_days","90_days","180_days" in that order; each "actions" has 2-5 short items.`

export async function analyzePointA(
  answers: Record<string, unknown>,
  pointA: PointA,
  company: Company | null,
  expertNotes?: GriExpertNotes | null,
): Promise<AIAnalysis | null> {
  // Skip if no API key (honest degradation — no fabrication without an LLM)
  if (!hasOpenRouterKey()) {
    console.warn('[point-a-analyzer] No OPENROUTER_API_KEY — skipping AI analysis')
    return null
  }

  try {
    const context = buildPrompt(answers, pointA, company, expertNotes)

    const [summary, priorities, blocksA, blocksB] = await Promise.all([
      generateObjectViaOpenRouter({
        label: 'point-a:summary',
        complexity: 'high',
        maxTokens: 1200,
        schema: summarySchema,
        system: SHARED_SYSTEM,
        user: context + SUMMARY_FORMAT,
      }),
      generateObjectViaOpenRouter({
        label: 'point-a:priorities',
        complexity: 'high',
        maxTokens: 1500,
        schema: prioritiesSchema,
        system: SHARED_SYSTEM,
        user: context + PRIORITIES_FORMAT,
      }),
      generateObjectViaOpenRouter({
        label: 'point-a:blocksA',
        complexity: 'medium',
        maxTokens: 2000,
        schema: blocksASchema,
        system: SHARED_SYSTEM,
        user: context + BLOCKS_A_FORMAT,
      }),
      generateObjectViaOpenRouter({
        label: 'point-a:blocksB',
        complexity: 'medium',
        maxTokens: 2000,
        schema: blocksBSchema,
        system: SHARED_SYSTEM,
        user: context + BLOCKS_B_FORMAT,
      }),
    ])

    // Honest fallback: if any part failed, we don't fabricate a partial analysis.
    if (!summary || !priorities || !blocksA || !blocksB) return null

    const blocks = {
      finance: blocksA.finance,
      sales: blocksA.sales,
      operations: blocksA.operations,
      marketing: blocksB.marketing,
      strategy: blocksB.strategy,
    }

    return {
      executive_summary: summary.executive_summary,
      industry_context: summary.industry_context,
      strategic_priorities: priorities.strategic_priorities,
      growth_roadmap: blocksB.growth_roadmap,
      blocks: blocks as unknown as Record<string, import('@/types/onboarding').AIBlockAnalysis>,
      model_used: `${OPENROUTER_MODELS.sonnet} + ${OPENROUTER_MODELS.haiku} (auto)`,
      generated_at: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[point-a-analyzer] AI analysis failed:', error)
    return null
  }
}
