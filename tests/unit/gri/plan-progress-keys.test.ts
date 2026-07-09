/**
 * tests/unit/gri/plan-progress-keys.test.ts — стабильные ключи шагов и процент
 * выполнения интерактивного плана 90 дней (Фаза 5, идея №4).
 *
 * Инвариант: пока action_plan_90d не пересчитан, ключ шага не меняется
 * (`<horizon>-c<idx>`), а добавление карточки в один горизонт не сдвигает
 * ключи в других горизонтах.
 */

import { describe, it, expect } from 'vitest'
import type { ActionCard, ActionPlan90d } from '@/lib/gri-calculator/top5-action-plan'
import {
  buildStepKey,
  computePlanPct,
  filterKnownKeys,
  flattenPlanSteps,
  isValidStepKey,
} from '@/lib/gri/plan-progress'

function card(limitation: string, horizon: ActionCard['horizon']): ActionCard {
  return {
    priority: horizon === '1-30' ? 'Критично' : horizon === '31-60' ? 'Высокий' : 'Средний',
    limitation,
    focus: 'Фокус',
    horizon,
  }
}

const PLAN: ActionPlan90d = {
  days_1_30: [card('Нет учёта юнит-экономики', '1-30'), card('Провалы в кассе', '1-30')],
  days_31_60: [card('Нет системы найма', '31-60')],
  days_61_90: [card('Масштабирование блока «operations»', '61-90')],
}

describe('buildStepKey', () => {
  it('формат `<horizon>-c<idx>`', () => {
    expect(buildStepKey('days_1_30', 0)).toBe('days_1_30-c0')
    expect(buildStepKey('days_31_60', 2)).toBe('days_31_60-c2')
    expect(buildStepKey('days_61_90', 10)).toBe('days_61_90-c10')
  })

  it('стабилен при повторных вызовах (детерминированность)', () => {
    expect(buildStepKey('days_1_30', 1)).toBe(buildStepKey('days_1_30', 1))
  })
})

describe('isValidStepKey', () => {
  it('принимает ключи из buildStepKey', () => {
    expect(isValidStepKey('days_1_30-c0')).toBe(true)
    expect(isValidStepKey('days_31_60-c12')).toBe(true)
    expect(isValidStepKey('days_61_90-c3')).toBe(true)
  })

  it('отвергает мусор', () => {
    expect(isValidStepKey('')).toBe(false)
    expect(isValidStepKey('days_1_30-c')).toBe(false)
    expect(isValidStepKey('days_2_40-c0')).toBe(false)
    expect(isValidStepKey('days_1_30-c0; DROP TABLE')).toBe(false)
    expect(isValidStepKey(42)).toBe(false)
    expect(isValidStepKey(null)).toBe(false)
    expect(isValidStepKey(undefined)).toBe(false)
  })
})

describe('flattenPlanSteps', () => {
  it('разворачивает план в порядке горизонтов с ключами по индексу карточки', () => {
    const steps = flattenPlanSteps(PLAN)
    expect(steps.map((s) => s.key)).toEqual([
      'days_1_30-c0',
      'days_1_30-c1',
      'days_31_60-c0',
      'days_61_90-c0',
    ])
    expect(steps[0].card.limitation).toBe('Нет учёта юнит-экономики')
    expect(steps[2].horizon).toBe('days_31_60')
  })

  it('каждый ключ проходит isValidStepKey', () => {
    for (const s of flattenPlanSteps(PLAN)) {
      expect(isValidStepKey(s.key)).toBe(true)
    }
  })

  it('добавление карточки в один горизонт не сдвигает ключи других', () => {
    const before = flattenPlanSteps(PLAN)
    const grown: ActionPlan90d = {
      ...PLAN,
      days_31_60: [...PLAN.days_31_60, card('Новая карточка', '31-60')],
    }
    const after = flattenPlanSteps(grown)
    const keyOf = (steps: ReturnType<typeof flattenPlanSteps>, lim: string) =>
      steps.find((s) => s.card.limitation === lim)?.key
    expect(keyOf(after, 'Провалы в кассе')).toBe(keyOf(before, 'Провалы в кассе'))
    expect(keyOf(after, 'Масштабирование блока «operations»')).toBe(
      keyOf(before, 'Масштабирование блока «operations»'),
    )
  })

  it('мусор терпимо: не-объект → [], битые карточки пропускаются без сдвига индексов', () => {
    expect(flattenPlanSteps(null)).toEqual([])
    expect(flattenPlanSteps('nope')).toEqual([])
    expect(flattenPlanSteps(42)).toEqual([])
    expect(flattenPlanSteps({})).toEqual([])

    const dirty = {
      days_1_30: [card('Первая', '1-30'), { bogus: true }, card('Третья', '1-30')],
      days_31_60: 'not-an-array',
    }
    const steps = flattenPlanSteps(dirty)
    // Битая карточка (idx=1) пропущена, но «Третья» сохраняет свой исходный индекс 2.
    expect(steps.map((s) => s.key)).toEqual(['days_1_30-c0', 'days_1_30-c2'])
  })
})

describe('computePlanPct', () => {
  it('0 шагов → 0 (без деления на ноль)', () => {
    expect(computePlanPct([], 0)).toBe(0)
    expect(computePlanPct(['days_1_30-c0'], 0)).toBe(0)
    expect(computePlanPct([], -3)).toBe(0)
    expect(computePlanPct([], Number.NaN)).toBe(0)
  })

  it('считает и округляет процент', () => {
    expect(computePlanPct([], 4)).toBe(0)
    expect(computePlanPct(['days_1_30-c0'], 4)).toBe(25)
    expect(computePlanPct(['days_1_30-c0'], 3)).toBe(33) // 33.33 → 33
    expect(computePlanPct(['a', 'b'], 3)).toBe(67) // 66.67 → 67
    expect(computePlanPct(['a', 'b', 'c', 'd'], 4)).toBe(100)
  })

  it('дубликаты не считаются дважды, счётчик клэмпится сверху', () => {
    expect(computePlanPct(['x', 'x', 'x'], 4)).toBe(25)
    // Устаревших ключей больше, чем шагов в новом плане → не выше 100%.
    expect(computePlanPct(['a', 'b', 'c', 'd', 'e'], 2)).toBe(100)
  })
})

describe('filterKnownKeys', () => {
  it('отбрасывает ключи, которых нет в текущем плане', () => {
    const steps = flattenPlanSteps(PLAN)
    const kept = filterKnownKeys(
      ['days_1_30-c0', 'days_1_30-c99', 'stale-key', 'days_61_90-c0'],
      steps,
    )
    expect(kept).toEqual(['days_1_30-c0', 'days_61_90-c0'])
  })
})
