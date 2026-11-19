/**
 * lib/crm/import-merge.ts — how a CSV / XLSX import meets the owner's existing base (pure; the
 * route app/api/v1/crm/clients/import executes the plan).
 *
 * Owner principle: an import never overwrites what the owner entered. It ADDS clients and FILLS
 * EMPTY fields of the clients it recognises; changing an existing value is done in the portal.
 *
 * Who is «the same client» — and never by a coincidence of contact details alone:
 *   1. the same normalised phone (E.164 — the base's unique key per owner) AND the same name.
 *      The same phone under ANOTHER name is a conflict: the row is not imported (a second client
 *      with that phone cannot exist) and nothing of it — check, note, e-mail — is attached to the
 *      other person; the owner sees the count.
 *   2. a valid e-mail (lib/crm/csv-import.ts validEmailOrNull — «-», «нет», «n/a» are not e-mails)
 *      AND the same name, and no two different phones. A shared mailbox (info@firm.kz) under
 *      another name is another person: a new client.
 *   3. a row with only a name (neither a normalised phone nor a valid e-mail): the ONE client with
 *      the same name, whatever that client's phone, e-mail or note — and, as always, only its
 *      EMPTY fields are filled. When two or more clients have that name (in the base or made by
 *      this file) the row is neither merged nor created: it is skipped and counted as `ambiguous`
 *      («несколько клиентов с таким именем»).
 * Names compare without case, «ё», punctuation, extra spaces and word order.
 *
 * Inside one file the first row of a client wins; a repeat only fills fields still empty.
 * A raw phone that did not normalise is kept only where the client has no phone at all; when the
 * import fills an empty phone, its raw form comes with it, so the screen shows the number that
 * «Позвонить» dials (an old raw phone that never normalised is replaced by it).
 */
import { validEmailOrNull, type ClientDraft } from './csv-import'

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
  /** Existing clients whose EMPTY fields the file fills: only the filled fields. */
  updates: Array<{ id: string; patch: Partial<ClientFields> }>
  /** Existing clients the file matched without anything to fill. */
  unchanged: number
  /** Rows that repeated a client already met earlier in the same file. */
  duplicates: number
  /** Rows not imported: their phone belongs to a client with another name. */
  conflicts: number
  /** Rows not imported: only a name, and several clients have that name. */
  ambiguous: number
}

/** A valid e-mail, lower-cased for comparison; null for anything else. */
export function normalizeEmail(email: string | null | undefined): string | null {
  return validEmailOrNull(email)?.toLowerCase() ?? null
}

/** A name for comparison: no case, «ё», punctuation, extra spaces or word order. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

function toCheck(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const empty = (s: string | null | undefined) => s == null || s.trim() === ''

interface Target {
  existingId: string | null
  original: ClientFields | null
  fields: ClientFields
  /** Already met by an earlier row of this file. */
  seenInFile: boolean
}

/** Fill the target's EMPTY fields from a row of the same client. Never changes a non-empty value. */
function fillEmpty(t: ClientFields, row: ClientDraft): void {
  if (row.phone && t.phone == null) {
    // The phone and the form it is shown in go together: an old raw phone that never normalised
    // would otherwise be on screen while «Позвонить» dials the imported number.
    t.phone = row.phone
    t.phone_raw = empty(row.phone_raw) ? row.phone : row.phone_raw
  } else if (row.phone && t.phone === row.phone) {
    if (empty(t.phone_raw)) t.phone_raw = row.phone_raw
  } else if (!row.phone && t.phone == null && empty(t.phone_raw) && !empty(row.phone_raw)) {
    t.phone_raw = row.phone_raw
  }
  if (empty(t.email) && row.email) t.email = row.email
  if (empty(t.note) && !empty(row.note)) t.note = row.note
  if (t.avg_check == null && row.avg_check != null) t.avg_check = row.avg_check
}

/** The fields `after` changed against `before` (fillEmpty only ever fills empty ones). */
function filledFields(before: ClientFields, after: ClientFields): Partial<ClientFields> {
  const patch: Partial<ClientFields> = {}
  for (const k of ['phone', 'phone_raw', 'email', 'note'] as const) if (before[k] !== after[k]) patch[k] = after[k]
  if (toCheck(before.avg_check) !== toCheck(after.avg_check)) patch.avg_check = after.avg_check
  return patch
}

export function planImport(rows: readonly ClientDraft[], existing: readonly ExistingClient[]): ImportPlan {
  const byPhone = new Map<string, Target>()
  const byEmail = new Map<string, Target[]>()
  /** Every client (of the base and made by this file) by its name. */
  const byName = new Map<string, Target[]>()
  const nameIndexed = new Set<Target>()
  const existingTargets: Target[] = []
  const newTargets: Target[] = []
  const emailIndexed = new Map<Target, Set<string>>()

  const index = (t: Target) => {
    if (t.fields.phone && !byPhone.has(t.fields.phone)) byPhone.set(t.fields.phone, t)
    const email = normalizeEmail(t.fields.email)
    if (email) {
      const seen = emailIndexed.get(t) ?? new Set<string>()
      if (!seen.has(email)) {
        seen.add(email)
        emailIndexed.set(t, seen)
        byEmail.set(email, [...(byEmail.get(email) ?? []), t])
      }
    }
    if (!nameIndexed.has(t)) {
      nameIndexed.add(t)
      const key = nameKey(t.fields.name)
      byName.set(key, [...(byName.get(key) ?? []), t])
    }
  }

  // The oldest client first, so when several could match, the oldest one does.
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
  let conflicts = 0
  let ambiguous = 0
  for (const row of rows) {
    const name = nameKey(row.name)
    const email = normalizeEmail(row.email)
    let target: Target | undefined

    if (row.phone && byPhone.has(row.phone)) {
      const t = byPhone.get(row.phone) as Target
      if (nameKey(t.fields.name) !== name) {
        conflicts += 1 // the phone is another person's: not imported, nothing moved
        continue
      }
      target = t
    }
    if (!target && email) {
      target = (byEmail.get(email) ?? []).find(
        (t) => nameKey(t.fields.name) === name && (!row.phone || !t.fields.phone || t.fields.phone === row.phone),
      )
    }
    if (!target && !row.phone && !email) {
      // Only a name: the one client with it; with several, nobody can tell which — skip the row.
      const named = byName.get(name) ?? []
      if (named.length > 1) {
        ambiguous += 1
        continue
      }
      target = named[0]
    }

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
    fillEmpty(target.fields, row)
    target.seenInFile = true
    index(target)
  }

  const updates: ImportPlan['updates'] = []
  let unchanged = 0
  for (const t of existingTargets) {
    if (!t.seenInFile) continue
    const patch = filledFields(t.original as ClientFields, t.fields)
    if (Object.keys(patch).length === 0) unchanged += 1
    else updates.push({ id: t.existingId as string, patch })
  }

  return { inserts: newTargets.map((t) => t.fields), updates, unchanged, duplicates, conflicts, ambiguous }
}
