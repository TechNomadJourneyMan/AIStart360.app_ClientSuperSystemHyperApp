import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { formatAttribution, formatAttributionDate, formatAuthorSummary, summarizeAuthors, type AnswerAttribution } from '@/lib/survey/attribution-label'
import { attributionOf, loadAttribution, staffAuthorIds } from '@/lib/survey/attribution-read'
import { memoryClient } from '../data-layer/memory-client'

const OWNER = '11111111-1111-4111-8111-111111111111'
const EXPERT = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'
// Midday UTC: the same calendar day in every time zone the tests run in.
const AT = '2026-10-22T09:00:00.000Z'

const a = (over: Partial<AnswerAttribution>): AnswerAttribution => ({ updatedBy: null, updatedByRole: null, updatedAt: AT, updatedByName: null, ...over })

describe('formatAttribution — the line under a field', () => {
  it('the user: «вы» for the owner, «пользователь» for staff', () => {
    expect(formatAttribution(a({ updatedBy: OWNER, updatedByRole: 'user' }), { viewerIsOwner: true })).toBe('Заполнил: вы · 22.10.2026')
    expect(formatAttribution(a({ updatedBy: OWNER, updatedByRole: 'user' }), { viewerId: OWNER })).toBe('Заполнил: вы · 22.10.2026')
    expect(formatAttribution(a({ updatedBy: OWNER, updatedByRole: 'user' }), { viewerId: EXPERT })).toBe('Заполнил пользователь · 22.10.2026')
  })

  it('expert and admin, with the name when known', () => {
    expect(formatAttribution(a({ updatedBy: EXPERT, updatedByRole: 'expert', updatedByName: 'Иван Петров' }), { viewerIsOwner: true }))
      .toBe('Изменил эксперт Иван Петров · 22.10.2026')
    expect(formatAttribution(a({ updatedBy: ADMIN, updatedByRole: 'admin' }), { viewerIsOwner: true })).toBe('Изменил админ · 22.10.2026')
    expect(formatAttribution(a({ updatedBy: ADMIN, updatedByRole: 'admin', updatedByName: '  ' }))).toBe('Изменил админ · 22.10.2026')
    expect(formatAttribution(a({ updatedBy: EXPERT, updatedByRole: 'expert' }), { viewerId: EXPERT })).toBe('Изменили вы (эксперт) · 22.10.2026')
  })

  it('AI and system', () => {
    expect(formatAttribution(a({ updatedByRole: 'ai' }))).toBe('Заполнил ИИ (из документов) · 22.10.2026')
    expect(formatAttribution(a({ updatedByRole: 'system' }))).toBe('Заполнено системой · 22.10.2026')
  })

  it('no author: no line at all (null); a broken date is dropped', () => {
    expect(formatAttribution(a({}))).toBeNull()
    expect(formatAttribution(null)).toBeNull()
    expect(formatAttribution(a({ updatedByRole: 'ai', updatedAt: 'nonsense' }))).toBe('Заполнил ИИ (из документов)')
    expect(formatAttributionDate(null)).toBeNull()
  })

  it('names are text, never markup', () => {
    const html = renderToStaticMarkup(createElement('p', null, formatAttribution(a({ updatedByRole: 'expert', updatedByName: '<b>x</b>' }))))
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('attributionOf — survey GET shaping', () => {
  const names = new Map([[EXPERT, 'Иван Петров']])

  it('stored author columns', () => {
    expect(attributionOf({ question_key: 'k', answer: { value: 'x' }, answered_at: AT, updated_by: EXPERT, updated_by_role: 'expert', updated_at: AT }, names))
      .toEqual({ updatedBy: EXPERT, updatedByRole: 'expert', updatedAt: AT, updatedByName: 'Иван Петров' })
    // The owner's name is not looked up (the client sees «вы», staff «пользователь»).
    expect(attributionOf({ question_key: 'k', updated_by: OWNER, updated_by_role: 'user', updated_at: AT }, new Map([[OWNER, 'Клиент']])).updatedByName).toBeNull()
  })

  it('legacy rows: `source` in the answer → AI (from documents), otherwise no author', () => {
    expect(attributionOf({ question_key: 'k', answer: { value: 1, source: 'P&L.xlsx, B4' }, answered_at: AT }))
      .toEqual({ updatedBy: null, updatedByRole: 'ai', updatedAt: AT, updatedByName: null, legacy: true })
    expect(attributionOf({ question_key: 'k', answer: { value: 1 }, answered_at: AT }))
      .toEqual({ updatedBy: null, updatedByRole: null, updatedAt: AT, updatedByName: null, legacy: true })
    expect(attributionOf({ question_key: 'k', answer: { value: 1, source: '' } }).updatedByRole).toBeNull()
    // An unknown stored role is treated as no author.
    expect(attributionOf({ question_key: 'k', answer: { value: 1 }, updated_by_role: 'boss' }).updatedByRole).toBeNull()
  })

  it('names: one profiles query for every expert / admin author (no N+1)', async () => {
    const m = memoryClient({ profiles: [
      { id: EXPERT, full_name: 'Иван Петров', email: 'ivan@x.kz' },
      { id: ADMIN, full_name: null, email: 'admin@x.kz' },
      { id: OWNER, full_name: 'Владелец', email: 'o@x.kz' },
    ] })
    const from = vi.spyOn(m.client, 'from')
    const rows = [
      { question_key: 'a', updated_by: EXPERT, updated_by_role: 'expert', updated_at: AT },
      { question_key: 'b', updated_by: EXPERT, updated_by_role: 'expert', updated_at: AT },
      { question_key: 'c', updated_by: ADMIN, updated_by_role: 'admin', updated_at: AT },
      { question_key: 'd', updated_by: OWNER, updated_by_role: 'user', updated_at: AT },
      { question_key: 'e', answer: { value: 1, source: 'doc' }, answered_at: AT },
    ]
    expect(staffAuthorIds(rows)).toEqual([EXPERT, ADMIN])
    const out = await loadAttribution(m.client, rows)
    expect(from).toHaveBeenCalledTimes(1)
    expect(out.a.updatedByName).toBe('Иван Петров')
    expect(out.c.updatedByName).toBe('admin@x.kz')
    expect(out.d).toMatchObject({ updatedByRole: 'user', updatedByName: null })
    expect(out.e).toMatchObject({ updatedByRole: 'ai', legacy: true })
  })

  it('no staff authors → no query; a failed name read keeps the roles', async () => {
    const m = memoryClient({})
    const from = vi.spyOn(m.client, 'from')
    await loadAttribution(m.client, [{ question_key: 'a', updated_by: OWNER, updated_by_role: 'user' }])
    expect(from).not.toHaveBeenCalled()
    const broken = { from: () => { throw new Error('down') } } as never
    const out = await loadAttribution(broken, [{ question_key: 'a', updated_by: EXPERT, updated_by_role: 'expert' }])
    expect(out.a).toMatchObject({ updatedByRole: 'expert', updatedByName: null })
  })
})

describe('the path in the author line (spec §5.4, migration 134)', () => {
  const user = (via?: AnswerAttribution['updatedVia']) => a({ updatedBy: OWNER, updatedByRole: 'user', ...(via ? { updatedVia: via } : {}) })

  it('the owner sees the path: быстрый старт / через ИИ-помощника; the full questionnaire adds nothing', () => {
    expect(formatAttribution(user('full'), { viewerIsOwner: true })).toBe('Заполнил: вы · 22.10.2026')
    expect(formatAttribution(user('express'), { viewerIsOwner: true })).toBe('Заполнил: вы (быстрый старт) · 22.10.2026')
    expect(formatAttribution(user('chat'), { viewerIsOwner: true })).toBe('Заполнил: вы (через ИИ-помощника) · 22.10.2026')
    expect(formatAttribution(user('helper'), { viewerIsOwner: true })).toBe('Заполнил: вы (через ИИ-помощника) · 22.10.2026')
  })

  it('staff see the client by name and the path: экспресс / через ИИ-помощника', () => {
    expect(formatAttribution(user('express'), { viewerId: EXPERT, ownerName: 'Айгуль' })).toBe('Заполнил пользователь Айгуль (экспресс) · 22.10.2026')
    expect(formatAttribution(user('chat'), { viewerId: EXPERT, ownerName: 'Айгуль' })).toBe('Заполнил пользователь Айгуль (через ИИ-помощника) · 22.10.2026')
    expect(formatAttribution(user(), { viewerId: EXPERT })).toBe('Заполнил пользователь · 22.10.2026')
  })

  it('documents, staff and system lines do not change with the path', () => {
    expect(formatAttribution(a({ updatedByRole: 'ai', updatedVia: 'document' }), { viewerIsOwner: true })).toBe('Заполнил ИИ (из документов) · 22.10.2026')
    expect(formatAttribution(a({ updatedBy: EXPERT, updatedByRole: 'expert', updatedByName: 'Иван Петров', updatedVia: 'staff' }), { viewerIsOwner: true })).toBe('Изменил эксперт Иван Петров · 22.10.2026')
    expect(formatAttribution(a({ updatedBy: EXPERT, updatedByRole: 'expert', updatedVia: 'staff' }), { viewerId: EXPERT })).toBe('Изменили вы (эксперт) · 22.10.2026')
  })

  it('attributionOf carries a valid path only', () => {
    expect(attributionOf({ question_key: 'k', updated_by: OWNER, updated_by_role: 'user', updated_at: AT, updated_via: 'helper' }).updatedVia).toBe('helper')
    expect(attributionOf({ question_key: 'k', updated_by: OWNER, updated_by_role: 'user', updated_at: AT, updated_via: 'hack' })).not.toHaveProperty('updatedVia')
    expect(attributionOf({ question_key: 'k', updated_by: OWNER, updated_by_role: 'user', updated_at: AT })).not.toHaveProperty('updatedVia')
  })
})

describe('«Кто заполнял» — summary', () => {
  const attribution: Record<string, AnswerAttribution> = {
    k1: a({ updatedBy: OWNER, updatedByRole: 'user', updatedVia: 'full' }),
    k2: a({ updatedBy: OWNER, updatedByRole: 'user', updatedVia: 'chat' }),
    k3: a({ updatedBy: OWNER, updatedByRole: 'user', updatedVia: 'express' }),
    k4: a({ updatedByRole: 'ai', updatedVia: 'document' }),
    k5: a({ updatedBy: EXPERT, updatedByRole: 'expert', updatedByName: 'Иван Петров' }),
    k6: a({ updatedBy: EXPERT, updatedByRole: 'expert', updatedByName: 'Иван Петров' }),
    k7: a({ updatedBy: ADMIN, updatedByRole: 'admin', updatedByName: 'Админ' }),
    k8: a({ updatedByRole: null, legacy: true }),
  }
  const keys = [...Object.keys(attribution), 'k9']

  it('counts per author and path', () => {
    const s = summarizeAuthors(keys, attribution)
    expect(s).toMatchObject({ total: 9, owner: 3, ownerViaAssistant: 1, ownerViaExpress: 1, documents: 1, system: 0, unknown: 2 })
    expect(s.staff).toEqual([
      { role: 'expert', id: EXPERT, name: 'Иван Петров', count: 2 },
      { role: 'admin', id: ADMIN, name: 'Админ', count: 1 },
    ])
  })

  it('one line for the owner and for staff', () => {
    const s = summarizeAuthors(keys, attribution)
    expect(formatAuthorSummary(s, { viewerIsOwner: true })).toBe(
      'Ответов 9: вы — 3 (из них в быстром старте — 1, через ИИ-помощника — 1), из документов — 1, эксперт Иван Петров — 2, админ Админ — 1, без автора (старые) — 2',
    )
    expect(formatAuthorSummary(s, { viewerId: EXPERT, ownerName: 'Айгуль' })).toContain('пользователь Айгуль — 3')
    expect(formatAuthorSummary(s, { viewerId: EXPERT, ownerName: 'Айгуль' })).toContain('вы (эксперт) — 2')
    expect(formatAuthorSummary(summarizeAuthors([], {}))).toBe('Ответов пока нет')
  })
})
