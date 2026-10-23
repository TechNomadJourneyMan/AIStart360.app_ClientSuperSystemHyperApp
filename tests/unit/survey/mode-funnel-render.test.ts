/**
 * Survey Ф5 — the GIGA panel «Способы заполнения анкеты» rendered to static
 * markup: the seven steps with shares, the tiles, the lists with links to User 360.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurveyModesFunnelView, type ModeFunnelPayload } from '@/components/giga-panel/surveys/SurveyModesFunnel'
import { computeModeFunnel } from '@/lib/survey/mode-funnel'

const base = computeModeFunnel({
  events: [
    { id: 1, user_id: 'u-b', event_name: 'SURVEY_MODE_CHOSEN', created_at: '2026-10-10T09:00:00Z', metadata: { mode: 'express' }, source: 'web' },
    { id: 2, user_id: 'u-b', event_name: 'SURVEY_EXPRESS_COMPLETED', created_at: '2026-10-10T09:09:00Z', metadata: { minutes: 9 }, source: 'server' },
    { id: 3, user_id: 'u-d', event_name: 'SURVEY_MODE_CHOSEN', created_at: '2026-10-11T09:00:00Z', metadata: { mode: 'chat' }, source: 'web' },
  ],
  submissions: new Map(),
  since: new Date('2026-10-01T00:00:00Z'),
  until: new Date('2026-10-31T00:00:00Z'),
  now: new Date('2026-10-20T09:09:00Z'),
})
const data: ModeFunnelPayload = { ...base, days: 30, submissionsSource: 'completions', people: { 'u-b': { name: 'Бек', company: 'ТОО Бета' } } }
const render = (d: ModeFunnelPayload) => renderToStaticMarkup(createElement(SurveyModesFunnelView, { data: d, base: '/admin-giga-panel' }))

describe('SurveyModesFunnelView', () => {
  it('the seven steps in order with the shares', () => {
    const html = render(data)
    expect(html).toContain('aria-label="Воронка способов заполнения"')
    expect(html.match(/data-step="/g)).toHaveLength(7)
    expect(html.indexOf('1. Выбрали способ заполнения')).toBeLessThan(html.indexOf('7. Отправили полную анкету'))
    expect(html).toContain('50% от выбравших')
    expect(html).toContain('9 мин')
  })

  it('stuck and pending clients link to User 360 → «Анкета»', () => {
    const html = render(data)
    expect(html).toContain('href="/admin-giga-panel/users/u-b?tab=survey"')
    expect(html).toContain('ТОО Бета')
    expect(html).toContain('10 дн. без полной анкеты')
    expect(html).toContain('Пользователь u-d') // no name loaded → a neutral marker, never a raw id alone
  })

  it('an empty cohort explains where the choice comes from', () => {
    const html = render({ ...data, cohort: 0, stuck: [], pending: [] })
    expect(html).toContain('За период никто не выбирал способ заполнения')
    expect(html).toContain('NEXT_PUBLIC_SURVEY_MODES')
  })

  it('the fallback source is said out loud', () => {
    expect(render({ ...data, submissionsSource: 'events' })).toContain('admin_survey_completions недоступна')
  })
})
