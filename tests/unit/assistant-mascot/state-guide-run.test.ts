/**
 * tests/unit/assistant-mascot/state-guide-run.test.ts
 *
 * Фаза 3, Батч B Task 4 (I3): слияние tourGuide в setContext во время/после
 * прогона экскурсии.
 *   • mergeTourGuide (чистая логика): guideRunning=true → локальный целиком;
 *     guideRunning=false → серверный с ранг-защитой (done/dismissed > active >
 *     pending), даунгрейд запрещён, терминалы при равном ранге держим локально.
 *   • setContext-обёртка: живой прогон не откатывается протухшим /context; после
 *     прогона адаптируется авторитетный серверный tourGuide (кросс-девайс/резюм).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { mergeTourGuide, useMascotStore } from '@/lib/assistant/mascot/state'
import {
  DEFAULT_MASCOT_SETTINGS,
  type AssistantContextPayload,
  type MascotSettings,
  type TourGuideState,
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

function setLocalGuide(tourGuide: TourGuideState, guideRunning: boolean) {
  useMascotStore.setState({
    guideRunning,
    settings: { ...DEFAULT_MASCOT_SETTINGS, tourGuide },
  } as never)
}

describe('mergeTourGuide — pure merge', () => {
  const active: TourGuideState = { status: 'active', stepIdx: 3 }
  const staleActive: TourGuideState = { status: 'active', stepIdx: 1 }
  const done: TourGuideState = { status: 'done', stepIdx: 7 }
  const dismissed: TourGuideState = { status: 'dismissed', stepIdx: 0 }
  const pending: TourGuideState = { status: 'pending', stepIdx: 0 }

  it('running → always keeps the local copy', () => {
    expect(mergeTourGuide(active, staleActive, true)).toBe(active)
    expect(mergeTourGuide(done, staleActive, true)).toBe(done)
    expect(mergeTourGuide({ status: 'active', stepIdx: 0 }, dismissed, true).status).toBe('active')
  })

  it('not running → a higher-rank server wins (progress adopted)', () => {
    expect(mergeTourGuide(active, done, false)).toBe(done)
    expect(mergeTourGuide(pending, active, false)).toBe(active)
  })

  it('not running → a lower-rank server never downgrades the local status', () => {
    expect(mergeTourGuide(active, pending, false)).toBe(active)
    expect(mergeTourGuide(done, staleActive, false)).toBe(done)
    expect(mergeTourGuide(dismissed, pending, false)).toBe(dismissed)
  })

  it('not running, equal non-terminal rank → server (cross-device authoritative)', () => {
    expect(mergeTourGuide(active, staleActive, false)).toBe(staleActive)
    expect(mergeTourGuide(pending, { status: 'pending', stepIdx: 2 }, false).stepIdx).toBe(2)
  })

  it('not running, equal terminal rank → local (never flip done↔dismissed)', () => {
    expect(mergeTourGuide(done, dismissed, false)).toBe(done)
    expect(mergeTourGuide(dismissed, done, false)).toBe(dismissed)
  })
})

describe('setContext — live-run guard (guideRunning=true)', () => {
  beforeEach(() => {
    useMascotStore.setState({
      guideRunning: false,
      settings: { ...DEFAULT_MASCOT_SETTINGS },
    } as never)
  })

  it('does NOT regress stepIdx from a stale in-flight /context', () => {
    setLocalGuide({ status: 'active', stepIdx: 3 }, true)
    useMascotStore
      .getState()
      .setContext(makePayload({ tourGuide: { status: 'active', stepIdx: 1 } }))
    expect(useMascotStore.getState().settings.tourGuide).toEqual({ status: 'active', stepIdx: 3 })
  })

  it('does NOT revert done → active during the run', () => {
    setLocalGuide({ status: 'done', stepIdx: 7 }, true)
    useMascotStore
      .getState()
      .setContext(makePayload({ tourGuide: { status: 'active', stepIdx: 2 } }))
    expect(useMascotStore.getState().settings.tourGuide).toEqual({ status: 'done', stepIdx: 7 })
  })
})

describe('setContext — server wins once the run ends (guideRunning=false)', () => {
  beforeEach(() => {
    useMascotStore.setState({
      guideRunning: false,
      settings: { ...DEFAULT_MASCOT_SETTINGS },
    } as never)
  })

  it('adopts a higher-rank server tourGuide after the run (cross-device resume)', () => {
    setLocalGuide({ status: 'active', stepIdx: 3 }, false)
    useMascotStore
      .getState()
      .setContext(makePayload({ tourGuide: { status: 'done', stepIdx: 8 } }))
    expect(useMascotStore.getState().settings.tourGuide).toEqual({ status: 'done', stepIdx: 8 })
  })

  it('still protects a local active status from a stale pending payload', () => {
    setLocalGuide({ status: 'active', stepIdx: 5 }, false)
    useMascotStore
      .getState()
      .setContext(makePayload({ tourGuide: { status: 'pending', stepIdx: 0 } }))
    expect(useMascotStore.getState().settings.tourGuide).toEqual({ status: 'active', stepIdx: 5 })
  })
})

describe('setGuideRunning setter', () => {
  it('flips the transient run flag', () => {
    useMascotStore.getState().setGuideRunning(true)
    expect(useMascotStore.getState().guideRunning).toBe(true)
    useMascotStore.getState().setGuideRunning(false)
    expect(useMascotStore.getState().guideRunning).toBe(false)
  })
})
