/**
 * W2 (PO 2026-10-22, п. 2): one menu for the whole client cabinet — which
 * items a user gets, which one is highlighted, where the bar is drawn.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLIENT_NAV_DEFS,
  EXPERT_BLOCKED_HREFS,
  activeClientNavKey,
  buildClientNav,
  clientShellMode,
} from '@/lib/client-shell/nav'

const keys = (items: { key: string }[]) => items.map((i) => i.key)

describe('buildClientNav', () => {
  it('an approved client gets every section, in order, on the existing routes', () => {
    const items = buildClientNav({ approved: true, hiddenPaths: [] })
    expect(keys(items)).toEqual(['home', 'dashboard', 'point_a', 'point_b', 'survey', 'gri', 'messages', 'documents'])
    expect(items.map((i) => i.label)).toEqual(['Главная', 'Дашборд', 'Точка А', 'Точка Б', 'Анкета', 'GRI', 'Сообщения', 'Документы'])
    expect(items.find((i) => i.key === 'point_a')?.href).toBe('/client/point-a')
    expect(items.find((i) => i.key === 'point_b')?.href).toBe('/client/point-b')
  })

  it('every href is a real page of the app', () => {
    const pageFor: Record<string, string> = {
      '/client/home': 'app/client/home/page.tsx',
      '/dashboard': 'app/(dashboard)/dashboard/page.tsx',
      '/client/point-a': 'app/client/point-a/page.tsx',
      '/client/point-b': 'app/client/point-b/page.tsx',
      '/client/onboarding': 'app/client/onboarding/page.tsx',
      '/gri': 'app/(dashboard)/gri/page.tsx',
      '/client/messages': 'app/client/messages/page.tsx',
      '/client/onboarding/documents': 'app/client/onboarding/documents/page.tsx',
    }
    for (const d of CLIENT_NAV_DEFS) {
      expect(pageFor[d.href], d.href).toBeDefined()
      expect(() => readFileSync(resolve(process.cwd(), pageFor[d.href]))).not.toThrow()
    }
  })

  it('before approval only the sections the cabinet treats as open', () => {
    expect(keys(buildClientNav({ approved: false, hiddenPaths: [] }))).toEqual(['home', 'survey', 'gri', 'messages', 'documents'])
  })

  it('drops sections switched off in GIGA-CRM (hiddenPaths of platform_sections)', () => {
    const items = buildClientNav({ approved: true, hiddenPaths: ['/point-b', '/client/point-b', '/gri', '/client/onboarding/documents'] })
    expect(keys(items)).toEqual(['home', 'dashboard', 'point_a', 'survey', 'messages'])
  })

  it('an expert account does not get links middleware would bounce to /expert', () => {
    const items = buildClientNav({ approved: true, hiddenPaths: [], profileRole: 'expert' })
    for (const href of EXPERT_BLOCKED_HREFS) expect(items.map((i) => i.href)).not.toContain(href)
    expect(keys(items)).toContain('point_a')
  })

  it('the expert-blocked list matches middleware ADMIN_PATHS', () => {
    const src = readFileSync(resolve(process.cwd(), 'middleware.ts'), 'utf8')
    const block = src.slice(src.indexOf('const ADMIN_PATHS'), src.indexOf(']', src.indexOf('const ADMIN_PATHS')))
    for (const href of EXPERT_BLOCKED_HREFS) expect(block).toContain(`'${href}'`)
  })

  it('puts the unread counter on «Сообщения» only', () => {
    const items = buildClientNav({ approved: true, hiddenPaths: [], unreadMessages: 3 })
    expect(items.find((i) => i.key === 'messages')?.badge).toBe(3)
    expect(items.filter((i) => i.badge !== undefined)).toHaveLength(1)
    expect(buildClientNav({ approved: true, hiddenPaths: [], unreadMessages: 0 }).some((i) => i.badge)).toBe(false)
    expect(buildClientNav({ approved: true, hiddenPaths: [], unreadMessages: Number.NaN }).some((i) => i.badge)).toBe(false)
  })
})

describe('activeClientNavKey', () => {
  const items = buildClientNav({ approved: true, hiddenPaths: [] })

  it.each([
    ['/client/home', 'home'],
    ['/client/point-a', 'point_a'],
    ['/client/point-b', 'point_b'],
    ['/client/onboarding', 'survey'],
    ['/client/onboarding-medical', 'survey'],
    ['/client/onboarding/documents', 'documents'],
    ['/client/messages', 'messages'],
    ['/client/content', null],
    ['/client/home?unavailable=gri', 'home'],
  ])('%s → %s', (path, key) => {
    expect(activeClientNavKey(path, items)).toBe(key)
  })

  it('does not match a route by prefix only (/client/point-ab is not Точка А)', () => {
    expect(activeClientNavKey('/client/point-ab', items)).toBeNull()
  })
})

describe('clientShellMode', () => {
  it.each([
    ['/client/home', 'sticky'],
    ['/client/point-a', 'sticky'],
    ['/client/point-b', 'sticky'],
    ['/client/onboarding/documents', 'sticky'],
    // The wizard keeps its own sticky progress header and step tabs.
    ['/client/onboarding', 'static'],
    // Gate and full-screen flows keep their own chrome.
    ['/client/waiting-room', 'none'],
    ['/client/welcome', 'none'],
    ['/client/journey', 'none'],
  ])('%s → %s', (path, mode) => {
    expect(clientShellMode(path)).toBe(mode)
  })
})
