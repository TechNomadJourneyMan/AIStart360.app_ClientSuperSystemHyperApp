/**
 * lib/point-b/strategy/progress.ts — progress of the strategy tree from the LIVE statuses of the
 * client's tasks (action_items). Pure.
 *
 *   tasks       tasks that have a status (a task without a row — deleted by the client, or never
 *               written — is not counted)
 *   percent     done / tasks · 100, a whole number; null when there are no tasks («нет задач», not 0%)
 *   state       no_tasks · not_started (nothing done or in progress) · in_progress · done (all done)
 *
 * An initiative counts its own tasks, a strategy pools the tasks of all its initiatives. A TASK node
 * gets an entry too (tasks 0 or 1) so the page can show the status of every task from this one record.
 */
import type { StrategyNode } from './types'

export type TaskStatus = 'open' | 'in_progress' | 'done'

export type ProgressState = 'no_tasks' | 'not_started' | 'in_progress' | 'done'

export interface NodeProgress {
  key: string
  tasks: number
  done: number
  inProgress: number
  percent: number | null
  state: ProgressState
}

interface Counter { tasks: number; done: number; inProgress: number }

const isStatus = (v: unknown): v is TaskStatus => v === 'open' || v === 'in_progress' || v === 'done'

function finish(key: string, c: Counter): NodeProgress {
  const percent = c.tasks > 0 ? Math.round((c.done / c.tasks) * 100) : null
  const state: ProgressState =
    c.tasks === 0 ? 'no_tasks' : c.done === c.tasks ? 'done' : c.done === 0 && c.inProgress === 0 ? 'not_started' : 'in_progress'
  return { key, tasks: c.tasks, done: c.done, inProgress: c.inProgress, percent, state }
}

export function computeProgress(
  items: StrategyNode[], statusByTaskKey: Record<string, TaskStatus | undefined>,
): Record<string, NodeProgress> {
  const byKey = new Map(items.map((i) => [i.key, i]))
  const counters = new Map<string, Counter>(items.map((i) => [i.key, { tasks: 0, done: 0, inProgress: 0 }]))
  const add = (key: string | null | undefined, status: TaskStatus) => {
    const c = key ? counters.get(key) : undefined
    if (!c) return
    c.tasks++
    if (status === 'done') c.done++
    else if (status === 'in_progress') c.inProgress++
  }

  for (const task of items) {
    if (task.kind !== 'task') continue
    const status = Object.prototype.hasOwnProperty.call(statusByTaskKey, task.key) ? statusByTaskKey[task.key] : undefined
    if (!isStatus(status)) continue
    const initiative = task.parentKey ? byKey.get(task.parentKey) : undefined
    const strategy = initiative?.kind === 'initiative' && initiative.parentKey ? byKey.get(initiative.parentKey) : undefined
    add(task.key, status)
    if (initiative?.kind === 'initiative') add(initiative.key, status)
    if (strategy?.kind === 'strategy') add(strategy.key, status)
  }

  const out: Record<string, NodeProgress> = {}
  for (const [key, c] of counters) out[key] = finish(key, c)
  return out
}
