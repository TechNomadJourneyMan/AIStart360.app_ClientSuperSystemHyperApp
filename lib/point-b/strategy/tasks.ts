/**
 * lib/point-b/strategy/tasks.ts — the tasks of a published plan version in the client's action plan
 * (public.action_items, source = 'point_b'; migration 128 adds the link columns).
 *
 *   taskRowOf        a task node → the row to insert
 *   syncPlanTasks    on PUBLICATION of a version: every task of the tree is inserted when the client has
 *                    no row with its key, otherwise an OPEN row is updated (title, description, due
 *                    date, owner, priority…). Idempotent by (user_id, pb_task_key) — also when two
 *                    publications run at once (the unique index decides, the loser re-reads).
 *                    A row the client finished (done), dropped or replaced is NOT touched. A task that
 *                    is not in the new version stays as it is (known limitation: nothing is deleted).
 *   loadTaskStatuses the live statuses of the tasks by key, for the progress on the page
 *
 * Service-role client; the callers authorise the user first. Errors (a missing table or column — the
 * migration is not applied) are thrown: the caller of the publication catches them, the approval of the
 * version never depends on this module.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskStatus } from './progress'
import type { PlanStrategy, StrategyNode } from './types'

/** A row for public.action_items (the columns the plan sets; the rest take their defaults). */
export interface ActionItemInsert {
  user_id: string
  title: string
  description: string | null
  status: 'open'
  owner: string | null
  due_date: string | null
  expected_effect: string | null
  linked_block: string | null
  priority: number
  source: 'point_b'
  pb_task_key: string
  pb_version_id: string
}

export interface TaskRowContext {
  userId: string
  versionId: string
  /** The title of the parent initiative, shown in the description; null when there is none. */
  initiativeTitle: string | null
  /** The impact (1..5) of the parent initiative: the priority is 6 − impact (3 when it is not rated). */
  initiativeImpact?: number | null
}

const BATCH = 100
/** Statuses of action_items that the client's plan may hold: the ones the plan does not count. */
const NOT_COUNTED = new Set(['dropped', 'replaced'])
/** The client's own decisions: a row in one of these statuses is never rewritten by a publication. */
const FINISHED = new Set(['done', 'dropped', 'replaced'])

function dbError(op: string, error: { code?: string } | null | undefined): Error {
  return new Error(`point-b tasks: ${op} failed (${error?.code ?? 'unknown'})`)
}

function kpiText(kpi: StrategyNode['kpi']): string | null {
  if (!kpi) return null
  const target = kpi.target === null ? '' : ` → ${kpi.target}${kpi.unit ? ` ${kpi.unit}` : ''}`
  return `KPI: ${kpi.name}${target}`
}

export function taskRowOf(node: StrategyNode, ctx: TaskRowContext): ActionItemInsert {
  const description = [node.description, ctx.initiativeTitle ? `Инициатива: ${ctx.initiativeTitle}` : null].filter(Boolean).join('\n\n')
  const impact = ctx.initiativeImpact
  const priority = typeof impact === 'number' && Number.isInteger(impact) && impact >= 1 && impact <= 5 ? 6 - impact : 3
  return {
    user_id: ctx.userId,
    title: node.title,
    description: description || null,
    status: 'open',
    owner: node.ownerLabel,
    due_date: node.dueDate,
    expected_effect: kpiText(node.kpi),
    linked_block: node.block,
    priority,
    source: 'point_b',
    pb_task_key: node.key,
    pb_version_id: ctx.versionId,
  }
}

interface ExistingRow {
  id: string
  pb_task_key: string
  status: string | null
  title: string | null
  description: string | null
  owner: string | null
  due_date: string | null
  expected_effect: string | null
  linked_block: string | null
  priority: number | null
}

const COLUMNS = 'id, pb_task_key, status, title, description, owner, due_date, expected_effect, linked_block, priority'
/** The fields a publication keeps in step with the tree (pb_version_id follows only when one of them changes). */
const SYNCED = ['title', 'description', 'owner', 'due_date', 'expected_effect', 'linked_block', 'priority'] as const

async function readExisting(sb: SupabaseClient, userId: string, keys: string[]): Promise<Map<string, ExistingRow>> {
  const out = new Map<string, ExistingRow>()
  for (let i = 0; i < keys.length; i += BATCH) {
    const { data, error } = await sb.from('action_items').select(COLUMNS).eq('user_id', userId).in('pb_task_key', keys.slice(i, i + BATCH))
    if (error) throw dbError('read existing', error)
    for (const r of (data ?? []) as ExistingRow[]) out.set(r.pb_task_key, r)
  }
  return out
}

export async function syncPlanTasks(
  sb: SupabaseClient, input: { userId: string; versionId: string; strategy: PlanStrategy },
): Promise<{ created: number; updated: number; skipped: number }> {
  const out = { created: 0, updated: 0, skipped: 0 }
  const items = input.strategy.items
  const tasks = items.filter((n) => n.kind === 'task')
  if (!tasks.length) return out

  const byKey = new Map(items.map((n) => [n.key, n]))
  const rowOf = (task: StrategyNode): ActionItemInsert => {
    const parent = task.parentKey ? byKey.get(task.parentKey) : undefined
    const initiative = parent?.kind === 'initiative' ? parent : undefined
    return taskRowOf(task, { userId: input.userId, versionId: input.versionId, initiativeTitle: initiative?.title ?? null, initiativeImpact: initiative?.impact ?? null })
  }

  /** Brings an existing row in step with the tree: untouched when the client finished it or nothing changed. */
  const update = async (row: ActionItemInsert, existing: ExistingRow): Promise<void> => {
    if (FINISHED.has(String(existing.status))) { out.skipped++; return }
    const changed = SYNCED.some((f) => (existing[f] ?? null) !== row[f])
    if (!changed) { out.skipped++; return }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), pb_version_id: row.pb_version_id }
    for (const f of SYNCED) patch[f] = row[f]
    // Conditional on the row not having been finished a moment ago.
    const { data, error } = await sb.from('action_items').update(patch).eq('id', existing.id).eq('user_id', input.userId).neq('status', 'done').select('id')
    if (error) throw dbError('update', error)
    if (((data ?? []) as unknown[]).length) out.updated++
    else out.skipped++
  }

  const existing = await readExisting(sb, input.userId, tasks.map((t) => t.key))
  const fresh: ActionItemInsert[] = []
  for (const task of tasks) {
    const row = rowOf(task)
    const found = existing.get(task.key)
    if (found) await update(row, found)
    else fresh.push(row)
  }
  if (!fresh.length) return out

  const batch = await sb.from('action_items').insert(fresh)
  if (!batch.error) {
    out.created += fresh.length
    return out
  }
  if (batch.error.code !== '23505') throw dbError('insert', batch.error)

  // A concurrent publication won the unique index: nothing of the batch was written. Row by row — a row
  // that lost the race is updated like any existing one.
  for (const row of fresh) {
    const res = await sb.from('action_items').insert(row)
    if (!res.error) { out.created++; continue }
    if (res.error.code !== '23505') throw dbError('insert', res.error)
    const winner = (await readExisting(sb, input.userId, [row.pb_task_key])).get(row.pb_task_key)
    if (winner) await update(row, winner)
    else out.skipped++
  }
  return out
}

/** The status of an action_items row as the plan counts it; null = not counted (dropped, replaced, unknown). */
export function planStatusOf(status: unknown): TaskStatus | null {
  if (status === 'done') return 'done'
  if (status === 'in_progress') return 'in_progress'
  if (typeof status === 'string' && NOT_COUNTED.has(status)) return null
  // open, todo, snoozed — the task is still to be done.
  return status === 'open' || status === 'todo' || status === 'snoozed' ? 'open' : null
}

export async function loadTaskStatuses(sb: SupabaseClient, userId: string, keys: string[]): Promise<Record<string, TaskStatus>> {
  const out: Record<string, TaskStatus> = {}
  const unique = [...new Set(keys)]
  for (let i = 0; i < unique.length; i += BATCH) {
    const { data, error } = await sb.from('action_items').select('pb_task_key, status').eq('user_id', userId).in('pb_task_key', unique.slice(i, i + BATCH))
    if (error) throw dbError('read statuses', error)
    for (const r of (data ?? []) as Array<{ pb_task_key: string | null; status: string | null }>) {
      const status = planStatusOf(r.status)
      if (r.pb_task_key && status) out[r.pb_task_key] = status
    }
  }
  return out
}
