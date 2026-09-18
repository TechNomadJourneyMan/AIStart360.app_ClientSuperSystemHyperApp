import { describe, expect, it } from 'vitest'

import {
  afterFactsConfirmed,
  runLocalTurn,
} from '@/components/journey/demo-machine'
import { createEmptyWorkspace } from '@/components/journey/model'

const BUSINESS_DESCRIPTION = 'У меня один магазин помидоров в Алматы'
const GOAL = 'Хочу открыть пять магазинов за 12 месяцев'

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase()
}

describe('journey deterministic demo flow', () => {
  it('keeps the journey partial when facts are confirmed but Point B is not measurable', () => {
    const initial = createEmptyWorkspace('journey-draft-goal-test')
    const described = runLocalTurn(initial, BUSINESS_DESCRIPTION)
    const draftGoal = {
      id: 'draft-goal',
      title: 'Хочу расти',
      status: 'draft' as const,
    }

    const confirmed = afterFactsConfirmed({
      ...described,
      goals: [draftGoal],
      facts: described.facts.map((fact) => ({ ...fact, status: 'confirmed' as const })),
    })

    expect(confirmed.phase).toBe('partial')
    expect(confirmed.messages.at(-1)?.text).toMatch(/показатель|значени|срок/i)
  })

  it('builds confirmed Point A, a five-store Point B and a domain roadmap without invented data', () => {
    const initial = createEmptyWorkspace('journey-demo-test')
    const described = runLocalTurn(initial, BUSINESS_DESCRIPTION)

    expect(described.provider).toEqual({ mode: 'demo', label: 'Демо-логика' })
    expect(described.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Описание бизнеса',
          value: BUSINESS_DESCRIPTION,
          sourceLabel: 'Сообщение пользователя',
          status: 'pending',
        }),
        expect.objectContaining({
          label: 'Формат бизнеса',
          value: 'Магазин помидоров',
          status: 'pending',
        }),
        expect.objectContaining({
          label: 'Количество точек',
          value: '1',
          status: 'pending',
        }),
      ]),
    )
    expect(described.facts.some((fact) => fact.category === 'finance')).toBe(false)
    expect(described.facts.some((fact) => fact.category === 'team')).toBe(false)

    const confirmed = afterFactsConfirmed({
      ...described,
      facts: described.facts.map((fact) => ({ ...fact, status: 'confirmed' as const })),
    })
    expect(confirmed.messages.at(-1)?.text).toMatch(/Точка A обновлена/i)

    const planned = runLocalTurn(confirmed, GOAL)

    expect(planned.phase).toBe('ready')
    expect(planned.goals).toEqual([
      expect.objectContaining({
        title: GOAL,
        metric: 'Количество магазинов',
        target: '5 магазинов',
        deadline: '12 месяцев',
        status: 'confirmed',
      }),
    ])
    expect(planned.roadmap.map((item) => item.title)).toEqual([
      'Проверить unit-экономику одной точки',
      'Отобрать локации и схему поставок',
      'Собрать чек-лист открытия магазина',
      'Спланировать команду и капитал',
    ])
    expect(planned.widgets.map((widget) => widget.kind)).toEqual(
      expect.arrayContaining([
        'business_passport',
        'domain_metrics',
        'domain_process',
        'point_b_goals',
        'roadmap_actions',
      ]),
    )

    const stateText = serialized(planned)
    expect(stateText).not.toMatch(/https?:\/\//)
    expect(stateText).not.toContain('javascript:')
    expect(stateText).not.toContain('выручка')
  })
})
