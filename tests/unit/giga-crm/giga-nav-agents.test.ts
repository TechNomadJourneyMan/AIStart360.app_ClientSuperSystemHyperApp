/**
 * GIGA-CRM menu: the «ИИ и автоматизация» group sits between «Коммуникации»
 * and «Платформа», every item is gated by a permission the role really has,
 * nested agent sections highlight / title the most specific item, and every
 * icon key exists in the sidebar.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GIGA_BASE, GIGA_NAV, SUPER_EXPERT_NAV, activeNavHref, gigaSectionTitle, visibleNav } from '@/lib/admin/nav'
import { PERMISSIONS, STAFF_ROLES, hasPermission, type StaffRole } from '@/lib/admin/rbac'

const AI_GROUP = 'ИИ и автоматизация'
const group = (label: string) => GIGA_NAV.find((g) => g.label === label)
const labelsFor = (role: StaffRole) => visibleNav(GIGA_NAV, (p) => hasPermission(role, p))

describe('группа «ИИ и автоматизация»', () => {
  it('стоит между «Коммуникации» и «Платформа»', () => {
    const order = GIGA_NAV.map((g) => g.label)
    const i = order.indexOf(AI_GROUP)
    expect(i).toBeGreaterThan(0)
    expect(order[i - 1]).toBe('Коммуникации')
    expect(order[i + 1]).toBe('Платформа')
  })

  it('содержит разделы агентов, отчёты, проверку выводов ИИ и «Модерацию ИИ» (маршрут и право прежние)', () => {
    const items = group(AI_GROUP)!.items
    expect(items.map((i) => [i.label, i.href.replace(GIGA_BASE, ''), i.permission])).toEqual([
      ['ИИ-агенты', '/agents', 'agents.view'],
      ['Задачи агентов', '/agents/tasks', 'agents.view'],
      ['Одобрения', '/agents/approvals', 'agents.view'],
      ['Стоимость ИИ', '/agents/costs', 'agents.view'],
      ['События платформы', '/agents/events', 'agents.view'],
      ['Отчёты', '/reports', 'agents.view'],
      ['Проверка выводов ИИ', '/ai-review', 'insights.moderate'],
      ['Модерация ИИ', '/moderation', 'insights.moderate'],
    ])
    expect(group('Коммуникации')!.items.some((i) => i.href.endsWith('/moderation'))).toBe(false)
  })

  it('счётчик ожидающих одобрений — только у «Одобрений»', () => {
    const withBadge = GIGA_NAV.flatMap((g) => g.items).filter((i) => i.badge)
    expect(withBadge.map((i) => [i.label, i.badge])).toEqual([['Одобрения', 'pendingApprovals']])
  })

  it('«Уведомления» доступны каждому сотруднику панели', () => {
    const n = GIGA_NAV.flatMap((g) => g.items).find((i) => i.href === `${GIGA_BASE}/notifications`)
    expect(n?.permission).toBe('dashboard.view')
    for (const r of STAFF_ROLES) expect(hasPermission(r, 'dashboard.view'), r).toBe(true)
  })
})

describe('видимость меню по правам', () => {
  it('каждый пункт закрыт существующим правом, ссылки уникальны', () => {
    const items = GIGA_NAV.flatMap((g) => g.items)
    for (const i of items) expect(Object.keys(PERMISSIONS), i.label).toContain(i.permission)
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length)
  })

  it('super_admin видит всю группу', () => {
    expect(labelsFor('super_admin').find((g) => g.label === AI_GROUP)!.items).toHaveLength(8)
  })

  it('аналитик видит агентов и отчёты, но не модерацию и не проверку выводов ИИ', () => {
    const items = labelsFor('analyst').find((g) => g.label === AI_GROUP)!.items.map((i) => i.label)
    expect(items).toContain('ИИ-агенты')
    expect(items).toContain('Одобрения')
    expect(items).toContain('Отчёты')
    expect(items).not.toContain('Модерация ИИ')
    expect(items).not.toContain('Проверка выводов ИИ')
  })

  it('контент-менеджер видит только проверку выводов ИИ и модерацию (право insights.moderate)', () => {
    expect(labelsFor('content_manager').find((g) => g.label === AI_GROUP)!.items.map((i) => i.label)).toEqual(['Проверка выводов ИИ', 'Модерация ИИ'])
  })

  it('роль без agents.view и insights.moderate не видит группу вовсе', () => {
    for (const r of STAFF_ROLES) {
      if (hasPermission(r, 'agents.view') || hasPermission(r, 'insights.moderate')) continue
      expect(labelsFor(r).some((g) => g.label === AI_GROUP), r).toBe(false)
    }
  })

  it('пустые группы не показываются', () => {
    for (const r of STAFF_ROLES) for (const g of labelsFor(r)) expect(g.items.length, `${r}: ${g.label}`).toBeGreaterThan(0)
  })
})

describe('вложенные разделы', () => {
  it('подсвечивается самый точный пункт', () => {
    expect(activeNavHref(GIGA_NAV, `${GIGA_BASE}/agents/tasks/0b7c5a2e`)).toBe(`${GIGA_BASE}/agents/tasks`)
    expect(activeNavHref(GIGA_NAV, `${GIGA_BASE}/agents/monitoring`)).toBe(`${GIGA_BASE}/agents`)
    expect(activeNavHref(GIGA_NAV, `${GIGA_BASE}/agents`)).toBe(`${GIGA_BASE}/agents`)
    expect(activeNavHref(GIGA_NAV, GIGA_BASE)).toBe(GIGA_BASE)
    expect(activeNavHref(GIGA_NAV, '/elsewhere')).toBeNull()
  })

  it('хлебные крошки берут самый точный раздел', () => {
    expect(gigaSectionTitle(`${GIGA_BASE}/agents/tasks/0b7c5a2e`)).toBe('Задачи агентов')
    expect(gigaSectionTitle(`${GIGA_BASE}/agents/approvals`)).toBe('Одобрения')
    expect(gigaSectionTitle(`${GIGA_BASE}/agents/monitoring`)).toBe('ИИ-агенты')
    expect(gigaSectionTitle(`${GIGA_BASE}/notifications`)).toBe('Уведомления')
    expect(gigaSectionTitle(`${GIGA_BASE}/moderation`)).toBe('Модерация ИИ')
    expect(gigaSectionTitle(`${GIGA_BASE}/reports`)).toBe('Отчёты')
    expect(gigaSectionTitle(`${GIGA_BASE}/ai-review`)).toBe('Проверка выводов ИИ')
  })
})

describe('иконки', () => {
  it('каждый ключ иконки из меню есть в боковой панели', () => {
    const src = readFileSync(resolve(process.cwd(), 'components/giga-panel/GigaSidebar.tsx'), 'utf8')
    const block = src.slice(src.indexOf('const ICONS'), src.indexOf('}', src.indexOf('const ICONS')))
    const keys = new Set(Array.from(block.matchAll(/(\w+):\s*[A-Z]\w*/g)).map((m) => m[1]))
    for (const i of [...GIGA_NAV, ...SUPER_EXPERT_NAV].flatMap((g) => g.items)) expect(keys, `${i.label}: ${i.icon}`).toContain(i.icon)
  })

  it('палитра команд строится из того же меню (новые разделы находятся поиском)', () => {
    const src = readFileSync(resolve(process.cwd(), 'components/giga-panel/CommandPalette.tsx'), 'utf8')
    expect(src).toContain('workspaceNav.flatMap')
    expect(src).toContain('can(i.permission)')
  })
})
