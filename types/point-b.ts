export interface TargetBlock {
  current: number       // Point A score (0-100)
  target: number        // Point B target (0-100)
  gap: number           // target - current
  priority: 'critical' | 'high' | 'medium' | 'low'
  effort: string        // "1-3 месяца", "3-6 месяцев"
}

export interface TargetKPI {
  label: string
  current: string       // formatted current value
  target: string        // formatted target value
  unit: string
  progress: number      // 0-100
}

export interface RoadmapQuarter {
  quarter: string       // "Q1", "Q2", "Q3", "Q4"
  title: string
  focus_blocks: string[]
  target_overall: number
  milestones: string[]
  expected_improvement: number
}

export interface PointB {
  // Identity
  diagnostic_id: string | null
  horizon_months: number         // default 12

  // Target scores
  target_overall_score: number
  target_health_index: number
  target_stage: string

  // Per-block targets
  target_blocks: Record<string, TargetBlock>

  // Business KPIs
  target_kpis: TargetKPI[]

  // GAP analysis (sorted by priority)
  gap_analysis: Array<{
    block: string
    label: string
    current: number
    target: number
    gap: number
    priority: 'critical' | 'high' | 'medium' | 'low'
    effort: string
  }>

  // Quarterly roadmap
  roadmap: RoadmapQuarter[]

  // User goals from survey
  user_goals: {
    goal_12months: string
    goal_3years: string
    main_pain: string
    growth_blockers: string[]
  }

  // AI enrichment
  ai_strategy: AIStrategy | null
  ai_status: 'none' | 'processing' | 'completed' | 'failed'

  calculated_at: string
}

export interface AIStrategy {
  transition_plan: string           // strategic plan overview
  scenarios: {
    optimistic: ScenarioOutcome
    realistic: ScenarioOutcome
    pessimistic: ScenarioOutcome
  }
  risk_factors: string[]            // top 3-5 risks to plan
  resource_requirements: string     // budget, team, tools
  model_used: string
  generated_at: string
}

export interface ScenarioOutcome {
  label: string
  overall_score: number
  revenue_growth: string
  key_assumption: string
}

/**
 * AI-generated NARRATIVE strategy for the goal-driven Point B (v2) engine.
 *
 * This is intentionally narrative-only: every numeric ground-truth (gap
 * multiplier, required CAGR/MoM/QoQ, target revenue, scores) is produced
 * deterministically by {@link calculatePointBV2}. The LLM never emits a target
 * or revenue number — the Zod schema in `lib/ai/point-b-analyzer.ts` contains
 * NO numeric fields, so a hallucinated figure cannot leak into the UI.
 *
 * Kept permissive (plain string/array fields) so the generic, defensive
 * renderer in `components/point-b/AiStrategy.tsx` keeps working even if the
 * model adds an extra block.
 */
export interface PointBStrategy {
  /** 3–5 sentence narrative of how to bridge the gap from current state to the goal. */
  strategic_bridge_summary: string
  /**
   * One entry per weak block / TOP-5 limit: what the gap is and the action to
   * close it. The priority label is localized: Russian ('Приоритет N') when the
   * portal locale is 'ru', English ('Priority N') when 'en'. Both label sets are
   * accepted so a strategy generated under either locale type-checks and renders.
   */
  gap_bridge: Array<{
    block: string
    gap: string
    action: string
    priority:
      | 'Приоритет 1'
      | 'Приоритет 2'
      | 'Приоритет 3'
      | 'Priority 1'
      | 'Priority 2'
      | 'Priority 3'
  }>
  /** Sequenced milestones derived from the deterministic horizons / TOP-5 limits. */
  milestones: Array<{
    q: string
    title: string
    desc: string
    status: 'current' | 'planned' | 'future'
  }>
  /** One mitigation per deterministic realism.risk_factor. */
  risk_mitigations: Array<{
    risk: string
    mitigation: string
  }>
}
