/**
 * CRM revival — reading Bitrix24 and amoCRM, with a fake fetch that answers like the real APIs
 * (tests/helpers/fake-crm.ts):
 *   H2: Bitrix24 returns 50 records per call; the client reads ascending by ID with the filter
 *       `>ID: <last read>` until the end, the cap, or the time budget, says which one stopped it,
 *       reports the CRM's total and returns the last ID read — a later call continues there (M2);
 *   H3: amoCRM refuses `limit` above 250; the client asks for exactly 250 per page (a fixed page size
 *       keeps the page cursor stable), follows `_links.next`, an empty page is HTTP 204, and returns
 *       the next page to read;
 *   mapping: contacts (name, phones, e-mails), deals (main contact, amount «not filled» = null,
 *   currency, lost), Bitrix24 error codes; identity: amoCRM by account id, Bitrix24 by host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'
import { fetchProviderSnapshot, identifyProvider } from '@/lib/crm/provider-client'
import { amoContact, amoLead, bxContact, bxDeal, fakeAmo, fakeBitrix, publicDns } from '../../helpers/fake-crm'

const B24 = { domain: 'acme.bitrix24.kz', accessToken: 'x', webhookUrl: 'https://acme.bitrix24.kz/rest/1/abc123/', resolve: publicDns }
const AMO = { domain: 'acme.amocrm.ru', accessToken: 'long-lived-token', resolve: publicDns }
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from)

afterEach(() => vi.unstubAllGlobals())

describe('Bitrix24 reading (H2, M2)', () => {
  it('reads every page ascending by ID with the `>ID` filter, and reports the total', async () => {
    const crm = fakeBitrix({ contacts: range(120).map((i) => bxContact(i)), deals: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const list = await bitrix24.listContacts(B24, { maxRecords: 2000 })
    expect(list.items).toHaveLength(120)
    expect(list.positions).toEqual(list.items.map((c) => c.id)) // L3: continue right after each record
    expect(list).toMatchObject({ total: 120, complete: true, stoppedBy: null, position: null })
    expect(crm.calls.map((c) => c.body?.filter)).toEqual([{}, { '>ID': '50' }, { '>ID': '100' }])
    expect(crm.calls.every((c) => c.body?.start === 0 && (c.body?.order as Record<string, string>).ID === 'ASC')).toBe(true)
    expect(crm.calls[0].url).toBe('https://acme.bitrix24.kz/rest/1/abc123/crm.contact.list.json')
    expect(list.items[0].id).toBe('1')
    expect(new Set(list.items.map((c) => c.id)).size).toBe(120)
  })

  it('stops exactly at the cap with the position of the last record returned; the next call continues there', async () => {
    const crm = fakeBitrix({ contacts: range(120).map((i) => bxContact(i)), deals: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const first = await bitrix24.listContacts(B24, { maxRecords: 60 })
    expect(first.items.map((c) => c.id)).toEqual(range(60).map(String))
    expect(first).toMatchObject({ total: 120, complete: false, stoppedBy: 'cap', position: '60' })
    const second = await bitrix24.listContacts(B24, { maxRecords: 60, from: first.position })
    expect(second.items.map((c) => c.id)).toEqual(range(60, 61).map(String))
    expect(second).toMatchObject({ total: 60, complete: true, position: null })
  })

  it('a record added at the start while reading never shifts the pages (no offsets)', async () => {
    const contacts = range(100, 10).map((i) => bxContact(i))
    const crm = fakeBitrix({ contacts, deals: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const first = await bitrix24.listContacts(B24, { maxRecords: 50 })
    contacts.push(bxContact(1)) // a smaller ID appears meanwhile
    const second = await bitrix24.listContacts(B24, { maxRecords: 2000, from: first.position })
    const ids = [...first.items, ...second.items].map((c) => Number(c.id))
    expect(ids).toEqual(range(100, 10))
  })

  it('stops asking for pages once the time budget for reading is spent, and says where it stopped', async () => {
    let t = 0
    const crm = fakeBitrix({ contacts: range(200).map((i) => bxContact(i)), deals: [] })
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => { t += 1000; return crm.fetchImpl(u, init) })
    const list = await bitrix24.listContacts(B24, { maxRecords: 2000, fetchUntil: 2000, now: () => t })
    expect(list).toMatchObject({ complete: false, stoppedBy: 'time', total: 200, position: '100' })
    expect(list.items).toHaveLength(100)
  })

  it('a failed later page ends the listing with what was read (and its position); a failed first page throws', async () => {
    const later = fakeBitrix({
      contacts: range(120).map((i) => bxContact(i)),
      deals: [],
      fail: (_m, _s, after) => (after === '50' ? new Response(JSON.stringify({ error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' }), { status: 503 }) : null),
    })
    vi.stubGlobal('fetch', later.fetchImpl)
    const list = await bitrix24.listContacts(B24, { maxRecords: 2000 })
    expect(list).toMatchObject({ complete: false, stoppedBy: 'error', position: '50' })
    expect(list.items).toHaveLength(50)
    expect(list.error).toMatch(/ограничил частоту/)

    const first = fakeBitrix({
      contacts: [],
      deals: [],
      fail: () => new Response(JSON.stringify({ error: 'insufficient_scope', error_description: 'The request requires higher privileges than provided by the webhook token' }), { status: 401 }),
    })
    vi.stubGlobal('fetch', first.fetchImpl)
    await expect(bitrix24.listContacts(B24, { maxRecords: 2000 })).rejects.toThrow(/нет права «CRM \(crm\)»/)
  })

  it('an error sent with HTTP 200 is an error', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'expired_token', error_description: 'The access token provided has expired.' }), { status: 200 }))
    await expect(bitrix24.listDeals(B24, { maxRecords: 10 })).rejects.toThrow(/отклонила доступ/)
  })

  it('maps contacts and deals the way crm.contact.list / crm.deal.list send them', async () => {
    const crm = fakeBitrix({
      contacts: [bxContact(7, { NAME: 'Иван', SECOND_NAME: 'Сергеевич', LAST_NAME: 'Петров', PHONE: [{ ID: '1', VALUE_TYPE: 'MOBILE', VALUE: '8 (701) 111-22-33', TYPE_ID: 'PHONE' }, { ID: '2', VALUE_TYPE: 'WORK', VALUE: '+77002223344', TYPE_ID: 'PHONE' }] }),
        bxContact(8, { NAME: '', LAST_NAME: '', PHONE: [], EMAIL: [] })],
      deals: [
        bxDeal(1, 7, '150000.00'),
        bxDeal(2, null, '99000.00'),
        bxDeal(3, 7, '0.00'),
        bxDeal(4, 7, '5000.00', { CURRENCY_ID: 'USD', STAGE_SEMANTIC_ID: 'F' }),
        bxDeal(5, 7, '100.00', { CONTACT_ID: '0' }),
      ],
    })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const contacts = await bitrix24.listContacts(B24, { maxRecords: 10 })
    expect(contacts.items).toEqual([
      { id: '7', name: 'Иван Сергеевич Петров', phones: ['8 (701) 111-22-33', '+77002223344'], emails: ['c7@example.kz'] },
      { id: '8', name: null, phones: [], emails: [] },
    ])
    const deals = await bitrix24.listDeals(B24, { maxRecords: 10 })
    const byId = Object.fromEntries(deals.items.map((d) => [d.id, d]))
    expect(byId['1']).toEqual({ id: '1', contactId: '7', amount: 150000, currency: 'KZT', lost: false })
    expect(byId['2'].contactId).toBeNull()
    expect(byId['3'].amount).toBeNull() // «0.00» is «not filled», never an amount of 0
    expect(byId['4']).toMatchObject({ currency: 'USD', lost: true })
    expect(byId['5'].contactId).toBeNull()
  })
})

describe('amoCRM reading (H3, M2)', () => {
  it('asks for exactly 250 per page ascending by id and follows `_links.next`; the fake refuses more, like amoCRM', async () => {
    const crm = fakeAmo({ contacts: range(260).map((i) => amoContact(i)), leads: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const list = await amocrm.listContacts(AMO, { maxRecords: 2000 })
    expect(list.items).toHaveLength(260)
    expect(list).toMatchObject({ complete: true, total: null, stoppedBy: null, position: null })
    const asked = crm.calls.map((c) => new URL(c.url))
    expect(asked.map((u) => u.searchParams.get('limit'))).toEqual(['250', '250'])
    expect(asked.map((u) => u.searchParams.get('page'))).toEqual(['1', '2'])
    expect(asked[0].searchParams.get('order[id]')).toBe('asc')
    expect(list.items[0].id).toBe('1')
    expect(crm.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('an empty list is HTTP 204 without a body: complete and empty, not an error', async () => {
    const crm = fakeAmo({ contacts: [], leads: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    expect(await amocrm.listContacts(AMO, { maxRecords: 2000 })).toMatchObject({ items: [], complete: true, position: null })
  })

  it('stops at the cap on a page boundary and returns the next page; continuing from it reads the rest', async () => {
    const crm = fakeAmo({ contacts: range(600).map((i) => amoContact(i)), leads: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const first = await amocrm.listContacts(AMO, { maxRecords: 250 })
    expect(first).toMatchObject({ complete: false, stoppedBy: 'cap', total: null, position: '2:250' })
    // L3: where to continue right after each record (a run whose writes stopped part-way).
    expect([first.positions[0], first.positions[99], first.positions[249]]).toEqual(['2:1', '2:100', '2:250'])
    expect(first.items).toHaveLength(250)
    const rest = await amocrm.listContacts(AMO, { maxRecords: 2000, from: first.position })
    expect(rest).toMatchObject({ complete: true, position: null })
    expect([...first.items, ...rest.items].map((c) => Number(c.id))).toEqual(range(600))
    expect(crm.calls.every((c) => new URL(c.url).searchParams.get('limit') === '250')).toBe(true)
  })

  // Wave 3, M2: amoCRM pages by offset, so a record deleted below the stored place shifts every later
  // one back. The position is `<next page>:<last id read>`; a resume reads one page earlier and
  // continues after that id once a page shows an id already read (proof that nothing was skipped),
  // stepping back further while it does not.
  const ids = (l: { items: Array<{ id: string }> }) => l.items.map((c) => Number(c.id))
  const pages = (crm: ReturnType<typeof fakeAmo>) => crm.calls.filter((c) => c.url.includes('/contacts')).map((c) => Number(new URL(c.url).searchParams.get('page')))

  it('M2 (wave 3): records deleted below the place between runs never make the next run skip any', async () => {
    const state = { contacts: range(600).map((i) => amoContact(i)), leads: [] }
    const crm = fakeAmo(state)
    vi.stubGlobal('fetch', crm.fetchImpl)
    const first = await amocrm.listContacts(AMO, { maxRecords: 250 })
    expect(first).toMatchObject({ complete: false, stoppedBy: 'cap', position: '2:250' })
    state.contacts = state.contacts.filter((c) => Number(c.id) < 5 || Number(c.id) > 14) // 10 deleted below the place
    crm.calls.length = 0
    const rest = await amocrm.listContacts(AMO, { maxRecords: 2000, from: first.position })
    expect(ids(rest)).toEqual(range(350, 251))
    expect(rest).toMatchObject({ complete: true, position: null })
    expect(pages(crm)).toEqual([1, 2, 3])
  })

  it('M2: more than a page deleted below the place — it steps back until an id already read proves the place', async () => {
    const state = { contacts: range(600).map((i) => amoContact(i)), leads: [] }
    const crm = fakeAmo(state)
    vi.stubGlobal('fetch', crm.fetchImpl)
    const first = await amocrm.listContacts(AMO, { maxRecords: 500 })
    expect(first.position).toBe('3:500')
    state.contacts = state.contacts.filter((c) => Number(c.id) > 300) // 300 deleted: page 2 now starts after 500
    crm.calls.length = 0
    const rest = await amocrm.listContacts(AMO, { maxRecords: 2000, from: first.position })
    expect(ids(rest)).toEqual(range(100, 501))
    expect(pages(crm)).toEqual([2, 1]) // page 2 is kept, not asked twice
  })

  it('M2: records restored below the place are neither read twice nor make it skip', async () => {
    const state = { contacts: range(600).filter((i) => i < 100 || i > 109).map((i) => amoContact(i)), leads: [] }
    const crm = fakeAmo(state)
    vi.stubGlobal('fetch', crm.fetchImpl)
    const first = await amocrm.listContacts(AMO, { maxRecords: 250 })
    expect(first.position).toBe('2:260')
    state.contacts = range(600).map((i) => amoContact(i))
    const rest = await amocrm.listContacts(AMO, { maxRecords: 2000, from: first.position })
    expect(ids(rest)).toEqual(range(340, 261))
  })

  it('M2: a place inside a page resumes right after its id; a place in the old page-only form starts again from page 1', async () => {
    vi.stubGlobal('fetch', fakeAmo({ contacts: range(600).map((i) => amoContact(i)), leads: [] }).fetchImpl)
    expect(ids(await amocrm.listContacts(AMO, { maxRecords: 2000, from: '2:100' }))).toEqual(range(500, 101))
    expect(ids(await amocrm.listContacts(AMO, { maxRecords: 2000, from: '3' }))).toEqual(range(600))
  })

  it('M2: out of time while finding the place — the place is kept and the next run finds it', async () => {
    const state = { contacts: range(600).map((i) => amoContact(i)), leads: [] }
    vi.stubGlobal('fetch', fakeAmo(state).fetchImpl)
    state.contacts = state.contacts.filter((c) => Number(c.id) > 300)
    let t = 0
    const short = await amocrm.listContacts(AMO, { maxRecords: 2000, from: '3:500', fetchUntil: 1, now: () => t++ })
    expect(short).toMatchObject({ items: [], complete: false, stoppedBy: 'time', position: '2:500' })
    expect(ids(await amocrm.listContacts(AMO, { maxRecords: 2000, from: short.position }))).toEqual(range(100, 501))
  })

  it('maps leads: the main contact, price «0» as no amount, status 143 as lost, the account currency', async () => {
    const crm = fakeAmo({
      contacts: [],
      leads: [amoLead(1, [5, 6], 46333), amoLead(2, [], 1000), amoLead(3, [6, 5], 0), amoLead(4, [5], 700, { status_id: 143 })],
      currency: 'RUB',
    })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const account = await amocrm.fetchAccount(AMO)
    expect(account).toEqual({ id: '28805383', currency: 'RUB' })
    const list = await amocrm.listDeals(AMO, { maxRecords: 100, currency: account.currency })
    const byId = Object.fromEntries(list.items.map((d) => [d.id, d]))
    expect(byId['1']).toEqual({ id: '1', contactId: '5', amount: 46333, currency: 'RUB', lost: false })
    expect(byId['2'].contactId).toBeNull()
    expect(byId['3']).toMatchObject({ contactId: '6', amount: null })
    expect(byId['4'].lost).toBe(true)
    expect(new URL(crm.calls[1].url).searchParams.get('with')).toBe('contacts')
  })

  it('maps contacts: name, PHONE and EMAIL multitext fields; no fields at all is fine', async () => {
    const crm = fakeAmo({ contacts: [amoContact(1), amoContact(2, { name: '', first_name: 'Анна', last_name: '', custom_fields_values: null })], leads: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const list = await amocrm.listContacts(AMO, { maxRecords: 10 })
    expect(list.items).toEqual([
      { id: '1', name: 'Контакт 1', phones: ['+77020000001'], emails: ['a1@example.kz'] },
      { id: '2', name: 'Анна', phones: [], emails: [] },
    ])
  })

  it('does not follow redirects and refuses a host outside amoCRM', async () => {
    const crm = fakeAmo({ contacts: [], leads: [] })
    vi.stubGlobal('fetch', vi.fn(crm.fetchImpl))
    await amocrm.listContacts(AMO, { maxRecords: 10 })
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]?.redirect).toBe('manual')
    await expect(amocrm.listContacts({ ...AMO, domain: 'evil.example.com' }, { maxRecords: 10 })).rejects.toThrow(/amoCRM/)
  })
})

describe('identifyProvider + fetchProviderSnapshot', () => {
  it('amoCRM: the account id is the identity, the host form is its legacy alias; a refused token fails here', async () => {
    vi.stubGlobal('fetch', fakeAmo({ contacts: [], leads: [], accountId: 777 }).fetchImpl)
    const acc = await identifyProvider('amocrm', 'acme.kommo.com', 't', { resolve: publicDns })
    expect(acc).toMatchObject({ externalSource: 'amocrm:777', legacySources: ['amocrm:acme.kommo.com'], currency: 'KZT' })

    const refused = fakeAmo({ contacts: [], leads: [], fail: () => new Response(JSON.stringify({ title: 'Unauthorized', status: 401 }), { status: 401 }) })
    vi.stubGlobal('fetch', refused.fetchImpl)
    await expect(identifyProvider('amocrm', 'acme.amocrm.ru', 'bad', { resolve: publicDns })).rejects.toThrow(/отклонила доступ/)
    expect(refused.calls).toHaveLength(1)
  })

  it('L1 (wave 3): an amoCRM answer without the account id fails — the identity never falls back to the host', async () => {
    const noId = fakeAmo({
      contacts: [], leads: [],
      fail: (entity) => (entity === 'account' ? new Response(JSON.stringify({ name: 'Acme', currency: 'KZT' }), { status: 200 }) : null),
    })
    vi.stubGlobal('fetch', noId.fetchImpl)
    await expect(identifyProvider('amocrm', 'acme.amocrm.ru', 't', { resolve: publicDns })).rejects.toThrow(/номер аккаунта/)
  })

  it('Bitrix24: identity = provider + portal host; failed deals do not stop the contacts; positions are used', async () => {
    const crm = fakeBitrix({
      contacts: range(3).map((i) => bxContact(i)),
      deals: [],
      fail: (m) => (m === 'crm.deal.list' ? new Response('{"error":"ACCESS_DENIED"}', { status: 403 }) : null),
    })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const acc = await identifyProvider('bitrix24', 'acme.bitrix24.kz', 'https://acme.bitrix24.kz/rest/1/abc123/', { resolve: publicDns })
    expect(acc).toMatchObject({ externalSource: 'bitrix24:acme.bitrix24.kz', legacySources: [] })
    const snap = await fetchProviderSnapshot(acc, 'https://acme.bitrix24.kz/rest/1/abc123/', { maxRecords: 100, resolve: publicDns, contactsFrom: '1', dealsFrom: null })
    expect(snap.contacts.items.map((c) => c.id)).toEqual(['2', '3'])
    expect(snap.deals).toBeNull()
    expect(snap.dealsError).toMatch(/отклонила доступ/)
  })
})
