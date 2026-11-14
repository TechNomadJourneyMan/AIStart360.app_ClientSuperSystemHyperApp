/**
 * I2 (R-042 follow-up) — the data-quality check of a patient base reads the
 * file exactly as the RFM analysis does (lib/tabular-parse.ts): day-first
 * dates, Excel date cells as dates, locale numbers, Cyrillic CSV in UTF-8 or
 * Windows-1251; a missing visit-count column is a warning, not «ok» silence
 * and not an unusable file.
 */
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseFileBuffer, validatePatientBase } from '@/lib/data-quality'
import { decodeTextFile } from '@/lib/tabular-parse'

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Клиенты')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Windows-1251 bytes of a string (Cyrillic + ASCII only). */
function cp1251(text: string): Buffer {
  const out: number[] = []
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c < 0x80) out.push(c)
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0)
    else if (c === 0x401) out.push(0xa8)
    else if (c === 0x451) out.push(0xb8)
    else throw new Error(`no cp1251 byte for ${ch}`)
  }
  return Buffer.from(out)
}

const HEAD = ['Имя', 'Телефон', 'Последний визит', 'Количество посещений', 'Потратил, ₸']
const rows = (n: number, visit: unknown = '03.04.2026', sum: unknown = '45 000,50') =>
  Array.from({ length: n }, (_, i) => [`Пациент ${i}`, `+7 701 000 ${String(1000 + i)}`, visit, 2, sum])

describe('data quality reads the file like the RFM analysis', () => {
  it('ДД.ММ.ГГГГ and «45 000,50 ₸» are valid, not «некорректный формат»', () => {
    const r = validatePatientBase(xlsx([HEAD, ...rows(60)]), 'base.xlsx')
    expect(r.ok).toBe(true)
    expect(r.issues.find((i) => i.field === 'last_visit' && /формат/.test(i.message))).toBeUndefined()
    expect(r.issues.find((i) => i.field === 'total_sum' && /нечитаем/.test(i.message))).toBeUndefined()
  })

  it('a real Excel date cell stays a date (not the US «4/3/26» text)', () => {
    const p = parseFileBuffer(xlsx([HEAD, ['А', '+77010001000', new Date(Date.UTC(2026, 3, 3)), 1, 1000]]), 'base.xlsx')
    const v = p.rows[0]['Последний визит']
    expect(v).toBeInstanceOf(Date)
    expect((v as Date).toISOString().slice(0, 10)).toBe('2026-04-03')
  })

  it('a Windows-1251 CSV keeps its Cyrillic headers; UTF-8 with BOM too', () => {
    // «₸» has no Windows-1251 byte — such exports write «тг».
    const head = ['Имя', 'Телефон', 'Последний визит', 'Количество посещений', 'Потратил, тг']
    const text = [head.join(';'), 'Иван;+77010001000;03.04.2026;2;45000'].join('\n')
    for (const bytes of [cp1251(text), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf-8')]), Buffer.from(text, 'utf-8')]) {
      expect(decodeTextFile(bytes)).toBe(text)
      const p = parseFileBuffer(bytes, 'base.csv')
      expect(p.error).toBeNull()
      expect(p.headers).toEqual(head)
      expect(p.rows[0]['Имя']).toBe('Иван')
    }
  })

  it('no visit-count column → a «частота неизвестна» warning (high), the file stays usable', () => {
    const head = ['Имя', 'Телефон', 'Последний визит', 'Потратил, ₸']
    const r = validatePatientBase(xlsx([head, ...rows(60).map((x) => [x[0], x[1], x[2], x[4]])]), 'base.xlsx')
    const w = r.issues.filter((i) => i.field === 'visits_count')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ severity: 'high' })
    expect(w[0].message).toMatch(/частота визитов неизвестна/)
    expect(r.ok).toBe(true)
  })

  it('«Визитов всего» is the visit count, never the spend column', () => {
    const head = ['Имя', 'Телефон', 'Последний визит', 'Визитов всего', 'Сумма']
    const r = validatePatientBase(xlsx([head, ...rows(60)]), 'base.xlsx')
    expect(r.detectedColumns.visits_count).toBe('Визитов всего')
    expect(r.detectedColumns.total_sum).toBe('Сумма')
  })
})
