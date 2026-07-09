import { describe, it, expect } from 'vitest'
import { parseClientsCsv } from '@/lib/crm/csv-import'

describe('parseClientsCsv (Russian headers, dedup, skip nameless)', () => {
  it('parses Russian headers with a semicolon delimiter', () => {
    const csv = [
      'Имя;Телефон;Email;Комментарий;Сумма',
      'Иван Петров;+7 701 000 00 01;ivan@ex.kz;VIP;150000',
      'ТОО Ромашка;8 (727) 300 55 00;;оптовик;1 200 000',
    ].join('\n')
    const { rows, skipped } = parseClientsCsv(csv)
    expect(skipped).toBe(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: 'Иван Петров',
      phone: '+77010000001',
      email: 'ivan@ex.kz',
      note: 'VIP',
      avg_check: 150000,
    })
    expect(rows[1].phone).toBe('+77273005500')
    expect(rows[1].avg_check).toBe(1200000)
    expect(rows[1].email).toBeNull()
  })

  it('parses English headers with a comma delimiter', () => {
    const csv = 'Name,Phone,Email\nJohn,77010000001,john@ex.com'
    const { rows } = parseClientsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'John', phone: '+77010000001', email: 'john@ex.com' })
  })

  it('skips rows without a name and counts them', () => {
    const csv = 'Имя,Телефон\nАнна,+77010000002\n,+77010000003\n  ,+77010000004'
    const { rows, skipped } = parseClientsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Анна')
    expect(skipped).toBe(2)
  })

  it('dedups within the file by normalized phone (first wins) and counts dupes as skipped', () => {
    const csv = [
      'Имя,Телефон',
      'Первый,+7 701 000 00 05',
      'Дубль,8 701 000 00 05',
    ].join('\n')
    const { rows, skipped } = parseClientsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Первый')
    expect(skipped).toBe(1)
  })

  it('keeps rows without a phone (no dedup key)', () => {
    const csv = 'Имя,Телефон\nБез Телефона,\nТоже Без,'
    const { rows, skipped } = parseClientsCsv(csv)
    expect(rows).toHaveLength(2)
    expect(skipped).toBe(0)
    expect(rows[0].phone).toBeNull()
  })

  it('handles quoted fields containing the delimiter', () => {
    const csv = 'Имя,Комментарий\n"Иванов, Иван","звонить, срочно"'
    const { rows } = parseClientsCsv(csv)
    expect(rows[0].name).toBe('Иванов, Иван')
    expect(rows[0].note).toBe('звонить, срочно')
  })

  it('skips all data rows when no name column is recognized', () => {
    const csv = 'Колонка1,Колонка2\nx,y'
    const { rows, skipped } = parseClientsCsv(csv)
    expect(rows).toHaveLength(0)
    expect(skipped).toBe(1)
  })

  it('returns empty for empty input', () => {
    expect(parseClientsCsv('')).toEqual({ rows: [], skipped: 0 })
  })
})
