/**
 * lib/crm/import-merge.ts — how a CSV / XLSX import meets the owner's existing base (pure; the
 * route app/api/v1/crm/clients/import executes the plan).
 *
 * Matching, in this order:
 *   1. by the normalised phone (E.164) — the base's unique key per owner;
 *   2. else by e-mail, case-insensitively — unless both sides have a phone and the phones differ
 *      (two numbers = two contacts, even with one shared mailbox);
 *   3. a row with neither a phone nor an e-mail matches only a client that has neither either and
 *      the same name (case, spaces and «ё» ignored) and the same raw phone digits, if any: the
 *      conservative choice — an identical anonymous row is not created a second time, and an
 *      anonymous row is never merged into a client that has contact details.
 *
 * Merging never overwrites a non-empty field with an empty one:
 *   - an existing client matched by the file gets the row's non-empty values (an import updates
 *     the data); its empty cells change nothing;
 *   - a row that repeats a contact already seen earlier in the SAME file is a duplicate: the first
 *     occurrence wins and the duplicate only fills fields still empty.
 * A raw phone that did not normalise is kept only where the client has no normalised phone.
 */
import type { ClientDraft } from './csv-import'

export interface ExistingClient {
  id: string
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  note: string | null
  avg_check: number | string | null
  created_at?: string | null
}

export interface ClientFields {
  name: string
  phone: string | null
  phone_raw: string | null
  email: string | null
  note: string | null
  avg_check: number | null
}

export interface ImportPlan {
  /** New clients, in file order. */
  inserts: ClientFields[]
  /** Existing clients whose data the file changes: the full merged field set. */
  updates: Array<{ id: string; fields: ClientFields }>
  /** Existing clients the file matched without changing anything. */
  unchanged: number
  /** Rows that repeated a contact already met earlier in the same file. */
  duplicates: number
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return e ? e : null
}

function normName(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

/** Identity of a client without phone and e-mail: the normalised name + raw phone digits. */
export function anonymousKey(name: string, phoneRaw: string | null): string {
  return `${normName(name)}|${(phoneRaw ?? '').replace(/\D/g, '')}`
}

function toCheck(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const nonEmpty = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim().length > 0

interface Target {
  existingId: string | null
  original: ClientFields | null
  fields: ClientFields
  /** Already met by an earlier row of this file. */
  seenInFile: boolean
}

/**
 * Apply one row to a target. `overwrite`: the row's non-empty values replace the target's (first
 * match of an existing client); otherwise they only fill empty fields (a duplicate row).
 */
function applyRow(t: ClientFields, row: ClientDraft, overwrite: boolean): void {
  const take = <K extends keyof ClientFields>(k: K, v: ClientFields[K] | null) => {
    if (v == null || (typeof v === 'string' && !nonEmpty(v))) return
    if (overwrite || t[k] == null || (typeof t[k] === 'string' && !nonEmpty(t[k] as string))) t[k] = v
  }
  // A new spelling of the name replaces the old one; a change of letter case / spaces only does not.
  if (overwrite && normName(row.name) !== normName(t.name)) take('name', row.name)
  if (row.phone) {
    // A normalised phone: matched by it (equal) or filling a client without one.
    if (t.phone == null) {
      t.phone = row.phone
      t.phone_raw = row.phone_raw
    } else if (t.phone === row.phone) {
      take('phone_raw', row.phone_raw)
    }
  } else if (nonEmpty(row.phone_raw) && t.phone == null) {
    take('phone_raw', row.phone_raw)
  }
  // The same mailbox in another letter case is not a change.
  if (normalizeEmail(row.email) !== normalizeEmail(t.email)) take('email', row.email)
  take('note', row.note)
  take('avg_check', row.avg_check)
}

function sameFields(a: ClientFields, b: ClientFields): boolean {
  return (
    a.name === b.name &&
    a.phone === b.phone &&
    a.phone_raw === b.phone_raw &&
    a.email === b.email &&
    a.note === b.note &&
    toCheck(a.avg_check) === toCheck(b.avg_check)
  )
}

export function planImport(rows: readonly ClientDraft[], existing: readonly ExistingClient[]): ImportPlan {
  const byPhone = new Map<string, Target>()
  const byEmail = new Map<string, Target>()
  const byAnon = new Map<string, Target>()
  const existingTargets: Target[] = []
  const newTargets: Target[] = []

  const index = (t: Target) => {
    if (t.fields.phone && !byPhone.has(t.fields.phone)) byPhone.set(t.fields.phone, t)
    const email = normalizeEmail(t.fields.email)
    if (email && !byEmail.has(email)) byEmail.set(email, t)
    if (!t.fields.phone && !email) {
      const key = anonymousKey(t.fields.name, t.fields.phone_raw)
      if (!byAnon.has(key)) byAnon.set(key, t)
    }
  }

  // The oldest client first, so a mailbox / anonymous name shared by several maps to one of them.
  const ordered = [...existing].sort(
    (a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id),
  )
  for (const c of ordered) {
    const fields: ClientFields = {
      name: c.name,
      phone: c.phone,
      phone_raw: c.phone_raw,
      email: c.email,
      note: c.note,
      avg_check: toCheck(c.avg_check),
    }
    const t: Target = { existingId: c.id, original: { ...fields }, fields, seenInFile: false }
    existingTargets.push(t)
    index(t)
  }

  let duplicates = 0
  for (const row of rows) {
    const email = normalizeEmail(row.email)
    let target: Target | undefined = row.phone ? byPhone.get(row.phone) : undefined
    if (!target && email) {
      const t = byEmail.get(email)
      if (t && (!row.phone || !t.fields.phone || t.fields.phone === row.phone)) target = t
    }
    if (!target && !row.phone && !email) target = byAnon.get(anonymousKey(row.name, row.phone_raw))

    if (!target) {
      const t: Target = {
        existingId: null,
        original: null,
        fields: { name: row.name, phone: row.phone, phone_raw: row.phone_raw, email: row.email, note: row.note, avg_check: row.avg_check },
        seenInFile: true,
      }
      newTargets.push(t)
      index(t)
      continue
    }

    if (target.seenInFile) duplicates += 1
    applyRow(target.fields, row, !target.seenInFile)
    target.seenInFile = true
    index(target)
  }

  const updates: ImportPlan['updates'] = []
  let unchanged = 0
  for (const t of existingTargets) {
    if (!t.seenInFile) continue
    if (sameFields(t.fields, t.original as ClientFields)) unchanged += 1
    else updates.push({ id: t.existingId as string, fields: t.fields })
  }

  return { inserts: newTargets.map((t) => t.fields), updates, unchanged, duplicates }
}
