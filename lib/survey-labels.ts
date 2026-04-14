/**
 * Human-readable labels for onboarding survey question keys.
 * Used in Giga Panel (admin view) and client "My Data" page.
 */

export const SURVEY_STEP_LABELS: Record<number, string> = {
  1: 'Company',
  2: 'Goals',
  3: 'Positioning',
  4: 'Org. Structure',
  5: 'Client Base',
  6: 'CJM',
  7: 'Marketing',
  8: 'Key Metrics',
  9: 'Finance',
  10: 'Personal Questions',
  11: 'Influence Map',
  12: 'Systems & Tools',
}

export const SURVEY_LABELS: Record<string, string> = {
  // ── Step 1 — Company ──────────────────────────────────────────────────
  s1_company_name: 'Company Name',
  s1_founded_at: 'Founded Date',
  s1_industry: 'Industry',
  s1_stage: 'Development Stage',
  s1_employee_count: 'Number of Employees',
  s1_regions: 'Geographic Presence',
  s1_business_model: 'Business Model',
  s1_contact_name: 'Contact Person (Full Name)',
  s1_contact_position: 'Position',
  s1_contact_phone: 'Phone',
  s1_contact_email: 'Contact Email',
  s1_years_on_market: 'Years on Market',
  s1_website: 'Company Website',
  s1_social_media: 'Company Social Media',
  s1_products_list: 'Products/Services List',
  s1_competitors_list: 'Main Competitors',

  // ── Step 2 (old finance fields, kept for backward compat) ───────────────
  s2_revenue_2023: 'Revenue 2023 (₸)',
  s2_revenue_2024: 'Revenue 2024 (₸)',
  s2_revenue_2025: 'Revenue 2025 (₸)',
  s2_new_clients_2023: 'New Clients 2023',
  s2_new_clients_2024: 'New Clients 2024',
  s2_new_clients_2025: 'New Clients 2025',
  s2_repeat_clients_2023: 'Repeat Clients 2023',
  s2_repeat_clients_2024: 'Repeat Clients 2024',
  s2_repeat_clients_2025: 'Repeat Clients 2025',
  s2_avg_check: 'Average Check (₸)',
  s2_gross_margin: 'Gross Margin (%)',
  s2_cac: 'CAC — Customer Acquisition Cost (₸)',
  s2_ltv: 'LTV — Customer Lifetime Value (₸)',
  s2_debt_load: 'Debt Load',
  s2_knows_breakeven: 'Knows Breakeven Point',

  // ── Step 2 new — Goals ───────────────────────────────────────────────────
  s2n_goal_12m_what: '12-Month Goal — What',
  s2n_goal_12m_metrics: '12-Month Goal — Metrics',
  s2n_goal_3y_what: '3-Year Goal — What',
  s2n_goal_3y_metrics: '3-Year Goal — Metrics',
  s2n_tried_for_growth: 'What Has Been Tried for Growth',
  s2n_what_blocks_growth: 'What Blocks Growth',

  // ── Step 3 (old sales/CRM) ─────────────────────────────────────────────
  s3_has_crm: 'CRM System',
  s3_products_description: 'Products/Services Description',
  s3_product_count: 'Number of Products',
  s3_flagship_product: 'Flagship Product',
  s3_deals_2023: 'Closed Deals 2023',
  s3_deals_2024: 'Closed Deals 2024',
  s3_deals_2025: 'Closed Deals 2025',
  s3_rejections_2023: 'Rejections 2023',
  s3_rejections_2024: 'Rejections 2024',
  s3_rejections_2025: 'Rejections 2025',
  s3_deal_cycle_days: 'Deal Cycle (days)',
  s3_promo_channels: 'Promotion Channels',
  s3_has_loyalty: 'Loyalty Program',

  // ── Step 3 new — Positioning ──────────────────────────────────────
  s3n_client_portrait: 'Client Portrait',
  s3n_price_segment: 'Price Segment',
  s3n_decision_maker: 'Decision Maker',
  s3n_purchase_participants: 'Purchase Process Participants',
  s3n_client_problem: 'Client Problem',
  s3n_problem_impact: 'Problem Impact',
  s3n_current_solution: 'Client\'s Current Solution',
  s3n_if_unsolved: 'If the Problem Remains Unsolved',
  s3n_life_after_solution: 'Life After Solution',
  s3n_measurable_results: 'Measurable Results',
  s3n_short_wins: 'Quick Wins',
  s3n_competitor_why_us: 'Why Choose Us Over Competitors',
  s3n_cannot_copy: 'What Cannot Be Copied',
  s3n_competitors_better: 'Where Competitors Are Better',
  s3n_industry_standard: 'Industry Standard',

  // ── Step 4 — Org. Structure (old) ──────────────────────────────────────
  s4_dept_count: 'Number of Departments',
  s4_has_org_chart: 'Has Org Chart',
  s4_management_method: 'Management Method',
  s4_has_regular_meetings: 'Regular Meetings',
  s4_reporting_tool: 'Reporting Tool',
  s4_task_manager: 'Task Manager',
  s4_has_dept_kpi: 'Department KPIs',

  // ── Step 4 new — Org. Structure ────────────────────────────────────────
  s4n_staffing_table: 'Staffing Table',
  s4n_structure_matches: 'Structure Matches Objectives',
  s4n_open_vacancies: 'Open Vacancies',
  s4n_multi_roles: 'Role Overlap',
  s4n_team_fit_12m: 'Team Fit for 12 Months',
  s4n_team_fit_3y: 'Team Fit for 3 Years',

  // ── Step 4 management — Management ─────────────────────────────────────
  s4m_strategic_planning: 'Strategic Planning',
  s4m_planning_team_or_solo: 'Planning — Team or Solo',
  s4m_dept_sync: 'Department Synchronization',
  s4m_control_method: 'Control Method',
  s4m_communication: 'Communication',
  s4m_dept_regulations: 'Department Regulations',
  s4m_cross_functional: 'Cross-Functional Collaboration',
  s4m_feedback_culture: 'Feedback Culture',
  s4m_meeting_structure: 'Meeting Structure',
  s4m_meeting_efficiency: 'Meeting Efficiency',
  s4m_report_types: 'Report Types',
  s4m_report_automated: 'Reports Automated',
  s4m_report_frequency: 'Reporting Frequency',
  s4m_hours_on_ops: 'Hours on Operations',
  s4m_delegation_readiness: 'Delegation Readiness',

  // ── Step 5 — Marketing (old) ───────────────────────────────────────────
  s5_target_audience: 'Target Audience',
  s5_audience_segments: 'Audience Segments',
  s5_top_regions: 'Top Regions',
  s5_marketing_channels: 'Marketing Channels',
  s5_marketing_budget_pct: 'Marketing Budget (% of Revenue)',
  s5_has_competitor_analysis: 'Has Competitor Analysis',
  s5_competitor_1: 'Competitor 1',
  s5_competitor_2: 'Competitor 2',
  s5_competitor_3: 'Competitor 3',
  s5_usp: 'USP (Unique Selling Proposition)',

  // ── Step 5 new — Client Base ────────────────────────────────────────
  s5n_funnel_lead_to_call: 'Conversion: Lead to Call',
  s5n_funnel_call_to_meeting: 'Conversion: Call to Meeting',
  s5n_funnel_call_to_kp: 'Conversion: Call to Proposal',
  s5n_funnel_meeting_to_kp: 'Conversion: Meeting to Proposal',
  s5n_funnel_call_to_sale: 'Conversion: Call to Sale',
  s5n_funnel_meeting_to_sale: 'Conversion: Meeting to Sale',
  s5n_funnel_kp_to_sale: 'Conversion: Proposal to Sale',
  s5n_funnel_lead_to_sale: 'Conversion: Lead to Sale',
  s5n_abc_analysis: 'ABC Client Analysis',
  s5n_rfm_analysis: 'RFM Analysis',
  s5n_product_locomotive: 'Flagship Product',
  s5n_most_marginal: 'Highest Margin Product',
  s5n_entry_product: 'Entry Product',
  s5n_client_list_table: 'Client Table',
  s5n_why_bought: 'Why They Bought',
  s5n_deciding_factor: 'Deciding Factor',
  s5n_compared_with: 'Compared With',
  s5n_barriers: 'Purchase Barriers',
  s5n_how_found_us: 'How They Found Us',
  s5n_intermediate_steps: 'Intermediate Steps',
  s5n_will_return_nps: 'Will Return (NPS)',
  s5n_improve_suggestions: 'Improvement Suggestions',
  s5n_top_questions: 'Top Client Questions',
  s5n_upsell_crosssell: 'Upsell / Cross-sell',

  // ── Step 6 — Goals and Pains (old) ─────────────────────────────────────
  s6_main_pain: 'Main Business Pain',
  s6_goal_12months: '12-Month Goal',
  s6_goal_3years: '3-Year Goal',
  s6_growth_blockers: 'Growth Blockers',
  s6_expectations: 'Platform Expectations',

  // ── Step 6 new — CJM ───────────────────────────────────────────────────
  s6n_journey_table: 'Customer Journey Table (CJM)',
  s6n_weak_funnel_points: 'Weak Funnel Points',
  s6n_post_sale_touchpoints: 'Post-Sale Touchpoints',
  s6n_script_first_contact: 'First Contact Script',
  s6n_script_meeting: 'Meeting Script',
  s6n_script_proposal: 'Proposal Sending Script',

  // ── Step 7 new — Marketing ─────────────────────────────────────────────
  s7n_channels_table: 'Marketing Channels Table',
  s7n_content_strategy: 'Content Strategy',
  s7n_competitor_1_analysis: 'Competitor 1 Analysis',
  s7n_competitor_2_analysis: 'Competitor 2 Analysis',
  s7n_competitor_3_analysis: 'Competitor 3 Analysis',

  // ── Step 8 — Key Metrics ──────────────────────────────────────────
  s8n_metrics_table: 'Key Metrics Table',

  // ── Step 9 — Finance ───────────────────────────────────────────────────
  s9n_revenue_2024: 'Revenue 2024',
  s9n_change_vs_2023: 'Change vs 2023',
  s9n_net_profit: 'Net Profit',
  s9n_net_margin: 'Net Margin',
  s9n_revenue_sources: 'Revenue Sources',
  s9n_seasonality: 'Seasonality',
  s9n_breakeven_point: 'Breakeven Point',
  s9n_dividend_policy: 'Dividend Policy',
  s9n_expense_cogs: 'Expenses: COGS',
  s9n_expense_marketing: 'Expenses: Marketing',
  s9n_expense_rent: 'Expenses: Rent',
  s9n_expense_other: 'Expenses: Other',
  s9n_accounting_method: 'Accounting Method',
  s9n_planning_frequency: 'Planning Frequency',
  s9n_analysis_frequency: 'Analysis Frequency',
  s9n_responsible_person: 'Finance Responsible Person',
  s9n_tracked_kpis: 'Tracked KPIs',
  s9n_debtor_days: 'Debtor Days',
  s9n_debts_amount: 'Debt Amount',
  s9n_tax_system: 'Tax System',
  s9n_transparency_pct: 'Business Transparency (%)',
  s9n_tax_audits: 'Tax Audits',
  s9n_audit_preparedness: 'Audit Preparedness',
  s9n_financial_blockers: 'Financial Blockers',

  // ── Step 10 — Personal Questions ───────────────────────────────────────
  s10_why_opened: 'Why You Started the Business',
  s10_best_result_2y: 'Best Result in 2 Years',
  s10_best_result_5y: 'Best Result in 5 Years',
  s10_best_result_10y: 'Best Result in 10 Years',
  s10_company_vision_2y: 'Company Vision for 2 Years',
  s10_company_vision_5y: 'Company Vision for 5 Years',
  s10_company_vision_10y: 'Company Vision for 10 Years',
  s10_problems_faced: 'Problems Faced',
  s10_who_to_blame: 'Who Is to Blame',
  s10_dept_assessment: 'Department Assessment',
  s10_what_depts_lack: 'What Departments Lack',
  s10_competitor_comparison: 'Comparison with Competitors',
  s10_self_comparison: 'Self-Assessment',
  s10_brand_perception: 'Brand Perception',
  s10_when_they_buy: 'When They Buy from You',
  s10_hours_on_ops: 'Hours per Day on Operations',
  s10_delegation_ready: 'Delegation Readiness (1-10)',
  s10_what_stops_delegating: 'What Prevents Delegation',

  // ── Step 11 — Influence Map ────────────────────────────────────────────
  s11_influence_map: 'Influence Map',

  // ── Step 12 — Systems & Tools ────────────────────────────────────
  s12_crm_tool: 'CRM System',
  s12_edm: 'EDM (Electronic Document Management)',
  s12_erp: 'ERP System',
  s12_bi_tool: 'BI Tool',
  s12_messengers: 'Messengers',
  s12_telephony: 'Telephony',
  s12_project_mgmt: 'Project Management',
  s12_marketing_platforms: 'Marketing Platforms',
  s12_automation_details: 'Automation Details',
  s12_it_support: 'IT Support',
}

/** Get the step number from a question key (e.g. "s2_revenue_2023" → 2) */
export function getStepFromKey(key: string): number {
  const match = key.match(/^s(\d+)_/)
  return match ? parseInt(match[1], 10) : 0
}

/** Format a survey value for display */
export function formatSurveyValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  // Unwrap Supabase JSONB {value: ...} wrapper
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'value' in value) {
    return formatSurveyValue(key, (value as Record<string, unknown>).value)
  }
  // Handle plain objects (shouldn't reach here after unwrap, but safety net)
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    try { return JSON.stringify(value) } catch { return '—' }
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(v => typeof v === 'object' && v !== null && 'value' in v ? (v as any).value : v).join(', ')
  if (typeof value === 'number') {
    if (key.includes('revenue') || key.includes('avg_check') || key.includes('cac') || key.includes('ltv')
        || key.includes('net_profit') || key.includes('debts_amount') || key.includes('breakeven_point')) {
      return new Intl.NumberFormat('en-US').format(value) + ' ₸'
    }
    if (key.includes('margin') || key.includes('budget_pct') || key.includes('transparency_pct')) {
      return value + '%'
    }
    if (key.includes('funnel_')) {
      return value + '%'
    }
    return String(value)
  }

  // ── Enum formatters ─────────────────────────────────────────────────────
  if (key === 's2_debt_load') {
    const map: Record<string, string> = { none: 'None', moderate: 'Moderate', high: 'High' }
    return map[String(value)] || String(value)
  }
  if (key === 's3_has_crm' || key === 's12_crm_tool') {
    const map: Record<string, string> = { none: 'None', excel: 'Excel', amocrm: 'AmoCRM', bitrix24: 'Bitrix24', '1c': '1C', other: 'Other' }
    return map[String(value)] || String(value)
  }
  if (key === 's4_management_method') {
    const map: Record<string, string> = { manual: 'Manual', kpi: 'By KPI', okr: 'OKR', hybrid: 'Hybrid' }
    return map[String(value)] || String(value)
  }
  if (key === 's4_reporting_tool') {
    const map: Record<string, string> = { excel: 'Excel', bi: 'BI System', crm: 'CRM', none: 'None' }
    return map[String(value)] || String(value)
  }
  if (key === 's4_task_manager') {
    const map: Record<string, string> = { none: 'None', trello: 'Trello', jira: 'Jira', notion: 'Notion', other: 'Other' }
    return map[String(value)] || String(value)
  }
  if (key === 's3n_price_segment') {
    const map: Record<string, string> = { economy: 'Economy', medium: 'Medium', premium: 'Premium' }
    return map[String(value)] || String(value)
  }
  if (key === 's9n_planning_frequency' || key === 's9n_analysis_frequency') {
    const map: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', never: 'Not conducted' }
    return map[String(value)] || String(value)
  }
  if (key === 's4m_report_frequency') {
    const map: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', never: 'Not conducted' }
    return map[String(value)] || String(value)
  }
  if (key === 's9n_accounting_method') {
    const map: Record<string, string> = { cash: 'Cash', accrual: 'Accrual', hybrid: 'Hybrid', none: 'Not conducted' }
    return map[String(value)] || String(value)
  }
  if (key === 's9n_tax_system') {
    const map: Record<string, string> = { simplified: 'Simplified', general: 'General', patent: 'Patent', other: 'Other' }
    return map[String(value)] || String(value)
  }
  if (key === 's12_edm' || key === 's12_erp' || key === 's12_bi_tool'
      || key === 's12_telephony' || key === 's12_project_mgmt' || key === 's12_marketing_platforms') {
    const map: Record<string, string> = { none: 'None', other: 'Other' }
    return map[String(value)] || String(value)
  }
  return String(value)
}
