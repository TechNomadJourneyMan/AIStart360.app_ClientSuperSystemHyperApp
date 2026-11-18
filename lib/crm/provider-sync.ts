/**
 * lib/crm/provider-sync.ts — what one CRM sync writes to crm_clients. Pure: no network, no database.
 *
 * Rules (CRM revival 2026-11-18, product owner):
 *   • a client is a CRM CONTACT, identified by (external_source, external_id) — re-running a sync
 *     never adds a second client for the same contact (H1/M5);
 *   • a deal is never a client: a deal without a contact is counted and reported, nothing more;
 *   • avg_check of a client = the arithmetic mean, rounded to whole tenge, of the amounts of its
 *     contact's deals that are not lost, have an amount (> 0) and are in KZT. Amounts in another or
 *     an unknown currency are not converted (the portal shows avg_check in ₸) and are counted
 *     instead. No such deal → null, never 0;
 *   • first sync: a contact whose normalised phone matches an existing client that no CRM record
 *     owns yet is LINKED to it (its external ids are set), not added;
 *   • a non-empty local name / phone / email / note is never overwritten by CRM data; only empty
 *     fields are filled (a name equal to the placeholder «Без имени» counts as empty).
 *     avg_check follows the CRM for clients the CRM brought in (source = the provider) and is only
 *     filled when empty for clients created in the portal (manual / CSV) — the owner's own figure
 *     wins. Unknown deals (they could not be read) leave avg_check as it is;
 *   • two contacts of one CRM with the same phone become one client (the first one keeps the link,
 *     the deals of both count) — the phone is unique per user in crm_clients;
 *   • a contact whose phone belongs to a client linked to another CRM record that this run did not
 *     load (another portal, a contact deleted in the CRM, one past the cap) is not added and counted.
 * Clients are never deleted here; the caller counts the linked ones the CRM no longer has.
 */

import { normalizePhone } from '@/lib/crm/phone'
import type { CrmProvider } from '@/lib/crm/types'
import type { ProviderContact, ProviderDeal } from '@/lib/crm/sync-types'

/** avg_check is shown in tenge everywhere in the portal; other currencies stay out. */
export const CRM_AMOUNT_CURRENCY = 'KZT'
/** Name of a client whose CRM contact has none; a later sync may fill it. */
export const NAME_PLACEHOLDER = 'Без имени'

const NAME_MAX = 120
const EMAIL_MAX = 254
const PHONE_RAW_MAX = 64

export interface ContactDraft {
  externalId: string
  name: string | null
  /** E.164, or null when no phone of the contact could be normalised. */
  phone: string | null
  /** The raw value behind `phone` (else the first raw phone), as the CRM has it. */
  phoneRaw: string | null
  email: string | null
}

const cap = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? '').trim().slice(0, max)
  return t ? t : null
}

export function contactDraft(c: ProviderContact): ContactDraft {
  let phone: string | null = null
  let phoneRaw: string | null = null
  for (const raw of c.phones) {
    const e164 = normalizePhone(raw).e164
    if (e164) {
      phone = e164
      phoneRaw = raw
      break
    }
  }
  if (!phoneRaw && c.phones.length > 0) phoneRaw = c.phones[0]
  return {
    externalId: c.id,
    name: cap(c.name, NAME_MAX),
    phone,
    phoneRaw: cap(phoneRaw, PHONE_RAW_MAX),
    email: cap(c.emails.find((e) => e.includes('@')) ?? null, EMAIL_MAX),
  }
}

export interface DealSummary {
  /** Amounts that count for avg_check, per contact id. */
  amounts: Map<string, number[]>
  /** Deals with no contact at all: they never become clients. */
  withoutContact: number
  /** Deals whose contact is not among the contacts read in this run (deleted, or past the cap). */
  unknownContact: number
  lost: number
  /** No amount (amoCRM / Bitrix24 keep «not filled» as 0). */
  withoutAmount: number
  /** Amount in another (or an unknown) currency than CRM_AMOUNT_CURRENCY. */
  otherCurrency: number
}

export function summariseDeals(deals: readonly ProviderDeal[], contactIds: ReadonlySet<string>): DealSummary {
  const s: DealSummary = { amounts: new Map(), withoutContact: 0, unknownContact: 0, lost: 0, withoutAmount: 0, otherCurrency: 0 }
  for (const d of deals) {
    if (!d.contactId) { s.withoutContact++; continue }
    if (!contactIds.has(d.contactId)) { s.unknownContact++; continue }
    if (d.lost) { s.lost++; continue }
    if (d.amount === null || !Number.isFinite(d.amount) || d.amount <= 0) { s.withoutAmount++; continue }
    if (d.currency !== CRM_AMOUNT_CURRENCY) { s.otherCurrency++; continue }
    const list = s.amounts.get(d.contactId) ?? []
    list.push(d.amount)
    s.amounts.set(d.contactId, list)
  }
  return s
}

/** Mean of `amounts`, rounded to whole tenge; null when there is none. */
export function averageCheck(amounts: readonly number[]): number | null {
  if (amounts.length === 0) return null
  return Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length)
}

/** The columns of crm_clients the sync reads. */
export const LOCAL_CLIENT_COLUMNS = 'id, name, phone, phone_raw, email, avg_check, source, external_source, external_id'

export interface LocalClient {
  id: string
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  avg_check: number | null
  source: string | null
  external_source: string | null
  external_id: string | null
}

/** A row the sync writes: without `id` an insert, with `id` an update of that client. */
export interface ClientRow {
  id?: string
  user_id: string
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  avg_check: number | null
  source: string | null
  external_source: string
  external_id: string
  updated_at?: string
}

export interface PlanInput {
  userId: string
  provider: CrmProvider
  externalSource: string
  /** The contacts read in this run, in CRM order. */
  drafts: readonly ContactDraft[]
  /** Deal amounts per contact id (summariseDeals); null when the deals could not be read. */
  amounts: ReadonlyMap<string, readonly number[]> | null
  /** Clients already linked to a contact of this run: external_id → client (same externalSource). */
  linked: ReadonlyMap<string, LocalClient>
  /** Clients that have one of the contacts' phones: E.164 → client. */
  byPhone: ReadonlyMap<string, LocalClient>
  nowIso: string
}

export interface ClientWritePlan {
  inserts: ClientRow[]
  updates: ClientRow[]
  /** Of `updates`: existing clients linked to their contact by phone in this run. */
  linkedNow: number
  /** Their ids. */
  linkIds: Set<string>
  /** Linked clients whose data needs no change. */
  unchanged: number
  /** Contacts that joined another contact's client because they share its phone. */
  mergedByPhone: number
  /** Contacts not added because their phone belongs to a client linked to another CRM record. */
  phoneConflicts: number
}

interface Group {
  key: string
  row: LocalClient | null
  primary: ContactDraft
  contactIds: string[]
  linkNow: boolean
}

const isEmpty = (v: string | null | undefined): boolean => !v || !v.trim()
const isEmptyName = (v: string | null | undefined): boolean => isEmpty(v) || v!.trim() === NAME_PLACEHOLDER
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export function planClientWrites(input: PlanInput): ClientWritePlan {
  const { userId, provider, externalSource, drafts, amounts, linked, byPhone, nowIso } = input
  const groups = new Map<string, Group>()
  const order: Group[] = []
  // E.164 → the group (or local client, `row:<id>`) that holds it. Local phones first.
  const phoneOwner = new Map<string, string>()
  for (const r of byPhone.values()) if (r.phone) phoneOwner.set(r.phone, `row:${r.id}`)
  for (const r of linked.values()) if (r.phone) phoneOwner.set(r.phone, `row:${r.id}`)
  const claimed = new Set<string>(Array.from(linked.values(), (r) => r.id))
  let mergedByPhone = 0
  let phoneConflicts = 0

  const open = (key: string, row: LocalClient | null, primary: ContactDraft, linkNow: boolean): Group => {
    const g: Group = { key, row, primary, contactIds: [primary.externalId], linkNow }
    groups.set(key, g)
    order.push(g)
    return g
  }

  // 1. Contacts that already have their client. A phoneless client reserves its contact's phone,
  //    so a duplicate contact with that phone joins it instead of taking the phone.
  for (const d of drafts) {
    const row = linked.get(d.externalId)
    if (!row) continue
    const key = `row:${row.id}`
    const g = groups.get(key)
    if (g) { g.contactIds.push(d.externalId); continue }
    open(key, row, d, false)
    if (!row.phone && d.phone && !phoneOwner.has(d.phone)) phoneOwner.set(d.phone, key)
  }

  // 2. The others: join, link by phone, or a new client.
  for (const d of drafts) {
    if (linked.has(d.externalId)) continue
    if (d.phone) {
      const owner = phoneOwner.get(d.phone)
      if (owner) {
        const g = groups.get(owner)
        if (g) { g.contactIds.push(d.externalId); mergedByPhone++; continue }
        const row = byPhone.get(d.phone)
        if (row && row.external_id === null && !claimed.has(row.id)) {
          claimed.add(row.id)
          open(owner, row, d, true)
          continue
        }
        phoneConflicts++
        continue
      }
      const key = `new:${d.externalId}`
      phoneOwner.set(d.phone, key)
      open(key, null, d, false)
      continue
    }
    open(`new:${d.externalId}`, null, d, false)
  }

  const inserts: ClientRow[] = []
  const updates: ClientRow[] = []
  const linkIds = new Set<string>()
  let unchanged = 0

  for (const g of order) {
    // undefined = deals unknown (leave avg_check alone); null = no deal that counts.
    const avg = amounts === null ? undefined : averageCheck(g.contactIds.flatMap((id) => amounts.get(id) ?? []))
    const d = g.primary
    if (!g.row) {
      inserts.push({
        user_id: userId,
        name: d.name ?? NAME_PLACEHOLDER,
        phone: d.phone,
        phone_raw: d.phoneRaw,
        email: d.email,
        avg_check: avg ?? null,
        source: provider,
        external_source: externalSource,
        external_id: d.externalId,
      })
      continue
    }
    const r = g.row
    let phone = r.phone
    let phoneRaw = r.phone_raw
    if (isEmpty(r.phone) && d.phone) {
      const owner = phoneOwner.get(d.phone)
      if (!owner || owner === g.key) {
        phone = d.phone
        phoneOwner.set(d.phone, g.key)
        if (isEmpty(r.phone_raw)) phoneRaw = d.phoneRaw
      }
    } else if (isEmpty(r.phone) && isEmpty(r.phone_raw) && d.phoneRaw) {
      phoneRaw = d.phoneRaw
    }
    const localAvg = num(r.avg_check)
    const nextAvg = avg === undefined ? localAvg : r.source === provider ? (avg ?? localAvg) : (localAvg ?? avg)
    const next: ClientRow = {
      id: r.id,
      user_id: userId,
      name: isEmptyName(r.name) && d.name ? d.name : r.name,
      phone,
      phone_raw: phoneRaw,
      email: isEmpty(r.email) && d.email ? d.email : r.email,
      avg_check: nextAvg,
      source: isEmpty(r.source) ? provider : r.source,
      external_source: r.external_source ?? externalSource,
      external_id: r.external_id ?? d.externalId,
    }
    const same =
      next.name === r.name && next.phone === r.phone && next.phone_raw === r.phone_raw && next.email === r.email &&
      next.avg_check === localAvg && next.source === r.source &&
      next.external_source === r.external_source && next.external_id === r.external_id
    if (same) { unchanged++; continue }
    updates.push({ ...next, updated_at: nowIso })
    if (g.linkNow) linkIds.add(r.id)
  }

  return { inserts, updates, linkedNow: linkIds.size, linkIds, unchanged, mergedByPhone, phoneConflicts }
}
