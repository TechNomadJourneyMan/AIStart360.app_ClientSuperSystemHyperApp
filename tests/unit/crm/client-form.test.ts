/**
 * L6 — the drawer opened from the Card tab must not lose the raw phone, and saving a client whose
 * phone did not normalise must not wipe phone_raw.
 */
import { describe, expect, it } from 'vitest'
import { drawerPatch, phoneFieldValue, seedFromQueueRow, type DrawerForm } from '@/lib/crm/client-form'

const row = {
  id: 'c1', name: 'Иван', phone: null, phoneRaw: '12-34 доб. 5', email: null, status: 'new',
  avgCheck: null, note: null, nextContactAt: null, lastContactAt: null,
}

const formFrom = (phone: string): DrawerForm => ({
  name: 'Иван', phone, email: '', status: 'new', avgCheck: null, nextContactAt: null, note: '',
})

describe('drawer seed and save patch', () => {
  it('a queue / card row seeds the drawer with the raw phone (it used to be phone_raw: null)', () => {
    const seed = seedFromQueueRow(row)
    expect(seed.phone_raw).toBe('12-34 доб. 5')
    expect(phoneFieldValue(seed)).toBe('12-34 доб. 5')
  })

  it('saving without touching the phone sends no phone (nothing to re-normalise or wipe)', () => {
    const seed = seedFromQueueRow(row)
    const patch = drawerPatch(seed, formFrom(phoneFieldValue(seed)))
    expect(patch).not.toHaveProperty('phone')
    expect(patch).toMatchObject({ name: 'Иван', email: null, note: null })
  })

  it('a changed phone is sent; clearing it on purpose is sent as empty', () => {
    const seed = seedFromQueueRow({ ...row, phone: '+77010000001', phoneRaw: '+7 701 000 00 01' })
    expect(drawerPatch(seed, formFrom('8 701 000 00 02')).phone).toBe('8 701 000 00 02')
    expect(drawerPatch(seed, formFrom('')).phone).toBe('')
  })
})
