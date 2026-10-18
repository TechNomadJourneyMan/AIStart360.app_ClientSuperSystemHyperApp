import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULTABLE_KEYS, FINMODEL_DEFS, FINMODEL_KEYS, isFinmodelKey, templateDefaults } from '@/lib/point-b/finmodel/keys'

describe('finmodel keys', () => {
  it('each of the 11 keys has a definition with label, unit, range, hint, unlocks', () => {
    expect(FINMODEL_KEYS).toHaveLength(11)
    for (const key of FINMODEL_KEYS) {
      const d = FINMODEL_DEFS[key]
      expect(d.key).toBe(key)
      expect(d.label.length).toBeGreaterThan(3)
      expect(['₸', '%', 'days']).toContain(d.unit)
      expect(d.min).toBeGreaterThanOrEqual(0)
      expect(d.max).toBeGreaterThan(d.min)
      expect(d.hint.length).toBeGreaterThan(10)
      expect(d.unlocks.length).toBeGreaterThan(5)
      if (d.unit === '%') expect(d.max).toBeLessThanOrEqual(1)
    }
  })

  it('FINMODEL_KEYS equals the key list in migration 126', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/126_point_b_finmodel.sql'), 'utf8').replace(/--.*$/gm, '')
    const m = sql.match(/key\s+TEXT\s+NOT NULL\s+CHECK \(key IN \(([\s\S]*?)\)\)/)
    expect(m).not.toBeNull()
    const keys = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
    expect([...keys].sort()).toEqual([...FINMODEL_KEYS].sort())
  })

  it('hard inputs are cash, fixed costs, payroll, debt and capex; debt service and interest follow the debt', () => {
    expect(FINMODEL_KEYS.filter((k) => FINMODEL_DEFS[k].required).sort()).toEqual(
      ['capex_year', 'cash_balance', 'debt_total', 'fixed_costs_month', 'payroll_month'],
    )
    expect(FINMODEL_DEFS.debt_service_month.requiredIf?.({ debt_total: 1 })).toBe(true)
    expect(FINMODEL_DEFS.debt_service_month.requiredIf?.({ debt_total: 0 })).toBe(false)
    expect(FINMODEL_DEFS.interest_rate_annual.requiredIf?.({ debt_total: null })).toBe(false)
  })

  it('defaults exist only for tax and the working-capital days, by industry', () => {
    expect([...DEFAULTABLE_KEYS].sort()).toEqual(['dio_days', 'dpo_days', 'dso_days', 'tax_rate'])
    expect(templateDefaults('ecommerce')).toEqual({ tax_rate: 0.1, dso_days: 3, dio_days: 45, dpo_days: 20 })
    expect(templateDefaults('services')).toEqual({ tax_rate: 0.1, dso_days: 21, dio_days: 0, dpo_days: 0 })
    expect(templateDefaults('production')).toEqual({ tax_rate: 0.1, dso_days: 30, dio_days: 60, dpo_days: 30 })
    expect(templateDefaults('default')).toEqual({ tax_rate: 0.1, dso_days: 14, dio_days: 20, dpo_days: 15 })
    for (const key of DEFAULTABLE_KEYS) expect(FINMODEL_DEFS[key].required).toBe(false)
  })

  it('isFinmodelKey accepts only the 11 keys', () => {
    expect(isFinmodelKey('cash_balance')).toBe(true)
    expect(isFinmodelKey('revenue')).toBe(false)
    expect(isFinmodelKey(null)).toBe(false)
  })
})
