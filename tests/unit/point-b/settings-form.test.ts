/**
 * GIGA settings «Точка Б»: the recompute schedule form (days + hour UTC ↔ cron, round trip, Almaty time) and the
 * verdict tolerances validation; the card rendered on the server (react-dom/server, no DOM).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PointBSettingsCard, type PointBValues } from '@/components/giga-panel/settings/PointBSettingsCard'
import { cronDue, isValidRecomputeCron } from '@/lib/point-b/planfact/cron'
import {
  buildRecomputeCron, describeRecomputeSchedule, localSchedule, parseTolerancesDraft, scheduleFromCron, validateScheduleDraft,
} from '@/lib/point-b/planfact/schedule-form'
import { validateSetting } from '@/lib/settings/registry'

const AT = new Date('2026-10-22T12:00:00Z')

describe('recompute schedule form ↔ cron', () => {
  it('the default cron maps to Mon + Thu 22:00 UTC and back', () => {
    expect(scheduleFromCron('0 22 * * 1,4')).toEqual({ days: [1, 4], hourUtc: 22 })
    expect(buildRecomputeCron({ days: [4, 1], hourUtc: 22 })).toBe('0 22 * * 1,4')
  })

  it('round trip: every day set × several hours gives a valid cron that parses back to the same schedule', () => {
    for (const days of [[1], [0], [6, 0], [1, 2, 3, 4, 5], [0, 3]]) {
      for (const hourUtc of [0, 5, 22, 23]) {
        const expr = buildRecomputeCron({ days, hourUtc })
        expect(isValidRecomputeCron(expr)).toBe(true)
        expect(validateSetting('pb_recompute_cron', expr).ok).toBe(true)
        expect(scheduleFromCron(expr)).toEqual({ days: [...days].sort((a, b) => a - b), hourUtc })
      }
    }
    // all seven days → '*', and back to the full list; Sunday as 7 folds into 0
    expect(buildRecomputeCron({ days: [0, 1, 2, 3, 4, 5, 6], hourUtc: 3 })).toBe('0 3 * * *')
    expect(scheduleFromCron('0 3 * * *')).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], hourUtc: 3 })
    expect(scheduleFromCron('0 3 * * 7')).toEqual({ days: [0], hourUtc: 3 })
    expect(buildRecomputeCron({ days: [7, 0], hourUtc: 3 })).toBe('0 3 * * 0')
  })

  it('the built cron fires exactly on the chosen UTC hours', () => {
    const expr = buildRecomputeCron({ days: [1, 4], hourUtc: 22 })
    expect(cronDue(expr, new Date('2026-10-22T22:00:00Z'))).toBe(true) // Thursday
    expect(cronDue(expr, new Date('2026-10-22T21:00:00Z'))).toBe(false)
    expect(cronDue(expr, new Date('2026-10-23T22:00:00Z'))).toBe(false) // Friday
  })

  it('expressions the form cannot show → null (several hours, a day of month, a month, invalid)', () => {
    expect(scheduleFromCron('0 9,22 * * 1')).toBeNull()
    expect(scheduleFromCron('0 */2 * * 1')).toBeNull()
    expect(scheduleFromCron('0 22 1 * *')).toBeNull()
    expect(scheduleFromCron('0 22 * 6 *')).toBeNull()
    expect(scheduleFromCron('0 22 * *')).toBeNull()
    expect(scheduleFromCron(null)).toBeNull()
  })

  it('validation: no day, a bad hour', () => {
    expect(validateScheduleDraft({ days: [], hourUtc: 22 })).toEqual({ ok: false, error: 'Выберите хотя бы один день' })
    expect(validateScheduleDraft({ days: [1], hourUtc: 24 })).toEqual({ ok: false, error: 'Час — от 0 до 23 (UTC)' })
    expect(validateScheduleDraft({ days: [1], hourUtc: -1 }).ok).toBe(false)
    expect(validateScheduleDraft({ days: [2, 5], hourUtc: 4 })).toEqual({ ok: true, value: '0 4 * * 2,5' })
    expect(buildRecomputeCron({ days: [], hourUtc: 1 })).toBe('')
  })

  it('the Almaty time: +5 hours, the days move across midnight', () => {
    expect(localSchedule({ days: [1, 4], hourUtc: 22 }, 'Asia/Almaty', AT)).toEqual({ days: [2, 5], time: '03:00' })
    expect(localSchedule({ days: [6], hourUtc: 20 }, 'Asia/Almaty', AT)).toEqual({ days: [0], time: '01:00' }) // Sat → Sun
    expect(localSchedule({ days: [1], hourUtc: 4 }, 'Asia/Almaty', AT)).toEqual({ days: [1], time: '09:00' })
    expect(localSchedule({ days: [1], hourUtc: 4 }, 'UTC', AT)).toEqual({ days: [1], time: '04:00' })
    expect(describeRecomputeSchedule({ days: [1, 4], hourUtc: 22 }, 'Asia/Almaty', AT)).toBe('Пн, Чт в 22:00 UTC · по Алматы: Вт, Пт в 03:00')
    expect(describeRecomputeSchedule({ days: [0, 1, 2, 3, 4, 5, 6], hourUtc: 1 }, 'Asia/Almaty', AT)).toBe('ежедневно в 01:00 UTC · по Алматы: ежедневно в 06:00')
    expect(describeRecomputeSchedule({ days: [], hourUtc: 1 })).toBe('Не выбран ни один день')
  })
})

describe('verdict tolerances validation', () => {
  it('accepts numbers with a comma, refuses empty / out of range / risk not above on-track', () => {
    expect(parseTolerancesDraft({ onTrack: '5', risk: '15' })).toEqual({ ok: true, value: { on_track_pct: 5, risk_pct: 15 } })
    expect(parseTolerancesDraft({ onTrack: '2,5', risk: '10' })).toEqual({ ok: true, value: { on_track_pct: 2.5, risk_pct: 10 } })
    expect(parseTolerancesDraft({ onTrack: '', risk: '15' })).toEqual({ ok: false, error: 'Укажите допуск «на курсе» числом' })
    expect(parseTolerancesDraft({ onTrack: '5', risk: 'abc' })).toEqual({ ok: false, error: 'Укажите допуск «риск» числом' })
    expect(parseTolerancesDraft({ onTrack: '51', risk: '60' })).toEqual({ ok: false, error: 'Допуск «на курсе» — от 0 до 50 %' })
    expect(parseTolerancesDraft({ onTrack: '5', risk: '91' })).toEqual({ ok: false, error: 'Допуск «риск» — от 0 до 90 %' })
    expect(parseTolerancesDraft({ onTrack: '-1', risk: '10' }).ok).toBe(false)
    expect(parseTolerancesDraft({ onTrack: '15', risk: '15' })).toEqual({ ok: false, error: 'Допуск «риск» должен быть больше допуска «на курсе»' })
    // whatever the form accepts, the API (the registry) accepts too
    const r = parseTolerancesDraft({ onTrack: '0', risk: '90' })
    expect(r.ok && validateSetting('pb_verdict_tolerances', r.value).ok).toBe(true)
  })
})

describe('PointBSettingsCard (server render)', () => {
  const values: PointBValues = {
    pb_popups_enabled: true, pb_popup_cards_per_day: 3, pb_recompute_cron: '0 22 * * 1,4', pb_verdict_tolerances: { on_track_pct: 5, risk_pct: 15 },
  }
  const render = (over: Partial<PointBValues> = {}, opts: { disabled?: boolean; saving?: string | null } = {}) =>
    renderToStaticMarkup(createElement(PointBSettingsCard, {
      values: { ...values, ...over }, meta: {}, disabled: opts.disabled ?? false, saving: opts.saving ?? null, onSave: async () => true,
    }))

  it('shows the group, the day checkboxes, the UTC hour with the Almaty time and the tolerances with Russian labels', () => {
    const html = render()
    expect(html).toContain('Точка Б')
    expect(html).toContain('Расписание пересчёта Точки Б (cron, UTC)')
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(7)
    expect((html.match(/checked=""/g) ?? []).length).toBe(2) // Пн, Чт
    expect(html).toMatch(/<option value="22" selected="">22:00<\/option>/)
    expect(html).toContain('по Алматы: Вт, Пт в 03:00')
    expect(html).toContain('«На курсе» — отставание до, %')
    expect(html).toContain('Факт ниже плана до 5 % — «на курсе»; до 15 % — «риск»; больше — «отстаём».')
    expect(html).toContain('рабочие часы раздела «Общение»')
    // nothing changed → no save buttons
    expect(html).not.toContain('Сохранить')
  })

  it('a hand-made cron is announced; read-only mode disables the controls', () => {
    expect(render({ pb_recompute_cron: '0 9,22 * * 1' })).toContain('Сейчас задано вручную: «0 9,22 * * 1»')
    const ro = render({}, { disabled: true })
    expect(ro).toMatch(/<fieldset[^>]*disabled=""/)
    expect(ro).toMatch(/role="switch"[^>]*disabled=""/)
  })

  it('the hand-made cron shows a save button for the form schedule; while saving it says «Сохраняем…»', () => {
    expect(render({ pb_recompute_cron: '0 9,22 * * 1' })).toContain('>Сохранить<')
    expect(render({ pb_recompute_cron: '0 9,22 * * 1' }, { saving: 'pb_recompute_cron' })).toContain('Сохраняем…')
  })
})
