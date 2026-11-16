/**
 * W2 (PO 2026-10-22, п. 2): one menu for the whole client cabinet — which
 * items a user gets, which one is highlighted, where the bar is drawn.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLIENT_MORE_DEFS,
  CLIENT_NAV_DEFS,
  EXPERT_BLOCKED_HREFS,
  NOTIFICATIONS_HREF,
  activeClientMoreKey,
  activeClientNavKey,
  buildClientMoreNav,
  buildClientNav,
  clientNotificationsLink,
  clientShellMode,
  hrefWithQuery,
  usesClientShell,
} from '@/lib/client-shell/nav'

const keys = (items: { key: string }[]) => items.map((i) => i.key)

describe('buildClientNav', () => {
  it('an approved client gets every section, in order, on the existing routes', () => {
    const items = buildClientNav({ approved: true, hiddenPaths: [] })
    expect(keys(items)).toEqual(['home', 'dashboard', 'point_a', 'point_b', 'survey', 'gri', 'market', 'messages', 'documents'])
    expect(items.map((i) => i.label)).toEqual(['Главная', 'Дашборд', 'Точка А', 'Точка Б', 'Анкета', 'GRI', 'Рынок', 'Сообщения', 'Документы'])
    expect(items.find((i) => i.key === 'market')?.href).toBe('/market')
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
      '/market': 'app/(dashboard)/market/page.tsx',
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
    expect(keys(items)).toEqual(['home', 'dashboard', 'point_a', 'survey', 'market', 'messages'])
    // the platform section «market» (migration 074, path /market) switched off → no item
    expect(keys(buildClientNav({ approved: true, hiddenPaths: ['/market'] }))).not.toContain('market')
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

describe('R-096: the bell of the cabinet bar (clientNotificationsLink)', () => {
  it('leads to the notification feed — a real page — with the unread count', () => {
    expect(clientNotificationsLink({ hiddenPaths: [], unread: 3 })).toEqual({ href: '/notifications', unread: 3 })
    expect(() => readFileSync(resolve(process.cwd(), 'app/(dashboard)/notifications/page.tsx'))).not.toThrow()
    expect(clientNotificationsLink({ hiddenPaths: [], unread: Number.NaN })?.unread).toBe(0)
    expect(clientNotificationsLink({ hiddenPaths: [], unread: -2 })?.unread).toBe(0)
  })

  it('is open before approval (middleware OPEN_BEFORE_APPROVAL lists the feed)', () => {
    const src = readFileSync(resolve(process.cwd(), 'middleware.ts'), 'utf8')
    const start = src.indexOf('const OPEN_BEFORE_APPROVAL')
    const block = src.slice(start, src.indexOf('\n]', start))
    expect(block).toContain(`'${NOTIFICATIONS_HREF}'`)
  })

  it('no bell for an expert profile (middleware sends it away from /notifications) or a feed hidden in GIGA-CRM', () => {
    for (const role of ['expert', 'manager', 'analyst']) expect(clientNotificationsLink({ profileRole: role, hiddenPaths: [] }), role).toBeNull()
    expect(EXPERT_BLOCKED_HREFS).toContain(NOTIFICATIONS_HREF)
    expect(clientNotificationsLink({ hiddenPaths: ['/notifications'] })).toBeNull()
    expect(clientNotificationsLink({ profileRole: 'client', hiddenPaths: [] })).not.toBeNull()
  })
})

describe('R-028: who gets the cabinet bar in the old (dashboard) shell (usesClientShell)', () => {
  it('a client (and a legacy owner) that is not staff', () => {
    expect(usesClientShell({ role: 'client', is_staff: false })).toBe(true)
    expect(usesClientShell({ role: 'owner', is_staff: false })).toBe(true)
  })

  it('staff, experts, admins and unknown facts keep the old shell', () => {
    expect(usesClientShell({ role: 'client', is_staff: true })).toBe(false) // role only in staff_roles
    for (const role of ['super_admin', 'admin', 'expert', 'manager']) expect(usesClientShell({ role, is_staff: role === 'admin' || role === 'super_admin' }), role).toBe(false)
    expect(usesClientShell(null)).toBe(false)
    expect(usesClientShell(undefined)).toBe(false)
  })
})

describe('hrefWithQuery (R-094: /point-a → /client/point-a keeps the query)', () => {
  it('keeps every parameter, repeated ones too', () => {
    expect(hrefWithQuery('/client/point-a')).toBe('/client/point-a')
    expect(hrefWithQuery('/client/point-a', {})).toBe('/client/point-a')
    expect(hrefWithQuery('/client/point-a', { tab: 'risks', a: ['1', '2'], skip: undefined })).toBe('/client/point-a?tab=risks&a=1&a=2')
    expect(hrefWithQuery('/client/point-a', { q: 'a b&c' })).toBe('/client/point-a?q=a+b%26c')
  })
})

describe('WA-1: «Ещё» — the sections of the old menus the cabinet bar had no item for', () => {
  const keys = (items: { key: string }[]) => items.map((i) => i.key)

  it('an approved client: Клиенты (CRM), Симулятор, Метрики, Психопрофиль — real pages', () => {
    const items = buildClientMoreNav({ approved: true, hiddenPaths: [] })
    expect(items.map((i) => i.href)).toEqual(['/pulse', '/simulator', '/metrics', '/profile/psych'])
    const pageFor: Record<string, string> = {
      '/pulse': 'app/(dashboard)/pulse/page.tsx',
      '/simulator': 'app/(dashboard)/simulator/page.tsx',
      '/metrics': 'app/(dashboard)/metrics/page.tsx',
      '/profile/psych': 'app/(dashboard)/profile/psych/page.tsx',
    }
    for (const d of CLIENT_MORE_DEFS) expect(() => readFileSync(resolve(process.cwd(), pageFor[d.href])), d.href).not.toThrow()
  })

  it('nothing hidden by platform_sections is shown (on prod simulator / metrics / pulse are staff_only → only Психопрофиль)', () => {
    expect(keys(buildClientMoreNav({ approved: true, hiddenPaths: ['/simulator', '/metrics', '/pulse'] }))).toEqual(['psych'])
    expect(buildClientMoreNav({ approved: true, hiddenPaths: ['/simulator', '/metrics', '/pulse', '/profile'] })).toEqual([])
  })

  it('every old-menu section a client could open is either in the bar or under «Ещё»', () => {
    const bar = [...CLIENT_NAV_DEFS.map((d) => d.href), ...CLIENT_MORE_DEFS.map((d) => d.href), NOTIFICATIONS_HREF]
    // lib/navigation.ts: what a client sees in the old sidebar (Точка А / Б there are /point-a, /point-b → the cabinet pages)
    for (const href of ['/dashboard', '/gri', '/pulse', '/simulator', '/metrics', '/market', '/notifications', '/profile/psych', '/client/home', '/client/messages']) {
      expect(bar, href).toContain(href)
    }
  })

  it('none of them is a paid section — the access decision puts no lock on them', async () => {
    const { PAID_SECTIONS } = await import('@/lib/access/entitlements')
    for (const d of CLIENT_MORE_DEFS) expect((PAID_SECTIONS as readonly string[]).includes(d.key), d.key).toBe(false)
    expect(buildClientMoreNav({ approved: true, hiddenPaths: [] }).some((i) => 'locked' in i)).toBe(false)
  })

  it('before approval «Ещё» is empty; an expert profile gets only what middleware lets it open', () => {
    expect(buildClientMoreNav({ approved: false, hiddenPaths: [] })).toEqual([])
    expect(keys(buildClientMoreNav({ approved: true, hiddenPaths: [], profileRole: 'expert' }))).toEqual(['pulse'])
  })

  it('the expert-blocked list (now with /simulator, /metrics, /profile) still matches middleware ADMIN_PATHS', () => {
    const src = readFileSync(resolve(process.cwd(), 'middleware.ts'), 'utf8')
    const start = src.indexOf('const ADMIN_PATHS')
    const block = src.slice(start, src.indexOf('\n]', start))
    for (const href of EXPERT_BLOCKED_HREFS) expect(block, href).toContain(`'${href}'`)
  })

  it('activeClientMoreKey marks the page of an item (and its subpages)', () => {
    const items = buildClientMoreNav({ approved: true, hiddenPaths: [] })
    expect(activeClientMoreKey('/simulator', items)).toBe('simulator')
    expect(activeClientMoreKey('/profile/psych?x=1', items)).toBe('psych')
    expect(activeClientMoreKey('/profile', items)).toBeNull()
    expect(activeClientMoreKey('/dashboard', items)).toBeNull()
  })
})
