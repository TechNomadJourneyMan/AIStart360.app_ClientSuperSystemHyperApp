/**
 * R2-B — UI таймера очереди эксперта (components/expert-sla/ExpertSlaQueueList):
 * «осталось N ч» / «просрочено на N ч» с цветом состояния, ссылка на работу,
 * честное пустое состояние; ссылки задач в кабинете эксперта и в ГИГА.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExpertSlaQueueList, SlaTimerBadge, type ExpertQueueTask } from '@/components/expert-sla/ExpertSlaQueueList'
import { slaDeadlines } from '@/lib/expert-sla/policy'
import { expertTaskHref, staffTaskHref } from '@/lib/expert-sla/links'

const T0 = new Date('2026-11-14T06:00:00.000Z')
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000)

function task(id: string, over: Partial<ExpertQueueTask> = {}): ExpertQueueTask {
  return {
    id, source: 'case', source_id: `case-${id}`, client_id: 'c1', title: `Обращение ${id}`, sourceLabel: 'Обращение клиента',
    client: { id: 'c1', name: 'ООО Ромашка' }, received_at: T0.toISOString(), ...slaDeadlines(T0),
    first_response_at: null, closed_at: null, ...over,
  }
}

describe('expert queue timer UI', () => {
  it('shows the hours left and the stage colour; flips to «просрочено» after 48 h', () => {
    const fresh = renderToStaticMarkup(createElement(SlaTimerBadge, { task: task('a'), now: at(17) }))
    expect(fresh).toContain('осталось 31 ч')
    expect(fresh).toContain('data-stage="ok"')
    const soon = renderToStaticMarkup(createElement(SlaTimerBadge, { task: task('a'), now: at(20) }))
    expect(soon).toContain('data-stage="due_soon"')
    const noReaction = renderToStaticMarkup(createElement(SlaTimerBadge, { task: task('a'), now: at(25) }))
    expect(noReaction).toContain('data-stage="escalated"')
    expect(noReaction).toContain('осталось 23 ч')
    const late = renderToStaticMarkup(createElement(SlaTimerBadge, { task: task('a'), now: at(51) }))
    expect(late).toContain('просрочено на 3 ч')
    expect(late).toContain('data-stage="breached"')
    expect(late).toContain('text-error')
  })

  it('lists tasks with the client, the kind of work, «ждёт реакции» and a link to the work', () => {
    const html = renderToStaticMarkup(createElement(ExpertSlaQueueList, {
      tasks: [task('a'), task('b', { source: 'report_review', source_id: 'rv-1', sourceLabel: 'Отчёт на проверке', first_response_at: at(1).toISOString() })],
      now: at(10),
    }))
    expect(html).toContain('Обращение a')
    expect(html).toContain('Обращение клиента · ООО Ромашка · ждёт реакции')
    expect(html).toContain('Отчёт на проверке · ООО Ромашка<')
    expect(html).toContain('href="/expert/clients/c1"')
    expect(html).toContain('href="/expert/reports"')
    expect(html).toContain('осталось 38 ч')
  })

  it('an empty queue says so plainly', () => {
    expect(renderToStaticMarkup(createElement(ExpertSlaQueueList, { tasks: [], now: T0 }))).toContain('Задач в очереди нет')
  })

  it('task links: expert cabinet and GIGA / SuperExpert workspaces', () => {
    const t = { source: 'case' as const, source_id: 'k1', client_id: 'c1' }
    expect(expertTaskHref(t)).toBe('/expert/clients/c1')
    expect(staffTaskHref(t, '/admin-giga-panel')).toBe('/admin-giga-panel/cases?case=k1')
    expect(staffTaskHref({ ...t, source: 'plan_review' }, '/admin-giga-panel')).toBe('/admin-giga-panel/point-b-queue')
    expect(staffTaskHref({ ...t, source: 'plan_review' }, '/super-expert')).toBe('/super-expert/users/c1')
    expect(staffTaskHref({ ...t, source: 'rec_review' }, '/super-expert')).toBe('/super-expert/users/c1')
    expect(staffTaskHref({ ...t, source: 'report_review' }, '/super-expert')).toBe('/super-expert/reports')
  })
})
