/**
 * Survey Ф5 — the questionnaire status staff see (spec §5.2, §10; PO §18.3
 * item 1: only the full questionnaire is «анкета заполнена»).
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildSurveyStaffStatus, countBySurveyFilter, filterBySurveyStatus, historyLine, matchesSurveyFilter, shortDate, surveyStatusChips,
  type SurveyStaffStatus,
} from '@/lib/survey/staff-status'
import { loadSurveyStaffStatuses } from '@/lib/survey/staff-status-load'
import { SurveyStatusChips } from '@/components/survey/SurveyStatusChips'

const NOW = new Date('2026-10-30T10:00:00')

describe('buildSurveyStaffStatus', () => {
  it('mode from the preference, since the last switch; express from the event; full not submitted → stuck', () => {
    const s = buildSurveyStaffStatus({
      preferences: { survey: { mode: 'express', chosen_at: '2026-10-23T09:00:00', switched_at: '2026-10-24T09:00:00' }, theme: 'dark' },
      expressCompleted: { at: '2026-10-25T12:00:00', metadata: { answered: 24, unknown: 2, skipped: 2, minutes: 8 } },
      modeEvents: [
        { at: '2026-10-23T09:00:00', metadata: { mode: 'full', previous: null, from: 'chooser' } },
        { at: '2026-10-24T09:00:00', metadata: { mode: 'express', previous: 'full', from: 'switch' } },
      ],
    })
    expect(s).toMatchObject({
      mode: 'express', modeSince: '2026-10-24T09:00:00', fullSubmittedAt: null, fullPending: true, stuckOnExpress: true,
      express: { completedAt: '2026-10-25T12:00:00', answered: 24, unknown: 2, total: 26 },
    })
    expect(s.history.map((h) => h.mode)).toEqual(['express', 'full'])
  })

  it('no preference → the last event; nothing at all → empty status', () => {
    expect(buildSurveyStaffStatus({ modeEvents: [{ at: '2026-10-23T09:00:00', metadata: { mode: 'chat', from: 'chooser' } }] }))
      .toMatchObject({ mode: 'chat', modeSince: '2026-10-23T09:00:00' })
    expect(buildSurveyStaffStatus({})).toMatchObject({ mode: null, express: null, fullPending: true, stuckOnExpress: false, history: [] })
  })

  it('full submitted → not stuck even after the express', () => {
    const s = buildSurveyStaffStatus({ expressCompleted: { at: '2026-10-25T12:00:00' }, fullSubmittedAt: '2026-10-28T12:00:00' })
    expect(s).toMatchObject({ stuckOnExpress: false, fullPending: false, express: { answered: null, total: null } })
  })

  it('malformed mode events are ignored; at most 10 in the history', () => {
    const events = Array.from({ length: 14 }, (_, i) => ({ at: `2026-10-${String(10 + i).padStart(2, '0')}T09:00:00`, metadata: { mode: i % 2 ? 'full' : 'express' } }))
    events.push({ at: '2026-10-29T09:00:00', metadata: { mode: 'paper' } })
    const s = buildSurveyStaffStatus({ modeEvents: events })
    expect(s.history).toHaveLength(10)
    expect(s.history[0].at).toBe('2026-10-23T09:00:00')
  })
})

describe('chips and lines', () => {
  const stuck = buildSurveyStaffStatus({
    preferences: { survey: { mode: 'express', chosen_at: '2026-10-23T09:00:00' } },
    expressCompleted: { at: '2026-10-25T12:00:00', metadata: { answered: 24, unknown: 2, skipped: 2 } },
  })

  it('«Заполняет: экспресс + блоки (с 23.10)», «Экспресс пройден 25.10 · первичная Точка А», «Полная анкета не отправлена»', () => {
    const chips = surveyStatusChips(stuck, NOW)
    expect(chips.map((c) => c.label)).toEqual([
      'Заполняет: экспресс + блоки (с 23.10)',
      'Экспресс пройден 25.10 · первичная Точка А',
      'Полная анкета не отправлена',
    ])
    expect(chips[1]).toMatchObject({ tone: 'amber', title: 'Ответов 24 из 26, «не знаю» — 2' })
  })

  it('submitted → green «Полная анкета отправлена 28.10»; a client who never met the modes → no chips', () => {
    const done = buildSurveyStaffStatus({ fullSubmittedAt: '2026-10-28T12:00:00' })
    expect(surveyStatusChips(done, NOW)).toEqual([expect.objectContaining({ key: 'full', label: 'Полная анкета отправлена 28.10', tone: 'green' })])
    expect(surveyStatusChips(buildSurveyStaffStatus({}), NOW)).toEqual([])
    expect(surveyStatusChips(null, NOW)).toEqual([])
  })

  it('history line and short date', () => {
    expect(historyLine({ mode: 'full', previous: 'express', from: 'switch', at: '2026-10-24T09:00:00' }, NOW)).toBe('24.10 · полная анкета (переключение с «экспресс + блоки»)')
    expect(historyLine({ mode: 'chat', previous: null, from: 'chooser', at: '2026-10-23T09:00:00' }, NOW)).toBe('23.10 · беседа с ИИ (выбор)')
    expect(shortDate('2025-12-31T09:00:00', NOW)).toBe('31.12.2025')
    expect(shortDate('nope', NOW)).toBeNull()
  })

  it('renders chips with the details for screen readers; nothing for an empty status', () => {
    const html = renderToStaticMarkup(createElement(SurveyStatusChips, { status: stuck, now: NOW }))
    expect(html).toContain('aria-label="Анкета: способ заполнения"')
    expect(html).toContain('Заполняет: экспресс + блоки (с 23.10)')
    expect(html).toContain('<span class="sr-only"> (Ответов 24 из 26, «не знаю» — 2)</span>')
    expect(renderToStaticMarkup(createElement(SurveyStatusChips, { status: buildSurveyStaffStatus({}) }))).toBe('')
  })
})

describe('filters', () => {
  const st = (f: Partial<SurveyStaffStatus>): SurveyStaffStatus => ({ ...buildSurveyStaffStatus({}), ...f })
  const rows = [
    { id: 'a', survey: st({ stuckOnExpress: true, fullPending: true }) },
    { id: 'b', survey: st({ fullPending: true }) },
    { id: 'c', survey: st({ fullPending: false, fullSubmittedAt: '2026-10-28T00:00:00' }) },
    { id: 'd', survey: null },
  ]
  it('«без отправленной полной анкеты», «застряли на экспрессе»; unknown status only in «Все»', () => {
    expect(filterBySurveyStatus(rows, 'full_pending').map((r) => r.id)).toEqual(['a', 'b'])
    expect(filterBySurveyStatus(rows, 'stuck_express').map((r) => r.id)).toEqual(['a'])
    expect(filterBySurveyStatus(rows, 'all')).toHaveLength(4)
    expect(countBySurveyFilter(rows)).toEqual({ all: 4, full_pending: 2, stuck_express: 1 })
    expect(matchesSurveyFilter(undefined, 'full_pending')).toBe(false)
  })
})

// ─── loader ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>
function fakeDb(tables: Record<string, Row[]>, rpc: { data?: unknown; error?: unknown } = { data: [] }) {
  return {
    rpc: async () => rpc,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      const b = {
        select: () => b,
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
        order: () => b,
        limit: () => b,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }).then(res),
      }
      return b
    },
  }
}

describe('loadSurveyStaffStatuses', () => {
  const A = 'a0000000-0000-4000-8000-000000000001'
  const B = 'b0000000-0000-4000-8000-000000000002'
  const tables = {
    profiles: [
      { id: A, preferences: { survey: { mode: 'express', chosen_at: '2026-10-23T09:00:00' } } },
      { id: B, preferences: {} },
    ],
    user_events: [
      { user_id: A, event_name: 'SURVEY_MODE_CHOSEN', created_at: '2026-10-23T09:00:00', metadata: { mode: 'express', from: 'chooser' }, source: 'web' },
      { user_id: A, event_name: 'SURVEY_EXPRESS_COMPLETED', created_at: '2026-10-23T09:10:00', metadata: { answered: 20, unknown: 1, skipped: 6 }, source: 'server' },
      // A choice made in a cabinet opened by staff is not the client's.
      { user_id: B, event_name: 'SURVEY_MODE_CHOSEN', created_at: '2026-10-24T09:00:00', metadata: { mode: 'chat', from: 'chooser' }, source: 'impersonation' },
      { user_id: B, event_name: 'QUESTIONNAIRE_COMPLETED', created_at: '2026-10-26T09:00:00', metadata: {}, source: 'server' },
    ],
  }

  it('reads preferences, events and admin_survey_completions', async () => {
    const map = await loadSurveyStaffStatuses(fakeDb(tables, { data: [{ user_id: B, completed_at: '2026-10-25T09:00:00' }] }) as never, [A, B, A])
    expect(map.get(A)).toMatchObject({ mode: 'express', stuckOnExpress: true, express: { answered: 20, total: 26 } })
    expect(map.get(B)).toMatchObject({ mode: null, fullSubmittedAt: '2026-10-25T09:00:00', stuckOnExpress: false })
  })

  it('the RPC is unavailable → QUESTIONNAIRE_COMPLETED decides', async () => {
    const map = await loadSurveyStaffStatuses(fakeDb(tables, { data: null, error: { message: 'no function' } }) as never, [B])
    expect(map.get(B)?.fullSubmittedAt).toBe('2026-10-26T09:00:00')
  })

  it('a known submission time is used as is (User 360)', async () => {
    const map = await loadSurveyStaffStatuses(fakeDb(tables) as never, [A], { fullSubmittedAt: new Map([[A, '2026-10-29T09:00:00']]) })
    expect(map.get(A)).toMatchObject({ fullSubmittedAt: '2026-10-29T09:00:00', stuckOnExpress: false })
  })

  it('a failed read → empty map, never throws', async () => {
    const broken = { rpc: async () => ({ data: [] }), from: () => { throw new Error('down') } }
    expect((await loadSurveyStaffStatuses(broken as never, [A])).size).toBe(0)
    expect((await loadSurveyStaffStatuses(fakeDb(tables) as never, [])).size).toBe(0)
  })
})
