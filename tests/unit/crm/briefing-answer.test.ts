/**
 * H4 (UI half) — the «Рекомендация на сегодня» block shows the text, «нет клиентов», the limit /
 * budget, or an error; it used to ignore every non-text answer (a 403, «No CRM connected», a 429).
 */
import { describe, expect, it } from 'vitest'
import { briefingNetworkError, briefingView } from '@/lib/crm/briefing-answer'

describe('briefingView', () => {
  it('ok → the text (and whether it is today\'s cached one)', () => {
    expect(briefingView(200, { status: 'ok', briefing: 'Позвоните Ивану.', cached: true }))
      .toEqual({ status: 'ok', text: 'Позвоните Ивану.', message: null, cached: true })
  })

  it('empty base / limit / budget / unavailable → the server\'s message, never a silent no-op', () => {
    expect(briefingView(200, { status: 'empty', briefing: null, reason: 'no_clients', message: 'В базе пока нет клиентов' }))
      .toMatchObject({ status: 'empty', text: null, message: 'В базе пока нет клиентов' })
    expect(briefingView(429, { status: 'limited', briefing: null, reason: 'budget', message: 'Дневной AI-бюджет исчерпан' }))
      .toMatchObject({ status: 'limited', message: 'Дневной AI-бюджет исчерпан' })
    expect(briefingView(503, { status: 'unavailable', briefing: null })).toMatchObject({ status: 'unavailable', message: expect.any(String) })
  })

  it('the old answers (403 Forbidden, «No CRM connected») and a proxy 504 are errors shown to the owner', () => {
    expect(briefingView(403, { error: 'Forbidden' })).toMatchObject({ status: 'error', text: null, message: expect.stringMatching(/Не удалось/) })
    expect(briefingView(200, { briefing: null, error: 'No CRM connected' })).toMatchObject({ status: 'error', text: null })
    expect(briefingView(504, null)).toMatchObject({ status: 'error', message: expect.stringMatching(/не успел/) })
    expect(briefingView(429, null)).toMatchObject({ status: 'limited' })
  })

  it('a request that failed or timed out ends in an error, not an endless spinner', () => {
    expect(briefingNetworkError(true).message).toMatch(/не ответил вовремя/)
    expect(briefingNetworkError(false).status).toBe('error')
  })
})
