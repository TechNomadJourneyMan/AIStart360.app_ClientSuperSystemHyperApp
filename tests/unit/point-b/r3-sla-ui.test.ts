/**
 * R3-SLA (migration 152) — Point B: the client is told WHO prepares the plan and until when, by the plan_prep task;
 * staff see «Ждут план» in «Точка Б — очередь» with «Взять себе» and «Собрать черновик плана».
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parsePlanPrep, planPrepView } from '@/components/point-b/planPrep'
import { withPlanTask } from '@/lib/point-b/plan/waiting'
import { PlanPrepQueueView, parsePlanPrepQueue, type PlanPrepRow } from '@/components/giga-panel/pages/PointBQueuePage'

const DUE = '2026-11-17T09:00:00.000Z' // 14:00 Алматы

describe('client: «План готовит: <имя>, до <срок>» / «Назначаем ответственного»', () => {
  it('a holder → his name and the deadline; nobody → «Назначаем ответственного» with the deadline', () => {
    const held = planPrepView({ kind: 'waiting', missing: [], since: null, task: { assignee: 'Анна Админ', dueAt: DUE, overdue: false } }, 'banner')!
    expect(held.title).toBe('План готовит: Анна Админ')
    expect(held.text).toContain('План будет готов до 17 ноября, 14:00.')
    const queue = planPrepView({ kind: 'waiting', missing: [], since: null, task: { assignee: null, dueAt: DUE, overdue: false } }, 'scenarios')!
    expect(queue.title).toBe('Назначаем ответственного')
    expect(queue.text).toContain('до 17 ноября, 14:00')
    const inWork = planPrepView({ kind: 'in_work', missing: [], since: null, task: { assignee: 'Анна Админ', dueAt: DUE, overdue: false } }, 'banner')!
    expect(inWork.text).toContain('Черновик вашего плана уже в работе.')
    const review = planPrepView({ kind: 'in_review', missing: [], since: null, task: { assignee: 'Анна Админ', dueAt: DUE, overdue: false } }, 'banner')!
    expect(review.title).toBe('План на проверке перед публикацией')
    expect(review.text).toContain('Срок — до 17 ноября, 14:00.')
  })

  it('an overdue task promises no date; without a task the R3-PB wording stays; «нужны данные» never gets a task', () => {
    const late = planPrepView({ kind: 'waiting', missing: [], since: null, task: { assignee: 'Анна Админ', dueAt: DUE, overdue: true } }, 'banner')!
    expect(late.text).toContain('Срок подготовки прошёл — команда об этом знает.')
    expect(late.text).not.toContain('17 ноября')
    expect(planPrepView({ kind: 'waiting', missing: [], since: null }, 'banner')!.title).toBe('Данных для плана достаточно')
    const needs = planPrepView({ kind: 'needs_data', missing: [{ key: 'goal', label: 'Цель', actions: ['survey'] }], since: null, task: { assignee: 'A', dueAt: DUE, overdue: false } }, 'banner')!
    expect(needs.title).toBe('Для плана нужны данные')
    expect(withPlanTask({ kind: 'needs_data', missing: [], since: null }, { assignee: 'A', dueAt: DUE, overdue: false })).not.toHaveProperty('task')
    expect(withPlanTask({ kind: 'published', missing: [], since: null }, { assignee: 'A', dueAt: DUE, overdue: false })).not.toHaveProperty('task')
    expect(withPlanTask({ kind: 'waiting', missing: [], since: null }, { assignee: 'A', dueAt: DUE, overdue: false }).task).toMatchObject({ assignee: 'A' })
  })

  it('the page state keeps the task through parsePlanPrep; a broken task is dropped', () => {
    expect(parsePlanPrep({ kind: 'waiting', missing: [], since: null, task: { assignee: 'Анна', dueAt: DUE, overdue: false } })?.task).toEqual({ assignee: 'Анна', dueAt: DUE, overdue: false })
    expect(parsePlanPrep({ kind: 'waiting', missing: [], since: null, task: { dueAt: 'not a date' } })).not.toHaveProperty('task')
  })
})

describe('GIGA «Точка Б — очередь»: «Ждут план»', () => {
  const row = (over: Partial<PlanPrepRow> = {}): PlanPrepRow => ({
    id: 't1', title: 'Подготовить план Точки Б', received_at: '2026-11-15T09:00:00.000Z', reaction_due_at: '2026-11-16T09:00:00.000Z',
    answer_due_at: DUE, first_response_at: null, closed_at: null, assignee_id: null, stage: 'ok',
    client: { id: 'c1', name: 'ООО Ромашка' }, assignee: null, takeable: true, ...over,
  })

  it('a row: the client, the timer, nobody → «Взять себе» for an admin, the link «Собрать черновик плана»', () => {
    const html = renderToStaticMarkup(createElement(PlanPrepQueueView, {
      base: '/admin-giga-panel', rows: [row()], loading: false, error: null, onRetry: () => {}, takerId: 'adm', onTake: () => {}, now: new Date('2026-11-15T19:00:00.000Z'),
    }))
    expect(html).toContain('Ждут план')
    expect(html).toContain('ООО Ромашка')
    expect(html).toContain('осталось 38 ч')
    expect(html).toContain('никто — очередь')
    expect(html).toContain('Взять себе')
    expect(html).toContain('href="/admin-giga-panel/users/c1?tab=point-b"')
    expect(html).toContain('Собрать черновик плана')
    // Not an admin (SuperExpert) or already his — no «Взять себе».
    expect(renderToStaticMarkup(createElement(PlanPrepQueueView, { base: '/admin-giga-panel', rows: [row()], loading: false, error: null, onRetry: () => {} }))).not.toContain('Взять себе')
    expect(renderToStaticMarkup(createElement(PlanPrepQueueView, {
      base: '/admin-giga-panel', rows: [row({ assignee_id: 'adm', assignee: { id: 'adm', name: 'Анна' } })], loading: false, error: null, onRetry: () => {}, takerId: 'adm', onTake: () => {},
    }))).not.toContain('Взять себе')
  })

  it('parse: rows of the SLA API only', () => {
    expect(parsePlanPrepQueue({ data: [row(), { id: 5 }, null] })).toHaveLength(1)
    expect(parsePlanPrepQueue(null)).toEqual([])
  })
})
