/**
 * tests/unit/crm/provider-sync.test.ts — маппинг внешней CRM → clients (Фаза 4B).
 */

import { describe, it, expect } from 'vitest'
import { mapProviderRecords } from '@/lib/crm/provider-sync'
import type { CrmContact, CrmDeal } from '@/lib/crm/types'

const deal = (over: Partial<CrmDeal>): CrmDeal => ({
  id: 'd',
  title: 'Сделка',
  amount: 0,
  currency: 'KZT',
  stage: '',
  createdAt: '',
  updatedAt: '',
  ...over,
})
const contact = (over: Partial<CrmContact>): CrmContact => ({ id: 'c', name: '', createdAt: '', ...over })

describe('mapProviderRecords', () => {
  it('merges a contact with its deals and averages the amounts into avg_check', () => {
    const out = mapProviderRecords(
      'amocrm',
      [contact({ id: '1', name: 'Иван', phone: '+77770000000', email: 'i@x.kz' })],
      [
        deal({ id: 'd1', amount: 100000, contactName: 'Иван', contactPhone: '+77770000000' }),
        deal({ id: 'd2', amount: 200000, contactName: 'Иван', contactPhone: '+77770000000' }),
      ],
    )
    expect(out).toHaveLength(1)
    expect(out[0].avg_check).toBe(150000)
    expect(out[0].email).toBe('i@x.kz')
    expect(out[0].source).toBe('amocrm')
  })

  it('creates a client from a deal that has no matching contact', () => {
    const out = mapProviderRecords('bitrix24', [], [
      deal({ id: 'd', amount: 50000, contactName: 'Пётр', contactPhone: '+77010000000' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Пётр')
    expect(out[0].avg_check).toBe(50000)
  })

  it('dedups phoneless records by name', () => {
    const out = mapProviderRecords(
      'amocrm',
      [contact({ id: '1', name: 'ООО Ромашка' }), contact({ id: '2', name: 'ООО Ромашка' })],
      [],
    )
    expect(out).toHaveLength(1)
  })

  it('skips nameless records and ignores non-positive deal amounts', () => {
    const out = mapProviderRecords(
      'amocrm',
      [contact({ id: '1', name: '   ' })],
      [deal({ id: 'd', amount: 0, contactName: 'Анна', contactPhone: '+77020000000' })],
    )
    // nameless contact dropped; deal with amount 0 still creates the client but no avg_check
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Анна')
    expect(out[0].avg_check).toBeNull()
  })
})
