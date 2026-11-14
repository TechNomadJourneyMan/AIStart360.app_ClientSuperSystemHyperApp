/**
 * R2-C — what the PO decisions change on screen (rendered with react-dom/server):
 *   M-4  the home card «Отчёт эксперта готов» for an account without Точка А:
 *        the paywall, no «Открыть» / PDF / link / report id; the expert's
 *        review block is not mounted on the home page (its API answers 402);
 *        the expert's review queue says the client is on the free tariff;
 *   Q4   FirstRunWizard: with the full GRI closed the third step is the free mini-GRI;
 *   Q5   «Рынок» in the cabinet menu, with a lock while the section is closed;
 *   M-5  «Назначить Pro» instead of «Принять» on a request for paid access.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ usePathname: () => '/client/home', useRouter: () => ({ push: () => {} }) }))
vi.mock('next/image', () => ({ default: (p: { alt: string; src: string }) => React.createElement('img', { alt: p.alt, src: p.src }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: async () => ({}) } }) }))
vi.mock('@/lib/events/client', () => ({ trackLogout: () => {} }))

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

describe('M-4: the home card of a published report', () => {
  const report = { id: 'v-secret-1', version: 3, title: 'Точка А: ТОО Ромашка', published_at: '2026-10-06T10:00:00.000Z', created_at: '2026-10-05T20:30:00.000Z' }

  it('Точка А closed → «Отчёт эксперта готов» leading to THE paywall of the page (#expert); nothing to open', async () => {
    const { ReportReadyCard, POINT_A_PAYWALL_ANCHOR } = await import('@/components/reports/ReportReadyCard')
    const out = html(React.createElement(ReportReadyCard, { report, locked: true }))
    expect(out).toContain('Отчёт эксперта готов')
    // review L-1: no second paywall inside the card — a link to the one below
    expect(out).not.toContain('data-paywall')
    expect(POINT_A_PAYWALL_ANCHOR).toBe('#expert')
    expect(out).toContain('href="#expert"')
    // review L-2: «6 октября 2026.», never «2026 г..»
    expect(out).toContain('6 октября 2026.')
    expect(out).not.toContain('г..')
    expect(out).not.toContain('Открыть отчёт')
    expect(out).not.toContain('/api/v1/reports')
    expect(out).not.toContain('/client/point-a#reports')
    expect(out).not.toContain('v-secret-1')
  })

  it('Точка А open → the card as before («Открыть», PDF of this version)', async () => {
    const { ReportReadyCard } = await import('@/components/reports/ReportReadyCard')
    const out = html(React.createElement(ReportReadyCard, { report }))
    expect(out).toContain('Ваш отчёт готов')
    expect(out).toContain('href="/api/v1/reports/v-secret-1/pdf"')
    expect(out).not.toContain('data-paywall')
  })
})

describe('M-4: the expert\'s review queue tells the expert the client is on Free', () => {
  it('locked client → the note; the others → no note', async () => {
    const { ExpertReviewQueue, FREE_CLIENT_NOTE } = await import('@/components/expert/ExpertReviewQueue')
    const item = { id: 'r1', company_id: 'c1', company_name: 'Ромашка', title: 'Точка А', stamp: 'Версия 1 · 01.11.2026', findings: 2, recommendations: 1 }
    const out = html(React.createElement(ExpertReviewQueue, { items: [{ ...item, clientPaidLocked: true }, { ...item, id: 'r2', company_name: 'Лютик' }], focusId: null }))
    expect(out.match(/data-free-client/g)).toHaveLength(1)
    expect(out).toContain(FREE_CLIENT_NOTE)
    // publishing stays available for both
    expect(out.match(/Подтвердить и опубликовать/g)).toHaveLength(2)
  })

})

describe('Q4 + review M-1 / L-9: the first steps of a Free account lead to the free «Снимок бизнеса»', () => {
  it('FirstRunWizard: full GRI closed → the third step is «Снимок бизнеса» in the cabinet (not the public /gri-free, not /gri)', async () => {
    const { FirstRunWizard, FREE_SNAPSHOT_HREF } = await import('@/components/dashboard/FirstRunWizard')
    const out = html(React.createElement(FirstRunWizard, { surveyStepsDone: 2, docsCount: 0, hasDiagnostic: false, griLocked: true }))
    expect(FREE_SNAPSHOT_HREF).toBe('/client/onboarding/snapshot')
    expect(out).toContain('href="/client/onboarding/snapshot"')
    expect(out).toContain('Открыть снимок бизнеса')
    expect(out).not.toContain('/gri-free')
    expect(out).not.toContain('href="/gri"')
    expect(out).not.toContain('мини-GRI')
    // the mascot markers stay
    expect(out).toContain('data-first-run-wizard')
  })

  it('FirstRunWizard: full GRI open (or not said) → as before', async () => {
    const { FirstRunWizard } = await import('@/components/dashboard/FirstRunWizard')
    for (const griLocked of [false, undefined]) {
      const out = html(React.createElement(FirstRunWizard, { surveyStepsDone: 0, docsCount: 0, hasDiagnostic: false, griLocked }))
      expect(out).toContain('href="/gri"')
      expect(out).not.toContain('/client/onboarding/snapshot')
    }
  })

  it('/dashboard hero: ONE call — closed → «Снимок бизнеса», no «Пройти GRI-диагностику» to the paywall; open → GRI as before', async () => {
    const { default: GrowthSnapshotHero } = await import('@/components/dashboard/GrowthSnapshotHero')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const hero = (props: Record<string, unknown>) => React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(GrowthSnapshotHero, props))
    const locked = html(hero({ visibleSections: ['gri', 'point_a'], hideSnapshot: true, griLocked: true }))
    expect(locked).toContain('data-next-step="snapshot"')
    expect(locked).toContain('href="/client/onboarding/snapshot"')
    expect(locked).not.toContain('Пройти GRI-диагностику')
    expect(locked).not.toContain('href="/gri"')
    const open = html(hero({ visibleSections: ['gri', 'point_a'], hideSnapshot: true }))
    expect(open).toContain('Пройти GRI-диагностику')
    expect(open).not.toContain('data-next-step="snapshot"')
  })

  it('/dashboard passes the same server decision of gri_full to the hero and the wizard', () => {
    const src = readFileSync('app/(dashboard)/dashboard/page.tsx', 'utf8')
    expect(src).toMatch(/const griOpen = sections\?\.gri_full \?\? false/)
    expect(src.match(/griLocked=\{!griOpen\}/g)).toHaveLength(2)
  })
})

describe('Q5: «Рынок» in the cabinet menu', () => {
  it('the server decision locks the items of closed sections, Рынок included', async () => {
    const { lockedNavKeysFor } = await import('@/lib/client-shell/nav')
    expect(lockedNavKeysFor({ point_a: true, point_b: true, market: false, gri_full: true })).toEqual(['market'])
    expect(lockedNavKeysFor({ point_a: false, point_b: false, market: false, gri_full: false })).toEqual(['point_a', 'point_b', 'market', 'gri'])
    expect(lockedNavKeysFor({ point_a: true, point_b: true, market: true, gri_full: true })).toEqual([])
    expect(readFileSync('app/client/layout.tsx', 'utf8')).toContain('lockedNavKeysFor((await getRequestAccess(userId)).sections)')
  })

  it('rendered: «Рынок» leads to /market and carries a lock while closed', async () => {
    const { buildClientNav, lockedNavKeysFor } = await import('@/lib/client-shell/nav')
    const { ClientNav } = await import('@/components/client/ClientNav')
    const items = buildClientNav({ approved: true, hiddenPaths: [], lockedKeys: lockedNavKeysFor({ point_a: true, point_b: true, market: false, gri_full: true }) })
    const out = html(React.createElement(ClientNav, { items, panel: null, email: null }))
    const market = out.slice(out.indexOf('href="/market"'), out.indexOf('</a>', out.indexOf('href="/market"')))
    expect(market).toContain('Рынок')
    expect(market).toContain('платный доступ')
    const open = html(React.createElement(ClientNav, { items: buildClientNav({ approved: true, hiddenPaths: [] }), panel: null, email: null }))
    const openMarket = open.slice(open.indexOf('href="/market"'), open.indexOf('</a>', open.indexOf('href="/market"')))
    expect(openMarket).toContain('Рынок')
    expect(openMarket).not.toContain('платный доступ')
  })

  it('not before approval, not for an expert account (middleware sends it to /expert)', async () => {
    const { buildClientNav } = await import('@/lib/client-shell/nav')
    expect(buildClientNav({ approved: false, hiddenPaths: [] }).map((i) => i.key)).not.toContain('market')
    expect(buildClientNav({ approved: true, hiddenPaths: [], profileRole: 'expert' }).map((i) => i.key)).not.toContain('market')
  })
})

describe('M-5: «Назначить Pro» on a request for paid access', () => {
  const base = { userName: 'Иван Петров', userEmail: 'i***@corp.kz', subject: 'Платный доступ: Точка А', description: '…', createdAt: '2026-11-14T09:00:00Z', status: 'pending' as const }

  it('a pending paywall / pilot / old «Pro» request → «Назначить Pro», no «Принять»; a registration → «Принять»', async () => {
    const { RequestCard } = await import('@/components/giga-panel/RequestsModule')
    const noop = () => {}
    for (const source of ['paywall', 'upgrade_modal']) {
      const out = html(React.createElement(RequestCard, { request: { ...base, id: 'r1', category: 'access', source }, onApprove: noop, onReject: noop, onArchive: noop, onAssignPro: noop, canAssignPro: true }))
      expect(out).toContain('Назначить Pro')
      expect(out).toContain('data-action="assign-pro"')
      expect(out).not.toContain('Принять')
      expect(out).toContain('Отклонить')
    }
    const reg = html(React.createElement(RequestCard, { request: { ...base, id: 'r2', category: 'registration', source: 'supabase_profile' }, onApprove: noop, onReject: noop, onArchive: noop, onAssignPro: noop, canAssignPro: true }))
    expect(reg).toContain('Принять')
    expect(reg).not.toContain('Назначить Pro')
  })

  it('without the plan editor\'s right (users.manage) the button is disabled with the reason', async () => {
    const { RequestCard } = await import('@/components/giga-panel/RequestsModule')
    const { ASSIGN_PRO_NO_RIGHT } = await import('@/components/giga-panel/assign-pro-model')
    const noop = () => {}
    const out = html(React.createElement(RequestCard, { request: { ...base, id: 'r1', category: 'access', source: 'paywall' }, onApprove: noop, onReject: noop, onArchive: noop, onAssignPro: noop, canAssignPro: false }))
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-action="assign-pro"|<button[^>]*data-action="assign-pro"[^>]*disabled=""/)
    expect(out).toContain(ASSIGN_PRO_NO_RIGHT)
  })

  it('the dialog model: period → body, the answer → the toast', async () => {
    const m = await import('@/components/giga-panel/assign-pro-model')
    expect(m.isTariffRequest({ category: 'access', source: 'paywall' })).toBe(true)
    expect(m.isTariffRequest({ category: 'registration', source: 'paywall' })).toBe(false)
    expect(m.isTariffRequest({ category: 'access', source: 'support' })).toBe(false)
    expect(m.assignProBody({ mode: 'months', months: '3', date: '', note: ' по звонку ' })).toEqual({ months: 3, note: 'по звонку' })
    expect(m.assignProBody({ mode: 'months', months: '0', date: '', note: '' })).toBeNull()
    expect(m.assignProBody({ mode: 'months', months: '37', date: '', note: '' })).toBeNull()
    expect(m.assignProBody({ mode: 'date', months: '', date: '2027-01-31', note: '' })).toEqual({ periodEnd: '2027-01-31' })
    expect(m.assignProBody({ mode: 'date', months: '', date: '', note: '' })).toBeNull()
    expect(m.assignProBody({ mode: 'none', months: '', date: '', note: '' })).toEqual({})
    expect(m.assignProPeriodText({ mode: 'date', months: '', date: '2027-01-31', note: '' })).toBe('до 31.01.2027')

    const calls: Array<{ url: string; body: unknown }> = []
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ ok: true, requestClosed: true, notified: true }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await m.sendAssignPro(ok, 'req-1', { months: 3 })
    expect(calls).toEqual([{ url: '/api/giga-admin/requests/req-1/assign-pro', body: { months: 3 } }])
    expect(r).toEqual({ ok: true, text: 'Pro назначен, заявка закрыта как одобренная, клиент получил уведомление «Доступ открыт».' })
    const denied = (async () => new Response(JSON.stringify({ ok: false, error: 'Недостаточно прав' }), { status: 403 })) as unknown as typeof fetch
    expect(await m.sendAssignPro(denied, 'req-1', {})).toEqual({ ok: false, text: 'Недостаточно прав' })
  })

  it('review L-3: an incomplete period LOCKS «Назначить Pro» and the form says why; a complete one unlocks it', async () => {
    const { AssignProDialog } = await import('@/components/giga-panel/RequestsModule')
    const { ASSIGN_PRO_PERIOD_ERROR, ASSIGN_PRO_NOT_CLOSED } = await import('@/components/giga-panel/assign-pro-model')
    const target = { ...base, id: 'r1', category: 'access' as const, source: 'paywall' }
    const dialog = (form: Record<string, string>) => html(React.createElement(AssignProDialog, { target, form: form as never, setForm: () => {}, busy: false, onClose: () => {}, onConfirm: () => {} }))
    const confirmButton = (out: string) => out.slice(out.lastIndexOf('<button', out.indexOf('Назначить Pro на') === -1 ? out.lastIndexOf('Назначить Pro') : out.indexOf('Назначить Pro на')), out.length)
    for (const form of [{ mode: 'months', months: '', date: '', note: '' }, { mode: 'months', months: '1.5', date: '', note: '' }, { mode: 'date', months: '', date: '', note: '' }]) {
      const out = dialog(form)
      expect(out).toContain(ASSIGN_PRO_PERIOD_ERROR)
      expect(out).toContain('role="alert"')
      expect(confirmButton(out).slice(0, 400)).toContain('disabled=""')
    }
    const ok = dialog({ mode: 'months', months: '3', date: '', note: '' })
    expect(ok).not.toContain(ASSIGN_PRO_PERIOD_ERROR)
    expect(ok).toContain('Назначить Pro на 3 мес.')
    expect(confirmButton(ok).slice(0, 400)).not.toContain('disabled=""')
    // the toast no longer sends staff to «Принять» (it is 409 for such a request now)
    expect(ASSIGN_PRO_NOT_CLOSED).not.toMatch(/вручную|Принять/)
  })

  it('User 360 → Биллинг reports the closed requests and the notice', async () => {
    const { billingSavedText } = await import('@/components/giga-panel/BillingControls')
    expect(billingSavedText({})).toBe('Сохранено. Изменение записано в журнал.')
    expect(billingSavedText({ closedRequests: ['a', 'b'], notified: true })).toContain('закрыты как одобренные: 2')
    expect(billingSavedText({ closedRequests: ['a'], notified: true })).toContain('«Доступ открыт»')
  })
})
