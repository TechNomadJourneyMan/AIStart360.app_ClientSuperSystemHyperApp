/**
 * Switching modes loses nothing (spec 2026-10-23 §5.1 invariant 4, §16 Ф2):
 * full → express → full on one in-memory server, through the same answers
 * controller and mode switch the screens use; a stale draft of another device
 * never overwrites a newer answer; express + blocks place all 174 keys once.
 */
import { describe, expect, it, vi } from 'vitest'
import { SurveyAnswersController } from '@/lib/survey/answers-controller'
import { switchSurveyMode } from '@/lib/survey/mode-switch'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import { EXPRESS_SCREENS, SURVEY_BLOCKS } from '@/lib/survey/questions'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { MemoryStorage, MemorySurveyServer } from '../helpers/survey-memory-server'

const deps = (c: SurveyAnswersController) => ({
  save: () => c.save(),
  patchPreferences: vi.fn(async () => undefined),
  track: vi.fn(),
  navigate: vi.fn(),
})

describe('full → express → full', () => {
  it('every answer survives, with its envelope and path', async () => {
    const server = new MemorySurveyServer()
    const storage = new MemoryStorage()

    // 1. The full questionnaire: some answers saved, one still unsaved when switching.
    const full = new SurveyAnswersController({ userId: 'u', via: 'full', fetch: server.fetch, storage })
    await full.load()
    full.change('s1_company_name', 'ТОО Пример')
    full.change('s9n_revenue_2024', 52_000_000)
    full.change('s3_deal_cycle_days', unknownAnswer())
    await full.save()
    full.change('s2n_goal_3y_what', 'Лидер в Алматы') // not saved yet
    const toExpress = await switchSurveyMode({ to: 'express', preference: { mode: 'full' } }, deps(full))
    expect(toExpress).toEqual({ ok: true, href: '/client/onboarding/express' })

    // 2. Express: sees everything, answers more, changes one answer, switches back with an unsaved edit.
    const express = new SurveyAnswersController({ userId: 'u', via: 'express', fetch: server.fetch, storage })
    await express.load()
    expect(express.getState().answers).toMatchObject({
      s1_company_name: 'ТОО Пример', s9n_revenue_2024: 52_000_000, s3_deal_cycle_days: unknownAnswer(), s2n_goal_3y_what: 'Лидер в Алматы',
    })
    express.change('s1_current_revenue_month', approxAnswer(5_000_000, 6_000_000))
    express.change('s3_deal_cycle_days', 21)
    await express.save()
    express.change('s6_main_pain', 'Нет отдела продаж') // unsaved at the switch
    const toFull = await switchSurveyMode({ to: 'full', preference: { mode: 'express' } }, deps(express))
    expect(toFull.ok).toBe(true)

    // 3. Back in the full questionnaire: nothing lost.
    const back = new SurveyAnswersController({ userId: 'u', via: 'full', fetch: server.fetch, storage })
    await back.load()
    expect(back.getState().answers).toMatchObject({
      s1_company_name: 'ТОО Пример',
      s9n_revenue_2024: 52_000_000,
      s2n_goal_3y_what: 'Лидер в Алматы',
      s1_current_revenue_month: approxAnswer(5_000_000, 6_000_000),
      s1_current_revenue_year: 66_000_000,
      s3_deal_cycle_days: 21,
      s6_main_pain: 'Нет отдела продаж',
    })
    expect(back.getState().dirtyKeys).toEqual([])
    expect(back.getState().attribution.s6_main_pain?.updatedVia).toBe('express')
    expect(back.getState().attribution.s9n_revenue_2024?.updatedVia).toBe('full')
    // Nothing of mode 2 ever submitted the questionnaire.
    expect(server.calls.some((c) => c.body && 'final' in c.body)).toBe(false)
  })

  it('a stale draft of another device does not overwrite the newer express answer', async () => {
    const server = new MemorySurveyServer()
    const laptop = new MemoryStorage()
    const phone = new MemoryStorage()
    const full = new SurveyAnswersController({ userId: 'u', via: 'full', fetch: server.fetch, storage: laptop })
    await full.load()
    full.change('s9n_net_margin', 10)
    await full.save()
    full.change('s9n_net_margin', 12) // typed, tab closed before the save
    full.persistDraft()

    server.clock += 60 * 60_000
    const express = new SurveyAnswersController({ userId: 'u', via: 'express', fetch: server.fetch, storage: phone })
    await express.load()
    express.change('s9n_net_margin', 18)
    await express.save()

    const reopened = new SurveyAnswersController({ userId: 'u', via: 'full', fetch: server.fetch, storage: laptop })
    await reopened.load()
    expect(reopened.getState().answers.s9n_net_margin).toBe(18)
    expect(reopened.getState().staleKeys).toEqual(['s9n_net_margin'])
    await reopened.save()
    expect(server.answers().s9n_net_margin).toBe(18)
  })
})

describe('express + blocks', () => {
  it('cover all 174 questionnaire keys exactly once', () => {
    const placed = [...EXPRESS_SCREENS.flatMap((s) => s.keys), ...SURVEY_BLOCKS.flatMap((b) => b.keys)]
    expect(placed).toHaveLength(174)
    expect(new Set(placed).size).toBe(174)
    expect([...placed].sort()).toEqual(Object.keys(SURVEY_KEY_STEP).sort())
  })
})
