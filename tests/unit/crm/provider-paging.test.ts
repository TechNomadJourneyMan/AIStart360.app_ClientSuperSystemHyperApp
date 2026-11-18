/**
 * CRM revival (2026-11-18) — reading Bitrix24 and amoCRM page by page, with a fake fetch that answers
 * like the real APIs (tests/helpers/fake-crm.ts):
 *   H2: Bitrix24 returns 50 records per call; the client follows `next` until the end, a cap, or
 *       the time budget — and says which one stopped it, with the CRM's `total`;
 *   H3: amoCRM refuses `limit` above 250 (the old sync asked for 500); the client asks for ≤ 250 and
 *       follows `_links.next`, an empty list is HTTP 204;
 *   mapping: contacts (name, phones, e-mails), deals (main contact, amount «not filled» = null,
 *   currency, lost), Bitrix24 error codes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as bitrix24 from '@/lib/crm/bitrix24'
import * as amocrm from '@/lib/crm/amocrm'
import { fetchProviderSnapshot } from '@/lib/crm/provider-client'
import { amoContact, amoLead, bxContact, bxDeal, fakeAmo, fakeBitrix, publicDns } from '../../helpers/fake-crm'

const B24 = { domain: 'acme.bitrix24.kz', accessToken: 'x', webhookUrl: 'https://acme.bitrix24.kz/rest/1/abc123/', resolve: publicDns }
const AMO = { domain: 'acme.amocrm.ru', accessToken: 'long-lived-token', resolve: publicDns }
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from)

afterEach(() => vi.unstubAllGlobals())

describe('Bitrix24 paging (H2)', () => {
  it('reads every page of 50 by following `next`, newest first, and reports the total', async () => {
    const crm = fakeBitrix({ contacts: range(120).map((i) => bxContact(i)), deals: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const list = await bitrix24.listContacts(B24, { maxRecords: 2000 })
    expect(list.items).toHaveLength(120)
    expect(list).toMatchObject({ total: 120, complete: true, stoppedBy: null })
    expect(crm.calls.map((c) => c.body?.start)).toEqual([0, 50, 100])
    expect(crm.calls[0].url).toBe('https://acme.bitrix24.kz/rest/1/abc123/crm.contact.list.json')
    expect(crm.calls[0].body).toMatchObject({ order: { ID: 'DESC' }, select: expect.arrayContaining(['ID', 'NAME', 'LAST_NAME', 'PHONE', 'EMAIL']) })
    expect(list.items[0].id).toBe('120')
    expect(new Set(list.items.map((c) => c.id)).size).toBe(120)
  })

  it('stops at the cap and says so: «N of total», not complete', async () => {
    const crm = fakeBitrix({ contacts: range(120).map((i) => bxContact(i)), deals: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const list = await bitrix24.listContacts(B24, { maxRecords: 60 })
    expect(list.items).toHaveLength(60)
    expect(list).toMatchObject({ total: 120, complete: false, stoppedBy: 'cap' })
    expect(crm.calls).toHaveLength(2)
  })

  it('exactly the cap with nothing left is complete', async () => {
    const crm = fakeBitrix({ contacts: range(50).map((i) => bxContact(i)), deals: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const list = await bitrix24.listContacts(B24, { maxRecords: 50 })
    expect(list).toMatchObject({ complete: true, stoppedBy: null })
    expect(list.items).toHaveLength(50)
  })

  it('stops asking for pages once the time budget for reading is spent', async () => {
    let t = 0
    const crm = fakeBitrix({ contacts: range(200).map((i) => bxContact(i)), deals: [] })
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => { t += 1000; return crm.fetchImpl(u, init) })
    const list = await bitrix24.listContacts(B24, { maxRecords: 2000, fetchUntil: 2000, now: () => t })
    expect(list).toMatchObject({ complete: false, stoppedBy: 'time', total: 200 })
    expect(list.items).toHaveLength(100)
  })

  it('a failed later page ends the listing with what was read; a failed first page throws', async () => {
    const later = fakeBitrix({
      contacts: range(120).map((i) => bxContact(i)),
      deals: [],
      fail: (_m, start) => (start === 50 ? new Response(JSON.stringify({ error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' }), { status: 503 }) : null),
    })
    vi.stubGlobal('fetch', later.fetchImpl)
    const list = await bitrix24.listContacts(B24, { maxRecords: 2000 })
    expect(list).toMatchObject({ complete: false, stoppedBy: 'error' })
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
        bxDeal(5, 0 as unknown as number, '100.00', { CONTACT_ID: '0' }),
      ],
    })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const contacts = await bitrix24.listContacts(B24, { maxRecords: 10 })
    expect(contacts.items).toEqual([
      { id: '8', name: null, phones: [], emails: [] },
      { id: '7', name: 'Иван Сергеевич Петров', phones: ['8 (701) 111-22-33', '+77002223344'], emails: ['c7@example.kz'] },
    ])
    const deals = await bitrix24.listDeals(B24, { maxRecords: 10 })
    const byId = Object.fromEntries(deals.items.map((d) => [d.id, d]))
    expect(byId['1']).toEqual({ id: '1', contactId: '7', amount: 150000, currency: 'KZT', lost: false })
    expect(byId['2'].contactId).toBeNull()
    expect(byId['3'].amount).toBeNull() // «0.00» is «not filled», never an amount of 0
    expect(byId['4']).toMatchObject({ currency: 'USD', lost: true })
    expect(byId['5'].contactId).toBeNull()
  })

  it('fetchDeals for the Pulse screens pages too (it used to stop at 50)', async () => {
    const crm = fakeBitrix({ contacts: [], deals: range(80).map((i) => bxDeal(i, i, '1000')) })
    vi.stubGlobal('fetch', crm.fetchImpl)
    expect(await bitrix24.fetchDeals(B24, 100)).toHaveLength(80)
  })
})

describe('amoCRM paging (H3)', () => {
  it('asks for at most 250 per page and follows `_links.next`; the fake refuses more, like amoCRM', async () => {
    const crm = fakeAmo({ contacts: range(260).map((i) => amoContact(i)), leads: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const list = await amocrm.listContacts(AMO, { maxRecords: 2000 })
    expect(list.items).toHaveLength(260)
    expect(list).toMatchObject({ complete: true, total: null, stoppedBy: null })
    const asked = crm.calls.map((c) => new URL(c.url))
    expect(asked.map((u) => u.searchParams.get('limit'))).toEqual(['250', '250'])
    expect(asked.map((u) => u.searchParams.get('page'))).toEqual(['1', '2'])
    expect(asked[0].pathname).toBe('/api/v4/contacts')
    expect(crm.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('an empty list is HTTP 204 without a body: complete and empty, not an error', async () => {
    const crm = fakeAmo({ contacts: [], leads: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    expect(await amocrm.listContacts(AMO, { maxRecords: 2000 })).toMatchObject({ items: [], complete: true })
  })

  it('stops at the cap: «есть ещё» without a total (amoCRM does not report one)', async () => {
    const crm = fakeAmo({ contacts: range(300).map((i) => amoContact(i)), leads: [] })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const list = await amocrm.listContacts(AMO, { maxRecords: 250 })
    expect(list).toMatchObject({ complete: false, stoppedBy: 'cap', total: null })
    expect(list.items).toHaveLength(250)
  })

  it('maps leads: the main contact, price «0» as no amount, status 143 as lost, the account currency', async () => {
    const crm = fakeAmo({
      contacts: [],
      leads: [amoLead(1, [5, 6], 46333), amoLead(2, [], 1000), amoLead(3, [6, 5], 0), amoLead(4, [5], 700, { status_id: 143 })],
      currency: 'RUB',
    })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const currency = await amocrm.fetchAccountCurrency(AMO)
    expect(currency).toBe('RUB')
    const list = await amocrm.listDeals(AMO, { maxRecords: 100, currency })
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
      { id: '2', name: 'Анна', phones: [], emails: [] },
      { id: '1', name: 'Контакт 1', phones: ['+77020000001'], emails: ['a1@example.kz'] },
    ])
  })

  it('a refused token fails at the account call, before any listing', async () => {
    const crm = fakeAmo({ contacts: [], leads: [], fail: () => new Response(JSON.stringify({ title: 'Unauthorized', status: 401 }), { status: 401 }) })
    vi.stubGlobal('fetch', crm.fetchImpl)
    await expect(fetchProviderSnapshot('amocrm', 'acme.amocrm.ru', 'bad', { maxRecords: 10, resolve: publicDns })).rejects.toThrow(/отклонила доступ/)
    expect(crm.calls).toHaveLength(1)
  })

  it('does not follow redirects and refuses a host outside amoCRM', async () => {
    const crm = fakeAmo({ contacts: [], leads: [] })
    vi.stubGlobal('fetch', vi.fn(crm.fetchImpl))
    await amocrm.listContacts(AMO, { maxRecords: 10 })
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]?.redirect).toBe('manual')
    await expect(amocrm.listContacts({ ...AMO, domain: 'evil.example.com' }, { maxRecords: 10 })).rejects.toThrow(/amoCRM/)
  })
})

describe('fetchProviderSnapshot', () => {
  it('Bitrix24: contacts and deals, external source = provider + portal host; failed deals do not stop contacts', async () => {
    const crm = fakeBitrix({
      contacts: range(3).map((i) => bxContact(i)),
      deals: [],
      fail: (m) => (m === 'crm.deal.list' ? new Response('{"error":"ACCESS_DENIED"}', { status: 403 }) : null),
    })
    vi.stubGlobal('fetch', crm.fetchImpl)
    const snap = await fetchProviderSnapshot('bitrix24', 'acme.bitrix24.kz', 'https://acme.bitrix24.kz/rest/1/abc123/', { maxRecords: 100, resolve: publicDns })
    expect(snap.externalSource).toBe('bitrix24:acme.bitrix24.kz')
    expect(snap.contacts.items).toHaveLength(3)
    expect(snap.deals).toBeNull()
    expect(snap.dealsError).toMatch(/отклонила доступ/)
  })
})
