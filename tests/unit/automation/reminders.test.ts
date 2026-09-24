/**
 * Cron-напоминания (F-057) и приветственная серия (F-058): кого выбираем,
 * какой шаг называем, какие ключи идемпотентности ставим и где останавливаемся
 * по недельному потолку. Данные, журнал, почта и лента подменены.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientState } from '@/lib/automation/data'

const h = vi.hoisted(() => ({
  states: [] as ClientState[],
  surveyRows: new Map<string, Array<{ question_key: string; step: number; answer: unknown }>>(),
  drafts: new Map<string, { updatedAt: string; completedSections: Record<string, boolean> }>(),
  pulse: new Map<string, string[]>(),
  profiles: new Map<string, { id: string; email: string | null; fullName: string | null; telegramChatId: string | null; preferences: unknown }>(),
  sends: [] as Array<{ id: string; userId: string | null; kind: string; dedupeKey: string | null; countsTowardCap: boolean; sentAt: number }>,
  clock: 0,
  settings: { auto_reminders_enabled: true, auto_touch_weekly_cap: 2 } as Record<string, unknown>,
  email: vi.fn(),
  feed: vi.fn(),
}))

vi.mock('@/lib/automation/data', () => ({
  fetchClientStates: async () => h.states,
  fetchSurveyRows: async (ids: string[]) => new Map(ids.filter((id) => h.surveyRows.has(id)).map((id) => [id, h.surveyRows.get(id)!])),
  fetchGriDrafts: async (ids: string[]) => new Map(ids.filter((id) => h.drafts.has(id)).map((id) => [id, h.drafts.get(id)!])),
  fetchPulseWeeks: async (ids: string[]) => new Map(ids.filter((id) => h.pulse.has(id)).map((id) => [id, h.pulse.get(id)!])),
}))
vi.mock('@/lib/notifications/store', () => ({
  getRecipient: async (id: string) => h.profiles.get(id) ?? null,
  countCapTouches: async (userId: string, sinceIso: string) =>
    h.sends.filter((s) => s.userId === userId && s.countsTowardCap && s.sentAt >= new Date(sinceIso).getTime()).length,
  claimSend: async (input: { userId: string | null; kind: string; dedupeKey: string | null; countsTowardCap: boolean }) => {
    if (input.dedupeKey && h.sends.some((s) => s.dedupeKey === input.dedupeKey)) return { result: 'duplicate', id: null }
    const id = `s${h.sends.length + 1}`
    h.sends.push({ id, ...input, sentAt: h.clock })
    return { result: 'claimed', id }
  },
  releaseSend: async () => undefined,
}))
vi.mock('@/lib/email/send', () => ({
  sendTransactionalEmail: async (input: unknown) => {
    h.email(input)
    return { ok: true }
  },
}))
vi.mock('@/lib/notifications/create', () => ({
  createNotification: async (input: unknown) => {
    h.feed(input)
    return true
  },
}))
vi.mock('@/lib/telegram', () => ({ sendTelegramMessage: async () => false }))
vi.mock('@/lib/settings/store', () => ({ getSetting: async (key: string) => h.settings[key] }))

const { runReminders, planReminders, firstMissingStep } = await import('@/lib/automation/reminders')

const DAY = 24 * 60 * 60 * 1000
// Четверг, 24.09.2026, 11:00 Алматы.
const NOW = new Date('2026-09-24T06:00:00Z')
const ago = (days: number, from: Date = NOW) => new Date(from.getTime() - days * DAY).toISOString()

function state(id: string, patch: Partial<ClientState> = {}): ClientState {
  return {
    user_id: id,
    registered_at: ago(40),
    approved_at: ago(40),
    status: 'approved',
    survey_steps: 0,
    survey_filled_steps: [],
    survey_first_at: null,
    survey_last_change_at: null,
    survey_completed: false,
    point_a_at: null,
    gri_started_at: null,
    gri_draft_updated_at: null,
    gri_completed_at: null,
    ...patch,
  }
}

/** Ответы, заполняющие шаги (по одному ключу на шаг). */
function rowsForSteps(steps: number[]) {
  const keyFor: Record<number, string> = { 1: 's1_company_name', 2: 's2n_goal_12m_what', 3: 's3n_client_portrait', 4: 's4_dept_count' }
  return steps.map((s) => ({ question_key: keyFor[s], step: s, answer: { value: 'x' } }))
}

function addProfile(id: string) {
  h.profiles.set(id, { id, email: `${id}@example.com`, fullName: null, telegramChatId: null, preferences: {} })
}

function emailKeys(): string[] {
  return h.email.mock.calls.map((c) => (c[0] as { dedupeKey: string }).dedupeKey)
}

beforeEach(() => {
  h.states = []
  h.surveyRows.clear()
  h.drafts.clear()
  h.pulse.clear()
  h.profiles.clear()
  h.sends = []
  h.clock = NOW.getTime()
  h.settings = { auto_reminders_enabled: true, auto_touch_weekly_cap: 2 }
  h.email.mockReset()
  h.feed.mockReset()
})

describe('planReminders', () => {
  it('firstMissingStep — первый незаполненный шаг 1..12', () => {
    expect(firstMissingStep([1, 2, 4])).toBe(3)
    expect(firstMissingStep([])).toBe(1)
    expect(firstMissingStep([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBeNull()
  })

  it('не одобренный клиент ничего не получает', () => {
    const s = state('p1', { status: 'pending_approval' })
    expect(planReminders({ state: s, surveySteps: [], draft: null, pulseWeeks: [] }, NOW)).toEqual([])
  })

  it('отправленная анкета — ни напоминаний про анкету, ни welcome', () => {
    const s = state('done', { survey_completed: true, survey_last_change_at: ago(10) })
    expect(planReminders({ state: s, surveySteps: [1, 2, 3], draft: null, pulseWeeks: [] }, NOW)).toEqual([])
  })

  it('черновик GRI важнее анкеты и называет следующий блок', () => {
    const s = state('g1', { survey_first_at: ago(20), survey_last_change_at: ago(8) })
    const plan = planReminders(
      { state: s, surveySteps: [1, 2], draft: { updatedAt: ago(4), completedSections: { 'product-demand': true } }, pulseWeeks: [] },
      NOW,
    )
    expect(plan.map((p) => p.kind)).toEqual(['gri_draft_reminder', 'survey_reminder'])
    expect(plan[0].title).toContain('Доверие и позиционирование')
  })

  it('пятница + стрик ≥ 2 + пульса на неделе нет → напоминание о пульсе', () => {
    const friday = new Date('2026-09-25T06:00:00Z')
    const s = state('pl', { survey_completed: true, gri_completed_at: ago(30, friday) })
    const plan = planReminders({ state: s, surveySteps: [], draft: null, pulseWeeks: ['2026-09-14', '2026-09-07'] }, friday)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ kind: 'pulse_reminder', dedupeKey: 'pulse_reminder:pl:2026-09-21' })
    // В четверг — нет.
    expect(planReminders({ state: s, surveySteps: [], draft: null, pulseWeeks: ['2026-09-14', '2026-09-07'] }, NOW)).toEqual([])
  })
})

describe('runReminders', () => {
  it('выбирает нужных клиентов и ставит ожидаемые ключи', async () => {
    // Анкета брошена 8 дней назад на шагах 1–2 → d7, «шаг 3».
    h.states.push(state('abandoned', { survey_first_at: ago(20), survey_last_change_at: ago(8), survey_steps: 2 }))
    h.surveyRows.set('abandoned', rowsForSteps([1, 2]))
    // Доступ открыт 3 дня назад, анкета не начата → welcome d3.
    h.states.push(state('newbie', { registered_at: ago(3), approved_at: ago(3) }))
    // Точка А 10 дней назад, GRI не начат → gri_start (анкета отправлена).
    h.states.push(state('pointa', { survey_completed: true, survey_steps: 12, point_a_at: ago(10) }))
    // Изменял анкету вчера → рано.
    h.states.push(state('fresh', { survey_first_at: ago(5), survey_last_change_at: ago(1) }))
    h.surveyRows.set('fresh', rowsForSteps([1]))
    // Ждёт одобрения → никогда.
    h.states.push(state('pending', { status: 'pending_approval', approved_at: null, registered_at: ago(5) }))
    for (const id of ['abandoned', 'newbie', 'pointa', 'fresh', 'pending']) addProfile(id)

    const stats = await runReminders(NOW)

    expect(stats.sent).toBe(3)
    expect(emailKeys().sort()).toEqual([
      'gri_start_reminder:pointa',
      'survey_reminder:d7:abandoned:2026-09-14',
      'welcome:d3:newbie',
    ])
    const surveyMail = h.email.mock.calls.map((c) => c[0] as { dedupeKey: string; subject: string; kind: string; to: string })
      .find((m) => m.dedupeKey.startsWith('survey_reminder'))!
    expect(surveyMail.subject).toContain('Вы остановились на шаге 3')
    expect(surveyMail.kind).toBe('reminder')
    expect(surveyMail.to).toBe('abandoned@example.com')
    const welcomeMail = h.email.mock.calls.map((c) => c[0] as { dedupeKey: string; kind: string }).find((m) => m.dedupeKey.startsWith('welcome'))!
    expect(welcomeMail.kind).toBe('welcome')
    // Лента получила ссылку на нужный шаг анкеты.
    const feedLinks = h.feed.mock.calls.map((c) => (c[0] as { link: string }).link)
    expect(feedLinks).toContain('/client/onboarding?step=3')
  })

  it('повторный запуск в тот же день ничего не шлёт', async () => {
    h.states.push(state('abandoned', { survey_first_at: ago(20), survey_last_change_at: ago(8) }))
    h.surveyRows.set('abandoned', rowsForSteps([1, 2]))
    addProfile('abandoned')
    await runReminders(NOW)
    await runReminders(NOW)
    expect(h.email).toHaveBeenCalledTimes(1)
  })

  it('останавливается на недельном потолке', async () => {
    h.states.push(state('busy', { survey_first_at: ago(20), survey_last_change_at: ago(8) }))
    h.surveyRows.set('busy', rowsForSteps([1, 2]))
    addProfile('busy')
    // Уже два касания за неделю.
    h.sends.push(
      { id: 'x1', userId: 'busy', kind: 'welcome', dedupeKey: 'welcome:d3:busy', countsTowardCap: true, sentAt: NOW.getTime() - 2 * DAY },
      { id: 'x2', userId: 'busy', kind: 'gri_rescan', dedupeKey: 'gri_rescan:busy:x', countsTowardCap: true, sentAt: NOW.getTime() - 5 * DAY },
    )
    const stats = await runReminders(NOW)
    expect(stats.capped).toBe(1)
    expect(h.email).not.toHaveBeenCalled()
    expect(h.feed).not.toHaveBeenCalled()
  })

  it('по одному касанию на клиента за запуск и потолок 2 за неделю по дням', async () => {
    // Клиент подходит под черновик GRI и под анкету.
    h.states.push(state('multi', { survey_first_at: ago(30), survey_last_change_at: ago(8), gri_draft_updated_at: ago(4), gri_started_at: ago(4) }))
    h.surveyRows.set('multi', rowsForSteps([1, 2]))
    h.drafts.set('multi', { updatedAt: ago(4), completedSections: {} })
    addProfile('multi')

    await runReminders(NOW)
    expect(emailKeys()).toEqual(['gri_draft_reminder:multi:2026-09-20'])

    // Назавтра черновик уже напомнили → уходит анкета (второе касание недели).
    const tomorrow = new Date(NOW.getTime() + DAY)
    h.clock = tomorrow.getTime()
    await runReminders(tomorrow)
    expect(emailKeys()).toEqual(['gri_draft_reminder:multi:2026-09-20', 'survey_reminder:d7:multi:2026-09-14'])

    // Через неделю после 8-го дня анкеты наступает стадия d14, но потолок 2 уже выбран за эти 7 дней.
    const later = new Date(NOW.getTime() + 6 * DAY)
    h.clock = later.getTime()
    const stats = await runReminders(later)
    expect(stats.capped).toBe(1)
    expect(h.email).toHaveBeenCalledTimes(2)
  })

  it('выключатель платформы останавливает все напоминания', async () => {
    h.settings.auto_reminders_enabled = false
    h.states.push(state('newbie', { registered_at: ago(1), approved_at: ago(1) }))
    addProfile('newbie')
    const stats = await runReminders(NOW)
    expect(stats.disabled).toBe(1)
    expect(h.email).not.toHaveBeenCalled()
  })
})
