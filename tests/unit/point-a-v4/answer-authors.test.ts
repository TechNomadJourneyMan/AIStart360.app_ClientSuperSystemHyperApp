import { describe, it, expect } from 'vitest'
import { POINT_A_QUESTION_KEYS, checkAuthorLines, lastAnswerChange, latestBlockAuthor } from '@/lib/point-a/v4/answer-authors'
import type { AnswerAttribution } from '@/lib/survey/attribution-label'

const at = (role: AnswerAttribution['updatedByRole'], updatedAt: string, extra: Partial<AnswerAttribution> = {}): AnswerAttribution =>
  ({ updatedBy: 'u1', updatedByRole: role, updatedAt, updatedByName: null, ...extra })

describe('who answered the questions of a Point A check, and when (PO 2026-11-02)', () => {
  const attribution = {
    s9n_revenue_2024: at('user', '2026-10-22T08:00:00Z'),
    s9n_change_vs_2023: at('expert', '2026-11-01T08:00:00Z', { updatedBy: 'e1', updatedByName: 'Иван Петров' }),
    s9n_net_margin: at('ai', '2026-10-20T08:00:00Z'),
    s12_crm_tool: at('admin', '2026-10-30T08:00:00Z', { updatedBy: 'a1', updatedByName: 'Алия' }),
    s6_main_pain: at('user', '2026-10-21T08:00:00Z', { updatedVia: 'chat' }),
  }

  it('the client, the expert, the AI and the admin, each with the date', () => {
    expect(checkAuthorLines('finance', 'growth', attribution, { viewerIsOwner: true })).toEqual([
      { key: 's9n_revenue_2024', label: 'Выручка 2024', line: 'Заполнил: вы · 22.10.2026' },
      { key: 's9n_change_vs_2023', label: 'Изменение выручки к 2023', line: 'Изменил эксперт Иван Петров · 01.11.2026' },
    ])
    expect(checkAuthorLines('finance', 'margin', attribution)[0].line).toBe('Заполнил ИИ (из документов) · 20.10.2026')
    expect(checkAuthorLines('sales', 'crm', attribution)[0].line).toBe('Изменил админ Алия · 30.10.2026')
    expect(checkAuthorLines('strategy', 'main_pain', attribution, { viewerIsOwner: true })[0].line).toBe('Заполнил: вы (через ИИ-помощника) · 21.10.2026')
  })

  it('staff see the client as «пользователь»', () => {
    expect(checkAuthorLines('finance', 'growth', attribution)[0].line).toBe('Заполнил пользователь · 22.10.2026')
  })

  it('a block card shows its latest change', () => {
    expect(latestBlockAuthor('finance', attribution, { viewerIsOwner: true })).toBe('Изменил эксперт Иван Петров · 01.11.2026')
    expect(latestBlockAuthor('team', attribution)).toBeNull()
  })

  it('no author recorded — no line; the latest change of all answers', () => {
    expect(checkAuthorLines('finance', 'debt', attribution)).toEqual([])
    expect(lastAnswerChange(attribution)).toBe('2026-11-01T08:00:00Z')
    expect(lastAnswerChange({})).toBeNull()
  })

  it('the keys the page reads authors of: every question behind a check, once', () => {
    expect(POINT_A_QUESTION_KEYS).toContain('s9n_revenue_2024')
    expect(new Set(POINT_A_QUESTION_KEYS).size).toBe(POINT_A_QUESTION_KEYS.length)
  })
})
