/**
 * tests/unit/assistant-mascot/tourguide-settings.test.ts
 *
 * Фаза 3, Батч A Task 1: настройки онбординг-экскурсии `tourGuide` в
 * profiles.preferences.assistant. Покрывает нормализацию (дефолты, кламп
 * stepIdx 0..50, неизвестный статус → 'pending') и patch-раунд-трип через
 * writeMascotSettings (strict-схема route синхронизирована с типом/normalize).
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeMascotSettings,
  writeMascotSettings,
} from '@/lib/assistant/mascot/settings-server'
import { DEFAULT_TOUR_GUIDE } from '@/lib/assistant/mascot/types'

/** Same minimal Supabase double shape as settings-server-write.test.ts. */
function mockSb(
  updateResult: { data: unknown; error: unknown },
  readData: unknown = { preferences: {} },
) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: readData, error: null }) }
            },
          }
        },
        update() {
          return {
            eq() {
              return { select: async () => updateResult }
            },
          }
        },
      }
    },
  }
}

describe('normalizeMascotSettings — tourGuide', () => {
  it('defaults to pending / stepIdx 0 when the bag is empty', () => {
    expect(normalizeMascotSettings(undefined).tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
    expect(normalizeMascotSettings({}).tourGuide).toEqual({ status: 'pending', stepIdx: 0 })
  })

  it('keeps valid values untouched', () => {
    const res = normalizeMascotSettings({ tourGuide: { status: 'active', stepIdx: 3 } })
    expect(res.tourGuide).toEqual({ status: 'active', stepIdx: 3 })
    for (const status of ['pending', 'active', 'done', 'dismissed'] as const) {
      expect(normalizeMascotSettings({ tourGuide: { status, stepIdx: 0 } }).tourGuide.status).toBe(
        status,
      )
    }
  })

  it('maps an unknown / missing status to pending', () => {
    expect(normalizeMascotSettings({ tourGuide: { status: 'weird', stepIdx: 2 } }).tourGuide.status).toBe(
      'pending',
    )
    expect(normalizeMascotSettings({ tourGuide: { stepIdx: 2 } }).tourGuide.status).toBe('pending')
  })

  it('clamps stepIdx to an integer in 0..50', () => {
    const g = (v: unknown) =>
      normalizeMascotSettings({ tourGuide: { status: 'active', stepIdx: v } }).tourGuide.stepIdx
    expect(g(-5)).toBe(0)
    expect(g(999)).toBe(50)
    expect(g(3.9)).toBe(3) // truncated, not rounded
    expect(g('nope')).toBe(0) // non-number → 0
    expect(g(NaN)).toBe(0)
    expect(g(Infinity)).toBe(0)
  })

  it('coerces a non-object tourGuide to the default', () => {
    expect(normalizeMascotSettings({ tourGuide: 'x' }).tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
    expect(normalizeMascotSettings({ tourGuide: [1, 2] }).tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
    expect(normalizeMascotSettings({ tourGuide: null }).tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
  })
})

describe('writeMascotSettings — tourGuide round-trip', () => {
  it('persists a tourGuide patch and returns it merged', async () => {
    const sb = mockSb({ data: [{ id: 'user-1' }], error: null })
    const res = await writeMascotSettings(sb as never, 'user-1', {
      greeted: true,
      tourGuide: { status: 'active', stepIdx: 0 },
    })
    expect(res.greeted).toBe(true)
    expect(res.tourGuide).toEqual({ status: 'active', stepIdx: 0 })
  })

  it('replaces the whole tourGuide object (server merge is shallow per field)', async () => {
    const sb = mockSb(
      { data: [{ id: 'user-1' }], error: null },
      { preferences: { assistant: { tourGuide: { status: 'active', stepIdx: 4 } } } },
    )
    const res = await writeMascotSettings(sb as never, 'user-1', {
      tourGuide: { status: 'done', stepIdx: 8 },
    })
    expect(res.tourGuide).toEqual({ status: 'done', stepIdx: 8 })
  })

  it('normalizes an out-of-range stepIdx on the way through the merge', async () => {
    const sb = mockSb({ data: [{ id: 'user-1' }], error: null })
    const res = await writeMascotSettings(sb as never, 'user-1', {
      // types allow only valid values, but a bad stored value must still be tamed
      tourGuide: { status: 'active', stepIdx: 123 } as never,
    })
    expect(res.tourGuide.stepIdx).toBe(50)
  })

  it('leaves tourGuide at the default when a patch touches other fields only', async () => {
    const sb = mockSb({ data: [{ id: 'user-1' }], error: null })
    const res = await writeMascotSettings(sb as never, 'user-1', { toursDone: ['/gri'] })
    expect(res.tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
  })
})
