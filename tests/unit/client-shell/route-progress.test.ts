/**
 * W3 (PO 2026-10-22, п. 3): the global loading bar — which programmatic
 * navigations start it and the watchdog that closes a stuck bar.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PROGRESS_FALLBACK_MS, createProgressWatchdog, shouldStartProgress } from '@/lib/route-progress'

describe('shouldStartProgress', () => {
  const here = 'https://portal.aistart360.app/client/home'

  it('starts for another page or another query of this site', () => {
    expect(shouldStartProgress(here, '/client/point-a')).toBe(true)
    expect(shouldStartProgress(here, '/client/home?unavailable=gri')).toBe(true)
    expect(shouldStartProgress(here, 'https://portal.aistart360.app/gri')).toBe(true)
    expect(shouldStartProgress(here, 'point-b')).toBe(true) // relative
  })

  it('does not start for the same URL, a hash jump, another site or a non-http scheme', () => {
    expect(shouldStartProgress(here, '/client/home')).toBe(false)
    expect(shouldStartProgress(here, '/client/home#gri')).toBe(false)
    expect(shouldStartProgress(here, 'https://example.com/client/point-a')).toBe(false)
    expect(shouldStartProgress(here, 'mailto:hi@aistart360.app')).toBe(false)
  })
})

describe('createProgressWatchdog', () => {
  function setup(timeoutMs = 1000) {
    let started = false
    let t = 0
    const done = vi.fn(() => { started = false })
    const dog = createProgressWatchdog({ isStarted: () => started, done, now: () => t, timeoutMs })
    return { dog, done, start: () => { started = true }, finish: () => { started = false }, advance: (ms: number) => { t += ms } }
  }

  it('closes a bar that runs longer than the fallback', () => {
    const w = setup()
    w.start()
    expect(w.dog.tick()).toBe(false) // first sighting
    w.advance(999)
    expect(w.dog.tick()).toBe(false)
    w.advance(1)
    expect(w.dog.tick()).toBe(true)
    expect(w.done).toHaveBeenCalledTimes(1)
  })

  it('leaves a bar alone that finished in time, and restarts the clock for the next one', () => {
    const w = setup()
    w.start()
    w.dog.tick()
    w.advance(800)
    w.finish()
    w.dog.tick()
    w.start()
    w.dog.tick()
    w.advance(800)
    expect(w.dog.tick()).toBe(false)
    expect(w.done).not.toHaveBeenCalled()
  })

  it('reset() forgets the start (the route committed)', () => {
    const w = setup()
    w.start()
    w.dog.tick()
    w.advance(900)
    w.dog.reset()
    w.dog.tick()
    w.advance(900)
    expect(w.dog.tick()).toBe(false)
  })

  it('defaults to a fallback long enough for a slow page', () => {
    expect(PROGRESS_FALLBACK_MS).toBeGreaterThanOrEqual(10_000)
  })
})

describe('wiring', () => {
  it('the root layout keeps the top loader and mounts the watchdog', () => {
    const src = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8')
    expect(src).toContain('<NextTopLoader')
    expect(src).toContain('<RouteProgress')
  })

  it('the bar and the skeletons do not animate for users who asked for reduced motion', () => {
    // The global rule cuts every transition (the bar's inline nprogress
    // transition included — !important beats inline styles) and animation
    // (animate-pulse of the loading.tsx skeletons).
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'), css.indexOf('@media (prefers-reduced-motion: reduce)') + 400)
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after/)
    expect(block).toContain('transition-duration: 0.01ms !important')
    expect(block).toContain('animation-duration: 0.01ms !important')
  })
})
