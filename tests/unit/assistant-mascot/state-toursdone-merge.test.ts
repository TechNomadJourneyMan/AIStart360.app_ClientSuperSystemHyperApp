/**
 * tests/unit/assistant-mascot/state-toursdone-merge.test.ts
 *
 * setContext must UNION the monotonically-growing lists (toursDone,
 * dismissedHints) between the local mirror and the server payload. A stale
 * GET /context response must not clobber a tour completed a second earlier
 * (the «гонка клоббера»). Every other settings field still adopts the server
 * value wholesale. See lib/assistant/mascot/state.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useMascotStore } from '@/lib/assistant/mascot/state'
import {
  DEFAULT_MASCOT_SETTINGS,
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

describe('setContext — union-merge of toursDone/dismissedHints', () => {
  beforeEach(() => {
    // Reset the mirror to defaults before each case.
    useMascotStore.setState({ settings: { ...DEFAULT_MASCOT_SETTINGS } } as never)
  })

  it('unions toursDone so a locally-completed tour survives a stale payload', () => {
    // Local mirror already recorded '/gri' completed a second ago…
    useMascotStore.setState({
      settings: { ...DEFAULT_MASCOT_SETTINGS, toursDone: ['/gri'] },
    } as never)

    // …a stale /context response only knows about '/dashboard'.
    useMascotStore.getState().setContext(makePayload({ toursDone: ['/dashboard'] }))

    const done = useMascotStore.getState().settings.toursDone
    expect(done).toContain('/gri')
    expect(done).toContain('/dashboard')
  })

  it('adopts scalar/other server settings wholesale', () => {
    useMascotStore.setState({
      settings: { ...DEFAULT_MASCOT_SETTINGS, greeted: false, character: 'cat' },
    } as never)

    useMascotStore.getState().setContext(makePayload({ greeted: true, character: 'owl' }))

    const s = useMascotStore.getState().settings
    expect(s.greeted).toBe(true)
    expect(s.character).toBe('owl')
  })

  it('unions dismissedHints the same way', () => {
    useMascotStore.setState({
      settings: { ...DEFAULT_MASCOT_SETTINGS, dismissedHints: ['hint-local'] },
    } as never)

    useMascotStore.getState().setContext(makePayload({ dismissedHints: ['hint-server'] }))

    const hints = useMascotStore.getState().settings.dismissedHints
    expect(hints).toContain('hint-local')
    expect(hints).toContain('hint-server')
  })

  it('does not duplicate an entry present in both mirror and payload', () => {
    useMascotStore.setState({
      settings: { ...DEFAULT_MASCOT_SETTINGS, toursDone: ['/gri'] },
    } as never)

    useMascotStore.getState().setContext(makePayload({ toursDone: ['/gri', '/dashboard'] }))

    const done = useMascotStore.getState().settings.toursDone
    expect(done.filter((t) => t === '/gri')).toHaveLength(1)
    expect(done).toContain('/dashboard')
  })
})
