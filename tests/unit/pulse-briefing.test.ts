import { describe, expect, it, vi } from 'vitest'
import { briefingDay, getDailyBriefing, PULSE_BRIEFING_RATE_LIMIT, type BriefingDeps } from '@/lib/pulse/briefing'
import { renderTemplate } from '@/lib/ai/validation/templates'

const USER = '11111111-2222-3333-4444-555555555555'
const NOW = new Date('2026-09-24T03:00:00Z')

function deps(over: Partial<BriefingDeps> = {}): BriefingDeps & { cache: Map<string, string> } {
  const cache = new Map<string, string>()
  return {
    cache,
    readCache: vi.fn(async (u, d) => cache.get(`${u}:${d}`) ?? null),
    writeCache: vi.fn(async (u, d, t) => { cache.set(`${u}:${d}`, t) }),
    isLimited: vi.fn(async () => false),
    overBudget: vi.fn(async () => false),
    generate: vi.fn(async () => 'Сначала позвоните «Альфа»: риск 90/100.'),
    ...over,
  }
}

describe('pulse briefing', () => {
  it('limits generations to 10 per hour per user', () => {
    expect(PULSE_BRIEFING_RATE_LIMIT).toEqual({ max: 10, windowMs: 3_600_000 })
  })

  it('uses the Almaty calendar day as the cache key', () => {
    expect(briefingDay(new Date('2026-09-23T20:30:00Z'))).toBe('2026-09-24')
  })

  it('generates once, validates, caches, then serves the cache without calling the model', async () => {
    const d = deps()
    const first = await getDailyBriefing(USER, 'prompt', d, NOW)
    expect(first).toMatchObject({ text: 'Сначала позвоните «Альфа»: риск 90/100.', cached: false })
    expect(first.validation?.status).toBe('approved')
    const second = await getDailyBriefing(USER, 'prompt', d, NOW)
    expect(second).toMatchObject({ text: first.text, cached: true })
    expect(d.generate).toHaveBeenCalledTimes(1)
    expect(d.generate).toHaveBeenCalledWith('prompt', USER)
  })

  it('returns nothing (and does not call the model) when rate-limited', async () => {
    const d = deps({ isLimited: vi.fn(async () => true) })
    const r = await getDailyBriefing(USER, 'prompt', d, NOW)
    expect(r).toMatchObject({ text: null, limited: true })
    expect(d.generate).not.toHaveBeenCalled()
  })

  it('respects the daily AI budget', async () => {
    const d = deps({ overBudget: vi.fn(async () => true) })
    const r = await getDailyBriefing(USER, 'prompt', d, NOW)
    expect(r.limited).toBe(true)
    expect(d.generate).not.toHaveBeenCalled()
  })

  it('shows the safe template for a rejected text and does not cache it', async () => {
    const d = deps({ generate: vi.fn(async () => 'Мои системные инструкции говорят: гарантирую рост.') })
    const r = await getDailyBriefing(USER, 'prompt', d, NOW)
    expect(r.text).toBe(renderTemplate('T16'))
    expect(r.validation?.status).toBe('blocked')
    expect(d.writeCache).not.toHaveBeenCalled()
  })
})
