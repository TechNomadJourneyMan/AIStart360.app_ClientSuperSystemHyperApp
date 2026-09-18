import { describe, it, expect } from 'vitest'
import { calculatePointA, withCurrentAliases } from '@/lib/point-a-engine'

// A client who filled the CURRENT 12-step form: none of the first-generation
// keys (s4_reporting_tool, s4_management_method, s2_knows_breakeven …) exist.
const currentForm = {
  s1_company_name: 'QA_TEST ТОО',
  s4_has_org_chart: true,
  s4_has_regular_meetings: true,
  s4m_control_method: 'kpi',
  s4m_report_automated: 'bi',
  s12_project_mgmt: 'jira',
  s12_crm_tool: 'bitrix24',
  s9n_breakeven_point: 2_500_000,
  s9n_net_margin: 18,
}

describe('Point A engine reads the current survey keys (E2E 2026-09-10)', () => {
  it('Operations is no longer capped at 25 / «Критично» for current-form clients', () => {
    const pa = calculatePointA(currentForm)
    expect(pa.blocks.operations.score).toBeGreaterThan(50)
    expect(pa.risks.map((r) => r.text).join(' ')).not.toMatch(/Ручное управление/)
  })

  it('break-even filled on step 9 is not reported as unknown', () => {
    const pa = calculatePointA(currentForm)
    const text = JSON.stringify([pa.risks, pa.quick_wins])
    expect(text).not.toMatch(/безубыточности неизвестна/i)
  })

  it('data gaps accept the current aliases', () => {
    const fields = calculatePointA(currentForm).data_gaps.map((g) => g.field)
    expect(fields).not.toContain('s2_gross_margin')
    expect(fields).not.toContain('s3_has_crm')
  })

  it('free-text «нет» in the CRM field counts as no CRM', () => {
    expect(withCurrentAliases({ s3_has_crm: 'Нет' }).s3_has_crm).toBe('none')
    expect(withCurrentAliases({ s3_has_crm: 'Нет', s12_crm_tool: 'amocrm' }).s3_has_crm).toBe('amocrm')
  })

  it('legacy answers are never overridden', () => {
    const a = withCurrentAliases({ s4_management_method: 'okr', s4m_control_method: 'fire_fighting', s4_reporting_tool: 'excel', s4m_report_automated: 'bi' })
    expect(a.s4_management_method).toBe('okr')
    expect(a.s4_reporting_tool).toBe('excel')
  })
})
