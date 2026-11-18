/**
 * tests/unit/crm/provider-sync.test.ts — what one CRM sync writes (lib/crm/provider-sync.ts), pure:
 * contacts are clients keyed by their CRM id, deals only feed avg_check, existing clients are linked
 * by phone and never overwritten, duplicates by phone are merged (CRM revival 2026-11-18).
 */
import { describe, expect, it } from 'vitest'
import {
  averageCheck,
  contactDraft,
  NAME_PLACEHOLDER,
  planClientWrites,
  summariseDeals,
  type LocalClient,
  type PlanInput,
} from '@/lib/crm/provider-sync'
import type { ProviderContact, ProviderDeal } from '@/lib/crm/sync-types'

const SRC = 'bitrix24:acme.bitrix24.kz'
const contact = (id: string, over: Partial<ProviderContact> = {}): ProviderContact => ({ id, name: `Клиент ${id}`, phones: [], emails: [], ...over })
const deal = (id: string, contactId: string | null, amount: number | null, over: Partial<ProviderDeal> = {}): ProviderDeal => ({ id, contactId, amount, currency: 'KZT', lost: false, ...over })
const local = (id: string, over: Partial<LocalClient> = {}): LocalClient => ({
  id, name: 'Локальный', phone: null, phone_raw: null, email: null, avg_check: null, source: 'manual', external_source: null, external_id: null, ...over,
})

function plan(over: Partial<PlanInput> & Pick<PlanInput, 'drafts'>) {
  return planClientWrites({
    userId: 'u1',
    provider: 'bitrix24',
    externalSource: SRC,
    amounts: new Map(),
    linked: new Map(),
    byPhone: new Map(),
    nowIso: '2026-11-18T10:00:00.000Z',
    ...over,
  })
}

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

describe('summariseDeals → avg_check', () => {
  it('only deals of a loaded contact, not lost, with an amount, in KZT; each other kind is counted', () => {
    const s = summariseDeals([
      deal('1', 'c1', 100_000),
      deal('2', 'c1', 200_001),
      deal('3', null, 50_000),
      deal('4', 'gone', 70_000),
      deal('5', 'c1', 999_999, { lost: true }),
      deal('6', 'c1', null),
      deal('7', 'c1', 5_000, { currency: 'USD' }),
      deal('8', 'c1', 5_000, { currency: null }),
    ], new Set(['c1']))
    expect(s.amounts.get('c1')).toEqual([100_000, 200_001])
    expect(s).toMatchObject({ withoutContact: 1, unknownContact: 1, lost: 1, withoutAmount: 1, otherCurrency: 2 })
    expect(averageCheck(s.amounts.get('c1')!)).toBe(150_001)
  })
  it('no deal that counts → null, never 0', () => {
    expect(averageCheck([])).toBeNull()
  })
})

describe('planClientWrites', () => {
  it('a new contact is an insert keyed by its CRM id; a deal never adds a client', () => {
    const drafts = [contactDraft(contact('1', { phones: ['+77010000001'] }))]
    const p = plan({ drafts, amounts: summariseDeals([deal('d', 'x', 5), deal('e', null, 5)], new Set(['1'])).amounts })
    expect(p.inserts).toEqual([{
      user_id: 'u1', name: 'Клиент 1', phone: '+77010000001', phone_raw: '+77010000001', email: null,
      avg_check: null, source: 'bitrix24', external_source: SRC, external_id: '1',
    }])
    expect(p.updates).toEqual([])
  })

  it('a contact already linked is never inserted again; unchanged data is not written', () => {
    const row = local('r1', { name: 'Клиент 1', phone: '+77010000001', phone_raw: '+77010000001', source: 'bitrix24', external_source: SRC, external_id: '1' })
    const p = plan({ drafts: [contactDraft(contact('1', { phones: ['+77010000001'] }))], linked: new Map([['1', row]]) })
    expect(p.inserts).toEqual([])
    expect(p.updates).toEqual([])
    expect(p.unchanged).toBe(1)
  })

  it('first sync: a manual client with the same phone is linked, its non-empty fields kept, empty ones filled', () => {
    const manual = local('m1', { name: 'Иван (VIP)', phone: '+77011112233', phone_raw: '8 701 111 22 33', email: null, avg_check: 50_000 })
    const p = plan({
      drafts: [contactDraft(contact('7', { name: 'Иван Петров', phones: ['+7 701 111 22 33'], emails: ['ivan@x.kz'] }))],
      amounts: new Map([['7', [100_000, 200_000]]]),
      byPhone: new Map([['+77011112233', manual]]),
    })
    expect(p.inserts).toEqual([])
    expect(p.linkedNow).toBe(1)
    expect(p.updates).toEqual([{
      id: 'm1', user_id: 'u1', name: 'Иван (VIP)', phone: '+77011112233', phone_raw: '8 701 111 22 33', email: 'ivan@x.kz',
      avg_check: 50_000, // the owner's own figure wins on a manual client
      source: 'manual', external_source: SRC, external_id: '7', updated_at: '2026-11-18T10:00:00.000Z',
    }])
  })

  it('a client the CRM brought in follows the CRM avg_check; unknown deals leave it alone; no deal never writes null over a value', () => {
    const row = local('r1', { name: 'Клиент 1', source: 'bitrix24', external_source: SRC, external_id: '1', avg_check: 10 })
    const drafts = [contactDraft(contact('1'))]
    expect(plan({ drafts, linked: new Map([['1', row]]), amounts: new Map([['1', [300]]]) }).updates[0].avg_check).toBe(300)
    expect(plan({ drafts, linked: new Map([['1', row]]), amounts: null }).unchanged).toBe(1)
    expect(plan({ drafts, linked: new Map([['1', row]]), amounts: new Map() }).unchanged).toBe(1)
  })

  it('the placeholder name counts as empty and is filled once the CRM has a name', () => {
    const row = local('r1', { name: NAME_PLACEHOLDER, source: 'bitrix24', external_source: SRC, external_id: '1' })
    const p = plan({ drafts: [contactDraft(contact('1', { name: 'Анна' }))], linked: new Map([['1', row]]) })
    expect(p.updates[0].name).toBe('Анна')
    const nameless = plan({ drafts: [contactDraft(contact('2', { name: null }))] })
    expect(nameless.inserts[0].name).toBe(NAME_PLACEHOLDER)
  })

  it('two contacts with one phone become one client; the deals of both count', () => {
    const drafts = [contactDraft(contact('1', { phones: ['+77010000001'] })), contactDraft(contact('2', { phones: ['8 701 000 00 01'] }))]
    const p = plan({ drafts, amounts: new Map([['1', [100]], ['2', [300]]]) })
    expect(p.inserts).toHaveLength(1)
    expect(p.inserts[0]).toMatchObject({ external_id: '1', avg_check: 200 })
    expect(p.mergedByPhone).toBe(1)
  })

  it('a duplicate-phone contact joins the client of the contact it duplicates, even when that one is phoneless locally', () => {
    const row = local('r1', { name: 'Клиент 1', phone: null, source: 'bitrix24', external_source: SRC, external_id: '1' })
    const drafts = [contactDraft(contact('2', { phones: ['+77010000001'] })), contactDraft(contact('1', { phones: ['+77010000001'] }))]
    const p = plan({ drafts, linked: new Map([['1', row]]) })
    expect(p.inserts).toEqual([])
    expect(p.mergedByPhone).toBe(1)
    expect(p.updates[0]).toMatchObject({ id: 'r1', phone: '+77010000001' })
  })

  it('a phone held by a client linked to another CRM record is not taken: counted, not added', () => {
    const other = local('o1', { phone: '+77010000001', external_source: 'amocrm:acme.amocrm.ru', external_id: '99' })
    const p = plan({ drafts: [contactDraft(contact('1', { phones: ['+77010000001'] }))], byPhone: new Map([['+77010000001', other]]) })
    expect(p.inserts).toEqual([])
    expect(p.updates).toEqual([])
    expect(p.phoneConflicts).toBe(1)
  })

  it('an empty phone of a linked client is filled only when no other client has that phone', () => {
    const row = local('r1', { name: 'Клиент 1', source: 'bitrix24', external_source: SRC, external_id: '1' })
    const holder = local('h1', { phone: '+77010000001' })
    const p = plan({ drafts: [contactDraft(contact('1', { phones: ['+77010000001'] }))], linked: new Map([['1', row]]), byPhone: new Map([['+77010000001', holder]]) })
    expect(p.updates).toEqual([])
    expect(p.unchanged).toBe(1)
  })
})
