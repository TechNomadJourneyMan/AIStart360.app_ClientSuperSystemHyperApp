/**
 * The answers controller behind the express flow and the blocks (survey Ф2):
 * load + draft, edits, save of changed keys only, envelopes, path, auto year,
 * company mirror, in-flight edits, failures — on an in-memory server.
 */
import { describe, expect, it } from 'vitest'
import { SurveyAnswersController } from '@/lib/survey/answers-controller'
import { approxAnswer, unknownAnswer } from '@/lib/survey/answer-value'
import { readDraft, writeDraft } from '@/lib/survey/draft'
import { MemoryStorage, MemorySurveyServer } from '../../helpers/survey-memory-server'

const make = (server: MemorySurveyServer, storage = new MemoryStorage(), via: 'full' | 'express' = 'express') =>
  new SurveyAnswersController({ userId: 'u', via, fetch: server.fetch, storage })

const posts = (s: MemorySurveyServer) => s.calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/onboarding/survey')

describe('SurveyAnswersController', () => {
  it('loads server answers and the author lines', async () => {
    const server = new MemorySurveyServer()
    server.writeElsewhere('s1_industry', 'Розница', 'full')
    const c = make(server)
    await c.load()
    expect(c.getState().loaded).toBe(true)
    expect(c.getState().answers.s1_industry).toBe('Розница')
    expect(c.getState().attribution.s1_industry?.updatedVia).toBe('full')
  })

  it('saves only changed keys with the express path, envelopes for «не знаю» / «примерно», never final', async () => {
    const server = new MemorySurveyServer()
    server.writeElsewhere('s6_main_pain', 'нет людей', 'full')
    const c = make(server)
    await c.load()
    c.change('s3_deal_cycle_days', unknownAnswer())
    c.change('s9n_debts_amount', approxAnswer(1_000_000, 2_000_000))
    const r = await c.save()
    expect(r.ok).toBe(true)
    const [post] = posts(server)
    expect(Object.keys(post.body!.answers as object).sort()).toEqual(['s3_deal_cycle_days', 's9n_debts_amount'])
    expect((post.body!.answers as Record<string, unknown>).s3_deal_cycle_days).toEqual({ value: null, unknown: true })
    expect((post.body!.answers as Record<string, unknown>).s9n_debts_amount).toMatchObject({ approx: true, range: [1_000_000, 2_000_000] })
    expect(post.body!.via).toBe('express')
    expect(post.body).not.toHaveProperty('final')
    expect(server.answers().s6_main_pain).toBe('нет людей')
    expect(c.getState().saveState).toBe('saved')
    expect(c.getState().attribution.s3_deal_cycle_days?.updatedVia).toBe('express')
  })

  it('a month answer brings its year (× 12) into the same save', async () => {
    const server = new MemorySurveyServer()
    const c = make(server)
    await c.load()
    c.change('s1_current_revenue_month', 5_000_000)
    expect(c.getState().answers.s1_current_revenue_year).toBe(60_000_000)
    await c.save()
    expect(Object.keys(posts(server)[0].body!.answers as object).sort()).toEqual(['s1_current_revenue_month', 's1_current_revenue_year'])
  })

  it('company fields are mirrored once the name exists; without a name the answers still save', async () => {
    const server = new MemorySurveyServer()
    const c = make(server)
    await c.load()
    c.change('s1_industry', 'Розница')
    await c.save()
    expect(server.calls.some((x) => x.method === 'POST' && x.url === '/api/v1/onboarding/company')).toBe(false)
    expect(server.answers().s1_industry).toBe('Розница')
    c.change('s1_company_name', 'ТОО Пример')
    await c.save()
    expect(server.company).toMatchObject({ name: 'ТОО Пример', industry: 'Розница' })
    expect(c.getState().companyId).toBe('c-1')
  })

  it('a key edited again while its save is in flight stays unsaved, the other is cleared', async () => {
    const server = new MemorySurveyServer()
    const c = make(server)
    await c.load()
    c.change('s6_main_pain', 'a')
    c.change('s5_usp', 'b')
    server.hold()
    const pending = c.save()
    await Promise.resolve()
    c.change('s6_main_pain', 'a2')
    server.release()
    await pending
    expect(c.getState().dirtyKeys).toEqual(['s6_main_pain'])
    expect(c.getState().saveState).toBe('dirty')
    await c.save()
    expect(server.answers().s6_main_pain).toBe('a2')
  })

  it('a failed save keeps the edits (state, draft) and reports the error', async () => {
    const server = new MemorySurveyServer()
    const storage = new MemoryStorage()
    const c = make(server, storage)
    await c.load()
    c.change('s5_usp', 'Быстрее всех')
    server.failNext = 500
    const r = await c.save()
    expect(r.ok).toBe(false)
    expect(c.getState().saveState).toBe('error')
    expect(c.getState().error).toMatch(/Не удалось сохранить/)
    expect(readDraft(storage, 'u')?.dirty).toEqual({ s5_usp: 'Быстрее всех' })
    expect((await c.save()).ok).toBe(true)
    expect(readDraft(storage, 'u')).toBeNull()
  })

  it('a quiet autosave failure does not raise the banner; 401 always does', async () => {
    const server = new MemorySurveyServer()
    const c = make(server)
    await c.load()
    c.change('s5_usp', 'x')
    server.failNext = 503
    await c.save({ autosave: true })
    expect(c.getState().error).toBeNull()
    server.failNext = 401
    await c.save({ autosave: true })
    expect(c.getState().error).toMatch(/Сессия истекла/)
  })

  it('profanity: the refused question is reported, no retry state', async () => {
    const server = new MemorySurveyServer()
    const original = server.fetch
    server.fetch = async (url, init) => (init?.method === 'POST' && url === '/api/v1/onboarding/survey'
      ? { ok: false, status: 400, json: async () => ({ ok: false, code: 'profanity', error: 'Уберите грубые слова', field: 's6_main_pain' }) }
      : original(url, init))
    const c = make(server)
    await c.load()
    c.change('s6_main_pain', '***')
    await c.save()
    expect(c.getState().fieldIssue).toEqual({ key: 's6_main_pain', message: 'Уберите грубые слова' })
    expect(c.getState().saveState).toBe('dirty')
  })

  it('a draft edit whose answer changed elsewhere is dropped and reported (stale draft)', async () => {
    const server = new MemorySurveyServer()
    const storage = new MemoryStorage()
    server.writeElsewhere('s1_current_revenue_month', 4_000_000, 'full')
    const base = new Date(server.clock).toISOString()
    // The full form held an unsaved 3 M; meanwhile the chat saved 5,5 M.
    writeDraft(storage, 'u', 1, { s1_current_revenue_month: 3_000_000, s5_usp: 'черновик' }, { s1_current_revenue_month: base, s5_usp: null })
    server.clock += 10 * 60_000
    server.writeElsewhere('s1_current_revenue_month', 5_500_000, 'chat')
    const c = make(server, storage)
    await c.load()
    expect(c.getState().answers.s1_current_revenue_month).toBe(5_500_000)
    expect(c.getState().staleKeys).toEqual(['s1_current_revenue_month'])
    expect(c.getState().answers.s5_usp).toBe('черновик')
    expect(c.getState().dirtyKeys).toEqual(['s5_usp'])
    await c.save()
    expect(server.answers().s1_current_revenue_month).toBe(5_500_000)
  })

  it('origins go with the save (document / field helper)', async () => {
    const server = new MemorySurveyServer()
    const c = make(server)
    await c.load()
    c.change('s3_deal_cycle_days', 14, 'document')
    await c.save()
    expect(posts(server)[0].body!.origins).toEqual({ s3_deal_cycle_days: 'document' })
  })
})
