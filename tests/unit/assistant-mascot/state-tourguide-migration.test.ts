/**
 * tests/unit/assistant-mascot/state-tourguide-migration.test.ts
 *
 * Регрессия ревью Батча A (C1): persisted-блоб 'aistart_mascot_v1', записанный
 * ДО появления settings.tourGuide, не должен убивать маскота. Два пояса:
 *   1) migrateMascotPersist (persist v2) бэкфилит tourGuide/behavior по-польно,
 *      НЕ теряя toursDone/dismissedHints пользователя;
 *   2) setContext защищён и на старом зеркале без tourGuide не бросает
 *      TypeError, а даёт дефолт.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { migrateMascotPersist, useMascotStore } from '@/lib/assistant/mascot/state'
import {
  DEFAULT_MASCOT_SETTINGS,
  DEFAULT_TOUR_GUIDE,
  type AssistantContextPayload,
  type MascotSettings,
} from '@/lib/assistant/mascot/types'

function makePayload(settings: Partial<MascotSettings>): AssistantContextPayload {
  return {
    ok: true,
    progress: {
      completionPct: 0,
      completedSections: 0,
      totalSections: 9,
      status: 'in_progress',
      nextSection: null,
    },
    results: { hasDiagnostic: false, griIndex: null, topLimit: null, realismLevel: null },
    hints: [],
    settings: { ...DEFAULT_MASCOT_SETTINGS, ...settings },
  }
}

/** Настройки «как из старого блоба»: поля Фазы 3 отсутствуют. */
function legacySettings(extra: Partial<MascotSettings> = {}): MascotSettings {
  const s: Record<string, unknown> = { ...DEFAULT_MASCOT_SETTINGS, ...extra }
  delete s.tourGuide
  return s as unknown as MascotSettings
}

describe('migrateMascotPersist — persist v2', () => {
  it('back-fills tourGuide with the default on an old blob', () => {
    const migrated = migrateMascotPersist({
      cooldowns: { global: 0, perScreen: {}, perHint: {}, muted: {} },
      minimized: false,
      settings: legacySettings(),
      lastCompletedSections: 2,
    })
    expect(migrated.settings.tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
    expect(migrated.lastCompletedSections).toBe(2)
  })

  it("does NOT drop the user's toursDone/dismissedHints/greeted", () => {
    const migrated = migrateMascotPersist({
      settings: legacySettings({
        greeted: true,
        toursDone: ['/gri', '/dashboard'],
        dismissedHints: ['idle'],
        character: 'owl',
      }),
    })
    expect(migrated.settings.greeted).toBe(true)
    expect(migrated.settings.toursDone).toEqual(['/gri', '/dashboard'])
    expect(migrated.settings.dismissedHints).toEqual(['idle'])
    expect(migrated.settings.character).toBe('owl')
    expect(migrated.settings.tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
  })

  it('merges a partial behavior field-wise instead of resetting it', () => {
    const migrated = migrateMascotPersist({
      settings: { ...legacySettings(), behavior: { walking: false } },
    })
    expect(migrated.settings.behavior.walking).toBe(false)
    expect(migrated.settings.behavior.sleep).toBe(true) // default backfilled
  })

  it('keeps an already-migrated tourGuide untouched', () => {
    const migrated = migrateMascotPersist({
      settings: { ...DEFAULT_MASCOT_SETTINGS, tourGuide: { status: 'active', stepIdx: 3 } },
    })
    expect(migrated.settings.tourGuide).toEqual({ status: 'active', stepIdx: 3 })
  })

  it('survives garbage input (null / non-object) with sane defaults', () => {
    for (const raw of [null, undefined, 'junk', 42]) {
      const migrated = migrateMascotPersist(raw)
      expect(migrated.settings).toEqual(DEFAULT_MASCOT_SETTINGS)
      expect(migrated.minimized).toBe(false)
      expect(migrated.lastCompletedSections).toBeNull()
    }
  })
})

describe('setContext — defensive against a pre-v2 mirror without tourGuide', () => {
  beforeEach(() => {
    useMascotStore.setState({ settings: { ...DEFAULT_MASCOT_SETTINGS } } as never)
  })

  it('does not throw and yields tourGuide defaults on an old mirror', () => {
    // Симулируем регидрацию старого блоба, проскочившую мимо миграции.
    useMascotStore.setState({ settings: legacySettings({ greeted: true }) } as never)

    expect(() => useMascotStore.getState().setContext(makePayload({}))).not.toThrow()
    expect(useMascotStore.getState().settings.tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
    expect(useMascotStore.getState().settings.greeted).toBe(true)
  })

  it('does not throw when the SERVER payload lacks tourGuide (old bag)', () => {
    const payload = makePayload({})
    delete (payload.settings as unknown as Record<string, unknown>).tourGuide

    expect(() => useMascotStore.getState().setContext(payload)).not.toThrow()
    expect(useMascotStore.getState().settings.tourGuide).toEqual(DEFAULT_TOUR_GUIDE)
  })

  it('still protects a local non-pending status from a stale pending payload', () => {
    useMascotStore.setState({
      settings: {
        ...DEFAULT_MASCOT_SETTINGS,
        tourGuide: { status: 'dismissed', stepIdx: 0 },
      },
    } as never)

    useMascotStore
      .getState()
      .setContext(makePayload({ tourGuide: { status: 'pending', stepIdx: 0 } }))

    expect(useMascotStore.getState().settings.tourGuide.status).toBe('dismissed')
  })
})
