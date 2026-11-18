/**
 * tests/unit/crm/provider-sync.test.ts — what one CRM sync run plans (lib/crm/provider-sync.ts),
 * pure: contacts are clients keyed by their CRM id, deals only qualify for avg_check, existing
 * clients are linked by phone, a phone another client holds is never proposed (M1), duplicates by
 * phone merge, a phone held by a client of another CRM record is a conflict to re-check (M5).
 * Filling only empty fields is decided by the database (crm_sync_update_clients) and tested there.
 */
import { describe, expect, it } from 'vitest'
import { classifyDeals, contactDraft, planClientWrites, type LocalClient, type PlanInput } from '@/lib/crm/provider-sync'
import type { ProviderContact, ProviderDeal } from '@/lib/crm/sync-types'

const SRC = 'bitrix24:acme.bitrix24.kz'
const contact = (id: string, over: Partial<ProviderContact> = {}): ProviderContact => ({ id, name: `Клиент ${id}`, phones: [], emails: [], ...over })
const deal = (id: string, contactId: string | null, amount: number | null, over: Partial<ProviderDeal> = {}): ProviderDeal => ({ id, contactId, amount, currency: 'KZT', lost: false, ...over })
const local = (id: string, over: Partial<LocalClient> = {}): LocalClient => ({
  id, name: 'Локальный', phone: null, phone_raw: null, email: null, source: 'manual', external_source: null, external_id: null, ...over,
})

const plan = (over: Partial<PlanInput> & Pick<PlanInput, 'drafts'>) =>
  planClientWrites({ externalSource: SRC, linked: new Map(), byPhone: new Map(), ...over })

describe('contactDraft', () => {
  it('takes the first phone that normalises to E.164 and keeps its raw form', () => {
    expect(contactDraft(contact('1', { phones: ['доб. 12', '8 (701) 111-22-33'], emails: ['нет', 'A@x.kz'] }))).toEqual({
      externalId: '1', name: 'Клиент 1', phone: '+77011112233', phoneRaw: '8 (701) 111-22-33', email: 'A@x.kz',
    })
  })
  it('no usable phone: phone null, the first raw value kept', () => {
    expect(contactDraft(contact('2', { phones: ['12-34'] }))).toMatchObject({ phone: null, phoneRaw: '12-34' })
  })
})

describe('classifyDeals', () => {
  it('qualifying = has a contact, not lost (open or won), an amount, in KZT; each other kind is counted', () => {
    const s = classifyDeals([
      deal('1', 'c1', 100_000),
      deal('2', 'c1', 200_001),
      deal('3', null, 50_000),
      deal('5', 'c1', 999_999, { lost: true }),
      deal('6', 'c1', null),
      deal('7', 'c1', 5_000, { currency: 'USD' }),
      deal('8', 'c1', 5_000, { currency: null }),
    ])
    expect(s.qualifying).toEqual([
      { deal_id: '1', contact_id: 'c1', amount: 100_000 },
      { deal_id: '2', contact_id: 'c1', amount: 200_001 },
    ])
    expect(s).toMatchObject({ withoutContact: 1, lost: 1, withoutAmount: 1, otherCurrency: 2 })
  })
})

describe('planClientWrites', () => {
  it('a new contact is an insert keyed by its CRM id', () => {
    const p = plan({ drafts: [contactDraft(contact('1', { phones: ['+77010000001'] }))] })
    expect(p.inserts).toEqual([{ external_id: '1', name: 'Клиент 1', phone: '+77010000001', phone_raw: '+77010000001', email: null }])
    expect(p.updates).toEqual([])
  })

  it('a contact already linked is never inserted again: it is an update of its client (seen, empty fields)', () => {
    const row = local('r1', { name: 'Клиент 1', phone: '+77010000001', source: 'bitrix24', external_source: SRC, external_id: '1' })
    const p = plan({ drafts: [contactDraft(contact('1', { phones: ['+77010000001'] }))], linked: new Map([['1', row]]) })
    expect(p.inserts).toEqual([])
    expect(p.updates).toEqual([{ id: 'r1', external_id: '1', name: 'Клиент 1', phone: '+77010000001', phone_raw: '+77010000001', email: null, link: false }])
  })

  it('first sync: a manual client with the same phone is linked (link = true), not added', () => {
    const manual = local('m1', { name: 'Иван (VIP)', phone: '+77011112233' })
    const p = plan({
      drafts: [contactDraft(contact('7', { name: 'Иван Петров', phones: ['+7 701 111 22 33'], emails: ['ivan@x.kz'] }))],
      byPhone: new Map([['+77011112233', manual]]),
    })
    expect(p.inserts).toEqual([])
    expect(p.updates).toEqual([{ id: 'm1', external_id: '7', name: 'Иван Петров', phone: '+77011112233', phone_raw: '+7 701 111 22 33', email: 'ivan@x.kz', link: true }])
  })

  it('M1: a linked client without a phone is never offered a phone another client holds (the sync loads holders of every phone)', () => {
    const row = local('r1', { name: 'Клиент 1', source: 'bitrix24', external_source: SRC, external_id: '1' })
    const holder = local('h1', { phone: '+77010000001' })
    const p = plan({ drafts: [contactDraft(contact('1', { phones: ['8 701 000 00 01'] }))], linked: new Map([['1', row]]), byPhone: new Map([['+77010000001', holder]]) })
    expect(p.updates).toEqual([{ id: 'r1', external_id: '1', name: 'Клиент 1', phone: null, phone_raw: null, email: null, link: false }])
  })

  it('M1: the same client gets the phone when nobody holds it', () => {
    const row = local('r1', { name: 'Клиент 1', source: 'bitrix24', external_source: SRC, external_id: '1' })
    const p = plan({ drafts: [contactDraft(contact('1', { phones: ['8 701 000 00 01'] }))], linked: new Map([['1', row]]) })
    expect(p.updates[0]).toMatchObject({ phone: '+77010000001', phone_raw: '8 701 000 00 01' })
  })

  it('two contacts with one phone become one client', () => {
    const drafts = [contactDraft(contact('1', { phones: ['+77010000001'] })), contactDraft(contact('2', { phones: ['8 701 000 00 01'] }))]
    const p = plan({ drafts })
    expect(p.inserts.map((r) => r.external_id)).toEqual(['1'])
    expect(p.mergedByPhone).toBe(1)
  })

  it('a duplicate-phone contact joins the client of the contact it duplicates, even when that one is phoneless locally', () => {
    const row = local('r1', { name: 'Клиент 1', phone: null, source: 'bitrix24', external_source: SRC, external_id: '1' })
    const drafts = [contactDraft(contact('2', { phones: ['+77010000001'] })), contactDraft(contact('1', { phones: ['+77010000001'] }))]
    const p = plan({ drafts, linked: new Map([['1', row]]) })
    expect(p.inserts).toEqual([])
    expect(p.mergedByPhone).toBe(1)
    expect(p.updates).toEqual([expect.objectContaining({ id: 'r1', phone: '+77010000001' })])
  })

  it('M5: a phone held by a client linked to another CRM record is not taken — it is a conflict to re-check after the pass', () => {
    const other = local('o1', { phone: '+77010000001', external_source: SRC, external_id: '99' })
    const p = plan({ drafts: [contactDraft(contact('1', { phones: ['+77010000001'] }))], byPhone: new Map([['+77010000001', other]]) })
    expect(p.inserts).toEqual([])
    expect(p.updates).toEqual([])
    expect(p.conflicts).toEqual([{ phone: '+77010000001', contact: '1' }])
  })
})
