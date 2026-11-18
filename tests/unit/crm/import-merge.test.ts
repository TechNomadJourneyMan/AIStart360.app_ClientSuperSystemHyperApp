/**
 * lib/crm/import-merge.ts — M4: a re-import must not duplicate clients nor wipe their data.
 */
import { describe, expect, it } from 'vitest'
import { parseClientsCsv } from '@/lib/crm/csv-import'
import { anonymousKey, planImport, type ExistingClient } from '@/lib/crm/import-merge'

const rows = (csv: string) => parseClientsCsv(csv).rows

function existing(over: Partial<ExistingClient> & { id: string }): ExistingClient {
  return { name: 'X', phone: null, phone_raw: null, email: null, note: null, avg_check: null, created_at: '2026-01-01T00:00:00Z', ...over }
}

describe('planImport', () => {
  it('matches by the normalised phone and never overwrites a field with an empty cell', () => {
    const base = [existing({ id: 'e1', name: 'Иван', phone: '+77010000001', phone_raw: '+7 701 000 00 01', email: 'ivan@ex.kz', note: 'VIP', avg_check: 150000 })]
    const plan = planImport(rows('Имя,Телефон,Email,Комментарий,Сумма\nИван,8 701 000 00 01,,,'), base)
    expect(plan.inserts).toEqual([])
    // email / note / avg_check stay; only the raw phone text differs → an update that keeps the rest
    expect(plan.updates).toEqual([{ id: 'e1', fields: { name: 'Иван', phone: '+77010000001', phone_raw: '8 701 000 00 01', email: 'ivan@ex.kz', note: 'VIP', avg_check: 150000 } }])
  })

  it('non-empty cells update the matched client (an import updates data)', () => {
    const base = [existing({ id: 'e1', name: 'Иван', phone: '+77010000001', phone_raw: '+77010000001', note: 'старое', avg_check: 1 })]
    const plan = planImport(rows('Имя,Телефон,Комментарий,Сумма\nИван,+77010000001,новое,2000'), base)
    expect(plan.updates[0].fields).toMatchObject({ note: 'новое', avg_check: 2000 })
  })

  it('re-importing the same file changes nothing and creates nothing', () => {
    const base = [
      existing({ id: 'e1', name: 'Иван', phone: '+77010000001', phone_raw: '+77010000001', email: 'ivan@ex.kz' }),
      existing({ id: 'e2', name: 'Без телефона', email: 'nophone@ex.kz', note: 'n' }),
      existing({ id: 'e3', name: 'Аноним' }),
    ]
    const csv = 'Имя,Телефон,Email,Комментарий\nИван,+77010000001,ivan@ex.kz,\nБез телефона,,NoPhone@Ex.kz,n\nАноним,,,'
    const plan = planImport(rows(csv), base)
    expect(plan).toEqual({ inserts: [], updates: [], unchanged: 3, duplicates: 0 })
  })

  it('a row without a phone is matched by e-mail, case-insensitively (it used to be inserted again)', () => {
    const base = [existing({ id: 'e2', name: 'Анна', email: 'Anna@Ex.kz', note: 'заметка' })]
    const plan = planImport(rows('Имя,Email,Сумма\nАнна,anna@ex.kz,500'), base)
    expect(plan.inserts).toEqual([])
    expect(plan.updates).toEqual([{ id: 'e2', fields: { name: 'Анна', phone: null, phone_raw: null, email: 'Anna@Ex.kz', note: 'заметка', avg_check: 500 } }])
  })

  it('e-mail matches fill a missing phone, but two different phones are two contacts', () => {
    const base = [existing({ id: 'e2', name: 'Анна', email: 'anna@ex.kz' }), existing({ id: 'e4', name: 'Пётр', phone: '+77010000009', email: 'office@ex.kz' })]
    const plan = planImport(rows('Имя,Телефон,Email\nАнна,+77010000002,anna@ex.kz\nМария,+77010000003,office@ex.kz'), base)
    expect(plan.updates.map((u) => [u.id, u.fields.phone])).toEqual([['e2', '+77010000002']])
    expect(plan.inserts.map((i) => i.name)).toEqual(['Мария'])
  })

  it('no phone, no e-mail: an identical anonymous client is not created twice; a client with contacts is never its match', () => {
    const base = [existing({ id: 'e3', name: 'Пётр  Иванов' }), existing({ id: 'e5', name: 'Ольга', email: 'olga@ex.kz' })]
    const plan = planImport(rows('Имя,Комментарий\nпётр иванов,звонить утром\nОльга,'), base)
    expect(plan.updates).toEqual([{ id: 'e3', fields: expect.objectContaining({ note: 'звонить утром' }) }])
    expect(plan.inserts.map((i) => i.name)).toEqual(['Ольга']) // has contacts in the base → not the same
    expect(anonymousKey('Пётр  Иванов', null)).toBe(anonymousKey('петр иванов', ''))
  })

  it('inside one file the first row wins; a repeat only fills empty fields and is counted', () => {
    const csv = 'Имя,Телефон,Email,Комментарий\nПервый,+7 701 000 00 05,,первая\nДубль,8 701 000 00 05,dup@ex.kz,вторая'
    const plan = planImport(rows(csv), [])
    expect(plan.inserts).toEqual([{ name: 'Первый', phone: '+77010000005', phone_raw: '+7 701 000 00 05', email: 'dup@ex.kz', note: 'первая', avg_check: null }])
    expect(plan.duplicates).toBe(1)
  })

  it('a raw phone that did not normalise is kept only where there is no normalised one', () => {
    const base = [existing({ id: 'e1', name: 'Иван', phone: '+77010000001', phone_raw: '+77010000001', email: 'ivan@ex.kz' })]
    const plan = planImport(rows('Имя,Телефон,Email\nИван,12-34,ivan@ex.kz'), base)
    expect(plan.updates).toEqual([])
    expect(plan.unchanged).toBe(1)
  })
})
