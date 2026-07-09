/**
 * tests/unit/assistant-mascot/tour-guide.test.ts
 *
 * Фаза 3, Батч B Task 4: чистый движок маршрута экскурсии «Первые шаги».
 * Покрывает: фильтр visibleSteps (экраны без тура в TOURS выпадают), краевые
 * случаи clampStepIdx/nextStepIdx/isLastStep над (idx, total) и инвариант
 * «каждый шаг каталога есть в TOURS и достижим в навигации».
 */

import { describe, it, expect } from 'vitest'
import {
  clampStepIdx,
  isLastStep,
  nextStepIdx,
  visibleSteps,
  TOUR_GUIDE_STEPS,
  type TourGuideStep,
} from '@/lib/assistant/mascot/tour-guide'
import { tourForScreen } from '@/lib/assistant/mascot/tours'
import { NAV_ITEMS } from '@/lib/navigation'

const navHrefs = new Set<string>()
for (const item of NAV_ITEMS) {
  navHrefs.add(item.href)
  for (const sub of item.subItems ?? []) navHrefs.add(sub.href)
}

const hasTourReal = (screen: string) => tourForScreen(screen) !== null

describe('TOUR_GUIDE_STEPS catalog', () => {
  it('starts on the dashboard and covers the key portal screens in order', () => {
    expect(TOUR_GUIDE_STEPS[0]).toEqual({ screen: '/dashboard', title: 'Дашборд' })
    const screens = TOUR_GUIDE_STEPS.map((s) => s.screen)
    expect(screens).toContain('/gri')
    expect(screens).toContain('/pulse')
    expect(screens).toContain('/market')
  })

  it('every catalog screen has a runtime tour and a real navigation href', () => {
    for (const step of TOUR_GUIDE_STEPS) {
      expect(tourForScreen(step.screen)).not.toBeNull()
      expect(navHrefs.has(step.screen)).toBe(true)
    }
  })
})

describe('visibleSteps', () => {
  const steps: TourGuideStep[] = [
    { screen: '/dashboard', title: 'Дашборд' },
    { screen: '/nope', title: 'Нет тура' },
    { screen: '/gri', title: 'GRI' },
  ]

  it('keeps only steps whose screen has a tour', () => {
    const visible = visibleSteps(steps, (s) => s !== '/nope')
    expect(visible.map((s) => s.screen)).toEqual(['/dashboard', '/gri'])
  })

  it('drops everything when nothing has a tour', () => {
    expect(visibleSteps(steps, () => false)).toEqual([])
  })

  it('against the real TOURS catalog yields only screens present in TOURS', () => {
    for (const step of visibleSteps(TOUR_GUIDE_STEPS, hasTourReal)) {
      expect(tourForScreen(step.screen)).not.toBeNull()
    }
    // Все текущие шаги каталога имеют тур, так что фильтр их не режет.
    expect(visibleSteps(TOUR_GUIDE_STEPS, hasTourReal)).toEqual(TOUR_GUIDE_STEPS)
  })
})

describe('clampStepIdx (idx, total)', () => {
  it('keeps an in-range integer', () => {
    expect(clampStepIdx(0, 7)).toBe(0)
    expect(clampStepIdx(3, 7)).toBe(3)
  })

  it('allows total as the «пройдено» sentinel but not beyond', () => {
    expect(clampStepIdx(7, 7)).toBe(7)
    expect(clampStepIdx(999, 7)).toBe(7)
  })

  it('clamps below 0 and truncates floats', () => {
    expect(clampStepIdx(-5, 7)).toBe(0)
    expect(clampStepIdx(3.9, 7)).toBe(3)
  })

  it('tames NaN/Infinity to 0 (non-finite → 0)', () => {
    expect(clampStepIdx(Number.NaN, 7)).toBe(0)
    expect(clampStepIdx(Number.POSITIVE_INFINITY, 7)).toBe(0)
    expect(clampStepIdx(Number.NEGATIVE_INFINITY, 7)).toBe(0)
  })

  it('returns 0 for an empty route (total 0)', () => {
    expect(clampStepIdx(4, 0)).toBe(0)
    expect(clampStepIdx(0, 0)).toBe(0)
  })
})

describe('nextStepIdx', () => {
  it('advances within range and saturates at total', () => {
    expect(nextStepIdx(0, 7)).toBe(1)
    expect(nextStepIdx(5, 7)).toBe(6)
    expect(nextStepIdx(6, 7)).toBe(7) // на последнем → сентинел total
    expect(nextStepIdx(7, 7)).toBe(7)
  })
})

describe('isLastStep (idx, total)', () => {
  it('is true only on the last visible index', () => {
    expect(isLastStep(6, 7)).toBe(true)
    expect(isLastStep(5, 7)).toBe(false)
    expect(isLastStep(0, 7)).toBe(false)
  })

  it('is false for an empty route and for the done sentinel', () => {
    expect(isLastStep(0, 0)).toBe(false)
    expect(isLastStep(7, 7)).toBe(false) // сентинел «пройдено» — не «последний шаг»
  })
})
