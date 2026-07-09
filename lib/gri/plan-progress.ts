// lib/gri/plan-progress.ts — чистая логика интерактивного плана 90 дней
// (Фаза 5, идея №4): стабильные ключи шагов + процент выполнения.
//
// Ключ шага строится из ГОРИЗОНТА и индекса карточки внутри горизонта
// (`days_1_30-c0`), а не из сквозного индекса: добавление карточки в один
// горизонт не сдвигает ключи в других. Пока план не пересчитан (тот же
// assessment), ключи стабильны — этого достаточно для галочек в
// public.gri_plan_progress (UNIQUE user_id+assessment_id+step_key).
//
// Никакого I/O — модуль тривиально тестируется (tests/unit/gri/plan-progress-keys.test.ts).

import type { ActionCard, ActionPlan90d } from '@/lib/gri-calculator/top5-action-plan'

export const HORIZON_KEYS = ['days_1_30', 'days_31_60', 'days_61_90'] as const
export type HorizonKey = (typeof HORIZON_KEYS)[number]

export interface PlanStep {
  /** Стабильный ключ шага: `<horizon>-c<idx>`, напр. `days_1_30-c0`. */
  key: string
  horizon: HorizonKey
  card: ActionCard
}

/** Стабильный ключ шага плана: горизонт + индекс карточки внутри горизонта. */
export function buildStepKey(horizon: HorizonKey, cardIdx: number): string {
  return `${horizon}-c${cardIdx}`
}

// Формат ключа, который принимает API (PATCH /api/v1/gri/plan-progress).
const STEP_KEY_RE = /^days_(1_30|31_60|61_90)-c\d{1,4}$/

/** true, если строка — валидный ключ шага (защита API от мусора). */
export function isValidStepKey(v: unknown): v is string {
  return typeof v === 'string' && STEP_KEY_RE.test(v)
}

function isActionCard(v: unknown): v is ActionCard {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ActionCard).limitation === 'string' &&
    (v as ActionCard).limitation.trim().length > 0
  )
}

/**
 * Разворачивает action_plan_90d (unknown из БД) в плоский список шагов с
 * ключами. Толерантен к мусору: не-объект → [], битые карточки пропускаются,
 * но ИНДЕКС берётся из исходного массива, чтобы ключи соседних карточек
 * не сдвигались.
 */
export function flattenPlanSteps(plan: unknown): PlanStep[] {
  if (!plan || typeof plan !== 'object') return []
  const p = plan as Partial<ActionPlan90d>

  const steps: PlanStep[] = []
  for (const horizon of HORIZON_KEYS) {
    const cards = p[horizon]
    if (!Array.isArray(cards)) continue
    cards.forEach((card, idx) => {
      if (!isActionCard(card)) return
      steps.push({ key: buildStepKey(horizon, idx), horizon, card })
    })
  }
  return steps
}

/**
 * Процент выполнения: уникальные done-ключи / totalSteps, 0..100 (целое).
 * totalSteps <= 0 → 0; счётчик клэмпится сверху (устаревшие ключи от
 * старой версии плана не дают >100%).
 */
export function computePlanPct(doneKeys: Iterable<string>, totalSteps: number): number {
  if (!Number.isFinite(totalSteps) || totalSteps <= 0) return 0
  const unique = new Set<string>()
  for (const k of doneKeys) {
    if (typeof k === 'string' && k.length > 0) unique.add(k)
  }
  const done = Math.min(unique.size, totalSteps)
  return Math.round((done / totalSteps) * 100)
}

/**
 * Оставляет только ключи, существующие в текущем плане (защита от «хвостов»
 * прогресса после пересчёта плана тем же assessment_id).
 */
export function filterKnownKeys(doneKeys: Iterable<string>, steps: PlanStep[]): string[] {
  const known = new Set(steps.map((s) => s.key))
  const out: string[] = []
  for (const k of doneKeys) {
    if (known.has(k)) out.push(k)
  }
  return out
}
