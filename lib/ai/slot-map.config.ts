/**
 * Slot-map configuration — canonical "where does each UI field come from"
 * table. Changing this file is how we rewire UI surfaces to different
 * extraction sources without touching extractors.
 *
 * Compute modes:
 *   'direct'     — first value from sources[] wins. Use when there's one
 *                  authoritative place (e.g. diagnostics JSON fields).
 *   'consensus'  — run through lib/ai/consensus.ts and pick canonical.
 *   'aggregate'  — custom aggregator fn (grouping, summing).
 */

export type ComputeMode = 'direct' | 'consensus' | 'aggregate'

export interface SlotRule {
  /**
   * Ordered list of sources. Syntax:
   *   'metrics.{metric_key}'                 — latest row in public.metrics
   *   'metrics.{metric_key}:{year}'          — specific period
   *   'ai_extractions.{entity_type}'         — active (superseded_by IS NULL)
   *   'ai_extractions.{entity_type}:{year}'  — active + period
   *   'diagnostics.{json_path}'              — dot-path in diagnostics row
   *   'point_b_analysis.{json_path}'         — dot-path in point_b_analysis
   *   'survey.{question_key}'                — direct read of survey_answers
   *   'companies.{column}'                   — direct column read
   */
  sources: string[]
  compute: ComputeMode
  /** Preference when values conflict (consensus mode). */
  prefer?: 'document-over-survey' | 'survey-over-document' | 'latest'
  /** Optional aggregator id — looked up in lib/ai/slot-aggregators.ts */
  aggregator?: string
  /** Human description for admin/debug UI. */
  description?: string
}

/**
 * UI slot path → rule. Paths use dot-notation matching the React tree:
 *   `dashboard.aiAnalysis.executive_summary`
 *   `point_a.gauges.finance`
 *   etc.
 */
export const SLOT_MAP: Record<string, SlotRule> = {
  // ─────────────────────────────────────────────────────────────────────────
  // Dashboard
  // ─────────────────────────────────────────────────────────────────────────
  'dashboard.aiAnalysis.executive_summary': {
    sources: ['diagnostics.ai_analysis.executive_summary'],
    compute: 'direct',
    description: 'AI-generated executive summary shown on client dashboard.',
  },
  'dashboard.aiAnalysis.strategic_priorities': {
    sources: ['diagnostics.ai_analysis.strategic_priorities'],
    compute: 'direct',
  },
  'dashboard.aiAnalysis.growth_roadmap': {
    sources: ['diagnostics.ai_analysis.growth_roadmap'],
    compute: 'direct',
  },
  'dashboard.aiAnalysis.industry_context': {
    sources: ['diagnostics.ai_analysis.industry_context'],
    compute: 'direct',
  },

  'dashboard.blocks.finance': {
    sources: ['diagnostics.finance_score'],
    compute: 'direct',
  },
  'dashboard.blocks.sales': {
    sources: ['diagnostics.sales_score'],
    compute: 'direct',
  },
  'dashboard.blocks.ops': {
    sources: ['diagnostics.operations_score'],
    compute: 'direct',
  },
  'dashboard.blocks.marketing': {
    sources: ['diagnostics.marketing_score'],
    compute: 'direct',
  },
  'dashboard.blocks.strategy': {
    sources: ['diagnostics.strategy_score'],
    compute: 'direct',
  },

  'dashboard.stats.total_clients': {
    sources: ['metrics.active_clients', 'ai_extractions.metric.active_clients'],
    compute: 'consensus',
    prefer: 'document-over-survey',
    description: 'Replaces hardcoded 48 in ClientsStatsWidget.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Point A (current state)
  // ─────────────────────────────────────────────────────────────────────────
  'point_a.gauges.overall': {
    sources: ['diagnostics.overall_score'],
    compute: 'direct',
  },
  'point_a.gauges.health': {
    sources: ['diagnostics.health_index'],
    compute: 'direct',
  },
  'point_a.gauges.finance': {
    sources: ['diagnostics.finance_score.score'],
    compute: 'direct',
  },
  'point_a.gauges.sales': {
    sources: ['diagnostics.sales_score.score'],
    compute: 'direct',
  },
  'point_a.gauges.ops': {
    sources: ['diagnostics.operations_score.score'],
    compute: 'direct',
  },
  'point_a.gauges.marketing': {
    sources: ['diagnostics.marketing_score.score'],
    compute: 'direct',
  },
  'point_a.gauges.strategy': {
    sources: ['diagnostics.strategy_score.score'],
    compute: 'direct',
  },

  'point_a.risks':      { sources: ['diagnostics.risks'],      compute: 'direct' },
  'point_a.insights':   { sources: ['diagnostics.insights'],   compute: 'direct' },
  'point_a.quick_wins': { sources: ['diagnostics.quick_wins'], compute: 'direct' },

  // ─────────────────────────────────────────────────────────────────────────
  // Point B (target state)
  // ─────────────────────────────────────────────────────────────────────────
  'point_b.target_overall':  { sources: ['point_b_analysis.target_overall'],  compute: 'direct' },
  'point_b.target_health':   { sources: ['point_b_analysis.target_health'],   compute: 'direct' },
  'point_b.target_stage':    { sources: ['point_b_analysis.target_stage'],    compute: 'direct' },
  'point_b.target_kpis':     { sources: ['point_b_analysis.target_kpis'],     compute: 'direct' },
  'point_b.gap_analysis':    { sources: ['point_b_analysis.gap_analysis'],    compute: 'direct' },
  'point_b.roadmap':         { sources: ['point_b_analysis.roadmap'],         compute: 'direct' },
  'point_b.ai_strategy':     { sources: ['point_b_analysis.ai_strategy'],     compute: 'direct' },

  // ─────────────────────────────────────────────────────────────────────────
  // Company-level attributes (feed multiple UI surfaces)
  // ─────────────────────────────────────────────────────────────────────────
  'company.name': {
    sources: ['companies.name', 'ai_extractions.attribute.company_name', 'survey.s1_company_name'],
    compute: 'direct',
  },
  'company.industry': {
    sources: ['companies.industry', 'ai_extractions.attribute.industry', 'survey.s1_industry'],
    compute: 'direct',
  },
  'company.stage': {
    sources: ['companies.stage', 'ai_extractions.attribute.stage', 'survey.s1_stage'],
    compute: 'direct',
  },
  'company.employees': {
    sources: ['metrics.employees', 'ai_extractions.metric.employees', 'survey.s1_employee_count'],
    compute: 'consensus',
    prefer: 'document-over-survey',
  },
  'company.website': {
    sources: ['companies.website', 'ai_extractions.attribute.website', 'survey.s1_website'],
    compute: 'direct',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Medical (active when company.vertical = 'medical')
  // ─────────────────────────────────────────────────────────────────────────
  'medical.clinic_name': {
    sources: ['ai_extractions.attribute.clinic_name', 'survey.s1_clinic_name'],
    compute: 'direct',
  },
  'medical.revenue_monthly_current': {
    sources: ['metrics.revenue_monthly', 'ai_extractions.metric.revenue_monthly'],
    compute: 'consensus',
    prefer: 'document-over-survey',
  },
  'medical.revenue_monthly_target': {
    sources: ['metrics.revenue_monthly_target', 'ai_extractions.metric.revenue_monthly_target'],
    compute: 'direct',
  },
  'medical.segments.champions':    { sources: ['patient_segments:vip_retention'],    compute: 'aggregate', aggregator: 'segment-summary' },
  'medical.segments.loyal':        { sources: ['patient_segments:loyal_active'],     compute: 'aggregate', aggregator: 'segment-summary' },
  'medical.segments.at_risk':      { sources: ['patient_segments:churn_risk'],       compute: 'aggregate', aggregator: 'segment-summary' },
  'medical.segments.sleeping':     { sources: ['patient_segments:sleeping'],         compute: 'aggregate', aggregator: 'segment-summary' },
  'medical.bundles':               { sources: ['growth_bundles'],                    compute: 'aggregate', aggregator: 'bundles-by-priority' },
  'medical.losses':                { sources: ['revenue_losses'],                    compute: 'aggregate', aggregator: 'losses-by-severity' },
}

/** Quick lookup for all slots that read from a given source type. Used by
 *  the invalidator: when `metrics` rows change, re-evaluate slots that
 *  depend on them. */
export function slotsUsing(sourcePrefix: string): string[] {
  const out: string[] = []
  for (const [slot, rule] of Object.entries(SLOT_MAP)) {
    if (rule.sources.some((s) => s.startsWith(sourcePrefix))) {
      out.push(slot)
    }
  }
  return out
}
