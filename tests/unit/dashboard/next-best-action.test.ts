/**
 * tests/unit/dashboard/next-best-action.test.ts — приоритет «1 действия» (Фаза 5, №2).
 */

import { describe, it, expect } from 'vitest'
import { pickNextBestAction, type NbaInput } from '@/lib/dashboard/next-best-action'

const base: NbaInput = {
  completionPct: 100,
  nextSectionLabel: null,
  hasDiagnostic: true,
  overdueClients: 0,
  criticalBlockLabel: null,
  griTopLimit: null,
}

describe('pickNextBestAction — priority chain', () => {
  it('incomplete survey wins over everything else', () => {
    const a = pickNextBestAction({
      ...base,
      completionPct: 40,
      nextSectionLabel: 'Финансы',
      overdueClients: 5,
      criticalBlockLabel: 'Продажи',
    })
    expect(a.kind).toBe('finish_survey')
    expect(a.href).toBe('/client/onboarding')
  })

  it('runs the diagnostic when the survey is done but there is none', () => {
    const a = pickNextBestAction({ ...base, hasDiagnostic: false, overdueClients: 3 })
    expect(a.kind).toBe('run_diagnostic')
    expect(a.href).toBe('/gri?tab=assess')
  })

  it('overdue clients beat the red zone (time-sensitive)', () => {
    const a = pickNextBestAction({ ...base, overdueClients: 2, criticalBlockLabel: 'Финансы' })
    expect(a.kind).toBe('call_clients')
    expect(a.title).toContain('2')
    expect(a.href).toBe('/pulse')
  })

  it('red zone beats the top limit', () => {
    const a = pickNextBestAction({ ...base, criticalBlockLabel: 'Операции', griTopLimit: 'X' })
    expect(a.kind).toBe('fix_red_zone')
    expect(a.title).toContain('Операции')
    expect(a.href).toBe('/gri?tab=result')
  })

  it('falls back to the GRI top limit', () => {
    const a = pickNextBestAction({ ...base, griTopLimit: 'Удержание команды' })
    expect(a.kind).toBe('work_top_limit')
    expect(a.title).toContain('Удержание')
  })

  it('celebrates when nothing is pending', () => {
    const a = pickNextBestAction(base)
    expect(a.kind).toBe('all_good')
    expect(a.href).toBe('/pulse')
  })
})
