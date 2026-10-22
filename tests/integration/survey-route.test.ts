/**
 * Интеграционный тест роута POST /api/v1/onboarding/survey.
 *
 * Прогоняет РЕАЛЬНЫЙ обработчик (тот же код, что вызывает браузер) поверх
 * in-memory Supabase-заглушки. Проверяет ровно то, что сломалось в E2E:
 *   1. колонка `step` больше не затирается номером текущего шага;
 *   2. прогресс считается по ключу вопроса → 12/12, а не 1/12;
 *   3. цели шага 1 становятся целями компании (metric_targets + companies.target_revenue_*);
 *   4. строка уходит в Google Sheets;
 *   5. уведомление «анкета пройдена» уходит один раз.
 *
 * Запись в реальную таблицу включается переменной GOOGLE_APPS_SCRIPT_WEBHOOK_URL;
 * без неё синхронизация помечается как не настроенная и тест всё равно проходит.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'
import { memoryClient } from '../unit/data-layer/memory-client'

// ─── in-memory Supabase ──────────────────────────────────────────────────────

interface AnswerRow { user_id: string; company_id: string | null; step: number; question_key: string; answer: unknown }

const db = {
  answers: [] as AnswerRow[],
  companies: [] as Array<{ id: string; user_id: string; target_revenue_12m_kzt: number | null; target_revenue_3y_kzt: number | null; updated_at?: string }>,
  notifications: [] as Record<string, unknown>[],
}

const USER = 'user-qa-1'

function surveyTable() {
  const chain: Record<string, unknown> = {}
  const ret = () => chain
  Object.assign(chain, {
    select: ret,
    eq: () => Promise.resolve({ data: db.answers.map((r) => ({ question_key: r.question_key, step: r.step, answer: r.answer })), error: null }),
    upsert: (rows: AnswerRow[]) => {
      for (const row of rows) {
        const i = db.answers.findIndex((a) => a.user_id === row.user_id && a.question_key === row.question_key)
        if (i >= 0) db.answers[i] = row
        else db.answers.push(row)
      }
      return Promise.resolve({ error: null })
    },
  })
  return chain
}

function companiesTable() {
  const chain: Record<string, unknown> = {}
  let pendingPatch: Record<string, unknown> | null = null
  Object.assign(chain, {
    select: () => chain,
    update: (patch: Record<string, unknown>) => { pendingPatch = patch; return chain },
    eq: () => (pendingPatch
      ? (Object.assign(db.companies[0], pendingPatch), Promise.resolve({ error: null }))
      : chain),
    maybeSingle: () => Promise.resolve({ data: db.companies[0] ?? null, error: null }),
  })
  return chain
}

/** Who is signed in (staff may save a client's survey). */
let sessionUserId = USER

const fakeServerClient = {
  from: (t: string) => (t === 'companies' ? companiesTable() : surveyTable()),
  auth: { getUser: () => Promise.resolve({ data: { user: { id: sessionUserId, email: 'qa@example.com' } }, error: null }) },
}

const PROFILE_EMAIL = 'client@example.com'

/** Goals (metric_targets) and the companies row as the service role sees them (lib/goals/survey-sync.ts). */
let goalsDb = memoryClient()

// Service client: used by the background mirror (answers + client profile)
// and by the completion marker (app_notifications).
const fakeServiceClient = {
  from: (t: string) => {
    const chain: Record<string, unknown> = {}
    const ret = () => chain
    // Product analytics (user_events) is not under test here.
    if (t === 'user_events') {
      Object.assign(chain, {
        insert: () => Promise.resolve({ error: null }),
        select: ret, eq: ret,
        limit: () => Promise.resolve({ data: [], error: null }),
      })
      return chain
    }
    if (t === 'metric_targets' || t === 'companies') return goalsDb.client.from(t)
    if (t === 'survey_answers') {
      const rows = () => db.answers.map((r) => ({ question_key: r.question_key, step: r.step, answer: r.answer }))
      Object.assign(chain, {
        select: ret,
        eq: () => Object.assign(Promise.resolve({ data: rows(), error: null }), {
          in: (_c: string, keys: string[]) => Promise.resolve({ data: rows().filter((r) => keys.includes(r.question_key)), error: null }),
        }),
        upsert: (list: AnswerRow[]) => {
          for (const row of list) {
            const i = db.answers.findIndex((a) => a.user_id === row.user_id && a.question_key === row.question_key)
            if (i >= 0) db.answers[i] = row
            else db.answers.push(row)
          }
          return Promise.resolve({ error: null })
        },
      })
      return chain
    }
    if (t === 'profiles') {
      Object.assign(chain, { select: ret, eq: ret, maybeSingle: () => Promise.resolve({ data: { email: PROFILE_EMAIL }, error: null }) })
      return chain
    }
    Object.assign(chain, {
      select: ret, eq: ret, contains: ret,
      limit: () => Promise.resolve({ data: db.notifications.length ? [{ id: 'n1' }] : [], error: null }),
      insert: (row: Record<string, unknown>) => { db.notifications.push(row); return Promise.resolve({ error: null }) },
    })
    return chain
  },
}

const notifyAdmins = vi.fn()
const clientEmail = vi.fn()
const upsertRowByKey = vi.fn(async (_headers: string[], _values: string[]) => ({ ok: true, url: 'https://docs.google.com/spreadsheets/d/test/edit' }))
const pending: Promise<unknown>[] = []

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeServerClient }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeServiceClient }))
vi.mock('@/lib/api-identity', () => ({ resolveTargetUserId: () => Promise.resolve({ userId: USER }) }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: (...a: unknown[]) => notifyAdmins(...a) }))
// Письмо клиенту «анкета пройдена» — мок, чтобы тест не зависел от почты.
// Письмо клиенту уходит через notifyClient (lib/notifications/product.ts).
vi.mock('@/lib/notifications/product', () => ({
  notifyQuestionnaireCompleted: (...a: unknown[]) => { clientEmail(...a); return Promise.resolve({ ok: true, delivered: {} }) },
}))
// Never hit the real staff spreadsheet from tests.
vi.mock('@/lib/integrations/google-sheets', () => ({
  googleSheetsConfigured: () => true,
  spreadsheetUrl: () => 'https://docs.google.com/spreadsheets/d/test/edit',
  upsertRowByKey: (h: string[], v: string[]) => upsertRowByKey(h, v),
}))
// Platform events (diagnostic pipeline triggers) are captured, not dispatched.
const platformEvents: Array<{ name: string; actor?: string | null; dedupeKey?: string | null }> = []
vi.mock('@/lib/events/platform', () => ({
  emitPlatformEventSafely: (e: { name: string; actor?: string | null; dedupeKey?: string | null }) => { platformEvents.push(e) },
}))
// Capture background work so tests can await it.
vi.mock('@/lib/background', () => ({
  runInBackground: (_label: string, work: () => Promise<unknown>) => { const p = work(); pending.push(p); return p },
}))

const { POST } = await import('@/app/api/v1/onboarding/survey/route')

// ─── helpers ─────────────────────────────────────────────────────────────────

const post = async (step: number, answers: Record<string, unknown>, opts: { final?: boolean } = {}) => {
  const body = {
    user_id: USER,
    company_id: 'co-1',
    step,
    final: opts.final === true,
    answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { value: v }])),
  }
  const res = await POST(new Request('http://localhost/api/v1/onboarding/survey', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)
  return (await res.json()).data
}
const drain = async () => { await Promise.all(pending.splice(0)) }

/** По одному непустому ответу на каждый из 12 шагов мастера. */
function oneAnswerPerStep(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const seen = new Set<number>()
  for (const [key, step] of Object.entries(SURVEY_KEY_STEP)) {
    if (seen.has(step)) continue
    seen.add(step)
    out[key] = `QA_TEST_${key}`
  }
  return out
}

beforeEach(() => {
  db.answers = []
  db.companies = [{ id: 'co-1', user_id: USER, target_revenue_12m_kzt: null, target_revenue_3y_kzt: null }]
  goalsDb = memoryClient({ companies: db.companies, metric_targets: [] })
  db.notifications = []
  notifyAdmins.mockClear()
  clientEmail.mockClear()
  upsertRowByKey.mockClear()
  pending.splice(0)
  platformEvents.splice(0)
  sessionUserId = USER
})

// ─── тесты ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/onboarding/survey', () => {
  it('не затирает step у чужих ответов и считает 12/12 (баг «1/12 · 8%»)', async () => {
    // Старый мастер слал ВСЮ накопленную карту ответов со «своим» номером шага.
    const all = oneAnswerPerStep()
    await post(1, all)
    const data = await post(1, all)

    const storedSteps = new Set(db.answers.map((r) => r.step))
    expect(storedSteps.size, 'до фикса все строки получали step=1').toBe(12)
    expect(data.completed_steps).toBe(12)
    // percent = «глубина» (answered fields), not started steps / 12: one answer per step is shallow.
    expect(data.percent).toBe(Math.round((12 / 171) * 100))
  })

  it('заполняет цели компании из шага 1 («Снимок Точки А ещё не построен»)', async () => {
    await post(1, { s1_company_name: 'ТОО kOtaq-Telecom', s1_goal_12m_revenue_year: 24_000_000, s1_goal_3y_revenue_month: 6_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt).toBe(24_000_000)
    expect(db.companies[0].target_revenue_3y_kzt).toBe(72_000_000)
    // The goals live in metric_targets: the owner's goals, attributed to the owner.
    const goals = goalsDb.db.metric_targets
    expect(goals.map((g) => [g.period_label, g.target_value, g.source, g.updated_by])).toEqual([
      ['12m', 24_000_000, 'owner', USER],
      ['3y', 72_000_000, 'owner', USER],
    ])
    // Only the month of the 3-year goal was written: the year answer is aligned, with ITS step.
    expect(db.answers.find((a) => a.question_key === 's1_goal_3y_revenue_year')).toMatchObject({ step: SURVEY_KEY_STEP.s1_goal_3y_revenue_year, answer: { value: 72_000_000 } })
  })

  it('следует за правкой цели в анкете, пока цель пришла из анкеты', async () => {
    await post(1, { s1_goal_12m_revenue_month: 1_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt).toBe(12_000_000)
    await post(1, { s1_goal_12m_revenue_month: 2_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt, 'дашборд не должен застревать на старой цели').toBe(24_000_000)
  })

  it('одна цель: правка цели в анкете меняет и цель, выставленную на дашборде (W1 2026-10-22)', async () => {
    db.companies[0].target_revenue_12m_kzt = 99_000_000
    goalsDb.db.metric_targets.push({ id: 't1', company_id: 'co-1', metric_key: 'biz.finansy.vyruchka_god', period_label: '12m', target_value: 99_000_000, source: 'owner', updated_by: USER })
    await post(1, { s1_goal_12m_revenue_year: 24_000_000, s1_goal_12m_revenue_month: 2_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt).toBe(24_000_000)
    expect(goalsDb.db.metric_targets).toHaveLength(1)
    expect(goalsDb.db.metric_targets[0]).toMatchObject({ target_value: 24_000_000 })
  })

  it('сотрудник, сохраняющий анкету клиента, ставит цель эксперта', async () => {
    sessionUserId = 'staff-1'
    await post(1, { s1_goal_3y_revenue_year: 600_000_000, s1_goal_3y_revenue_month: 50_000_000 })
    expect(goalsDb.db.metric_targets[0]).toMatchObject({ period_label: '3y', target_value: 600_000_000, source: 'expert', updated_by: 'staff-1' })
  })

  it('автосохранение пустого поля не удаляет цель (ввод ещё идёт)', async () => {
    await post(1, { s1_goal_12m_revenue_year: 24_000_000, s1_goal_12m_revenue_month: 2_000_000 })
    const res = await POST(new Request('http://localhost/api/v1/onboarding/survey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 1, autosave: true, answers: { s1_goal_12m_revenue_month: { value: 0 }, s1_goal_12m_revenue_year: { value: 0 } } }),
    }) as never)
    expect(res.status).toBe(200)
    expect(goalsDb.db.metric_targets).toHaveLength(1)
    expect(db.companies[0].target_revenue_12m_kzt).toBe(24_000_000)
  })

  it('уведомление уходит один раз по явной отправке анкеты, даже если шаг 12 пустой', async () => {
    const partial = Object.fromEntries(Object.entries(oneAnswerPerStep()).filter(([k]) => SURVEY_KEY_STEP[k] !== 12))
    await post(11, partial)
    await drain()
    expect(notifyAdmins, 'на промежуточных шагах молчим').not.toHaveBeenCalled()

    // Уход с шага 12 по вкладке (step=12, но не final) — раньше слал «анкета пройдена (1/12)».
    await post(12, {})
    await drain()
    expect(notifyAdmins, 'переключение вкладки — не отправка').not.toHaveBeenCalled()

    await post(12, {}, { final: true })
    await drain()
    expect(notifyAdmins).toHaveBeenCalledTimes(1)
    // Клиент тоже получает письмо — ровно один раз, вместе с уведомлением админам.
    expect(clientEmail).toHaveBeenCalledTimes(1)
    expect(clientEmail.mock.calls[0][1]).toMatchObject({ completedSteps: 11, totalSteps: 12 })
    const [type, payload] = notifyAdmins.mock.calls[0]
    expect(type).toBe('survey_completed')
    expect(payload).toMatchObject({ completedSteps: 11, totalSteps: 12, sheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit' })
    expect(JSON.stringify(db.notifications), 'ссылка на админскую таблицу не попадает в клиентскую запись').not.toContain('docs.google.com')

    await post(12, {}, { final: true })
    await drain()
    expect(notifyAdmins, 'повторная отправка не шлёт второе уведомление').toHaveBeenCalledTimes(1)
  })

  it('зеркалит строку в Google Sheets в фоне, с email клиента из профиля', async () => {
    await post(1, oneAnswerPerStep())
    await drain()
    expect(upsertRowByKey).toHaveBeenCalledTimes(1)
    const values = upsertRowByKey.mock.calls[0][1]
    expect(values[0]).toBe(USER)
    expect(values[2], 'не email сотрудника из сессии').toBe(PROFILE_EMAIL)
  })

  it('ответ не ждёт Google Sheets (кнопка «Далее» висела 6–19 с)', async () => {
    upsertRowByKey.mockImplementationOnce(() => new Promise(() => {})) // «зависший» Apps Script
    const started = Date.now()
    const data = await post(1, { s1_company_name: 'ТОО' })
    expect(data.saved).toBe(1)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('не принимает служебные ключи и не перештамповывает их шагом мастера', async () => {
    db.answers.push({ user_id: USER, company_id: null, step: 0, question_key: 'gri_expert_finance', answer: { value: 'заметка эксперта' } })
    const data = await post(3, { gri_expert_finance: 'подделка клиента', goal_week_v2: 'x', s3n_problem: 'ok' })
    expect(data.saved).toBe(1)
    expect(data.ignored).toBe(2)
    const note = db.answers.find((r) => r.question_key === 'gri_expert_finance')!
    expect(note.step).toBe(0)
    expect(note.answer).toEqual({ value: 'заметка эксперта' })
  })

  it('platform events: ONBOARDING_COMPLETED once on completion, later explicit submits are QUESTIONNAIRE_COMPLETED', async () => {
    await post(12, oneAnswerPerStep(), { final: true })
    expect(platformEvents.map((e) => e.name)).toEqual(['ONBOARDING_COMPLETED'])
    expect(platformEvents[0].dedupeKey).toBe('onboarding_completed:co-1')

    await post(3, { s3n_problem: 'обновил' }, { final: true })
    expect(platformEvents.map((e) => e.name)).toEqual(['ONBOARDING_COMPLETED', 'QUESTIONNAIRE_COMPLETED'])
    expect(platformEvents[1].dedupeKey).toMatch(/^questionnaire_completed:co-1:/)

    // A step save that is not a submit: no completion event, but the data
    // Point A is built from changed → SURVEY_ANSWER_CHANGED (spec 2026-10-12 §1.6).
    await post(3, { s3n_problem: 'ещё правка' })
    expect(platformEvents.map((e) => e.name)).toEqual(['ONBOARDING_COMPLETED', 'QUESTIONNAIRE_COMPLETED', 'SURVEY_ANSWER_CHANGED'])
    expect(platformEvents[2].dedupeKey).toMatch(/^survey_changed:co-1:/)
  })

  it('platform events name who made the change (staff saving for a client), not the client', async () => {
    sessionUserId = 'staff-1'
    await post(12, oneAnswerPerStep(), { final: true })
    expect(platformEvents[0]).toMatchObject({ name: 'ONBOARDING_COMPLETED', actor: 'user:staff-1' })
  })

  it('отклоняет некорректный шаг', async () => {
    const res = await POST(new Request('http://localhost/api/v1/onboarding/survey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: '0', answers: { gri_expert_finance: { value: 'x' } } }),
    }) as never)
    expect(res.status).toBe(400)
  })
})
