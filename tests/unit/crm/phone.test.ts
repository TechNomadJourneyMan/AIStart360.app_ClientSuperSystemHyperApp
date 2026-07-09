import { describe, it, expect } from 'vitest'
import { normalizePhone } from '@/lib/crm/phone'

describe('normalizePhone (CRM E.164, KZ/RU-aware)', () => {
  it('normalizes a formatted +7 number, stripping spaces', () => {
    const r = normalizePhone('+7 701 000 00 01')
    expect(r.e164).toBe('+77010000001')
    expect(r.raw).toBe('+7 701 000 00 01')
  })

  it('converts a KZ 8(...)... landline-style number to +7', () => {
    expect(normalizePhone('8(727)300-55-00').e164).toBe('+77273005500')
  })

  it('adds + to a bare 7XXXXXXXXXX number', () => {
    expect(normalizePhone('77010000001').e164).toBe('+77010000001')
  })

  it('passes through an already-valid international number', () => {
    expect(normalizePhone('+380 44 123 45 67').e164).toBe('+380441234567')
  })

  it('returns null e164 for junk', () => {
    expect(normalizePhone('не телефон').e164).toBeNull()
    expect(normalizePhone('abc-123').e164).toBeNull()
  })

  it('returns null e164 for an empty / whitespace string', () => {
    expect(normalizePhone('').e164).toBeNull()
    expect(normalizePhone('   ').e164).toBeNull()
  })

  it('rejects a too-short number (not 11 digits, no +)', () => {
    expect(normalizePhone('727 300').e164).toBeNull()
  })

  it('rejects an international number outside the 11-15 digit range', () => {
    expect(normalizePhone('+1234567890').e164).toBeNull() // 10 digits
    expect(normalizePhone('+1234567890123456').e164).toBeNull() // 16 digits
  })

  it('always echoes back the raw input', () => {
    expect(normalizePhone('8(727)300-55-00').raw).toBe('8(727)300-55-00')
  })
})
