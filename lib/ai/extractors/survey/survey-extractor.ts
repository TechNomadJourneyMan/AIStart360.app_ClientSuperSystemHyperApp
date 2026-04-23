/**
 * Survey extractor — normalizes survey_answers rows into ExtractedEntity[].
 *
 * No LLM calls. Pure rule-based mapping from question_key → entity_type
 * with unit + period extraction where applicable.
 *
 * Confidence defaults to 0.7 for surveys (users can mistype, round, etc.)
 * but climbs to 0.85 for enum fields (stage, industry) where the answer
 * is constrained to a known set.
 */

import { coerceNumber, DEFAULT_CONFIDENCE, excerpt, makeEntity } from '../base'
import type { Extractor, ExtractorContext, ExtractedEntity, FiscalQuarter } from '../types'

const EXTRACTOR_NAME = 'survey'
const EXTRACTOR_VERSION = '1.0.0'

// -----------------------------------------------------------------------------
// Mapping table — question_key → entity description
// -----------------------------------------------------------------------------

interface MetricRule {
  kind: 'metric'
  entityType: string
  unit?: string
  /** Extract period from key: 's2_revenue_2024' → 2024. Regex with year capture. */
  yearFromKey?: RegExp
  /** Default confidence override. */
  confidence?: number
}

interface AttributeRule {
  kind: 'attribute'
  entityType: string
  confidence?: number
}

type Rule = MetricRule | AttributeRule

const RULES: Record<string, Rule> = {
  // ── Step 1 — О компании ──────────────────────────────────────────────────
  s1_company_name:     { kind: 'attribute', entityType: 'attribute.company_name', confidence: 0.95 },
  s1_industry:         { kind: 'attribute', entityType: 'attribute.industry', confidence: 0.9 },
  s1_stage:            { kind: 'attribute', entityType: 'attribute.stage', confidence: 0.9 },
  s1_employee_count:   { kind: 'metric', entityType: 'metric.employees', unit: 'count' },
  s1_years_on_market:  { kind: 'metric', entityType: 'metric.years_on_market', unit: 'years' },
  s1_business_model:   { kind: 'attribute', entityType: 'attribute.business_model' },
  s1_website:          { kind: 'attribute', entityType: 'attribute.website', confidence: 0.9 },
  s1_products_list:    { kind: 'attribute', entityType: 'attribute.products_list' },
  s1_competitors_list: { kind: 'attribute', entityType: 'attribute.competitors_list' },

  // ── Step 2 — Finance (period-aware) ──────────────────────────────────────
  s2_revenue_2023:         { kind: 'metric', entityType: 'metric.revenue', unit: 'KZT', yearFromKey: /_(\d{4})$/ },
  s2_revenue_2024:         { kind: 'metric', entityType: 'metric.revenue', unit: 'KZT', yearFromKey: /_(\d{4})$/ },
  s2_revenue_2025:         { kind: 'metric', entityType: 'metric.revenue', unit: 'KZT', yearFromKey: /_(\d{4})$/ },
  s2_new_clients_2023:     { kind: 'metric', entityType: 'metric.new_clients', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s2_new_clients_2024:     { kind: 'metric', entityType: 'metric.new_clients', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s2_new_clients_2025:     { kind: 'metric', entityType: 'metric.new_clients', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s2_repeat_clients_2023:  { kind: 'metric', entityType: 'metric.repeat_clients', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s2_repeat_clients_2024:  { kind: 'metric', entityType: 'metric.repeat_clients', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s2_repeat_clients_2025:  { kind: 'metric', entityType: 'metric.repeat_clients', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s2_avg_check:            { kind: 'metric', entityType: 'metric.avg_check', unit: 'KZT' },
  s2_gross_margin:         { kind: 'metric', entityType: 'metric.gross_margin', unit: '%' },
  s2_cac:                  { kind: 'metric', entityType: 'metric.cac', unit: 'KZT' },
  s2_ltv:                  { kind: 'metric', entityType: 'metric.ltv', unit: 'KZT' },
  s2_debt_load:            { kind: 'attribute', entityType: 'attribute.debt_load' },
  s2_knows_breakeven:      { kind: 'attribute', entityType: 'attribute.knows_breakeven' },

  // ── Step 3 — Sales ───────────────────────────────────────────────────────
  s3_has_crm:          { kind: 'attribute', entityType: 'attribute.has_crm', confidence: 0.9 },
  s3_product_count:    { kind: 'metric', entityType: 'metric.product_count', unit: 'count' },
  s3_deals_2023:       { kind: 'metric', entityType: 'metric.deals_closed', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s3_deals_2024:       { kind: 'metric', entityType: 'metric.deals_closed', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s3_deals_2025:       { kind: 'metric', entityType: 'metric.deals_closed', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s3_rejections_2023:  { kind: 'metric', entityType: 'metric.deals_rejected', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s3_rejections_2024:  { kind: 'metric', entityType: 'metric.deals_rejected', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s3_rejections_2025:  { kind: 'metric', entityType: 'metric.deals_rejected', unit: 'count', yearFromKey: /_(\d{4})$/ },
  s3_deal_cycle_days:  { kind: 'metric', entityType: 'metric.deal_cycle_days', unit: 'days' },
  s3_flagship_product: { kind: 'attribute', entityType: 'attribute.flagship_product' },
  s3_has_loyalty:      { kind: 'attribute', entityType: 'attribute.has_loyalty' },

  // ── Step 4 — Ops ──────────────────────────────────────────────────────────
  s4_dept_count:       { kind: 'metric', entityType: 'metric.dept_count', unit: 'count' },
  s4_has_org_chart:    { kind: 'attribute', entityType: 'attribute.has_org_chart' },
  s4_has_dept_kpi:     { kind: 'attribute', entityType: 'attribute.has_dept_kpi' },

  // ── Step 5 — Marketing ────────────────────────────────────────────────────
  s5_marketing_budget_pct: { kind: 'metric', entityType: 'metric.marketing_budget_pct', unit: '%' },
  s5_has_competitor_analysis: { kind: 'attribute', entityType: 'attribute.has_competitor_analysis' },
  s5_usp:                  { kind: 'attribute', entityType: 'attribute.usp' },

  // ── Step 6 — Pain / goals ─────────────────────────────────────────────────
  s6_main_pain:        { kind: 'attribute', entityType: 'attribute.main_pain' },
  s6_goal_12months:    { kind: 'attribute', entityType: 'attribute.goal_12m' },
  s6_goal_3years:      { kind: 'attribute', entityType: 'attribute.goal_3y' },
  s6_growth_blockers:  { kind: 'attribute', entityType: 'attribute.growth_blockers' },

  // ── Step 2n / Goals ───────────────────────────────────────────────────────
  s2n_goal_12m_what:       { kind: 'attribute', entityType: 'attribute.goal_12m' },
  s2n_goal_12m_metrics:    { kind: 'attribute', entityType: 'attribute.goal_12m_metrics' },
  s2n_goal_3y_what:        { kind: 'attribute', entityType: 'attribute.goal_3y' },
  s2n_goal_3y_metrics:     { kind: 'attribute', entityType: 'attribute.goal_3y_metrics' },
  s2n_tried_for_growth:    { kind: 'attribute', entityType: 'attribute.tried_for_growth' },
  s2n_what_blocks_growth:  { kind: 'attribute', entityType: 'attribute.growth_blockers' },

  // ── Step 9 — Финансы (newer fields) ──────────────────────────────────────
  s9n_revenue_2024: { kind: 'metric', entityType: 'metric.revenue', unit: 'KZT', yearFromKey: /_(\d{4})$/ },
  s9n_net_profit:   { kind: 'metric', entityType: 'metric.net_profit', unit: 'KZT' },
  s9n_net_margin:   { kind: 'metric', entityType: 'metric.net_margin', unit: '%' },

  // ── Medical-specific (s1_ fields overridden for medical vertical) ───────
  s1_cardiac_specialization: { kind: 'attribute', entityType: 'attribute.medical_specialization' },
  s1_clinic_name:            { kind: 'attribute', entityType: 'attribute.clinic_name' },
  s1_top_services:           { kind: 'attribute', entityType: 'attribute.top_services' },
  s1_top_competitors:        { kind: 'attribute', entityType: 'attribute.top_competitors' },

  // Medical intake uses s1_current_revenue / s1_target_revenue (monthly)
  s1_current_revenue:        { kind: 'metric', entityType: 'metric.revenue_monthly', unit: 'KZT' },
  s1_target_revenue:         { kind: 'metric', entityType: 'metric.revenue_monthly_target', unit: 'KZT' },
}

// -----------------------------------------------------------------------------
// Survey row type
// -----------------------------------------------------------------------------

export interface SurveyAnswerRow {
  question_key: string
  answer: { value: unknown } | null
  step: number
  answered_at?: string
}

// -----------------------------------------------------------------------------
// Extractor
// -----------------------------------------------------------------------------

export const surveyExtractor: Extractor<SurveyAnswerRow[]> = {
  name: EXTRACTOR_NAME,
  version: EXTRACTOR_VERSION,
  label: 'Survey answers → entities',

  supports(_ctx: ExtractorContext): boolean {
    // Survey extractor always supports — dispatched explicitly by survey_completed trigger
    return true
  },

  async extract(rows: SurveyAnswerRow[], ctx: ExtractorContext): Promise<ExtractedEntity[]> {
    const out: ExtractedEntity[] = []

    for (const row of rows ?? []) {
      const rule = RULES[row.question_key]
      if (!rule) continue // unknown field — skip silently (not every answer is extractable)

      const rawValue = row.answer?.value
      if (rawValue === null || rawValue === undefined || rawValue === '') continue

      const confidence = rule.confidence ?? DEFAULT_CONFIDENCE.survey

      if (rule.kind === 'metric') {
        const n = coerceNumber(rawValue)
        if (!Number.isFinite(n)) continue

        const period_year = rule.yearFromKey
          ? extractYear(row.question_key, rule.yearFromKey)
          : undefined

        out.push(
          makeEntity({
            entity_type: rule.entityType,
            value: n,
            unit: rule.unit,
            period_year,
            confidence,
            source_type: 'survey',
            extractor_name: EXTRACTOR_NAME,
            extractor_version: EXTRACTOR_VERSION,
            source_field: `survey.${row.question_key}`,
            raw_excerpt: excerpt(String(rawValue)),
          })
        )
      } else {
        // attribute — store raw value (string, array, object)
        out.push(
          makeEntity({
            entity_type: rule.entityType,
            value: rawValue,
            confidence,
            source_type: 'survey',
            extractor_name: EXTRACTOR_NAME,
            extractor_version: EXTRACTOR_VERSION,
            source_field: `survey.${row.question_key}`,
            raw_excerpt: excerpt(String(rawValue)),
          })
        )
      }
    }

    return out
  },
}

function extractYear(key: string, re: RegExp): number | undefined {
  const m = key.match(re)
  if (!m) return undefined
  const y = Number(m[1])
  return Number.isFinite(y) ? y : undefined
}

/**
 * Quarter extractor — useful for keys like `s2_revenue_2024_q3` in future schemas.
 * Not used in Phase 1 (survey has no quarterly fields yet) but ready to go.
 */
export function extractQuarter(key: string): FiscalQuarter | undefined {
  const m = key.match(/_q([1-4])(?:$|_)/i)
  return m ? (`Q${m[1]}` as FiscalQuarter) : undefined
}

// Self-registration — imported by lib/ai/extractors/index.ts bootstraps registration
import { registerExtractor } from '../registry'
registerExtractor('generic', 'survey', surveyExtractor)
registerExtractor('medical', 'survey', surveyExtractor)
