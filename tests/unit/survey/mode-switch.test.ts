/**
 * Switching modes saves first and stays on failure (spec §5.1 invariant 4).
 */
import { describe, expect, it, vi } from 'vitest'
import { switchSurveyMode } from '@/lib/survey/mode-switch'

const deps = (ok: boolean) => ({
  save: vi.fn(async () => (ok ? { ok: true } : { ok: false, error: 'нет связи' })),
  patchPreferences: vi.fn(async () => undefined),
  track: vi.fn(),
  navigate: vi.fn(),
})

describe('switchSurveyMode', () => {
  it('saves, remembers, tracks and opens the mode', async () => {
    const d = deps(true)
    const r = await switchSurveyMode({ to: 'express', preference: { mode: 'full', chosen_at: '2026-10-20T00:00:00.000Z' }, now: new Date('2026-10-23T10:00:00Z') }, d)
    expect(r).toEqual({ ok: true, href: '/client/onboarding/express' })
    expect(d.save).toHaveBeenCalledBefore(d.patchPreferences)
    expect(d.patchPreferences).toHaveBeenCalledWith({ survey: { mode: 'express', chosen_at: '2026-10-20T00:00:00.000Z', switched_at: '2026-10-23T10:00:00.000Z' } })
    expect(d.track).toHaveBeenCalledWith('SURVEY_MODE_CHOSEN', { mode: 'express', previous: 'full', from: 'switch' })
    expect(d.navigate).toHaveBeenCalledWith('/client/onboarding/express')
  })

  it('a failed save keeps the user where they are', async () => {
    const d = deps(false)
    const r = await switchSurveyMode({ to: 'full', preference: { mode: 'express' } }, d)
    expect(r).toEqual({ ok: false, error: 'нет связи' })
    expect(d.patchPreferences).not.toHaveBeenCalled()
    expect(d.navigate).not.toHaveBeenCalled()
  })
})
