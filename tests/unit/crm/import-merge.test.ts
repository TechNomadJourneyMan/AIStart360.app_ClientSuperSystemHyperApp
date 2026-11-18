/**
 * lib/crm/import-merge.ts — an import only adds: new clients, and EMPTY fields of the clients it
 * recognises; who is «the same client» needs the same name, never a coincidence of contact
 * details alone (review H1, M2).
 */
import { describe, expect, it } from 'vitest'
import { parseClientsCsv } from '@/lib/crm/csv-import'
import { anonymousKey, nameKey, planImport, type ExistingClient } from '@/lib/crm/import-merge'

const rows = (csv: string) => parseClientsCsv(csv).rows

function existing(over: Partial<ExistingClient> & { id: string }): ExistingClient {
  return { name: 'X', phone: null, phone_raw: null, email: null, note: null, avg_check: null, created_at: '2026-01-01T00:00:00Z', ...over }
}

const petr = () => existing({
  id: 'petr', name: 'Пётр Иванов', phone: '+77010000001', phone_raw: '+7 701 000 00 01',
  email: 'info@firm.kz', note: 'звонить утром', avg_check: 100000,
})

describe('planImport — identity (H1)', () => {
  it('a shared mailbox under another name is another person: no rename, no lost note, a new client', () => {
    const plan = planImport(rows('Имя,Email,Сумма,Комментарий\nАнна Смирнова,info@firm.kz,50000,'), [petr()])
    expect(plan.updates).toEqual([]) // Пётр is not renamed, keeps his phone, check and note
    expect(plan.inserts).toEqual([{ name: 'Анна Смирнова', phone: null, phone_raw: null, email: 'info@firm.kz', note: null, avg_check: 50000 }])
  })

  it('a later row\'s check never fills another person\'s empty check', () => {
    const noCheck = existing({ id: 'petr', name: 'Пётр Иванов', email: 'info@firm.kz' })
    const plan = planImport(rows('Имя,Email,Сумма\nАнна Смирнова,info@firm.kz,70000'), [noCheck])
    expect(plan.updates).toEqual([])
    expect(plan.inserts.map((i) => [i.name, i.avg_check])).toEqual([['Анна Смирнова', 70000]])
  })

  it('placeholder e-mails («-», «нет», «n/a») are no e-mail: different people are not merged by them', () => {
    const csv = 'Имя,Email,Сумма\nАнна,-,100\nБорис,нет,200\nВера,n/a,300\nГалина,—,400'
    expect(rows(csv).map((r) => r.email)).toEqual([null, null, null, null])
    const base = [existing({ id: 'e1', name: 'Дмитрий', email: '-' })]
    const plan = planImport(rows(csv), base)
    expect(plan.inserts.map((i) => i.name)).toEqual(['Анна', 'Борис', 'Вера', 'Галина'])
    expect(plan.updates).toEqual([])
  })

  it('the same phone under another name is a conflict: not imported, nothing moved to the other person', () => {
    const plan = planImport(rows('Имя,Телефон,Сумма,Комментарий\nАнна Смирнова,8 701 000 00 01,5000,новая заметка'), [petr()])
    expect(plan).toEqual({ inserts: [], updates: [], unchanged: 0, duplicates: 0, conflicts: 1 })
  })

  it('names compare without case, «ё», punctuation and word order', () => {
    expect(nameKey('Пётр  Иванов')).toBe(nameKey('иванов, петр'))
    const plan = planImport(rows('Имя,Телефон\n"Иванов, Петр",+77010000001'), [petr()])
    expect(plan).toMatchObject({ conflicts: 0, unchanged: 1, inserts: [] })
  })

  it('the same e-mail and name (the base has no phone yet): the same client, its empty fields filled', () => {
    const anna = existing({ id: 'anna', name: 'Анна', email: 'Anna@Ex.kz', note: 'заметка' })
    const plan = planImport(rows('Имя,Телефон,Email,Сумма\nАнна,+77010000002,anna@ex.kz,500'), [anna])
    expect(plan.inserts).toEqual([])
    expect(plan.updates).toEqual([{ id: 'anna', patch: { phone: '+77010000002', phone_raw: '+77010000002', avg_check: 500 } }])
  })

  it('the same e-mail and name but two different phones: two contacts', () => {
    const anna = existing({ id: 'anna', name: 'Анна', phone: '+77010000009', email: 'anna@ex.kz' })
    const plan = planImport(rows('Имя,Телефон,Email\nАнна,+77010000002,anna@ex.kz'), [anna])
    expect(plan.inserts.map((i) => i.phone)).toEqual(['+77010000002'])
    expect(plan.updates).toEqual([])
  })
})

describe('planImport — fill empty fields only (M2: a stale re-import never reverts the portal)', () => {
  it('a matched client keeps every value the owner entered; only empty fields are filled', () => {
    const ivan = existing({ id: 'ivan', name: 'Иван', phone: '+77010000001', phone_raw: '+7 701 000 00 01', note: 'изменено в портале', avg_check: 2000 })
    const plan = planImport(rows('Имя,Телефон,Email,Комментарий,Сумма\nИван,8 701 000 00 01,ivan@ex.kz,старая заметка,1000'), [ivan])
    expect(plan.updates).toEqual([{ id: 'ivan', patch: { email: 'ivan@ex.kz' } }])
  })

  it('a client renamed in the portal is not renamed back by an old file (the old name is a conflict)', () => {
    const renamed = existing({ id: 'ivan', name: 'Иван Петров', phone: '+77010000001' })
    expect(planImport(rows('Имя,Телефон\nИван,+77010000001'), [renamed])).toMatchObject({ updates: [], inserts: [], conflicts: 1 })
  })

  it('re-importing the same file changes nothing and creates nothing', () => {
    const base = [
      existing({ id: 'e1', name: 'Иван', phone: '+77010000001', phone_raw: '+77010000001', email: 'ivan@ex.kz' }),
      existing({ id: 'e2', name: 'Без телефона', email: 'nophone@ex.kz', note: 'n' }),
      existing({ id: 'e3', name: 'Аноним' }),
    ]
    const csv = 'Имя,Телефон,Email,Комментарий\nИван,+77010000001,ivan@ex.kz,\nБез телефона,,NoPhone@Ex.kz,n\nАноним,,,'
    expect(planImport(rows(csv), base)).toEqual({ inserts: [], updates: [], unchanged: 3, duplicates: 0, conflicts: 0 })
  })
})

describe('planImport — rows without a phone and an e-mail (M2)', () => {
  it('match only a client without contacts, with the same name AND the same note', () => {
    const base = [existing({ id: 'i1', name: 'Иван', note: 'склад' }), existing({ id: 'o1', name: 'Ольга', email: 'olga@ex.kz' })]
    const plan = planImport(rows('Имя,Комментарий,Сумма\nИван,склад,900\nИван,офис,\nОльга,,'), base)
    expect(plan.updates).toEqual([{ id: 'i1', patch: { avg_check: 900 } }])
    // another note → another Иван; Ольга has an e-mail in the base → not this anonymous row
    expect(plan.inserts.map((i) => [i.name, i.note])).toEqual([['Иван', 'офис'], ['Ольга', null]])
    expect(anonymousKey('Иван', null, null)).toBe(anonymousKey('иван', '', ''))
  })

  it('identical name-only rows of one file collapse; the repeat only fills empty fields', () => {
    const plan = planImport(rows('Имя,Комментарий,Сумма\nМария,,\nМария,,700\nМария,другая,'), [])
    expect(plan.inserts).toEqual([
      { name: 'Мария', phone: null, phone_raw: null, email: null, note: null, avg_check: 700 },
      { name: 'Мария', phone: null, phone_raw: null, email: null, note: 'другая', avg_check: null },
    ])
    expect(plan.duplicates).toBe(1)
  })
})

describe('planImport — inside one file', () => {
  it('the first row of a client wins; a repeat (same phone and name) only fills empty fields', () => {
    const csv = 'Имя,Телефон,Email,Комментарий\nПервый,+7 701 000 00 05,,первая\nПервый,8 701 000 00 05,dup@ex.kz,вторая'
    const plan = planImport(rows(csv), [])
    expect(plan.inserts).toEqual([{ name: 'Первый', phone: '+77010000005', phone_raw: '+7 701 000 00 05', email: 'dup@ex.kz', note: 'первая', avg_check: null }])
    expect(plan.duplicates).toBe(1)
  })

  it('a repeat of the phone under another name is a conflict, also inside the file', () => {
    const plan = planImport(rows('Имя,Телефон,Сумма\nПервый,+77010000005,100\nДругой,+77010000005,900'), [])
    expect(plan.inserts.map((i) => [i.name, i.avg_check])).toEqual([['Первый', 100]])
    expect(plan.conflicts).toBe(1)
  })

  it('a raw phone that did not normalise is kept only where there is no phone at all', () => {
    const base = [existing({ id: 'e1', name: 'Иван', phone: '+77010000001', phone_raw: '+77010000001', email: 'ivan@ex.kz' })]
    expect(planImport(rows('Имя,Телефон,Email\nИван,12-34,ivan@ex.kz'), base)).toMatchObject({ updates: [], unchanged: 1 })
  })
})
