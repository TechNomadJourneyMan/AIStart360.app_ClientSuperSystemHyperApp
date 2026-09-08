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

const fakeServiceClient = {
  from: () => {
    const chain: Record<string, unknown> = {}
    const ret = () => chain
    Object.assign(chain, {
      select: ret, eq: ret, contains: ret,
      limit: () => Promise.resolve({ data: db.notifications.length ? [{ id: 'n1' }] : [], error: null }),
      insert: (row: Record<string, unknown>) => { db.notifications.push(row); return Promise.resolve({ error: null }) },
    })
    return chain
  },
}

const notifyAdmins = vi.fn()

vi.mock('@/lib/supabase-server', () => ({ createServerClient: () => fakeServerClient }))
vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => fakeServiceClient }))
vi.mock('@/lib/api-identity', () => ({ resolveTargetUserId: () => Promise.resolve({ userId: USER }) }))
vi.mock('@/lib/notifications', () => ({ notifyAdmins: (...a: unknown[]) => notifyAdmins(...a) }))

const { POST } = await import('@/app/api/v1/onboarding/survey/route')

// ─── helpers ─────────────────────────────────────────────────────────────────

const post = async (step: number, answers: Record<string, unknown>) => {
  const body = {
    user_id: USER,
    company_id: 'co-1',
    step,
    answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { value: v }])),
  }
  const res = await POST(new Request('http://localhost/api/v1/onboarding/survey', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)
  return (await res.json()).data
}

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
})

// ─── тесты ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/onboarding/survey', () => {
  it('не затирает step у чужих ответов и считает 12/12 (баг «1/12 · 8%»)', async () => {
    // Мастер шлёт ВСЮ накопленную карту ответов со «своим» номером шага.
    const all = oneAnswerPerStep()
    await post(1, all)
    // Пользователь перезагрузил страницу (мастер стартует с шага 1) и сохранил снова.
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

  it('не перетирает цель, выставленную вручную', async () => {
    db.companies[0].target_revenue_12m_kzt = 99_000_000
    await post(1, { s1_goal_12m_revenue_year: 24_000_000 })
    expect(db.companies[0].target_revenue_12m_kzt).toBe(99_000_000)
  })

  it('шлёт уведомление один раз при отправке финального шага, даже если он пустой', async () => {
    const partial = Object.fromEntries(Object.entries(oneAnswerPerStep()).filter(([k]) => SURVEY_KEY_STEP[k] !== 12))
    await post(11, partial)
    expect(notifyAdmins, 'на промежуточных шагах молчим').not.toHaveBeenCalled()

    const finish = await post(12, partial) // шаг 12 проехали без ответов
    expect(finish.announced).toBe(true)
    expect(notifyAdmins).toHaveBeenCalledTimes(1)
    const [type, payload] = notifyAdmins.mock.calls[0]
    expect(type).toBe('survey_completed')
    expect(payload).toMatchObject({ completedSteps: 11, totalSteps: 12 })

    const again = await post(12, partial)
    expect(again.announced, 'повторное сохранение не шлёт второе уведомление').toBe(false)
    expect(notifyAdmins).toHaveBeenCalledTimes(1)
  })

  it('отправляет строку в Google Sheets', async () => {
    const data = await post(12, oneAnswerPerStep())
    if (process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL) {
      expect(data.sheet_synced, 'реальный вебхук Apps Script').toBe(true)
    } else {
      expect(data.sheet_synced).toBe(false)
    }
  }, 30000)
})
