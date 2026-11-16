/**
 * R3-PA — the questionnaire's side of the way to the score:
 *   П5б  «Отправить анкету — получить оценку» from the Point A page opens the
 *        final check (`?step=review`); old surveys «11 из 12» are NOT counted
 *        as sent automatically (решение PO) — the client presses the button;
 *   П5а  the review step says «Минимум для Точки А» by the RULE of the score
 *        (from the server), the old counter is renamed «Ключевые вопросы»;
 *   B5   a failed recalculation after sending is told, not swallowed.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseStepParam } from '@/lib/survey/draft'
import { recalcAfterSubmit, RECALC_FAILED_MESSAGE } from '@/lib/survey/recalc-after-submit'
import { pointAScorePath } from '@/lib/point-a/v4/score-path'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/client/onboarding' }))
const { default: SurveyReview, reviewScoreLine } = await import('@/components/onboarding/SurveyReview')

describe('?step=review (П5б)', () => {
  it('opens the final check only where allowed; numbers as before', () => {
    expect(parseStepParam('review', 12, { review: true })).toBe(13)
    expect(parseStepParam('review', 12)).toBeNull()
    expect(parseStepParam('9', 12, { review: true })).toBe(9)
    expect(parseStepParam('13', 12, { review: true })).toBeNull()
  })

  it('the wizard reads it, and sending stays an explicit action (no automatic «sent» for 11/12)', () => {
    const page = readFileSync('app/client/onboarding/page.tsx', 'utf8')
    expect(page).toMatch(/parseStepParam\(searchParams\.get\('step'\), TOTAL_STEPS, \{ review: true \}\)/)
    expect(page).toMatch(/saveToServer\(TOTAL_STEPS, \{ final: true \}\)/)
  })
})

describe('the recalculation after sending (B5)', () => {
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

  it('200 → ok; 409 «уже пересчитывается» → ok (busy), not an error', async () => {
    expect(await recalcAfterSubmit((async () => res(200, { ok: true })) as unknown as typeof fetch, 'u')).toEqual({ ok: true, busy: false })
    expect(await recalcAfterSubmit((async () => res(409, { ok: false })) as unknown as typeof fetch, 'u')).toEqual({ ok: true, busy: true })
  })

  it('a server error is TOLD with the server\'s Russian reason; a network error too', async () => {
    const r = await recalcAfterSubmit((async () => res(503, { ok: false, error: 'Не удалось пересчитать Точку А — попробуйте через минуту' })) as unknown as typeof fetch, 'u')
    expect(r).toEqual({ ok: false, message: `Не удалось пересчитать Точку А — попробуйте через минуту. ${RECALC_FAILED_MESSAGE}` })
    expect(await recalcAfterSubmit((async () => res(500, { error: 'Internal error' })) as unknown as typeof fetch, 'u')).toEqual({ ok: false, message: RECALC_FAILED_MESSAGE })
    const net = await recalcAfterSubmit((async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch, 'u')
    expect(net.ok).toBe(false)
    expect(!net.ok && net.message).toContain('Нет связи с сервером')
  })

  it('the wizard shows it and stays (no silent `catch {}` before leaving)', () => {
    const page = readFileSync('app/client/onboarding/page.tsx', 'utf8')
    expect(page).toContain('recalcAfterSubmit(fetch, userIdRef.current)')
    expect(page).toContain('data-recalc-error')
    expect(page).toContain('Повторить пересчёт')
    expect(page).not.toMatch(/diagnostics\/recalculate[\s\S]{0,200}\} catch \{\}\s*\n\s*router\.push\(target\)/)
  })
})

describe('the review step: «Минимум для Точки А» = the rule (П5а)', () => {
  const block = (key: string, weight: number, answered: number) => ({
    key, weight, score: answered >= 2 ? 70 : null,
    checks: Array.from({ length: 5 }, (_, i) => ({ id: `${key}${i}`, max: 10, answered: i < answered })),
  })
  const review = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(SurveyReview, {
    fill: [], percent: 40, submitting: false, hasUnsaved: false, onEditStep: () => undefined, onBack: () => undefined, onSubmit: () => undefined, ...props,
  } as never))

  it('what is still missing before the score, by the rule; enough → «после отправки появится оценка»', () => {
    const missing = pointAScorePath([block('finance', 0.3, 0), block('marketing', 0.7, 3)], { surveySent: false })
    expect(reviewScoreLine(missing)).toBe('До оценки осталось 2 пункта: «Финансы» — 2.')
    const out = review({ scorePath: missing })
    expect(out).toContain('Минимум для Точки А:')
    expect(out).toContain('До оценки осталось 2 пункта')
    expect(out).toContain('не меньше 60 % веса')
    const enough = pointAScorePath([block('finance', 1, 3)], { surveySent: false })
    expect(reviewScoreLine(enough)).toBe('данных хватает — после отправки появится оценка')
    expect(review({ scorePathLoading: true })).toContain('проверяем…')
  })

  it('the old counter is «Ключевые вопросы Точки А», not the «minimum»', () => {
    const out = review({ minimum: { answered: 15, total: 15, missing: [] } })
    expect(out).toContain('Ключевые вопросы Точки А: <b>15 из 15</b>')
    expect(out).not.toContain('Минимум для Точки А')
    expect(readFileSync('components/onboarding/SurveyProgressHeader.tsx', 'utf8')).not.toContain('можно формировать')
  })
})
