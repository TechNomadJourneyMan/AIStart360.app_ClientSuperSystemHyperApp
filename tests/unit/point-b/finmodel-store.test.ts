import { describe, expect, it } from 'vitest'
import { FINMODEL_KEYS } from '@/lib/point-b/finmodel/keys'
import { finmodelFromSurvey } from '@/lib/point-b/finmodel/sources'
import {
  FinmodelError, loadFinmodel, mergeFinmodel, saveFinmodelValues, verifyFinmodelValues, type FinmodelRow,
} from '@/lib/point-b/finmodel/store'
import type { PointBInputs } from '@/lib/point-b/inputs'
import { ProfanityError } from '@/lib/moderation/profanity'
import { pbDb } from './_pbdb'

const COMPANY = 'company-1'
const OWNER = { id: '00000000-0000-4000-8000-000000000001', role: 'owner' as const, name: 'Владелец' }
const EXPERT = { id: '00000000-0000-4000-8000-0000000000e1', role: 'expert' as const, name: 'Анна Эксперт' }
const REVIEWER = { id: EXPERT.id, name: 'Анна Эксперт' }

const row = (over: Partial<FinmodelRow> & { key: string; value: number }): FinmodelRow => ({
  period_key: '', as_of: null, origin: 'owner', status: 'entered', note: null, verified_by_name: null, verified_at: null, updated_at: '2026-10-18T09:00:00Z', ...over,
})

const pbWith = (answers: Record<string, unknown>) => ({ answers } as unknown as PointBInputs)

describe('finmodel store — validation and writes', () => {
  it('a value outside the range or negative is rejected with invalid_value and the field name', async () => {
    const { sb, db } = pbDb()
    const bad = async (key: string, value: number) =>
      saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: key as never, value }] }).catch((e) => e)

    for (const [key, value] of [['cash_balance', -1], ['tax_rate', 1.5], ['dso_days', 400], ['interest_rate_annual', 2], ['capex_year', Number.NaN], ['payroll_month', Infinity]] as const) {
      const err = await bad(key, value)
      expect(err).toBeInstanceOf(FinmodelError)
      expect(err).toMatchObject({ code: 'invalid_value', field: key })
    }
    const unknown = await bad('revenue', 5)
    expect(unknown).toMatchObject({ code: 'unknown_key', field: 'revenue' })
    expect(db.pb_finmodel_inputs).toHaveLength(0)
  })

  it('nothing is written when one of several values is wrong', async () => {
    const { sb, db } = pbDb()
    await expect(saveFinmodelValues(sb, {
      companyId: COMPANY, actor: OWNER,
      values: [{ key: 'cash_balance', value: 5 }, { key: 'tax_rate', value: 7 }],
    })).rejects.toMatchObject({ field: 'tax_rate' })
    expect(db.pb_finmodel_inputs).toHaveLength(0)
  })

  it('0 is valid for debt_total, capex_year and debt_service_month', async () => {
    const { sb, db } = pbDb()
    const saved = await saveFinmodelValues(sb, {
      companyId: COMPANY, actor: OWNER,
      values: [{ key: 'debt_total', value: 0 }, { key: 'capex_year', value: 0 }, { key: 'debt_service_month', value: 0 }],
    })
    expect(Object.keys(saved).sort()).toEqual(['capex_year', 'debt_service_month', 'debt_total'])
    expect(db.pb_finmodel_inputs.map((r) => r.value)).toEqual([0, 0, 0])
  })

  it('owner entry is origin owner status entered; expert entry origin expert', async () => {
    const { sb, db } = pbDb()
    const a = await saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 5_000_000, asOf: '2026-10-15', note: 'по выписке' }] })
    expect(a.cash_balance).toMatchObject({ value: 5_000_000, origin: 'owner', status: 'entered', asOf: '2026-10-15', note: 'по выписке' })
    const b = await saveFinmodelValues(sb, { companyId: COMPANY, actor: EXPERT, values: [{ key: 'payroll_month', value: 2_000_000 }] })
    expect(b.payroll_month).toMatchObject({ origin: 'expert', status: 'entered' })
    expect(db.pb_finmodel_inputs.find((r) => r.key === 'payroll_month')).toMatchObject({ origin: 'expert', updated_by: EXPERT.id, company_id: COMPANY })
  })

  it('a repeated entry overwrites the row of the same key and period', async () => {
    const { sb, db } = pbDb()
    await saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 1 }] })
    await saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 2 }] })
    expect(db.pb_finmodel_inputs).toHaveLength(1)
    expect(db.pb_finmodel_inputs[0].value).toBe(2)
  })

  it('verifying sets verified_by, name and date; re-entering a verified value returns it to entered', async () => {
    const { sb, db } = pbDb()
    await saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 100 }, { key: 'payroll_month', value: 50 }] })
    await verifyFinmodelValues(sb, { companyId: COMPANY, keys: ['cash_balance'], reviewer: REVIEWER, now: new Date('2026-10-18T10:00:00Z') })
    const verified = db.pb_finmodel_inputs.find((r) => r.key === 'cash_balance')!
    expect(verified).toMatchObject({ status: 'verified', verified_by: EXPERT.id, verified_by_name: 'Анна Эксперт', verified_at: '2026-10-18T10:00:00.000Z' })
    expect(db.pb_finmodel_inputs.find((r) => r.key === 'payroll_month')!.status).toBe('entered')

    const state = await loadFinmodel(sb, { companyId: COMPANY, template: 'default', pb: pbWith({}) })
    expect(state.values.cash_balance).toMatchObject({ status: 'verified', verifiedByName: 'Анна Эксперт', verifiedAt: '2026-10-18T10:00:00.000Z' })

    await saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 101 }] })
    expect(db.pb_finmodel_inputs.find((r) => r.key === 'cash_balance')).toMatchObject({
      status: 'entered', origin: 'owner', verified_by: null, verified_by_name: null, verified_at: null,
    })
  })

  it('verify refuses a key without a stored value (questionnaire, default or nothing) with not_found', async () => {
    const { sb } = pbDb()
    await expect(verifyFinmodelValues(sb, { companyId: COMPANY, keys: ['tax_rate'], reviewer: REVIEWER }))
      .rejects.toMatchObject({ code: 'not_found', field: 'tax_rate' })
    await expect(verifyFinmodelValues(sb, { companyId: COMPANY, keys: [], reviewer: REVIEWER })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('profanity in note throws with the field', async () => {
    const { sb, db } = pbDb()
    const err = await saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 1, note: 'ну это хуйня' }] }).catch((e) => e)
    expect(err).toBeInstanceOf(ProfanityError)
    expect(err.field).toBe('note')
    expect(db.pb_finmodel_inputs).toHaveLength(0)
  })

  it('a note is limited to 500 characters and the date and period are checked', async () => {
    const { sb } = pbDb()
    await expect(saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 1, note: 'а'.repeat(501) }] })).rejects.toMatchObject({ field: 'note' })
    await expect(saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 1, asOf: '15.10.2026' }] })).rejects.toMatchObject({ field: 'asOf' })
    await expect(saveFinmodelValues(sb, { companyId: COMPANY, actor: OWNER, values: [{ key: 'cash_balance', value: 1, period: '2026-13' }] })).rejects.toMatchObject({ field: 'period' })
  })
})

describe('finmodel store — merge of the sources', () => {
  it('merge priority: expert verified beats owner beats survey beats metric beats default', () => {
    const survey = finmodelFromSurvey({ s9n_debts_amount: 7_000_000, s9n_debtor_days: 40 })
    // dso_days: survey 40 beats the default 14
    const s0 = mergeFinmodel({ rows: [], survey, template: 'default' })
    expect(s0.values.dso_days).toMatchObject({ value: 40, origin: 'survey', status: 'auto' })
    expect(s0.values.dio_days).toMatchObject({ value: 20, origin: 'default', status: 'auto' })
    // the owner beats the survey
    const s1 = mergeFinmodel({ rows: [row({ key: 'dso_days', value: 25 })], survey, template: 'default' })
    expect(s1.values.dso_days).toMatchObject({ value: 25, origin: 'owner', status: 'entered' })
    // the expert's entry beats the owner's
    const s2 = mergeFinmodel({
      rows: [row({ key: 'dso_days', value: 25 }), row({ key: 'dso_days', value: 30, origin: 'expert', period_key: '2026-09' })],
      survey, template: 'default',
    })
    expect(s2.values.dso_days).toMatchObject({ value: 30, origin: 'expert' })
    // a verified value beats everything (also an owner's value an expert checked)
    const s3 = mergeFinmodel({
      rows: [
        row({ key: 'dso_days', value: 30, origin: 'expert', period_key: '2026-09' }),
        row({ key: 'dso_days', value: 28, origin: 'owner', status: 'verified', verified_by_name: 'Анна', verified_at: '2026-10-01T00:00:00Z', period_key: '2026-08' }),
      ],
      survey, template: 'default',
    })
    expect(s3.values.dso_days).toMatchObject({ value: 28, status: 'verified', verifiedByName: 'Анна' })
    // no metric is substituted for the cash on the account (cash_flow_mes is a flow, not a balance)
    expect(mergeFinmodel({ rows: [], survey, template: 'default' }).values.cash_balance).toBeUndefined()
  })

  it('fixed_costs_month comes from survey rent and other costs divided by 12 only when both are numbers', () => {
    expect(finmodelFromSurvey({ s9n_expense_rent: '6 000 000', s9n_expense_other: '600 000' }).fixed_costs_month)
      .toMatchObject({ value: 550_000, period: '2024' })
    expect(finmodelFromSurvey({ s9n_expense_rent: 1_200_000, s9n_expense_other: '1,2 млн' }).fixed_costs_month?.value).toBe(200_000)
    // a monthly figure is annualised
    expect(finmodelFromSurvey({ s9n_expense_rent: '300 000 в месяц', s9n_expense_other: '0' }).fixed_costs_month?.value).toBe(300_000)
    expect(finmodelFromSurvey({ s9n_expense_rent: '6 млн', s9n_expense_other: 'не знаю' }).fixed_costs_month).toBeUndefined()
    expect(finmodelFromSurvey({ s9n_expense_rent: '6 млн' }).fixed_costs_month).toBeUndefined()
    expect(finmodelFromSurvey({ s9n_expense_rent: '2-3 млн', s9n_expense_other: '1 млн' }).fixed_costs_month).toBeUndefined()
  })

  it('debt and days of payment are read from the questionnaire; 0 debt is an answer', () => {
    expect(finmodelFromSurvey({ s9n_debts_amount: 0 }).debt_total).toMatchObject({ value: 0 })
    expect(finmodelFromSurvey({ s9n_debts_amount: '15 млн' }).debt_total?.value).toBe(15_000_000)
    expect(finmodelFromSurvey({ s9n_debts_amount: 'есть кредит' }).debt_total).toBeUndefined()
    expect(finmodelFromSurvey({ s9n_debtor_days: '2 недели' }).dso_days?.value).toBe(14)
    expect(finmodelFromSurvey({ s9n_debtor_days: 400 }).dso_days).toBeUndefined()
    expect(finmodelFromSurvey({}).debt_total).toBeUndefined()
  })

  it('defaults are applied only to tax and NWC days and listed in defaulted', () => {
    const s = mergeFinmodel({ rows: [], survey: {}, template: 'ecommerce' })
    expect([...s.defaulted].sort()).toEqual(['dio_days', 'dpo_days', 'dso_days', 'tax_rate'])
    for (const k of s.defaulted) expect(s.values[k]).toMatchObject({ origin: 'default', status: 'auto' })
    expect(s.values.tax_rate?.value).toBe(0.1)
    expect(s.values.dio_days?.value).toBe(45)
    // a typed value is not «defaulted»
    const t = mergeFinmodel({ rows: [row({ key: 'tax_rate', value: 0.2 })], survey: {}, template: 'ecommerce' })
    expect(t.defaulted).not.toContain('tax_rate')
    expect(t.values.tax_rate?.value).toBe(0.2)
  })

  it('cash_balance, payroll_month, fixed_costs_month, capex_year and debt_total have no defaults and stay in missing', () => {
    const s = mergeFinmodel({ rows: [], survey: {}, template: 'services' })
    expect(s.missing.sort()).toEqual(['capex_year', 'cash_balance', 'debt_total', 'fixed_costs_month', 'payroll_month'])
    expect(s.complete).toBe(false)
    for (const k of s.missing) expect(s.values[k]).toBeUndefined()
  })

  it('debt service and interest become required when debt_total > 0', () => {
    const base = [
      row({ key: 'cash_balance', value: 1 }), row({ key: 'payroll_month', value: 1 }), row({ key: 'fixed_costs_month', value: 1 }), row({ key: 'capex_year', value: 0 }),
    ]
    const noDebt = mergeFinmodel({ rows: [...base, row({ key: 'debt_total', value: 0 })], survey: {}, template: 'default' })
    expect(noDebt.missing).toEqual([])
    expect(noDebt.complete).toBe(true)
    const debt = mergeFinmodel({ rows: [...base, row({ key: 'debt_total', value: 3_000_000 })], survey: {}, template: 'default' })
    expect(debt.missing.sort()).toEqual(['debt_service_month', 'interest_rate_annual'])
    expect(debt.complete).toBe(false)
    const full = mergeFinmodel({
      rows: [...base, row({ key: 'debt_total', value: 3_000_000 }), row({ key: 'debt_service_month', value: 0 }), row({ key: 'interest_rate_annual', value: 0 })],
      survey: {}, template: 'default',
    })
    expect(full.complete).toBe(true)
  })

  it('complete is true only when missing is empty', () => {
    const all = FINMODEL_KEYS.map((key) => row({ key, value: 1 }))
    expect(mergeFinmodel({ rows: all, survey: {}, template: 'default' }).complete).toBe(true)
    expect(mergeFinmodel({ rows: all.filter((r) => r.key !== 'payroll_month'), survey: {}, template: 'default' })).toMatchObject({ complete: false, missing: ['payroll_month'] })
  })

  it('loadFinmodel merges stored rows with the questionnaire and does not fail without the table', async () => {
    const { sb } = pbDb({ pb_finmodel_inputs: [{ id: 'x', company_id: COMPANY, ...row({ key: 'cash_balance', value: 9 }) }] })
    const state = await loadFinmodel(sb, { companyId: COMPANY, template: 'default', pb: pbWith({ s9n_debts_amount: 0 }) })
    expect(state.values.cash_balance?.value).toBe(9)
    expect(state.values.debt_total).toMatchObject({ value: 0, origin: 'survey' })
    expect(state.facts).toEqual({ opexMonthly: null, adSpendMonthly: null })

    const noTable = {
      from: () => {
        const b: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in']) b[m] = () => b
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }).then(res)
        return b
      },
    }
    const empty = await loadFinmodel(noTable as never, { companyId: COMPANY, template: 'default', pb: pbWith({}) })
    expect(empty.complete).toBe(false)
    expect(Object.keys(empty.values).sort()).toEqual(['dio_days', 'dpo_days', 'dso_days', 'tax_rate'])
  })
})
