/**
 * Еженедельный дайджест клиенту (F-059): что попадает в текст и когда
 * дайджест не уходит вовсе.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/automation/data', () => ({}))
vi.mock('@/lib/notifications/store', () => ({}))
vi.mock('@/lib/settings/store', () => ({ getSetting: async () => true }))

const { planDigest } = await import('@/lib/automation/client-digest')

// Понедельник, 21.09.2026, 09:00 Алматы.
const NOW = new Date('2026-09-21T04:00:00Z')

const base = {
  userId: 'u1',
  now: NOW,
  gri: [],
  lastDigestGri: null,
  lastDigestAt: null,
  openTasks: [],
  newContent: [],
  daysSincePulse: null,
  nbaDone: new Set<string>(),
}

describe('planDigest', () => {
  it('нечего сказать → null (письмо не уходит)', () => {
    expect(planDigest(base)).toBeNull()
  })

  it('дельта GRI с прошлого дайджеста, задачи недели, материалы и NBA', () => {
    const plan = planDigest({
      ...base,
      gri: [{ griIndex: 6.4, createdAt: '2026-09-01T00:00:00Z', topLimit: { criterionText: 'Нет системы продаж', blockName: 'Продукт и спрос' } }],
      lastDigestGri: 5.9,
      lastDigestAt: '2026-09-14T04:00:00Z',
      openTasks: [
        { id: 't1', title: 'Нанять РОПа', dueDate: '2026-09-23', status: 'open', priority: 1 },
        { id: 't2', title: 'Скрипт звонка', dueDate: '2026-09-10', status: 'open', priority: 2 },
        { id: 't3', title: 'Далёкая задача', dueDate: '2026-11-01', status: 'open', priority: 3 },
      ],
      newContent: [{ slug: 'sales-101', title: 'Как выстроить отдел продаж', publishedAt: '2026-09-18T00:00:00Z' }],
    })!
    expect(plan.body).toContain('Индекс GRI: 6,4 из 10 (+0,5 с прошлого дайджеста)')
    expect(plan.body).toContain('Задачи плана на эту неделю: 2, из них просрочено 1')
    expect(plan.body).toContain('Нанять РОПа')
    expect(plan.body).not.toContain('Далёкая задача')
    expect(plan.body).toContain('Новый материал: 1')
    expect(plan.nba).not.toBeNull()
    expect(plan.body).toContain('Главный шаг недели')
    expect(plan.griIndex).toBe(6.4)
  })

  it('выполненный за неделю NBA не предлагается', () => {
    const input = {
      ...base,
      openTasks: [{ id: 't1', title: 'Нанять РОПа', dueDate: null, status: 'open', priority: 1 }],
    }
    const first = planDigest(input)!
    expect(first.nba).not.toBeNull()
    const again = planDigest({ ...input, nbaDone: new Set([first.nba!.actionKey]) })
    expect(again?.nba?.actionKey ?? null).not.toBe(first.nba!.actionKey)
  })
})
