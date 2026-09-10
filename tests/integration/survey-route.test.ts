/**
 * Интеграционный тест роута POST /api/v1/onboarding/survey.
 *
 * Прогоняет РЕАЛЬНЫЙ обработчик (тот же код, что вызывает браузер) поверх
 * in-memory Supabase-заглушки. Проверяет ровно то, что сломалось в E2E:
 *   1. колонка `step` больше не затирается номером текущего шага;
 *   2. прогресс считается по ключу вопроса → 12/12, а не 1/12;
 *   3. companies.target_revenue_* заполняется из целей шага 1;
 *   4. строка уходит в Google Sheets;
 *   5. уведомление «анкета пройдена» уходит один раз.
 *
 * Запись в реальную таблицу включается переменной GOOGLE_APPS_SCRIPT_WEBHOOK_URL;
 * без неё синхронизация помечается как не настроенная и тест всё равно проходит.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SURVEY_KEY_STEP } from '@/lib/survey/steps'

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

const fakeServerClient = {
  from: (t: string) => (t === 'companies' ? companiesTable() : surveyTable()),
  auth: { getUser: () => Promise.resolve({ data: { user: { id: USER, email: 'qa@example.com' } }, error: null }) },
}

const PROFILE_EMAIL = 'client@example.com'

// Service client: used by the background mirror (answers + client profile)
// and by the completion marker (app_notifications).
const fakeServiceClient = {
  from: (t: string) => {
    const chain: Record<string, unknown> = {}
    const ret = () => chain
    if (t === 'survey_answers') {
      Object.assign(chain, {
        select: ret,
        eq: () => Promise.resolve({ data: db.answers.map((r) => ({ question_key: r.question_key, step: r.step, answer: r.answer })), error: null }),
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
const upsertRowByKey = vi.fn(async (_headers: string[], _values: string[]) => ({ ok: true, url: 'https://docs.google.com/spreadsheets/d/test/edit' }))
const pending: Promise<unknown>[] = []

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeServerClient }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeServiceClient }))
vi.mock('@/lib/api-identity', () => ({ resolveTargetUserId: () => Promise.resolve({ userId: USER }) }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: (...a: unknown[]) => notifyAdmins(...a) }))
// Never hit the real staff spreadsheet from tests.
vi.mock('@/lib/integrations/google-sheets', () => ({
  googleSheetsConfigured: () => true,
  spreadsheetUrl: () => 'https://docs.google.com/spreadsheets/d/test/edit',
  upsertRowByKey: (h: string[], v: string[]) => upsertRowByKey(h, v),
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
  db.notifications = []
  notifyAdmins.mockClear()
  upsertRowByKey.mockClear()
  pending.splice(0)
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
    expect(data.percent).toBe(100)
  })

  it('заполняет цели компании из шага 1 («Снимок Точки А ещё не построен»)', async () => {
    await post(1, { s1_company_name: 'ТОО kOtaq-Telecom', s1_goal_12m_revenue_year: 24_000_000, s1_goal_3y_revenue_month: 6_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt).toBe(24_000_000)
    expect(db.companies[0].target_revenue_3y_kzt).toBe(72_000_000)
  })

  it('следует за правкой цели в анкете, пока цель пришла из анкеты', async () => {
    await post(1, { s1_goal_12m_revenue_month: 1_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt).toBe(12_000_000)
    await post(1, { s1_goal_12m_revenue_month: 2_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt, 'дашборд не должен застревать на старой цели').toBe(24_000_000)
  })

  it('не перетирает цель, выставленную вручную', async () => {
    db.companies[0].target_revenue_12m_kzt = 99_000_000
    await post(1, { s1_goal_12m_revenue_year: 24_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt).toBe(99_000_000)
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

  it('отклоняет некорректный шаг', async () => {
    const res = await POST(new Request('http://localhost/api/v1/onboarding/survey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: '0', answers: { gri_expert_finance: { value: 'x' } } }),
    }) as never)
    expect(res.status).toBe(400)
  })
})
