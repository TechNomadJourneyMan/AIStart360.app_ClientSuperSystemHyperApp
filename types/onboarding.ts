// ─── User / Profile ───────────────────────────────────────────────────────────
export type ApprovalStatus = 'pending_approval' | 'approved' | 'rejected' | 'requires_clarification'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: 'super_admin' | 'admin' | 'manager' | 'analyst' | 'client' | 'expert' | 'owner'
  status: ApprovalStatus
  approved_at: string | null
  approved_by: string | null
  avatar_url: string | null
  organization: string | null
  position: string | null
  phone: string | null
  created_at: string
  updated_at: string
}

// ─── Company ──────────────────────────────────────────────────────────────────
export interface Company {
  id: string
  user_id: string
  name: string
  industry: string | null
  stage: 'Startup' | 'Growth' | 'Scale' | 'Mature' | null
  employee_count: number | null
  founded_at: string | null
  business_model: 'B2B' | 'B2C' | 'B2B2C' | 'Mixed' | null
  regions: string[]
  contact_name: string | null
  contact_position: string | null
  contact_phone: string | null
  contact_email: string | null
  created_at: string
  updated_at: string
}

// ─── Survey ───────────────────────────────────────────────────────────────────
export interface SurveyAnswer {
  id: string
  user_id: string
  company_id: string | null
  step: number
  question_key: string
  answer: { value: unknown }
  answered_at: string
}

export type SurveyProgress = {
  current_step: number
  completed_steps: number[]
  answers: Record<string, unknown>
}

// Step 1 — Company
export interface Step1Data {
  s1_company_name: string
  s1_founded_at: string
  s1_industry: string
  s1_stage: 'Startup' | 'Growth' | 'Scale' | 'Mature'
  s1_employee_count: number
  s1_regions: string[]
  s1_business_model: 'B2B' | 'B2C' | 'B2B2C' | 'Mixed'
  s1_contact_name: string
  s1_contact_position: string
  s1_contact_phone: string
  s1_contact_email: string
}

// Step 2 — Finance
export interface Step2Data {
  s2_revenue_2023: number
  s2_revenue_2024: number
  s2_revenue_2025: number
  s2_new_clients_2023: number
  s2_new_clients_2024: number
  s2_new_clients_2025: number
  s2_repeat_clients_2023: number
  s2_repeat_clients_2024: number
  s2_repeat_clients_2025: number
  s2_avg_check: number
  s2_gross_margin: number
  s2_cac: number
  s2_ltv: number
  s2_debt_load: 'none' | 'moderate' | 'high'
  s2_knows_breakeven: boolean
}

// Step 3 — Sales & CRM
export interface Step3Data {
  s3_has_crm: 'none' | 'excel' | 'amocrm' | 'bitrix24' | 'other'
  s3_products_description: string
  s3_product_count: number
  s3_flagship_product: string
  s3_deals_2023: number
  s3_deals_2024: number
  s3_deals_2025: number
  s3_rejections_2023: number
  s3_rejections_2024: number
  s3_rejections_2025: number
  s3_deal_cycle_days: number
  s3_promo_channels: string[]
  s3_has_loyalty: boolean
}

// Step 4 — Operations
export interface Step4Data {
  s4_dept_count: number
  s4_has_org_chart: boolean
  s4_management_method: 'manual' | 'kpi' | 'okr' | 'hybrid'
  s4_has_regular_meetings: boolean
  s4_reporting_tool: 'excel' | 'bi' | 'crm' | 'none'
  s4_task_manager: 'none' | 'trello' | 'jira' | 'notion' | 'other'
  s4_has_dept_kpi: boolean
}

// Step 5 — Marketing
export interface Step5Data {
  s5_target_audience: string
  s5_audience_segments: string[]
  s5_top_regions: string[]
  s5_marketing_channels: string[]
  s5_marketing_budget_pct: number
  s5_has_competitor_analysis: boolean
  s5_competitor_1: string
  s5_competitor_2: string
  s5_competitor_3: string
  s5_usp: string
}

// Step 6 — Goals
export interface Step6Data {
  s6_main_pain: string
  s6_goal_12months: string
  s6_goal_3years: string
  s6_growth_blockers: string[]
  s6_expectations: string
}

// ─── Documents ────────────────────────────────────────────────────────────────
export type DocType = 'pl_report' | 'balance_sheet' | 'marketing_report' | 'ops_report' | 'crm_export' | 'audit' | 'other'
export type ParseStatus = 'queued' | 'processing' | 'parsed' | 'error'

export interface Document {
  id: string
  user_id: string
  company_id: string | null
  file_name: string
  file_url: string
  file_size: number | null
  mime_type: string | null
  doc_type: DocType
  period_quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  period_year: number | null
  parse_status: ParseStatus
  parsed_data: Record<string, unknown> | null
  parse_error: string | null
  n8n_execution_id: string | null
  uploaded_at: string
}

// ─── Point A / Diagnostics ────────────────────────────────────────────────────
export type BlockStatus = 'critical' | 'weak' | 'average' | 'strong' | 'excellent'
export type DiagnosticStage = 'seed' | 'early' | 'growth' | 'scale' | 'mature'
export type RiskLevel = 'critical' | 'important' | 'moderate'

export interface BlockScore {
  score: number           // 0–100
  status: BlockStatus
  top_issues: string[]
  recommendations: string[]
}

export interface Risk {
  level: RiskLevel
  area: string
  text: string
  impact: string
}

export interface Insight {
  text: string
  area: string
}

export interface QuickWin {
  action: string
  timeline: string
  area: string
}

export interface DataGap {
  field: string
  step: number
  impact: string
}

export interface PointA {
  overall_score: number
  health_index: number
  stage: DiagnosticStage
  blocks: {
    finance: BlockScore
    marketing: BlockScore
    operations: BlockScore
    strategy: BlockScore
    sales: BlockScore
  }
  risks: Risk[]
  insights: Insight[]
  quick_wins: QuickWin[]
  data_gaps: DataGap[]
  intelligence?: PointAIntelligence
}

// ─── Phase 4 — Aggregator v2 Intelligence ────────────────────────────────────
export interface PointAIntelligence {
  by_department: Array<{
    department: string
    coverage: number
    strongest: Array<{ metric_id: string; label: string; value: number | null; unit: string; confidence: number }>
    weakest:   Array<{ metric_id: string; label: string; value: number | null; unit: string; confidence: number; reason: string }>
  }>
  top_strengths: Array<{ metric_id: string; label: string; value: number | null; unit: string; namespace: string }>
  top_gaps: Array<{ metric_id: string; label: string; suggested_source: string; reason: string }>
  coverage: { biz: number; kpi: number; gri: number; goal: number; overall: number }
  trends: Array<{ metric_id: string; direction: 'up'|'down'|'flat'; delta_pct: number }>
  generated_at: string
  resolver_version: string
}

export interface Diagnostic {
  id: string
  user_id: string
  company_id: string | null
  version: number
  overall_score: number | null
  health_index: number | null
  stage: DiagnosticStage | null
  finance_score: BlockScore | null
  marketing_score: BlockScore | null
  operations_score: BlockScore | null
  strategy_score: BlockScore | null
  sales_score: BlockScore | null
  risks: Risk[] | null
  insights: Insight[] | null
  quick_wins: QuickWin[] | null
  data_gaps: DataGap[] | null
  is_current: boolean
  calculated_at: string
  ai_analysis: AIAnalysis | null
  ai_status: AIStatus
}

// ─── AI Analysis (Layer 2 — Claude-powered) ──────────────────────────────────

export type AIStatus = 'none' | 'processing' | 'completed' | 'failed'

export interface AIBlockAnalysis {
  diagnosis: string
  benchmark_comparison: string
  key_risk: string
  top_recommendation: string
}

export interface StrategicPriority {
  title: string
  rationale: string
  expected_impact: string
}

export interface RoadmapItem {
  horizon: '30_days' | '90_days' | '180_days'
  actions: string[]
}

export interface AIAnalysis {
  executive_summary: string
  blocks: Record<string, AIBlockAnalysis>
  strategic_priorities: StrategicPriority[]
  growth_roadmap: RoadmapItem[]
  industry_context: string
  model_used: string
  generated_at: string
}

// ─── API Responses ────────────────────────────────────────────────────────────
export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr   { ok: false; error: string }
export type ApiResult<T> = ApiOk<T> | ApiErr
