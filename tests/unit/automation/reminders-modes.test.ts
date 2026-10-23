/**
 * Survey Ф5 — the questionnaire reminder in the client's mode instead of
 * «N из 12 шагов»: the express done → blocks + the full questionnaire; the
 * express or the chat in progress → back to that mode; no mode → as before.
 * PO §18.3 item 1: only the full questionnaire stops the reminders.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClientState } from '@/lib/automation/data'

const h = vi.hoisted(() => ({ modes: new Map<string, { mode: string | null; expressCompletedAt: string | null }>(), modesFail: false, sent: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/automation/data', () => ({
  fetchClientStates: async () => [state('runner', { survey_first_at: ago(8), survey_last_change_at: ago(8) })],
  fetchSurveyRows: async () => new Map([['runner', [{ question_key: 's1_company_name', step: 1, answer: { value: 'ТОО' } }]]]),
  fetchGriDrafts: async () => new Map(),
  fetchPulseWeeks: async () => new Map(),
}))
vi.mock('@/lib/automation/survey-modes', () => ({
  fetchSurveyModes: async () => { if (h.modesFail) throw new Error('down'); return h.modes },
}))
vi.mock('@/lib/notifications/notify', () => ({
  notifyClient: async (input: Record<string, unknown>) => { h.sent.push(input); return { ok: true } },
}))

const { planReminders, runReminders } = await import('@/lib/automation/reminders')

const DAY = 86_400_000
const NOW = new Date('2026-10-30T06:00:00Z')
function ago(days: number) { return new Date(NOW.getTime() - days * DAY).toISOString() }
function state(id: string, patch: Partial<ClientState> = {}): ClientState {
  return {
    user_id: id, registered_at: ago(40), approved_at: ago(40), status: 'approved', survey_steps: 0, survey_filled_steps: [],
    survey_first_at: null, survey_last_change_at: null, survey_completed: false, point_a_at: null, gri_started_at: null,
    gri_draft_updated_at: null, gri_completed_at: null, ...patch,
  }
}
const surveyTouch = (input: Parameters<typeof planReminders>[0]) => planReminders(input, NOW).find((t) => t.kind === 'survey_reminder')
const stuck = state('u1', { survey_first_at: ago(8), survey_last_change_at: ago(8) })

describe('planReminders — the questionnaire mode', () => {
  it('express done, full not submitted → blocks and the full questionnaire, same dedupe family', () => {
    const t = surveyTouch({ state: stuck, surveySteps: [1, 3], draft: null, pulseWeeks: [], survey: { mode: 'express', expressCompletedAt: '2026-10-22T09:00:00Z', answers: {} } })
    expect(t).toMatchObject({ title: 'Первичная Точка А готова — уточните её', ctaUrl: '/client/onboarding/blocks', ctaLabel: 'Открыть блоки', stage: 'd7' })
    expect(t?.body).toContain('Быстрый старт пройден 22.10.2026')
    expect(t?.body).toMatch(/начните с «[^»]+» \(~\d+ мин\), «/)
    expect(t?.body).toContain('Полная анкета ещё не отправлена')
    expect(t?.body).not.toContain('из 12 шагов')
    expect(t?.dedupeKey).toMatch(/^survey_reminder:d7:u1:/)
  })

  it('the express in progress → «Продолжите быстрый старт» with the count', () => {
    const t = surveyTouch({ state: stuck, surveySteps: [1], draft: null, pulseWeeks: [], survey: { mode: 'express', expressCompletedAt: null, answers: { s1_company_name: 'ТОО' } } })
    expect(t).toMatchObject({ title: 'Продолжите быстрый старт', ctaUrl: '/client/onboarding/express' })
    expect(t?.body).toMatch(/Отвечено \d+ из 26 вопросов быстрого старта/)
  })

  it('the chat → «Продолжите беседу» to /client/onboarding/chat', () => {
    const t = surveyTouch({ state: stuck, surveySteps: [1, 2], draft: null, pulseWeeks: [], survey: { mode: 'chat', expressCompletedAt: null } })
    expect(t).toMatchObject({ title: 'Продолжите беседу с помощником анкеты', ctaUrl: '/client/onboarding/chat' })
  })

  it('the full mode / no mode → the classic «Вы остановились на шаге N»', () => {
    for (const survey of [undefined, { mode: 'full' as const, expressCompletedAt: null }]) {
      const t = surveyTouch({ state: stuck, surveySteps: [1, 2], draft: null, pulseWeeks: [], survey })
      expect(t).toMatchObject({ title: 'Вы остановились на шаге 3', ctaUrl: '/client/onboarding?step=3' })
      expect(t?.body).toContain('Анкета заполнена на 2 из 12 шагов')
    }
  })

  it('the express done without step 1 still gets the reminder (not the welcome series)', () => {
    const out = planReminders({ state: stuck, surveySteps: [3], draft: null, pulseWeeks: [], survey: { mode: 'express', expressCompletedAt: ago(8) } }, NOW)
    expect(out.map((t) => t.kind)).toEqual(['survey_reminder'])
  })

  it('the full questionnaire submitted → no questionnaire reminder even after the express', () => {
    const done = state('u2', { survey_completed: true, survey_first_at: ago(8), survey_last_change_at: ago(8) })
    expect(surveyTouch({ state: done, surveySteps: [1], draft: null, pulseWeeks: [], survey: { mode: 'express', expressCompletedAt: ago(8) } })).toBeUndefined()
  })
})

describe('runReminders reads the mode', () => {
  it('the mode facts reach the text; a failed read keeps the classic text', async () => {
    h.modes = new Map([['runner', { mode: 'express', expressCompletedAt: ago(8) }]])
    h.sent = []
    await runReminders(NOW)
    expect(h.sent[0]).toMatchObject({ event: 'survey_reminder', title: 'Первичная Точка А готова — уточните её' })

    h.modesFail = true
    h.sent = []
    await runReminders(NOW)
    expect(h.sent[0]).toMatchObject({ event: 'survey_reminder', title: 'Вы остановились на шаге 2' })
  })
})
