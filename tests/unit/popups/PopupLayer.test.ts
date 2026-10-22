/**
 * The cabinet pop-up layer. The repo has neither jsdom nor @testing-library,
 * so the behaviour lives in a framework-free controller
 * (components/popups/popupController.ts) that is tested here with fake timers,
 * a fetch double and a Realtime double; the markup (card / modal) is checked
 * with react-dom/server. What needs a real browser — focus movement, Esc,
 * Realtime over the wire — is covered by the pure helpers below and by the
 * manual pass listed in the task report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PopupController, isTextEntry, nextTrapIndex, type PopupControllerDeps } from '@/components/popups/popupController'
import type { PopupCandidate } from '@/lib/popups/types'

vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode } & Record<string, unknown>) => React.createElement('a', { href: p.href, className: p.className as string }, p.children) }))

const state = vi.hoisted(() => ({ hook: null as unknown }))
vi.mock('@/components/popups/usePopups', () => ({ usePopups: () => state.hook }))

import { PopupCard } from '@/components/popups/PopupCard'
import { PopupModal } from '@/components/popups/PopupModal'
import { PopupLayer } from '@/components/popups/PopupLayer'

const cand = (over: Partial<PopupCandidate> & { id: string }): PopupCandidate => ({
  kind: 'expert_message', display: 'card', priority: 10, title: 'Сообщение от эксперта', body: 'Посмотрите, пожалуйста, цели на квартал', authorName: 'Анна Ким',
  authorSpecialty: null, createdAt: '2026-10-18T09:00:00.000Z', href: '/client/messages', important: false, canReply: true, ...over,
})

type Call = { url: string; method: string; body: unknown }

function setup(opts: { list?: PopupCandidate[]; threadId?: string | null; typing?: boolean; status?: number; throws?: boolean } = {}) {
  const calls: Call[] = []
  const rt = { handlers: [] as Array<(row: Record<string, unknown>) => void>, subscribed: [] as string[], unsubscribed: 0 }
  const flags = { typing: opts.typing ?? false, visible: true }
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (opts.throws && method === 'GET') throw new Error('offline')
    if (method === 'GET') {
      const status = opts.status ?? 200
      return { ok: status < 400, status, json: async () => (status < 400 ? { ok: true, data: { threadId: opts.threadId === undefined ? 't-1' : opts.threadId, popups: opts.list ?? [] } } : { ok: false }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  })
  const deps: PopupControllerDeps = {
    fetchFn: fetchFn as unknown as typeof fetch,
    isTyping: () => flags.typing,
    isVisible: () => flags.visible,
    subscribe: (threadId, onRow) => {
      rt.subscribed.push(threadId)
      rt.handlers.push(onRow)
      return () => { rt.unsubscribed += 1 }
    },
  }
  const ctrl = new PopupController(deps)
  return { ctrl, calls, rt, flags, fetchFn, writes: () => calls.filter((c) => c.method !== 'GET'),
    /** User actions only (the automatic «seen» marks excluded). */
    acts: () => calls.filter((c) => c.method !== 'GET' && (c.body as { action?: string } | undefined)?.action !== 'seen') }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z')) })
afterEach(() => { vi.useRealTimers() })

describe('PopupController', () => {
  it('shows one card at a time with the author name and a preview', async () => {
    const t = setup({ list: [cand({ id: 'a' }), cand({ id: 'b', body: 'Второе сообщение' })] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    const snap = t.ctrl.getSnapshot()
    expect(snap.popups.map((p) => p.id)).toEqual(['a', 'b'])
    expect(snap.current?.id).toBe('a')

    const html = renderToStaticMarkup(React.createElement(PopupCard, { popup: snap.current!, onDismiss: () => {}, onSnooze: () => {}, onReply: async () => {} }))
    expect(html).toContain('Анна Ким')
    expect(html).toContain('Посмотрите, пожалуйста, цели на квартал')
    expect(html).not.toContain('Второе сообщение')
    t.ctrl.stop()
  })

  it('marks the window as seen once it is actually shown', async () => {
    const t = setup({ list: [cand({ id: 'a' })] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    expect(t.writes()).toEqual([])
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.writes()).toEqual([{ url: '/api/v1/popups/a', method: 'PATCH', body: { action: 'seen' } }])
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.writes()).toHaveLength(1)
    t.ctrl.stop()
  })

  it('a new message via Realtime appears without a reload', async () => {
    const t = setup({ list: [] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.ctrl.getSnapshot().current).toBeNull()
    expect(t.rt.subscribed).toEqual(['t-1'])
    const before = t.fetchFn.mock.calls.length

    t.rt.handlers[0]({ id: 'rt-1', author_kind: 'staff', direction: 'out', channel: 'app', author_name: 'Анна', subject: null, body: 'Новое сообщение', flags: {}, created_at: '2026-10-18T10:00:06.000Z' })
    expect(t.ctrl.getSnapshot().current).toMatchObject({ id: 'rt-1', display: 'card', authorName: 'Анна' })
    // …no extra GET: the payload is enough
    expect(t.fetchFn.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === 'GET')).toHaveLength(before)

    // bot / system / foreign-channel rows never become windows
    for (const row of [{ author_kind: 'bot' }, { author_kind: 'system' }, { channel: 'email' }, { direction: 'in', author_kind: 'user' }]) {
      t.rt.handlers[0]({ id: `x-${JSON.stringify(row)}`, author_kind: 'staff', direction: 'out', channel: 'app', body: 'нет', flags: { important: true }, created_at: '2026-10-18T10:00:07.000Z', ...row })
    }
    expect(t.ctrl.getSnapshot().popups.map((p) => p.id)).toEqual(['rt-1'])
    t.ctrl.stop()
    expect(t.rt.unsubscribed).toBe(1)
  })

  it('an important staff message arriving via Realtime opens as a modal and replaces a card on screen', async () => {
    const t = setup({ list: [cand({ id: 'card' })] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.ctrl.getSnapshot().current?.id).toBe('card')
    t.rt.handlers[0]({ id: 'imp', author_kind: 'staff', direction: 'out', channel: 'app', author_name: 'Анна', body: 'Срочно ответьте', flags: { important: true }, created_at: '2026-10-18T10:00:08.000Z' })
    expect(t.ctrl.getSnapshot().current).toMatchObject({ id: 'imp', display: 'modal', important: true })
    t.ctrl.stop()
  })

  it('does not open anything during the first 5 seconds after load', async () => {
    const t = setup({ list: [cand({ id: 'a' })] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(4900)
    expect(t.ctrl.getSnapshot().popups).toHaveLength(1)
    expect(t.ctrl.getSnapshot().current).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(t.ctrl.getSnapshot().current?.id).toBe('a')
    t.ctrl.stop()
  })

  it('defers the window while a text field is focused and shows it after blur', async () => {
    const t = setup({ list: [cand({ id: 'a' })], typing: true })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(6000)
    expect(t.ctrl.getSnapshot().current).toBeNull()
    expect(t.ctrl.getSnapshot().popups.map((p) => p.id)).toEqual(['a']) // not lost
    expect(t.writes()).toEqual([]) // not marked as seen while hidden

    t.flags.typing = false
    t.ctrl.refresh()
    expect(t.ctrl.getSnapshot().current?.id).toBe('a')
    t.ctrl.stop()
  })

  it('does not render on /client/messages and /client/onboarding', async () => {
    const t = setup({ list: [cand({ id: 'a' })] })
    t.ctrl.start()
    for (const route of ['/client/messages', '/client/onboarding', '/client/onboarding/2', '/client/survey']) {
      await t.ctrl.setRoute(route)
      await vi.advanceTimersByTimeAsync(6000)
      expect(t.ctrl.getSnapshot().current, route).toBeNull()
    }
    expect(t.fetchFn).not.toHaveBeenCalled()
    t.ctrl.stop()
  })

  it('a window waiting behind a suppressed route comes back (fresh load, no 60 s wait) when the user leaves it', async () => {
    const t = setup({ list: [cand({ id: 'a' })] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.ctrl.getSnapshot().current?.id).toBe('a')
    await t.ctrl.setRoute('/client/messages')
    expect(t.ctrl.getSnapshot().current).toBeNull()
    await t.ctrl.setRoute('/client/home')
    expect(t.fetchFn.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === 'GET')).toHaveLength(2)
    t.ctrl.stop()
  })

  it('route changes reload at most once a minute; a hidden tab does not poll', async () => {
    const t = setup({ list: [] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await t.ctrl.setRoute('/client/point-a')
    await vi.advanceTimersByTimeAsync(30_000)
    await t.ctrl.setRoute('/client/point-b')
    const gets = () => t.fetchFn.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === 'GET').length
    expect(gets()).toBe(1)
    await vi.advanceTimersByTimeAsync(31_000)
    await t.ctrl.setRoute('/client/gri')
    expect(gets()).toBe(2)

    t.flags.visible = false
    await vi.advanceTimersByTimeAsync(240_000)
    expect(gets()).toBe(2)
    t.flags.visible = true
    await vi.advanceTimersByTimeAsync(120_000)
    expect(gets()).toBe(3)
    t.ctrl.stop()
  })

  it('quick reply posts to /api/v1/comm/messages, then dismisses the card', async () => {
    const t = setup({ list: [cand({ id: 'a' })] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    await t.ctrl.reply('a', '  Спасибо, посмотрю  ')
    expect(t.acts().filter((w) => w.method === 'POST')).toEqual([{ url: '/api/v1/comm/messages', method: 'POST', body: { body: 'Спасибо, посмотрю' } }])
    expect(t.acts().at(-1)).toEqual({ url: '/api/v1/popups/a', method: 'PATCH', body: { action: 'acted' } })
    expect(t.ctrl.getSnapshot().current).toBeNull()
    expect(t.ctrl.getSnapshot().popups).toEqual([])
    t.ctrl.stop()
  })

  it('a failed reply keeps the card and throws the server message', async () => {
    const t = setup({ list: [cand({ id: 'a' })] })
    t.fetchFn.mockImplementation(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') return { ok: false, status: 429, json: async () => ({ ok: false, error: 'Слишком много сообщений подряд' }) } as unknown as Response
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { threadId: 't-1', popups: [cand({ id: 'a' })] } }) } as unknown as Response
    })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    await expect(t.ctrl.reply('a', 'Привет')).rejects.toThrow('Слишком много сообщений подряд')
    expect(t.ctrl.getSnapshot().current?.id).toBe('a')
    await expect(t.ctrl.reply('a', '   ')).rejects.toThrow()
    t.ctrl.stop()
  })

  it('dismiss and snooze call PATCH with the days and take the card away', async () => {
    const t = setup({ list: [cand({ id: 'a' }), cand({ id: 'b' }), cand({ id: 'c' })] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    await t.ctrl.snooze('a', 7)
    expect(t.acts().at(-1)).toEqual({ url: '/api/v1/popups/a', method: 'PATCH', body: { action: 'snooze', days: 7 } })
    expect(t.ctrl.getSnapshot().current?.id).toBe('b')
    await t.ctrl.dismiss('b')
    expect(t.acts().at(-1)).toEqual({ url: '/api/v1/popups/b', method: 'PATCH', body: { action: 'dismiss' } })
    expect(t.ctrl.getSnapshot().current?.id).toBe('c')
    // days other than 3 / 7 / 30 never reach the server
    await t.ctrl.snooze('c', 5 as never)
    expect(t.writes().filter((w) => (w.body as { days?: number }).days === 5)).toEqual([])
    t.ctrl.stop()
  })

  it('renders nothing and makes no writes when the API returns an empty list or an error', async () => {
    for (const o of [{ list: [] }, { status: 500 }, { status: 401 }, { throws: true }]) {
      const t = setup(o)
      t.ctrl.start()
      await t.ctrl.setRoute('/client/home')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(t.ctrl.getSnapshot()).toMatchObject({ popups: [], current: null })
      expect(t.writes()).toEqual([])
      t.ctrl.stop()
    }
  })

  it('popup controller sends kind and shows the right badge for insight and recommendation', async () => {
    const insight = cand({ id: 'ins', kind: 'insight', priority: 3, authorName: null, canReply: false, title: 'Кассовый разрыв в месяце 4', href: '/client/point-b?tab=whatif' })
    const rec = cand({ id: 'rec', kind: 'recommendation', priority: 4, authorName: 'Анна Ким', canReply: false, title: 'Поднять конверсию', href: '/client/point-b?tab=recs' })
    const msg = cand({ id: 'msg', priority: 1 })
    const t = setup({ list: [insight, rec, msg] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    // an expert message: written as before, without a kind
    expect(t.writes()).toEqual([{ url: '/api/v1/popups/msg', method: 'PATCH', body: { action: 'seen' } }])
    await t.ctrl.dismiss('msg')
    expect(t.acts().at(-1)).toEqual({ url: '/api/v1/popups/msg', method: 'PATCH', body: { action: 'dismiss' } })
    // an insight: seen / snooze carry the kind
    expect(t.ctrl.getSnapshot().current?.id).toBe('ins')
    expect(t.writes()).toContainEqual({ url: '/api/v1/popups/ins', method: 'PATCH', body: { action: 'seen', kind: 'insight' } })
    await t.ctrl.snooze('ins', 3)
    expect(t.acts().at(-1)).toEqual({ url: '/api/v1/popups/ins', method: 'PATCH', body: { action: 'snooze', days: 3, kind: 'insight' } })
    // a recommendation: «Открыть» = acted, with the kind
    expect(t.ctrl.getSnapshot().current?.id).toBe('rec')
    await t.ctrl.act('rec')
    expect(t.acts().at(-1)).toEqual({ url: '/api/v1/popups/rec', method: 'PATCH', body: { action: 'acted', kind: 'recommendation' } })
    expect(t.ctrl.getSnapshot()).toMatchObject({ popups: [], current: null })
    t.ctrl.stop()

    const noop = () => {}
    const html = (p: PopupCandidate) => renderToStaticMarkup(React.createElement(PopupCard, { popup: p, onDismiss: noop, onSnooze: noop, onReply: async () => {} }))
    const ins = html(insight)
    expect(ins).toContain('Подсказка платформы · не проверена экспертом')
    expect(ins).toContain('Почему я это вижу')
    expect(ins).toContain('>Открыть</a>')
    expect(ins).not.toContain('Открыть диалог')
    expect(ins).not.toContain('<textarea')
    const r = html(rec)
    expect(r).toContain('Проверено экспертом · Анна Ким')
    expect(r).toContain('Почему я это вижу')
    expect(r).not.toContain('не проверена')
    // the server's own reason wins when it sends one
    expect(html({ ...insight, why: 'Разрыв в первые 6 месяцев выбранного темпа' } as PopupCandidate)).toContain('Разрыв в первые 6 месяцев выбранного темпа')
    // an expert message keeps its badge and its link, and has no «why»
    const m = html(cand({ id: 'm' }))
    expect(m).toContain('Эксперт · Анна Ким')
    expect(m).toContain('Открыть диалог')
    expect(m).not.toContain('Почему я это вижу')
    // a critical insight as a modal: the same badge in a dialog
    const modal = renderToStaticMarkup(React.createElement(PopupModal, { popup: { ...insight, display: 'modal' }, onDismiss: noop, onSnooze: noop, onReply: async () => {} }))
    expect(modal).toContain('role="dialog"')
    expect(modal).toContain('Подсказка платформы · не проверена экспертом')
  })

  it('a failed reload keeps what is already known', async () => {
    const t = setup({ list: [cand({ id: 'a' })] })
    t.ctrl.start()
    await t.ctrl.setRoute('/client/home')
    await vi.advanceTimersByTimeAsync(5000)
    t.fetchFn.mockImplementation(async () => { throw new Error('offline') })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(t.ctrl.getSnapshot().current?.id).toBe('a')
    t.ctrl.stop()
  })
})

describe('focus helpers', () => {
  it('isTextEntry: fields where the user types, not buttons or boxes', () => {
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'email' })).toBe(true)
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(true)
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range']) expect(isTextEntry({ tagName: 'INPUT', type }), type).toBe(false)
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })

  it('nextTrapIndex keeps Tab / Shift+Tab inside the dialog', () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0)
    expect(nextTrapIndex(3, 0, true)).toBe(2)
    expect(nextTrapIndex(3, 1, false)).toBeNull() // default Tab is fine inside
    expect(nextTrapIndex(3, -1, false)).toBe(0) // focus outside → pulled in
    expect(nextTrapIndex(3, -1, true)).toBe(2)
    expect(nextTrapIndex(0, -1, false)).toBeNull()
  })
})

describe('markup', () => {
  const noop = () => {}
  const card = (p: PopupCandidate) => renderToStaticMarkup(React.createElement(PopupCard, { popup: p, onDismiss: noop, onSnooze: noop, onReply: async () => {} }))

  it('snooze buttons offer 3 / 7 / 30 days', () => {
    const html = card(cand({ id: 'a' }))
    for (const label of ['3 дня', '7 дней', '30 дней']) expect(html).toContain(label)
    expect(html).toContain('Закрыть')
    expect(html).toContain('href="/client/messages"')
  })

  it('a card without the right to reply has no reply field', () => {
    expect(card(cand({ id: 'a', canReply: false }))).not.toContain('<textarea')
  })

  it('the modal is a labelled, modal dialog with the reply field', () => {
    const html = renderToStaticMarkup(React.createElement(PopupModal, { popup: cand({ id: 'm', display: 'modal', important: true, title: 'Нужен ответ' }), onDismiss: noop, onSnooze: noop, onReply: async () => {} }))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).toContain('Нужен ответ')
    expect(html).toContain('Анна Ким')
  })

  it('the layer renders a polite live region with the current card, a dialog for a modal, and nothing visible when empty', () => {
    const actions = { dismiss: async () => {}, snooze: async () => {}, markSeen: async () => {}, reply: async () => {}, act: async () => {} }
    state.hook = { popups: [], current: null, ...actions }
    const empty = renderToStaticMarkup(React.createElement(PopupLayer))
    expect(empty).not.toContain('<button')
    expect(empty).not.toContain('role="dialog"')

    state.hook = { popups: [cand({ id: 'a' })], current: cand({ id: 'a' }), ...actions }
    const withCard = renderToStaticMarkup(React.createElement(PopupLayer))
    expect(withCard).toContain('aria-live="polite"')
    expect(withCard).toContain('Анна Ким')

    const m = cand({ id: 'm', display: 'modal', important: true })
    state.hook = { popups: [m], current: m, ...actions }
    expect(renderToStaticMarkup(React.createElement(PopupLayer))).toContain('role="dialog"')
  })
})
