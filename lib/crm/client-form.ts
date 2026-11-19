/**
 * lib/crm/client-form.ts — the client drawer's seed and save patch (pure, shared by the «Сегодня»
 * queue, the Card tab and the Base tab).
 *
 * L6: the drawer opened from the Card tab used to be seeded without phone_raw, so a phone that did
 * not normalise to E.164 showed as an empty field, and «Сохранить» sent phone: '' — wiping
 * phone_raw. The seed now carries the raw phone, and the phone is sent only when the owner changed
 * it.
 */
import type { ClientStatus } from './client-validate'

/** The minimal client the drawer needs. */
export interface DrawerSeed {
  id: string
  name: string
  phone: string | null
  phone_raw?: string | null
  email: string | null
  status: ClientStatus
  avg_check: number | null
  note: string | null
  /** The note is a preview cut by GET /api/v1/crm/today — the drawer must not save it back. */
  noteTruncated?: boolean
  next_contact_at: string | null
  last_contact_at: string | null
}

/** A row of GET /api/v1/crm/today (todayClients / riskClients). */
export interface QueueRowLike {
  id: string
  name: string
  phone: string | null
  phoneRaw?: string | null
  email: string | null
  status: string
  avgCheck: number | null
  note?: string | null
  noteTruncated?: boolean
  nextContactAt: string | null
  lastContactAt: string | null
}

export function seedFromQueueRow(r: QueueRowLike): DrawerSeed {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? null,
    phone_raw: r.phoneRaw ?? null,
    email: r.email ?? null,
    status: r.status as ClientStatus,
    avg_check: typeof r.avgCheck === 'number' ? r.avgCheck : null,
    note: r.note ?? null,
    noteTruncated: r.noteTruncated === true,
    next_contact_at: r.nextContactAt ?? null,
    last_contact_at: r.lastContactAt ?? null,
  }
}

/** A crm_clients row as GET /api/v1/crm/clients and the PATCH response return it (snake_case). */
export interface ClientRowLike {
  id: string
  name: string
  phone: string | null
  phone_raw?: string | null
  email: string | null
  status: string
  avg_check: number | string | null
  note: string | null
  next_contact_at: string | null
  last_contact_at: string | null
}

/** The drawer seed of a full row (the base tab, the PATCH response): its note is the whole note. */
export function seedFromClientRow(c: ClientRowLike): DrawerSeed {
  const check = c.avg_check == null || c.avg_check === '' ? null : Number(c.avg_check)
  return {
    id: c.id,
    name: c.name,
    phone: c.phone ?? null,
    phone_raw: c.phone_raw ?? null,
    email: c.email ?? null,
    status: c.status as ClientStatus,
    avg_check: check != null && Number.isFinite(check) ? check : null,
    note: c.note ?? null,
    noteTruncated: false,
    next_contact_at: c.next_contact_at ?? null,
    last_contact_at: c.last_contact_at ?? null,
  }
}

/**
 * The drawer's baseline after a successful save: what the server now holds — the row the PATCH
 * answered with. The drawer stays open after «Сохранить»; with the snapshot it was opened with as
 * the baseline, changing a field back (Новый → Клиент, save; Клиент → Новый, save) looked like «no
 * change» and was never sent. The drawer re-seeds its form from this baseline, so an untouched
 * field still equals it and is still not re-sent. No row (or another client's) keeps `prev`.
 */
export function baselineAfterSave(prev: DrawerSeed, saved: ClientRowLike | null | undefined): DrawerSeed {
  if (!saved || saved.id !== prev.id) return prev
  return seedFromClientRow(saved)
}

/** What the drawer's phone field shows: the phone as the owner typed it, else the normalised one. */
export function phoneFieldValue(seed: DrawerSeed): string {
  return seed.phone_raw ?? seed.phone ?? ''
}

export interface DrawerForm {
  name: string
  phone: string
  email: string
  status: ClientStatus
  avgCheck: number | null
  nextContactAt: string | null
  note: string
}

export interface DrawerPatch {
  name?: string
  phone?: string
  email?: string | null
  status?: ClientStatus
  avg_check?: number | null
  next_contact_at?: string | null
  note?: string | null
}

/** Same minute (the drawer's date field has minute precision), or both empty. */
function sameMinute(a: string | null, b: string | null): boolean {
  if (!a || !b) return !a && !b
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b
  return Math.floor(ta / 60_000) === Math.floor(tb / 60_000)
}

/**
 * The PATCH body of «Сохранить»: ONLY the fields the owner changed. Re-sending an untouched value
 * would put back a stale copy over a newer one (a CRM sync updates the check, another tab edits
 * the note), re-normalise a phone that never normalised and wipe phone_raw, or — from a queue row,
 * whose note is a cut preview — save the cut note over the full one. An empty object = no changes.
 */
export function drawerPatch(seed: DrawerSeed, form: DrawerForm): DrawerPatch {
  const patch: DrawerPatch = {}
  const name = form.name.trim()
  if (name !== seed.name.trim()) patch.name = name
  const phone = form.phone.trim()
  if (phone !== phoneFieldValue(seed).trim()) patch.phone = phone
  const email = form.email.trim() || null
  if (email !== ((seed.email ?? '').trim() || null)) patch.email = email
  if (form.status !== seed.status) patch.status = form.status
  if (form.avgCheck !== (seed.avg_check == null ? null : Number(seed.avg_check))) patch.avg_check = form.avgCheck
  if (!sameMinute(form.nextContactAt, seed.next_contact_at)) patch.next_contact_at = form.nextContactAt
  const note = form.note.trim() || null
  if (!seed.noteTruncated && note !== ((seed.note ?? '').trim() || null)) patch.note = note
  return patch
}
