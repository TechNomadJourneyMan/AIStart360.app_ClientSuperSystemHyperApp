/**
 * lib/crm/provider-sync.ts — what one CRM sync run writes to crm_clients. Pure: no network, no database.
 *
 * Rules (CRM revival 2026-11-18, product owner; review wave 2):
 *   • a client is a CRM CONTACT, identified by (external_source, external_id) — re-running a sync
 *     never adds a second client for the same contact (H1/M5);
 *   • a deal is never a client. It counts for avg_check when it has a contact, is not lost (open or
 *     won), has an amount (> 0) and is in KZT (the portal shows avg_check in ₸; other currencies are
 *     not converted). Deals without a contact and in another currency are counted and reported.
 *     avg_check = the mean of the qualifying deals of the client's contact, rounded to whole tenge,
 *     applied once a whole pass of the deals was read (crm_sync_apply_deal_totals, migration 157);
 *   • first sync: a contact whose normalised phone matches an existing client that no CRM record owns
 *     yet is LINKED to it (its external ids are set), not added;
 *   • a non-empty local name / phone / email / note is never overwritten; only empty fields are
 *     filled (a name equal to the placeholder «Без имени» counts as empty). The database decides at
 *     write time (crm_sync_update_clients), so an owner's edit made during the run is never reverted;
 *     a phone is proposed only when no other client of the user has it (M1), and the database
 *     checks that again;
 *   • two contacts of one CRM with the same phone become one client (the first one keeps the link;
 *     avg_check comes from the deals of that contact) — the phone is unique per user;
 *   • a contact whose phone belongs to a client linked to another CRM record is not added; the pair
 *     is returned so that, after a complete pass, the client can be re-linked if its own contact is
 *     gone from the CRM (M5).
 * Clients are never deleted.
 */

import { normalizePhone } from '@/lib/crm/phone'
import type { PhoneConflict } from '@/lib/crm/sync-cursor'
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

export interface QualifyingDeal {
  deal_id: string
  contact_id: string
  amount: number
}

export interface DealClasses {
  /** Deals that count for avg_check (crm_sync_deals rows). */
  qualifying: QualifyingDeal[]
  /** Deals with no contact at all: they never become clients. */
  withoutContact: number
  lost: number
  /** No amount (amoCRM / Bitrix24 keep «not filled» as 0). */
  withoutAmount: number
  /** Amount in another (or an unknown) currency than CRM_AMOUNT_CURRENCY. */
  otherCurrency: number
}

export function classifyDeals(deals: readonly ProviderDeal[]): DealClasses {
  const s: DealClasses = { qualifying: [], withoutContact: 0, lost: 0, withoutAmount: 0, otherCurrency: 0 }
  for (const d of deals) {
    if (!d.contactId) { s.withoutContact++; continue }
    if (d.lost) { s.lost++; continue }
    if (d.amount === null || !Number.isFinite(d.amount) || d.amount <= 0) { s.withoutAmount++; continue }
    if (d.currency !== CRM_AMOUNT_CURRENCY) { s.otherCurrency++; continue }
    s.qualifying.push({ deal_id: d.id, contact_id: d.contactId, amount: d.amount })
  }
  return s
}

/** The columns of crm_clients the sync reads. */
export const LOCAL_CLIENT_COLUMNS = 'id, name, phone, phone_raw, email, source, external_source, external_id'

export interface LocalClient {
  id: string
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  source: string | null
  external_source: string | null
  external_id: string | null
}

/** A new client (crm_sync_insert_clients). */
export interface InsertRow {
  external_id: string
  name: string | null
  phone: string | null
  phone_raw: string | null
  email: string | null
}

/**
 * The CRM data for an existing client (crm_sync_update_clients): `link` = link it to this contact
 * now; otherwise it is already linked to it. Values are proposals — only empty fields take them.
 */
export interface UpdateRow {
  id: string
  external_id: string
  name: string | null
  /** null when the phone belongs to another client (never proposed then). */
  phone: string | null
  phone_raw: string | null
  email: string | null
  link: boolean
}

export interface PlanInput {
  externalSource: string
  /** The contacts read in this run, in CRM order. */
  drafts: readonly ContactDraft[]
  /** Clients already linked to a contact of this run: external_id → client (same externalSource). */
  linked: ReadonlyMap<string, LocalClient>
  /** Clients that have one of the phones of ANY contact of this run: E.164 → client (M1). */
  byPhone: ReadonlyMap<string, LocalClient>
}

export interface ClientWritePlan {
  inserts: InsertRow[]
  /** Every linked client of this run (also marks its contact as seen) and those to link now. */
  updates: UpdateRow[]
  /** Contacts that joined another contact's client because they share its phone. */
  mergedByPhone: number
  /** Contacts not added because their phone belongs to a client linked to another CRM record. */
  conflicts: PhoneConflict[]
}

interface Group {
  key: string
  row: LocalClient | null
  primary: ContactDraft
  linkNow: boolean
}

export function planClientWrites(input: PlanInput): ClientWritePlan {
  const { drafts, linked, byPhone } = input
  const groups = new Map<string, Group>()
  const order: Group[] = []
  // E.164 → the group (or local client, `row:<id>`) that holds it. Local phones first.
  const phoneOwner = new Map<string, string>()
  for (const r of byPhone.values()) if (r.phone) phoneOwner.set(r.phone, `row:${r.id}`)
  for (const r of linked.values()) if (r.phone) phoneOwner.set(r.phone, `row:${r.id}`)
  const claimed = new Set<string>(Array.from(linked.values(), (r) => r.id))
  let mergedByPhone = 0
  const conflicts: PhoneConflict[] = []

  const open = (key: string, row: LocalClient | null, primary: ContactDraft, linkNow: boolean): Group => {
    const g: Group = { key, row, primary, linkNow }
    groups.set(key, g)
    order.push(g)
    return g
  }

  // 1. Contacts that already have their client. A phoneless client reserves its contact's phone
  //    (when nobody has it), so a duplicate contact with that phone joins it instead of taking it.
  for (const d of drafts) {
    const row = linked.get(d.externalId)
    if (!row) continue
    const key = `row:${row.id}`
    if (groups.has(key)) continue
    open(key, row, d, false)
    if (!row.phone && d.phone && !phoneOwner.has(d.phone)) phoneOwner.set(d.phone, key)
  }

  // 2. The others: join, link by phone, or a new client.
  for (const d of drafts) {
    if (linked.has(d.externalId)) continue
    if (d.phone) {
      const owner = phoneOwner.get(d.phone)
      if (owner) {
        if (groups.has(owner)) { mergedByPhone++; continue }
        const row = byPhone.get(d.phone)
        if (row && row.external_id === null && !claimed.has(row.id)) {
          claimed.add(row.id)
          open(owner, row, d, true)
          continue
        }
        conflicts.push({ phone: d.phone, contact: d.externalId })
        continue
      }
      const key = `new:${d.externalId}`
      phoneOwner.set(d.phone, key)
      open(key, null, d, false)
      continue
    }
    open(`new:${d.externalId}`, null, d, false)
  }

  const inserts: InsertRow[] = []
  const updates: UpdateRow[] = []
  for (const g of order) {
    const d = g.primary
    if (!g.row) {
      inserts.push({ external_id: d.externalId, name: d.name, phone: d.phone, phone_raw: d.phoneRaw, email: d.email })
      continue
    }
    // A phone is proposed only to a client without one, and only when no other client has it.
    const owner = d.phone ? phoneOwner.get(d.phone) : undefined
    const phoneFree = !!d.phone && (!owner || owner === g.key)
    updates.push({
      id: g.row.id,
      external_id: d.externalId,
      name: d.name,
      phone: phoneFree ? d.phone : null,
      // The raw form goes with the phone; alone only when the CRM phone could not be normalised.
      phone_raw: phoneFree || !d.phone ? d.phoneRaw : null,
      email: d.email,
      link: g.linkNow,
    })
  }

  return { inserts, updates, mergedByPhone, conflicts }
}
