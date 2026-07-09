/**
 * tests/unit/gri/pulse-streak.test.ts — стрик еженедельного GRI-пульса (Фаза 5, №11).
 *
 * Опорная точка: среда 2026-07-08 12:00 UTC → текущая неделя начинается
 * с понедельника 2026-07-06; прошлые недели: 2026-06-29, 2026-06-22, 2026-06-15.
 */

import { describe, it, expect } from 'vitest'
import { computePulseStreak } from '@/lib/gri/pulse-streak'

const NOW = Date.UTC(2026, 6, 8, 12, 0, 0) // Wed 2026-07-08

const CUR = '2026-07-06'
const W1 = '2026-06-29' // -1 неделя
const W2 = '2026-06-22' // -2 недели
const W3 = '2026-06-15' // -3 недели

describe('computePulseStreak', () => {
  it('пустой массив → 0', () => {
    expect(computePulseStreak([], NOW)).toBe(0)
  })

  it('только текущая неделя → 1', () => {
    expect(computePulseStreak([CUR], NOW)).toBe(1)
  })

  it('3 недели подряд, включая текущую → 3', () => {
    expect(computePulseStreak([W2, W1, CUR], NOW)).toBe(3)
  })

  it('дырка рвёт серию: текущая есть, -1 пропущена, -2 есть → 1', () => {
    expect(computePulseStreak([CUR, W2, W3], NOW)).toBe(1)
  })

  it('текущая ещё не снята, но прошлые 2 подряд → 2 (грейс до конца недели)', () => {
    expect(computePulseStreak([W1, W2], NOW)).toBe(2)
  })

  it('серия оборвалась раньше прошлой недели → 0', () => {
    expect(computePulseStreak([W2, W3], NOW)).toBe(0)
  })

  it('порядок и дубликаты не важны', () => {
    expect(computePulseStreak([W1, CUR, W1, W2, W2], NOW)).toBe(3)
  })

  it('воскресенье относится к неделе своего понедельника', () => {
    const sunday = Date.UTC(2026, 6, 12, 23, 0, 0) // Sun 2026-07-12 — та же неделя, что 07-06
    expect(computePulseStreak([CUR, W1], sunday)).toBe(2)
  })
})
