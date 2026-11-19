/**
 * The client drawer's save (lib/crm/client-form.ts): only the fields the owner changed are sent —
 *   L6: a phone that did not normalise is never wiped (the seed carries phone_raw);
 *   review M3: a queue row's note is a cut preview — it is never saved over the full note;
 *   an untouched value is never written back over a newer one (e.g. a check a CRM sync updated).
 */
import { describe, expect, it } from 'vitest'
import {
  baselineAfterSave, drawerPatch, phoneFieldValue, seedFromClientRow, seedFromQueueRow, type ClientRowLike, type DrawerForm, type DrawerSeed,
} from '@/lib/crm/client-form'

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

// Review (high): the drawer stays open after «Сохранить», but its baseline was the snapshot taken
// when it opened — so changing a field back (Новый → Клиент, save; Клиент → Новый, save) was
// «Нет изменений» and the server kept «Клиент». After a save the baseline is what the server holds.
describe('two saves in a row from the same open drawer', () => {
  /** What PATCH /api/v1/crm/clients/[id] answers: the stored row after the patch. */
  const stored = (seed: DrawerSeed, patch: Record<string, unknown>): ClientRowLike => {
    const out: ClientRowLike = { ...seed, avg_check: seed.avg_check }
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'phone') {
        const raw = String(v ?? '').trim()
        const digits = raw.replace(/\D/g, '')
        out.phone_raw = raw || null
        out.phone = digits.length === 11 ? `+7${digits.slice(1)}` : null
      } else (out as unknown as Record<string, unknown>)[k] = v
    }
    return out
  }

  /** The drawer: open with `seed`, edit, save, edit, save — what each save sends. */
  function twoSaves(seed: DrawerSeed, first: Partial<DrawerForm>, second: Partial<DrawerForm>) {
    let baseline = seed
    const form1 = { ...untouched(baseline), ...first }
    const p1 = drawerPatch(baseline, form1)
    baseline = baselineAfterSave(baseline, stored(baseline, p1 as Record<string, unknown>))
    const form2 = { ...form1, ...second } // the drawer stays open: the form keeps what the owner typed
    return { p1, p2: drawerPatch(baseline, form2) }
  }

  const ivan = seedFromQueueRow({
    ...row, phone: '+77010000001', phoneRaw: '+7 701 000 00 01', email: 'ivan@ex.kz', nextContactAt: '2026-11-20T10:00:00.000Z',
  })

  it('status: Новый → Клиент, save; Клиент → Новый, save — the second save sends the status back', () => {
    const { p1, p2 } = twoSaves(ivan, { status: 'customer' }, { status: 'new' })
    expect(p1).toEqual({ status: 'customer' })
    expect(p2).toEqual({ status: 'new' })
  })

  it('phone, e-mail, next contact and check changed and changed back are each sent again', () => {
    expect(twoSaves(ivan, { phone: '8 701 000 00 02' }, { phone: '+7 701 000 00 01' }).p2).toEqual({ phone: '+7 701 000 00 01' })
    expect(twoSaves(ivan, { email: 'new@ex.kz' }, { email: 'ivan@ex.kz' }).p2).toEqual({ email: 'ivan@ex.kz' })
    expect(twoSaves(ivan, { nextContactAt: null }, { nextContactAt: '2026-11-20T10:00:00.000Z' }).p2)
      .toEqual({ next_contact_at: '2026-11-20T10:00:00.000Z' })
    expect(twoSaves(ivan, { avgCheck: 5000 }, { avgCheck: null }).p2).toEqual({ avg_check: null })
  })

  it('after a save the untouched fields are still not re-sent', () => {
    expect(twoSaves(ivan, { status: 'customer' }, {}).p2).toEqual({})
  })

  it("the baseline is the server row: a queue row's cut note becomes the stored full note (nothing to send back)", () => {
    const cut = seedFromQueueRow({ ...row, note: 'начало…', noteTruncated: true })
    const after = baselineAfterSave(cut, { ...stored(cut, { status: 'customer' }), note: 'начало длинной заметки целиком' })
    expect(after).toMatchObject({ status: 'customer', note: 'начало длинной заметки целиком', noteTruncated: false })
    expect(drawerPatch(after, untouched(after))).toEqual({})
  })

  it('a NUMERIC check that comes back as a string is a number; a row of another client is not a baseline', () => {
    expect(seedFromClientRow({ ...stored(ivan, {}), avg_check: '2500' }).avg_check).toBe(2500)
    expect(baselineAfterSave(ivan, { ...stored(ivan, { status: 'lost' }), id: 'other' })).toBe(ivan)
    expect(baselineAfterSave(ivan, null)).toBe(ivan)
  })
})
