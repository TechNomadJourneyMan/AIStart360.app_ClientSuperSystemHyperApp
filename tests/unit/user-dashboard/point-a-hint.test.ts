/**
 * Survey Ф5 — /client/home says «Первичная · по быстрым данным» under the Point A
 * tile when a weighed v4 block has no data (as the snapshot and the Point A header do).
 */
import { describe, expect, it } from 'vitest'
import { pointAStatHint, snapshotIsPrimary } from '@/lib/user-dashboard/point-a-hint'

const fmt = (iso: string) => iso.slice(0, 10)
const block = (key: string, score: number | null, status = score === null ? 'insufficient_data' : 'ok', informational = false) => ({ key, score, status, informational })

describe('home Point A hint', () => {
  it('primary snapshot: a weighed block without data', () => {
    expect(snapshotIsPrimary({ overall: 54, blocks: [block('finance', 60), block('team', null)] })).toBe(true)
    expect(snapshotIsPrimary({ overall: 54, blocks: [block('finance', 60), block('esg', null, 'insufficient_data', true)] })).toBe(false)
    expect(snapshotIsPrimary({ overall: null, blocks: [block('team', null)] })).toBe(false)
    expect(snapshotIsPrimary({ overall: 54, blocks: 'nope' })).toBe(false)
    expect(snapshotIsPrimary(null)).toBe(false)
  })

  it('the hint text', () => {
    expect(pointAStatHint({ calculatedAt: '2026-10-23T09:00:00Z', primary: true }, fmt)).toBe('Первичная · по быстрым данным · расчёт 2026-10-23')
    expect(pointAStatHint({ calculatedAt: '2026-10-23T09:00:00Z' }, fmt)).toBe('расчёт 2026-10-23')
    expect(pointAStatHint(null, fmt)).toBe('появится после анкеты')
  })
})
