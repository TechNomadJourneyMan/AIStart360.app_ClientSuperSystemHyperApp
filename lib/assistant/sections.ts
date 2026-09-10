/**
 * lib/assistant/sections.ts — SECTION_FIELD_MAP.
 *
 * The SINGLE editable table that powers both the completion engine
 * (lib/assistant/completion.ts) and the deterministic field validators
 * (lib/assistant/validators/deterministic.ts). Add or retire a field by
 * editing ONE array here.
 *
 * Sections are keyed to the 12 анкета steps in
 * components/onboarding/constants/step-config.ts (STEPS). Each field carries a
 * format descriptor so the deterministic validators know how to check it.
 *
 * SURVEY KEY DRIFT — CRITICAL: the onboarding survey exists in two naming
 * generations. The legacy form wrote s2_/s3_/s5_/s6_ keys; the current 12-step
 * form writes s*n_ keys (s2n_/s9n_ …). A field with an `aliases` chain is
 * considered "answered" when ANY alias holds a usable value — mirroring the
 * alias readers in lib/point-a-engine.ts and lib/point-b/engine.ts. Without
 * this, completion % would read 0 for whichever cohort filled the other form.
 */

// ─── Format descriptors ──────────────────────────────────────────────────────

export type FieldFormat =
  | 'number'
  | 'money'
  | 'percent'
  | 'enum'
  | 'text'
  | 'email'
  | 'url'
  | 'min_len'
  | 'list'
  | 'bool'

export interface SurveyField {
  /** Primary/canonical survey question key. */
  key: string
  /**
   * Alternate keys that satisfy this field (legacy ⇄ current generations).
   * A field is "answered" when the primary key OR any alias holds a value.
   */
  aliases?: string[]
  format: FieldFormat
  /** Minimum character length for `min_len`/`text` free-text fields. */
  minLen?: number
}

export interface AssistantSection {
  /** Stable section id (used as ValidationIssue.section + completion key). */
  id: string
  /** Russian label for the section (drives the UI). */
  label: string
  /** Анкета step number (1–12) from step-config.ts. */
  step: number
  required: SurveyField[]
  recommended: SurveyField[]
}

// ─── The map ─────────────────────────────────────────────────────────────────
//
// Keys are taken verbatim from lib/survey-labels.ts SURVEY_LABELS. Alias chains
// reuse the exact pairings the engines already accept (e.g. revenue 2024 =
// s2_revenue_2024 | s9n_revenue_2024; goal 12m = s6_goal_12months |
// s2n_goal_12m_what; goal 3y = s6_goal_3years | s2n_goal_3y_what).

export const SECTION_FIELD_MAP: AssistantSection[] = [
  // ── Step 1 — Регистрация / О компании ────────────────────────────────────
  {
    id: 'company',
    label: 'О компании',
    step: 1,
    required: [
      { key: 's1_company_name', format: 'text', minLen: 2 },
      { key: 's1_industry', format: 'text', minLen: 2 },
      // Стадия (s1_stage) intentionally NOT required/displayed — kept in data only
      // for the realism rules to read opportunistically (see validators/rules.ts).
      { key: 's1_contact_email', format: 'email' },
    ],
    recommended: [
      { key: 's1_employee_count', format: 'number' },
      { key: 's1_business_model', format: 'enum' },
      { key: 's1_regions', format: 'list' },
      { key: 's1_contact_name', format: 'text', minLen: 2 },
      { key: 's1_contact_phone', format: 'text' },
      { key: 's1_website', format: 'url' },
      { key: 's1_products_list', format: 'text', minLen: 3 },
      { key: 's1_competitors_list', format: 'text', minLen: 3 },
    ],
  },

  // ── Step 2 — Цели ─────────────────────────────────────────────────────────
  {
    id: 'goals',
    label: 'Цели',
    step: 2,
    required: [
      { key: 's2n_goal_12m_what', aliases: ['s6_goal_12months'], format: 'min_len', minLen: 15 },
      { key: 's2n_goal_3y_what', aliases: ['s6_goal_3years'], format: 'min_len', minLen: 15 },
    ],
    recommended: [
      { key: 's2n_goal_12m_metrics', format: 'text', minLen: 5 },
      { key: 's2n_goal_3y_metrics', format: 'text', minLen: 5 },
      { key: 's2n_tried_for_growth', format: 'text', minLen: 5 },
      { key: 's2n_what_blocks_growth', aliases: ['s6_growth_blockers'], format: 'text', minLen: 5 },
      { key: 's6_main_pain', format: 'min_len', minLen: 10 },
    ],
  },

  // ── Step 3 — Позиционирование ─────────────────────────────────────────────
  {
    id: 'positioning',
    label: 'Позиционирование',
    step: 3,
    required: [
      { key: 's3n_client_portrait', aliases: ['s5_target_audience'], format: 'min_len', minLen: 15 },
      { key: 's3n_client_problem', format: 'min_len', minLen: 15 },
    ],
    recommended: [
      { key: 's3n_price_segment', format: 'enum' },
      { key: 's3n_decision_maker', format: 'text', minLen: 3 },
      { key: 's3n_competitor_why_us', aliases: ['s5_usp'], format: 'min_len', minLen: 10 },
      { key: 's3n_cannot_copy', format: 'text', minLen: 5 },
      { key: 's3n_measurable_results', format: 'text', minLen: 5 },
    ],
  },

  // ── Step 4 — HR / Орг. структура ──────────────────────────────────────────
  {
    id: 'org',
    label: 'Орг. структура',
    step: 4,
    required: [
      { key: 's4_dept_count', aliases: ['s4n_staffing_table'], format: 'number' },
    ],
    recommended: [
      { key: 's4_has_org_chart', format: 'bool' },
      { key: 's4_has_dept_kpi', format: 'bool' },
      { key: 's4_management_method', format: 'enum' },
      { key: 's4n_structure_matches', format: 'text' },
      { key: 's4n_open_vacancies', format: 'text' },
      { key: 's4n_team_fit_12m', format: 'text' },
    ],
  },

  // ── Step 5 — Проверка данных / Работа с базой ─────────────────────────────
  {
    id: 'base',
    label: 'Работа с базой',
    step: 5,
    required: [],
    recommended: [
      { key: 's5n_funnel_lead_to_sale', format: 'percent' },
      { key: 's5n_funnel_call_to_sale', format: 'percent' },
      { key: 's5n_product_locomotive', aliases: ['s3_flagship_product'], format: 'text', minLen: 2 },
      { key: 's5n_will_return_nps', aliases: ['s7_nps_score'], format: 'number' },
      { key: 's5n_client_list_table', format: 'text' },
      { key: 's5n_abc_analysis', format: 'text' },
    ],
  },

  // ── Step 6 — Уточняющий опрос / CJM ───────────────────────────────────────
  {
    id: 'cjm',
    label: 'CJM',
    step: 6,
    required: [],
    recommended: [
      { key: 's6n_journey_table', format: 'text' },
      { key: 's6n_weak_funnel_points', format: 'text', minLen: 5 },
      { key: 's6n_post_sale_touchpoints', format: 'text', minLen: 5 },
      { key: 's6n_script_first_contact', format: 'text' },
    ],
  },

  // ── Step 7 — Маркетинг (Step7MarketingForm writes s5_* / s7_* / s7n_*) ─────
  {
    id: 'marketing',
    label: 'Маркетинг',
    step: 7,
    required: [],
    recommended: [
      { key: 's5_marketing_channels', format: 'list' },
      { key: 's5_marketing_budget_pct', format: 'percent' },
      { key: 's7n_content_strategy', format: 'text', minLen: 5 },
      { key: 's5_competitor_1', format: 'text', minLen: 2 },
    ],
  },

  // ── Step 9 — Финансы (Step9FinanceForm writes the s9n_* family) ───────────
  // Was attached to step 7 (the marketing form): the inline hints on the
  // marketing step nagged about «Выручка 2024», which lives on step 9.
  {
    id: 'finance',
    label: 'Финансы',
    step: 9,
    required: [
      { key: 's9n_revenue_2024', aliases: ['s2_revenue_2024'], format: 'money' },
    ],
    recommended: [
      { key: 's9n_net_profit', format: 'money' },
      { key: 's9n_net_margin', aliases: ['s2_gross_margin'], format: 'percent' },
      { key: 's9n_change_vs_2023', format: 'percent' },
      // NB: do NOT alias s2_knows_breakeven here — that is a boolean «знает ли
      // точку безубыточности» (yes/no), not the numeric break-even amount. Aliasing
      // it made the validator read `true` into a money field → false
      // "должно быть числом, содержит true" warning.
      { key: 's9n_breakeven_point', format: 'money' },
      { key: 's9n_transparency_pct', format: 'percent' },
      { key: 's9n_accounting_method', format: 'enum' },
      { key: 's9n_tax_system', format: 'enum' },
      { key: 's9n_financial_blockers', format: 'text', minLen: 5 },
    ],
  },

  // ── Step 8 — Аудит базы / Ключевые метрики ────────────────────────────────
  {
    id: 'metrics',
    label: 'Ключевые метрики',
    step: 8,
    required: [],
    recommended: [
      { key: 's8n_metrics_table', format: 'text' },
      { key: 's2_avg_check', aliases: ['s7_avg_check_target_kzt'], format: 'money' },
      { key: 's2_ltv', format: 'money' },
      { key: 's2_cac', format: 'money' },
    ],
  },

  // ── Step 5 — сегментация базы (s5n_* live in Step5ClientBaseForm) ─────────
  // Listed after the main step-5 section so getSectionByStep(5) keeps
  // returning «Работа с базой» for the wizard's inline hints.
  {
    id: 'segmentation',
    label: 'Сегментация базы',
    step: 5,
    required: [],
    recommended: [
      { key: 's5n_rfm_analysis', format: 'text' },
      { key: 's5n_most_marginal', format: 'text', minLen: 2 },
      { key: 's5n_entry_product', format: 'text', minLen: 2 },
      { key: 's5n_upsell_crosssell', format: 'text' },
    ],
  },

  // ── Step 10 — Личные вопросы ──────────────────────────────────────────────
  {
    id: 'personal',
    label: 'Личные вопросы',
    step: 10,
    required: [],
    recommended: [
      { key: 's10_why_opened', format: 'text', minLen: 10 },
      { key: 's10_company_vision_5y', format: 'text', minLen: 10 },
      { key: 's10_what_depts_lack', format: 'text', minLen: 5 },
      { key: 's10_delegation_ready', format: 'number' },
    ],
  },

  // ── Step 11 — Карта влияния ───────────────────────────────────────────────
  {
    id: 'strategy',
    label: 'Карта влияния',
    step: 11,
    required: [],
    recommended: [
      { key: 's11_influence_map', format: 'text' },
    ],
  },

  // ── Step 12 — Системы и инструменты ───────────────────────────────────────
  {
    id: 'systems',
    label: 'Системы и инструменты',
    step: 12,
    required: [],
    recommended: [
      { key: 's12_crm_tool', aliases: ['s3_has_crm'], format: 'enum' },
      { key: 's12_bi_tool', aliases: ['s4_reporting_tool'], format: 'enum' },
      { key: 's12_project_mgmt', aliases: ['s4_task_manager'], format: 'enum' },
      { key: 's12_telephony', format: 'enum' },
    ],
  },
]

// ─── Helpers (shared by completion + validators) ────────────────────────────

/** Every key (primary + aliases) that satisfies a field. */
export function fieldKeys(field: SurveyField): string[] {
  return field.aliases && field.aliases.length > 0
    ? [field.key, ...field.aliases]
    : [field.key]
}

/**
 * True when at least one of the field's keys (primary OR alias) holds a usable
 * value in the parsed answers map. Mirrors the alias-reader semantics of the
 * Point A / Point B engines:
 *  - empty string / null / undefined → not answered
 *  - empty array → not answered
 *  - the number 0 → counts as answered (an explicit zero is a real answer),
 *    EXCEPT booleans `false` which still count as answered.
 */
export function isFieldAnswered(answers: Record<string, unknown>, field: SurveyField): boolean {
  for (const k of fieldKeys(field)) {
    const v = answers[k]
    if (v === undefined || v === null) continue
    if (typeof v === 'string') {
      if (v.trim() !== '') return true
      continue
    }
    if (Array.isArray(v)) {
      if (v.length > 0) return true
      continue
    }
    if (typeof v === 'object') {
      // Tables / structured answers — non-empty object counts as answered.
      if (Object.keys(v as Record<string, unknown>).length > 0) return true
      continue
    }
    // number (incl. 0) or boolean (incl. false) → an explicit answer.
    return true
  }
  return false
}

/** Look up a section definition by its id. */
export function getSection(id: string): AssistantSection | undefined {
  return SECTION_FIELD_MAP.find((s) => s.id === id)
}

/** Look up a section definition by its анкета step number. */
export function getSectionByStep(step: number): AssistantSection | undefined {
  return SECTION_FIELD_MAP.find((s) => s.step === step)
}
