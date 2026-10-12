/**
 * lib/point-a/snapshot-diff.ts — inputs of a Point A snapshot and «что
 * изменилось и почему» between two snapshots (spec §2.5). Pure.
 */
import { createHash } from 'node:crypto'
import { getMetricById } from '@/lib/metrics/registry'
import { stepForQuestionKey } from '@/lib/survey/steps'
import type { V4Block } from './v4/engine'

export interface SnapshotMetricInput {
  value: number
  source: string | null
  /** '2025' / '2026-09' … of the picked value, when known. */
  period: string | null
}

export interface SnapshotInputs {
  /** Metric id → value the calculation used. */
  metrics: Record<string, SnapshotMetricInput>
  /** Survey key → short hash of the answer. */
  answers: Record<string, string>
  /** Metric ids with an open data discrepancy. */
  conflicts: string[]
  config: string
}

export type ChangeReason =
  | { type: 'block'; block: string; title: string; from: number | null; to: number | null; text: string }
  | { type: 'metric'; metric: string; label: string; from: number | null; to: number | null; source: string | null; period: string | null; text: string }
  | { type: 'answers'; step: number | null; count: number; text: string }
  | { type: 'conflicts'; opened: number; closed: number; text: string }
  | { type: 'config'; from: string; to: string; text: string }
  | { type: 'first'; text: string }

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
}

export function hashOf(v: unknown, len = 64): string {
  return createHash('sha256').update(stable(v)).digest('hex').slice(0, len)
}

export function inputsHash(i: SnapshotInputs): string {
  return hashOf(i)
}

function fmt(n: number | null): string {
  if (n === null) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10} млн`
  if (a >= 1_000) return `${Math.round(n / 100) / 10} тыс.`
  return String(Math.round(n * 100) / 100)
}

const SOURCE_RU: Record<string, string> = { survey: 'анкета', document: 'документ', manual: 'вручную', calculated: 'расчёт', external: 'интеграция' }

export function changeReasons(
  prev: { blocks: V4Block[]; inputs: SnapshotInputs } | null,
  next: { blocks: V4Block[]; inputs: SnapshotInputs },
): ChangeReason[] {
  if (!prev) return [{ type: 'first', text: 'Первый расчёт Точки А' }]
  const out: ChangeReason[] = []

  const before = new Map(prev.blocks.map((b) => [b.key, b]))
  for (const b of next.blocks) {
    const p = before.get(b.key)
    const from = p?.score ?? null
    const to = b.score
    if (from === to) continue
    if (from !== null && to !== null && Math.abs(to - from) < 1) continue
    const text = from === null ? `${b.title}: появился балл ${to}` : to === null ? `${b.title}: не хватает данных для балла` : `${b.title}: ${to > from ? '+' : ''}${to - from} (${from} → ${to})`
    out.push({ type: 'block', block: b.key, title: b.title, from, to, text })
  }

  const ids = new Set([...Object.keys(prev.inputs.metrics), ...Object.keys(next.inputs.metrics)])
  for (const id of ids) {
    const a = prev.inputs.metrics[id]
    const b = next.inputs.metrics[id]
    if (a && b && a.value === b.value && a.period === b.period) continue
    const label = getMetricById(id)?.label ?? id
    const src = b?.source ? SOURCE_RU[b.source] ?? b.source : null
    out.push({
      type: 'metric', metric: id, label, from: a?.value ?? null, to: b?.value ?? null, source: b?.source ?? null, period: b?.period ?? null,
      text: `${label}: ${fmt(a?.value ?? null)} → ${fmt(b?.value ?? null)}${b?.period ? ` · ${b.period}` : ''}${src ? ` · ${src}` : ''}`,
    })
  }

  const steps = new Map<number | null, number>()
  const keys = new Set([...Object.keys(prev.inputs.answers), ...Object.keys(next.inputs.answers)])
  for (const k of keys) {
    if (prev.inputs.answers[k] === next.inputs.answers[k]) continue
    const s = stepForQuestionKey(k)
    steps.set(s, (steps.get(s) ?? 0) + 1)
  }
  for (const [step, count] of steps) {
    out.push({ type: 'answers', step, count, text: `Анкета${step ? `, шаг ${step}` : ''}: изменено ответов — ${count}` })
  }

  const pc = new Set(prev.inputs.conflicts)
  const nc = new Set(next.inputs.conflicts)
  const opened = [...nc].filter((x) => !pc.has(x)).length
  const closed = [...pc].filter((x) => !nc.has(x)).length
  if (opened || closed) {
    out.push({ type: 'conflicts', opened, closed, text: [opened ? `найдено расхождений: ${opened}` : null, closed ? `закрыто расхождений: ${closed}` : null].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) })
  }

  if (prev.inputs.config !== next.inputs.config) {
    out.push({ type: 'config', from: prev.inputs.config, to: next.inputs.config, text: 'Изменена настройка блоков' })
  }
  return out
}
