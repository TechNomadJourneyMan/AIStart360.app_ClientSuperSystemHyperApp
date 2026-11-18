/**
 * The client drawer's save (lib/crm/client-form.ts): only the fields the owner changed are sent —
 *   L6: a phone that did not normalise is never wiped (the seed carries phone_raw);
 *   review M3: a queue row's note is a cut preview — it is never saved over the full note;
 *   an untouched value is never written back over a newer one (e.g. a check a CRM sync updated).
 */
import { describe, expect, it } from 'vitest'
import { drawerPatch, phoneFieldValue, seedFromQueueRow, type DrawerForm, type DrawerSeed } from '@/lib/crm/client-form'

const row = {
  id: 'c1', name: 'Иван', phone: null, phoneRaw: '12-34 доб. 5', email: null, status: 'new',
  avgCheck: null, note: null, nextContactAt: null, lastContactAt: null,
}

/** The drawer's form exactly as seeded (nothing touched). */
function untouched(seed: DrawerSeed): DrawerForm {
  return {
    name: seed.name, phone: phoneFieldValue(seed), email: seed.email ?? '', status: seed.status,
    avgCheck: seed.avg_check, nextContactAt: seed.next_contact_at, note: seed.note ?? '',
  }
}

describe('drawer seed and save patch', () => {
  it('a queue / card row seeds the drawer with the raw phone (it used to be phone_raw: null)', () => {
    const seed = seedFromQueueRow(row)
    expect(seed.phone_raw).toBe('12-34 доб. 5')
    expect(phoneFieldValue(seed)).toBe('12-34 доб. 5')
  })

  it('saving without changes sends nothing — no phone to re-normalise or wipe, no stale values', () => {
    const seed = seedFromQueueRow({ ...row, avgCheck: 5000, email: 'ivan@ex.kz', note: 'VIP', nextContactAt: '2026-11-19T10:00:30.000Z' })
    expect(drawerPatch(seed, untouched(seed))).toEqual({})
    // the date field has minute precision: the same minute is not a change
    expect(drawerPatch(seed, { ...untouched(seed), nextContactAt: '2026-11-19T10:00:00.000Z' })).toEqual({})
  })

  it('only the changed fields are sent', () => {
    const seed = seedFromQueueRow({ ...row, avgCheck: 5000 })
    expect(drawerPatch(seed, { ...untouched(seed), name: 'Иван Петров', status: 'in_progress' })).toEqual({ name: 'Иван Петров', status: 'in_progress' })
  })

  it('a changed phone is sent; clearing it on purpose is sent as empty', () => {
    const seed = seedFromQueueRow({ ...row, phone: '+77010000001', phoneRaw: '+7 701 000 00 01' })
    expect(drawerPatch(seed, { ...untouched(seed), phone: '8 701 000 00 02' })).toEqual({ phone: '8 701 000 00 02' })
    expect(drawerPatch(seed, { ...untouched(seed), phone: '' })).toEqual({ phone: '' })
  })

  it('a cut note from the queue is never sent, even when the field was edited', () => {
    const seed = seedFromQueueRow({ ...row, note: 'начало длинной заметки…', noteTruncated: true })
    expect(seed.noteTruncated).toBe(true)
    expect(drawerPatch(seed, untouched(seed))).toEqual({})
    expect(drawerPatch(seed, { ...untouched(seed), note: 'начало длинной заметки… и ещё' })).toEqual({})
    // a full note (from the base tab) is sent when changed
    const full = seedFromQueueRow({ ...row, note: 'коротко' })
    expect(drawerPatch(full, { ...untouched(full), note: 'коротко, дополнено' })).toEqual({ note: 'коротко, дополнено' })
  })
})
