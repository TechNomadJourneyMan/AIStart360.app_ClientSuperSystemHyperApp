import { describe, it, expect, vi } from 'vitest'
import {
  shouldAnnounceCompletion,
  buildClientNotice,
  claimCompletionNotice,
  SURVEY_COMPLETED_EVENT,
} from '@/lib/survey/completion-notice'

describe('shouldAnnounceCompletion', () => {
  const base = { totalSteps: 12, isCompleteNow: false, wasCompleteBefore: false }

  it('срабатывает на отправку финального шага, даже если он пустой', () => {
    // QA-кейс: 11/12 заполнено, шаг 12 проехали без ответов.
    expect(shouldAnnounceCompletion({ ...base, submittedStep: 12 })).toBe(true)
  })

  it('срабатывает, когда анкета впервые стала полной на промежуточном шаге', () => {
    expect(shouldAnnounceCompletion({ ...base, submittedStep: 7, isCompleteNow: true })).toBe(true)
  })

  it('молчит на обычных промежуточных сохранениях', () => {
    expect(shouldAnnounceCompletion({ ...base, submittedStep: 3 })).toBe(false)
  })

  it('молчит при повторном сохранении уже полной анкеты не с финального шага', () => {
    expect(
      shouldAnnounceCompletion({ ...base, submittedStep: 5, isCompleteNow: true, wasCompleteBefore: true }),
    ).toBe(false)
  })
})

describe('buildClientNotice', () => {
  it('разный текст для полной и частичной анкеты', () => {
    expect(buildClientNotice({ completedSteps: 12, totalSteps: 12, company: 'X', sheetUrl: null }).title)
      .toBe('Анкета заполнена полностью')
    const partial = buildClientNotice({ completedSteps: 11, totalSteps: 12, company: 'X', sheetUrl: null })
    expect(partial.title).toBe('Анкета отправлена')
    expect(partial.body).toContain('11 из 12')
  })
})

// ─── claimCompletionNotice ───────────────────────────────────────────────────

function fakeService(existing: Array<{ id: string }>, opts: { selectError?: string; insertError?: string } = {}) {
  const inserts: Record<string, unknown>[] = []
  const client = {
    from() {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self, eq: self, contains: self,
        limit: () => Promise.resolve({ data: existing, error: opts.selectError ? { message: opts.selectError } : null }),
        insert: (row: Record<string, unknown>) => {
          inserts.push(row)
          return Promise.resolve({ error: opts.insertError ? { message: opts.insertError } : null })
        },
      })
      return chain
    },
  }
  return { client: client as never, inserts }
}

const input = { completedSteps: 11, totalSteps: 12, company: 'ТОО kOtaq-Telecom', sheetUrl: 'https://docs.google.com/x' }

describe('claimCompletionNotice', () => {
  it('первый вызов ставит маркер и разрешает рассылку', async () => {
    const { client, inserts } = fakeService([])
    await expect(claimCompletionNotice(client, 'u-1', input)).resolves.toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ user_id: 'u-1', category: 'survey', link: '/client/point-a' })
    expect((inserts[0].metadata as Record<string, unknown>).event).toBe(SURVEY_COMPLETED_EVENT)
  })

  it('повторный вызов не шлёт второе уведомление', async () => {
    const { client, inserts } = fakeService([{ id: 'n-1' }])
    await expect(claimCompletionNotice(client, 'u-1', input)).resolves.toBe(false)
    expect(inserts).toHaveLength(0)
  })

  it('ошибка БД не глушит уведомление', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = fakeService([], { selectError: 'boom' })
    await expect(claimCompletionNotice(a.client, 'u-1', input)).resolves.toBe(true)
    const b = fakeService([], { insertError: 'boom' })
    await expect(claimCompletionNotice(b.client, 'u-1', input)).resolves.toBe(true)
    vi.restoreAllMocks()
  })
})
