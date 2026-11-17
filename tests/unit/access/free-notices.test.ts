/**
 * R2-A (ревью L-6): what a Free account is told and where it is sent.
 *  - notices «Точка А пересчитана» / «Анкета принята»: no score, the free «Снимок бизнеса»;
 *  - the in-app completion notice: the same;
 *  - «1 действие сейчас»: no «Пройдите GRI-диагностику» into a paywall, an honest «request access»;
 *  - the free snapshot's link says the full Point A is paid;
 *  - Share / PDF of Point A on /dashboard: hidden without the section, 402 → «в платном доступе».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const s = vi.hoisted(() => ({ closed: true, express: true, sent: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/access/recipient', () => ({ pointAClosedFor: async () => s.closed, sectionClosedFor: async () => s.closed }))
vi.mock('@/lib/notifications/notify', () => ({ notifyClient: async (o: Record<string, unknown>) => { s.sent.push(o); return { ok: true } } }))
// R4-B4: «Снимок бизнеса» is a screen of «Экспресс + блоки» (GIGA setting survey_modes).
vi.mock('@/lib/survey/modes-server', () => ({ freeSnapshotAvailable: async () => s.express }))

const product = await import('@/lib/notifications/product')
const { buildClientNotice } = await import('@/lib/survey/completion-notice')
const { pickNextBestAction } = await import('@/lib/dashboard/next-best-action')

beforeEach(() => {
  s.closed = true
  s.express = true
  s.sent = []
})

describe('notices', () => {
  it('«Точка А пересчитана» for Free: no score, the free snapshot (before: «Общий балл: 61», link into the paywall)', async () => {
    await product.notifyPointARecalculated('u-1', { diagnosticId: 'd-1', overallScore: 61 })
    const n = s.sent[0]
    expect(String(n.body)).not.toContain('61')
    expect(String(n.body)).toContain('в платном доступе')
    expect(n.ctaUrl).toBe('/client/onboarding/snapshot')
  })

  it('… and for Pro as before', async () => {
    s.closed = false
    await product.notifyPointARecalculated('u-1', { diagnosticId: 'd-1', overallScore: 61 })
    expect(String(s.sent[0].body)).toContain('Общий балл: 61')
    expect(s.sent[0].ctaUrl).toBe('/client/point-a')
  })

  it('«Анкета принята» for Free leads to the snapshot and says the full analysis is paid', async () => {
    await product.notifyQuestionnaireCompleted('u-1', { completedSteps: 12, totalSteps: 12 })
    expect(s.sent[0].ctaUrl).toBe('/client/onboarding/snapshot')
    expect(String(s.sent[0].body)).toContain('в платном доступе')
  })

  it('the in-app completion notice: Free → the snapshot link; otherwise /client/point-a', () => {
    expect(buildClientNotice({ completedSteps: 12, totalSteps: 12, company: 'ООО' }, { pointALocked: true })).toMatchObject({ link: '/client/onboarding/snapshot' })
    expect(buildClientNotice({ completedSteps: 12, totalSteps: 12, company: 'ООО' })).toMatchObject({ link: '/client/point-a' })
  })

  // R4-B4: the express mode switched off in GIGA → the snapshot page sends the client away, so
  // no Free notice leads there or promises an «экспресс-оценка» (before: always the snapshot).
  it('express switched off: «Анкета принята» / «Точка А пересчитана» for Free lead to the cabinet, no snapshot promised', async () => {
    s.express = false
    await product.notifyQuestionnaireCompleted('u-1', { completedSteps: 12, totalSteps: 12 })
    expect(s.sent[0].ctaUrl).toBe('/client/home')
    expect(s.sent[0].ctaLabel).toBe('Открыть кабинет')
    expect(String(s.sent[0].body)).not.toMatch(/экспресс-оценка|[Сс]нимок/)
    expect(String(s.sent[0].body)).toContain('в платном доступе')
    await product.notifyPointARecalculated('u-1', { diagnosticId: 'd-1', overallScore: 61 })
    expect(s.sent[1].ctaUrl).toBe('/client/home')
    expect(`${s.sent[1].title} ${s.sent[1].body}`).not.toMatch(/[Сс]нимок|[Ээ]кспресс/)
    expect(String(s.sent[1].body)).not.toContain('61')
    // Pro is not affected by the setting
    s.closed = false
    await product.notifyQuestionnaireCompleted('u-1', { completedSteps: 12, totalSteps: 12 })
    expect(s.sent[2].ctaUrl).toBe('/client/point-a')
  })

  it('express switched off: the in-app completion notice — the cabinet when full, the questionnaire otherwise; no «экспресс-оценка»', () => {
    const full = buildClientNotice({ completedSteps: 12, totalSteps: 12, company: 'ООО' }, { pointALocked: true, snapshot: false })
    expect(full.link).toBe('/client/home')
    expect(full.body).not.toMatch(/[Ээ]кспресс-оценка/)
    expect(buildClientNotice({ completedSteps: 5, totalSteps: 12, company: 'ООО' }, { pointALocked: true, snapshot: false }).link).toBe('/client/onboarding')
    expect(buildClientNotice({ completedSteps: 12, totalSteps: 12, company: 'ООО' }, { snapshot: false }).link).toBe('/client/point-a')
  })

  it('express switched off: the feed record written by claimCompletionNotice follows the setting', async () => {
    const { claimCompletionNotice } = await import('@/lib/survey/completion-notice')
    const inserts: Array<Record<string, unknown>> = []
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: () => chain, eq: () => chain, contains: () => chain,
      limit: async () => ({ data: [], error: null }),
      insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null } },
    })
    const sb = { from: () => chain } as never
    s.express = false
    await claimCompletionNotice(sb, 'u-1', { completedSteps: 12, totalSteps: 12, company: 'ООО' })
    expect(inserts[0]).toMatchObject({ link: '/client/home' })
    s.express = true
    await claimCompletionNotice(sb, 'u-2', { completedSteps: 12, totalSteps: 12, company: 'ООО' })
    expect(inserts[1]).toMatchObject({ link: '/client/onboarding/snapshot' })
  })
})

describe('«1 действие сейчас»', () => {
  const base = { completionPct: 100, nextSectionLabel: null, hasDiagnostic: false, overdueClients: 0, criticalBlockLabel: null, griTopLimit: null }
  it('the full GRI closed → an honest «request access», not «Пройдите GRI-диагностику» into a paywall', () => {
    const a = pickNextBestAction({ ...base, diagnosticLocked: true })
    expect(a.kind).toBe('request_access')
    expect(a.title).toContain('в платном доступе')
    expect(pickNextBestAction(base).kind).toBe('run_diagnostic')
  })
})

describe('the free «Снимок бизнеса»', () => {
  it('the Point A link says the full analysis is paid when the server answered the express view', async () => {
    const { BusinessSnapshot } = await import('@/components/onboarding/express/BusinessSnapshot')
    const pointA = { state: 'ready' as const, locked: true, snapshot: { assessment: 'full' as const, overall: 61, confidence: 0.7, blocks: [{ key: 'finance', title: 'Финансы', score: 64, status: 'ok', issues_count: 1 }] } }
    const out = renderToStaticMarkup(React.createElement(BusinessSnapshot, { answers: {}, pointA, recommended: [] }))
    expect(out).toContain('Полный разбор Точки А — в платном доступе')
    const open = renderToStaticMarkup(React.createElement(BusinessSnapshot, { answers: {}, pointA: { ...pointA, locked: false }, recommended: [] }))
    expect(open).toContain('Открыть Точку А')
  })

  it('a preliminary block still shows HOW MANY findings it has (the count stays, the text does not)', async () => {
    const { blockFindingsText } = await import('@/lib/point-a/v4/primary')
    expect(blockFindingsText({ issues_count: 2, coverage: 0.9 })).toBe('2 находки')
    expect(blockFindingsText({ top_issues: ['a'], coverage: 0.9 })).toBe('1 находка')
  })
})

describe('Share / PDF of Point A on /dashboard', () => {
  it('the buttons are shown only with the section; a 402 is «в платном доступе», not «не удалось»', () => {
    expect(readFileSync('app/(dashboard)/dashboard/page.tsx', 'utf8')).toMatch(/pointA && companyId && pointAOpen && \(/)
    const share = readFileSync('components/share/ShareButton.tsx', 'utf8')
    expect(share).toMatch(/res\.status === 402 \|\| json\.error === 'upgrade_required'/)
    expect(share).toMatch(/res\.status === 402 \|\| errCode === 'upgrade_required'/)
  })
})
