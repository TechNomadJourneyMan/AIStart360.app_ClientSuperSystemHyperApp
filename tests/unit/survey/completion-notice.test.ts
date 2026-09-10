import { describe, it, expect, vi } from 'vitest'
import {
  shouldAnnounceCompletion,
  buildClientNotice,
  claimCompletionNotice,
  SURVEY_COMPLETED_EVENT,
} from '@/lib/survey/completion-notice'

describe('shouldAnnounceCompletion', () => {
  const base = { finalSubmitted: false, isCompleteNow: false, wasCompleteBefore: false }

  it('срабатывает на явную отправку анкеты, даже если шаг 12 пустой', () => {
    // QA-кейс: 11/12 заполнено, шаг 12 проехали без ответов и нажали «Получить диагностику».
    expect(shouldAnnounceCompletion({ ...base, finalSubmitted: true })).toBe(true)
  })

  it('срабатывает, когда анкета впервые стала полной на промежуточном шаге', () => {
    expect(shouldAnnounceCompletion({ ...base, isCompleteNow: true })).toBe(true)
  })

  it('молчит на обычных сохранениях, включая уход с шага 12 по вкладке', () => {
    // Раньше step=12 из вкладки считался «финалом» и слал «анкета пройдена (1/12)».
    expect(shouldAnnounceCompletion(base)).toBe(false)
  })

  it('молчит при повторном сохранении уже полной анкеты без явной отправки', () => {
    expect(shouldAnnounceCompletion({ ...base, isCompleteNow: true, wasCompleteBefore: true })).toBe(false)
  })
})

describe('buildClientNotice', () => {
  it('разный текст для полной и частичной анкеты', () => {
    expect(buildClientNotice({ completedSteps: 12, totalSteps: 12, company: 'X' }).title)
      .toBe('Анкета заполнена полностью')
    const partial = buildClientNotice({ completedSteps: 11, totalSteps: 12, company: 'X' })
    expect(partial.title).toBe('Анкета отправлена')
    expect(partial.body).toContain('11 из 12')
  })
})

// ─── claimCompletionNotice ───────────────────────────────────────────────────

function fakeService(existing: Array<{ id: string }>, opts: { selectError?: string; insertError?: string; insertCode?: string } = {}) {
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
          return Promise.resolve({ error: opts.insertError ? { message: opts.insertError, code: opts.insertCode } : null })
        },
      })
      return chain
    },
  }
  return { client: client as never, inserts }
}

const input = { completedSteps: 11, totalSteps: 12, company: 'ТОО kOtaq-Telecom' }

describe('claimCompletionNotice', () => {
  it('первый вызов ставит маркер и разрешает рассылку', async () => {
    const { client, inserts } = fakeService([])
    await expect(claimCompletionNotice(client, 'u-1', input)).resolves.toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ user_id: 'u-1', category: 'survey', link: '/client/point-a' })
    expect((inserts[0].metadata as Record<string, unknown>).event).toBe(SURVEY_COMPLETED_EVENT)
    // клиент читает свои уведомления через RLS — ссылки на админскую таблицу там быть не должно
    expect(JSON.stringify(inserts[0])).not.toContain('docs.google.com')
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

  it('параллельный дубль, пойманный уникальным индексом (23505), не шлёт второе уведомление', async () => {
    const { client } = fakeService([], { insertError: 'duplicate key', insertCode: '23505' })
    await expect(claimCompletionNotice(client, 'u-1', input)).resolves.toBe(false)
  })
})
