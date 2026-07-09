import { describe, it, expect } from 'vitest'
import { computeCoachmarkLayout } from '@/lib/assistant/mascot/coachmark-layout'

const VW = 1280
const VH = 800
const CARD_H = 200

describe('computeCoachmarkLayout', () => {
  it('places the card below the target when there is room', () => {
    const r = computeCoachmarkLayout({ top: 100, left: 500, width: 200, height: 50 }, VW, VH, CARD_H)
    expect(r.below).toBe(true)
    expect(r.top).toBe(100 + 50 + 14) // target bottom + gap
  })

  it('places the card above the target when no room below', () => {
    const r = computeCoachmarkLayout({ top: 700, left: 500, width: 200, height: 60 }, VW, VH, CARD_H)
    expect(r.below).toBe(false)
    expect(r.top).toBe(700 - 14 - CARD_H) // target top - gap - card height
    expect(r.top + CARD_H).toBeLessThanOrEqual(VH - 12)
  })

  it('clamps the card into the viewport vertically (huge target)', () => {
    const r = computeCoachmarkLayout({ top: 10, left: 100, width: 300, height: 900 }, VW, VH, CARD_H)
    expect(r.top).toBeGreaterThanOrEqual(12)
    expect(r.top + CARD_H).toBeLessThanOrEqual(VH - 12 + 1)
  })

  it('shrinks width on narrow viewports', () => {
    const r = computeCoachmarkLayout({ top: 100, left: 0, width: 40, height: 40 }, 320, 700, CARD_H)
    expect(r.width).toBe(320 - 24)
    expect(r.left + r.width).toBeLessThanOrEqual(320 - 12 + 1)
  })

  it('uses full 330 width when viewport allows', () => {
    const r = computeCoachmarkLayout({ top: 100, left: 0, width: 40, height: 40 }, 1280, 800, CARD_H)
    expect(r.width).toBe(330)
    expect(r.left).toBeGreaterThanOrEqual(12)
  })

  it('keeps the arrow within the card', () => {
    const r = computeCoachmarkLayout({ top: 100, left: 1200, width: 60, height: 40 }, VW, VH, CARD_H)
    expect(r.arrowLeft).toBeGreaterThanOrEqual(18)
    expect(r.arrowLeft).toBeLessThanOrEqual(r.width - 18)
  })

  it('falls back to a safe top-left position without a rect', () => {
    const r = computeCoachmarkLayout(null, VW, VH, CARD_H)
    expect(r.top).toBe(12)
    expect(r.left).toBe(12)
  })
})
