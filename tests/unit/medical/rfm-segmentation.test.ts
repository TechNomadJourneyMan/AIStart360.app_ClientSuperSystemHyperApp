/**
 * R-042 (BI-54/55) — RFM parsers and segments: day-first dates, locale
 * numbers, VIP from the base's own quantile, no «all dead leads» without a
 * visit-count column (and a quality warning instead of «ok»).
 */
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseDayFirstDate, parseLocaleNumber, segmentPatients } from '@/lib/rfm-segmentation'

const NOW = new Date('2026-11-13T00:00:00Z')
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Клиенты')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('parseDayFirstDate (R-042, BI-54)', () => {
  it('R-042 golden: «03.04.2026» is 3 April (was 4 March); «03.11.2026» is 3 November', () => {
    expect(iso(parseDayFirstDate('03.04.2026'))).toBe('2026-04-03')
    expect(iso(parseDayFirstDate('03.11.2026'))).toBe('2026-11-03')
    expect(iso(parseDayFirstDate('25.12.2025'))).toBe('2025-12-25')
  })
  it('ISO, slashes, dashes, 2-digit years, time suffix, Excel serial, Date', () => {
    expect(iso(parseDayFirstDate('2026-04-03'))).toBe('2026-04-03')
    expect(iso(parseDayFirstDate('2026-04-03T10:15:00Z'))).toBe('2026-04-03')
    expect(iso(parseDayFirstDate('03/04/2026'))).toBe('2026-04-03')
    expect(iso(parseDayFirstDate('03-04-26'))).toBe('2026-04-03')
    expect(iso(parseDayFirstDate('03.04.2026 14:30'))).toBe('2026-04-03')
    expect(iso(parseDayFirstDate(46115))).toBe('2026-04-03')
    expect(iso(parseDayFirstDate(new Date(Date.UTC(2026, 3, 3))))).toBe('2026-04-03')
  })
  it('impossible or unknown → null', () => {
    expect(parseDayFirstDate('31.02.2026')).toBeNull()
    expect(parseDayFirstDate('13/13/2026')).toBeNull()
    expect(parseDayFirstDate('April 3')).toBeNull()
    expect(parseDayFirstDate('')).toBeNull()
  })
})

describe('parseLocaleNumber (R-042, BI-55)', () => {
  it('R-042 golden: «45 000,50» → 45000.5 (was 4 500 050)', () => {
    expect(parseLocaleNumber('45 000,50')).toBe(45000.5)
    expect(parseLocaleNumber('45 000,50 ₸')).toBe(45000.5)
    expect(parseLocaleNumber('45 000 тг')).toBe(45000)
  })
  it('other formats', () => {
    expect(parseLocaleNumber('45,000.50')).toBe(45000.5)
    expect(parseLocaleNumber('1.234.567,8')).toBe(1234567.8)
    expect(parseLocaleNumber('1 234 567')).toBe(1234567)
    expect(parseLocaleNumber('45,000')).toBe(45000)
    expect(parseLocaleNumber('12,5')).toBe(12.5)
    expect(parseLocaleNumber('0,500')).toBe(0.5)
    expect(parseLocaleNumber("1'500")).toBe(1500)
    expect(parseLocaleNumber('-2 500,5')).toBe(-2500.5)
    expect(parseLocaleNumber(7)).toBe(7)
    expect(parseLocaleNumber('нет')).toBeNull()
    expect(parseLocaleNumber('')).toBeNull()
  })
})

describe('segmentPatients (R-042)', () => {
  it('golden: a visit on 03.11.2026 (10 days ago) is active — «Лояльные активные», not «Спящие»', () => {
    const buf = xlsx([
      ['Имя', 'Телефон', 'Потратил ₸', 'Количество посещений', 'Последний визит'],
      ['Айгуль', '+7 701 123 45 67', '45 000,50', '3', '03.11.2026'],
    ])
    const r = segmentPatients(buf, 'base.xlsx', { now: NOW })!
    expect(r.patients[0]).toMatchObject({ recency_days: 10, monetary_kzt: 45001, frequency: 3, segment: 'loyal_active' })
    expect(r.quality?.status).toBe('warning') // tiny base: VIP threshold is the default, said so
  })

  it('real date cells and number cells of an xlsx are read as typed values (not the US «4/3/26» text)', () => {
    const buf = xlsx([
      ['Имя', 'Телефон', 'Потратил ₸', 'Количество посещений', 'Последний визит'],
      ['А', '+77011234567', 45000.5, 2, new Date(Date.UTC(2026, 10, 3))],
    ])
    const r = segmentPatients(buf, 'base.xlsx', { now: NOW })!
    expect(r.patients[0]).toMatchObject({ recency_days: 10, monetary_kzt: 45001 })
  })

  it('golden: no visit-count column → not everybody is a dead lead; quality is a warning, not ok', () => {
    const rows: unknown[][] = [['Имя', 'Телефон', 'Потратил ₸', 'Последний визит']]
    for (let i = 0; i < 60; i++) rows.push([`П${i}`, `+770100000${String(i).padStart(2, '0')}`, `${(i + 1) * 1000}`, i % 2 ? '01.11.2026' : '01.06.2026'])
    const r = segmentPatients(xlsx(rows), 'base.xlsx', { now: NOW })!
    expect(r.totals.dead_leads).toBe(0)
    expect(r.quality).toMatchObject({ status: 'warning', frequency_known: false })
    expect(r.quality!.warnings.join(' ')).toContain('количеством посещений')
    expect(r.totals.avg_check_kzt).toBe(0) // unknown, not the whole spend as one check
    expect(r.patients.some((p) => p.segment === 'loyal_active')).toBe(true)
  })

  it('VIP cut-off = the base\'s own 98th percentile of spend when the base is large enough', () => {
    const rows: unknown[][] = [['Имя', 'Телефон', 'Потратил ₸', 'Количество посещений', 'Последний визит']]
    for (let i = 1; i <= 100; i++) rows.push([`П${i}`, `+77010000${String(i).padStart(3, '0')}`, i * 1000, 2, '01.11.2026'])
    const r = segmentPatients(xlsx(rows), 'base.xlsx', { now: NOW })!
    expect(r.thresholds).toMatchObject({ vip_ltv_kzt: 98_000, vip_source: 'quantile' })
    expect(r.patients.filter((p) => p.segment === 'vip_retention')).toHaveLength(3)
    expect(r.quality?.status).toBe('ok')
  })

  it('a UTF-8 CSV keeps its Cyrillic headers and day-first dates', () => {
    const csv = '﻿Имя,Телефон,Потратил,Количество посещений,Последний визит\nА,+77011234567,"45 000,50",2,03.11.2026\n'
    const r = segmentPatients(Buffer.from(csv, 'utf8'), 'base.csv', { now: NOW })!
    expect(r).not.toBeNull()
    expect(r.patients[0]).toMatchObject({ recency_days: 10, monetary_kzt: 45001 })
  })

  it('«Визитов всего» is not taken for the spend column', () => {
    const buf = xlsx([
      ['Имя', 'Телефон', 'Визитов всего', 'Потратил ₸', 'Последний визит'],
      ['А', '+77011234567', 4, 12000, '03.11.2026'],
    ])
    const r = segmentPatients(buf, 'base.xlsx', { now: NOW })!
    expect(r.patients[0].monetary_kzt).toBe(12000)
  })
})
