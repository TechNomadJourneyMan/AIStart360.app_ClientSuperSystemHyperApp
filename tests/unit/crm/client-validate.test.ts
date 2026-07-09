import { describe, it, expect } from 'vitest'
import { validateClient } from '@/lib/crm/client-validate'

describe('validateClient (CRM client body validation)', () => {
  it('requires a non-empty name in full mode', () => {
    expect(validateClient({}).ok).toBe(false)
    expect(validateClient({ name: '   ' }).ok).toBe(false)
  })

  it('trims and caps the name at 120 chars', () => {
    const r = validateClient({ name: '  Иван  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.name).toBe('Иван')
    const long = validateClient({ name: 'x'.repeat(200) })
    expect(long.ok).toBe(false)
  })

  it('defaults status to "new" and rejects unknown statuses', () => {
    const r = validateClient({ name: 'A' })
    if (r.ok) expect(r.value.status).toBe('new')
    expect(validateClient({ name: 'A', status: 'bogus' }).ok).toBe(false)
    const ok = validateClient({ name: 'A', status: 'customer' })
    if (ok.ok) expect(ok.value.status).toBe('customer')
  })

  it('normalizes phone into e164 + raw', () => {
    const r = validateClient({ name: 'A', phone: '8 (727) 300 55 00' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.phone).toBe('+77273005500')
      expect(r.value.phone_raw).toBe('8 (727) 300 55 00')
    }
  })

  it('keeps raw but null e164 for an unparseable phone', () => {
    const r = validateClient({ name: 'A', phone: 'нет' })
    if (r.ok) {
      expect(r.value.phone).toBeNull()
      expect(r.value.phone_raw).toBe('нет')
    }
  })

  it('validates avg_check as a finite number >= 0 or null', () => {
    const ok = validateClient({ name: 'A', avg_check: 15000 })
    if (ok.ok) expect(ok.value.avg_check).toBe(15000)
    expect(validateClient({ name: 'A', avg_check: -5 }).ok).toBe(false)
    expect(validateClient({ name: 'A', avg_check: 'много' }).ok).toBe(false)
    const nul = validateClient({ name: 'A', avg_check: null })
    if (nul.ok) expect(nul.value.avg_check).toBeNull()
  })

  it('rejects non-number/non-string avg_check (no boolean/array coercion)', () => {
    expect(validateClient({ name: 'A', avg_check: true }).ok).toBe(false)
    expect(validateClient({ name: 'A', avg_check: [42] }).ok).toBe(false)
    expect(validateClient({ name: 'A', avg_check: {} }).ok).toBe(false)
  })

  it('rejects a non-string name (no object/number coercion)', () => {
    expect(validateClient({ name: 123 }).ok).toBe(false)
    expect(validateClient({ name: {} }).ok).toBe(false)
  })

  it('caps and trims email/source/note, empty → null', () => {
    const r = validateClient({ name: 'A', email: '  a@b.co ', note: '', source: 'csv' })
    if (r.ok) {
      expect(r.value.email).toBe('a@b.co')
      expect(r.value.note).toBeNull()
      expect(r.value.source).toBe('csv')
    }
  })

  it('accepts an ISO next_contact_at and rejects garbage', () => {
    const r = validateClient({ name: 'A', next_contact_at: '2026-07-10T09:00:00.000Z' })
    if (r.ok) expect(r.value.next_contact_at).toBe('2026-07-10T09:00:00.000Z')
    expect(validateClient({ name: 'A', next_contact_at: 'вчера' }).ok).toBe(false)
    const nul = validateClient({ name: 'A', next_contact_at: null })
    if (nul.ok) expect(nul.value.next_contact_at).toBeNull()
  })

  it('partial mode does not require name and returns only provided keys', () => {
    const r = validateClient({ status: 'lost' }, { partial: true })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.status).toBe('lost')
      expect('name' in r.value).toBe(false)
      expect('status' in r.value).toBe(true)
    }
    // an invalid field still fails in partial mode
    expect(validateClient({ status: 'bogus' }, { partial: true }).ok).toBe(false)
  })

  it('rejects a non-object body', () => {
    expect(validateClient(null).ok).toBe(false)
    expect(validateClient('nope').ok).toBe(false)
  })
})
