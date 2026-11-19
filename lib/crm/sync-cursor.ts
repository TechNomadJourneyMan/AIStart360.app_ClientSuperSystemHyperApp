/**
 * lib/crm/sync-cursor.ts — where the CRM sync of a connection continues
 * (crm_provider_connections.sync_cursor, migration 157). Written only by lib/crm/sync.ts.
 *
 * Contacts and deals are each read in passes: a pass starts at the beginning of the CRM's list
 * (ascending id), every run continues from `position`, and the pass completes when the end is
 * reached; the next run starts a new pass (wrap-around). A CRM smaller than one run's cap completes
 * a pass on every run. Per pass:
 *   contacts — `started_at` is what `crm_clients.external_seen_at` is compared with once the pass
 *              completes (linked clients not seen since are counted as gone from the CRM, and their
 *              phone may be re-linked: `conflicts`, at most MAX_CONFLICTS);
 *   deals    — `started_at` tags the qualifying deals of the pass in crm_sync_deals; avg_check is
 *              applied from them when the pass completes; the counters say what did not qualify.
 * `relink_pending` (wave 3, L5): the re-link at the end of a contacts pass failed — its pass start and
 * conflicts are kept and the next run retries it first; a later completed pass replaces it.
 * `catching_up` (a pass is in progress, or a re-link waits) makes the automatic sync come back within half an hour
 * instead of six hours (lib/crm/sync-cron.ts). A cursor of another CRM account, of another shape or
 * unreadable is replaced by an empty one (the next run starts new passes).
 */

export interface PassCursor {
  /** ISO time the running pass started; null when no pass is in progress. */
  started_at: string | null
  /** Where the next run continues (ProviderList.position); null = from the start. */
  position: string | null
  /** Records read in the running pass so far. */
  read: number
}

export interface PhoneConflict {
  /** E.164 phone the contact shares with a client linked to another CRM record. */
  phone: string
  /** The contact's id. */
  contact: string
}

export interface ContactsCursor extends PassCursor {
  conflicts: PhoneConflict[]
}

export interface DealsCursor extends PassCursor {
  without_contact: number
  other_currency: number
}

export interface PendingRelink {
  /** Start of the contacts pass whose re-link failed: clients not seen since then are the gone ones. */
  started_at: string
  conflicts: PhoneConflict[]
}

export interface SyncCursor {
  v: 1
  /** crm_clients.external_source the cursor belongs to. */
  source: string | null
  catching_up: boolean
  contacts: ContactsCursor
  deals: DealsCursor
  relink_pending: PendingRelink | null
}

export const MAX_CONFLICTS = 500

export function emptyCursor(source: string | null): SyncCursor {
  return {
    v: 1,
    source,
    catching_up: false,
    contacts: { started_at: null, position: null, read: 0, conflicts: [] },
    deals: { started_at: null, position: null, read: 0, without_contact: 0, other_currency: 0 },
    relink_pending: null,
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
const iso = (v: unknown): string | null => {
  const s = str(v)
  return s && !Number.isNaN(Date.parse(s)) ? s : null
}

/** The stored cursor for `source`, or an empty one. */
export function readCursor(raw: unknown, source: string): SyncCursor {
  if (!raw || typeof raw !== 'object') return emptyCursor(source)
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || r.source !== source) return emptyCursor(source)
  const c = (r.contacts ?? {}) as Record<string, unknown>
  const d = (r.deals ?? {}) as Record<string, unknown>
  const conflictsOf = (v: unknown): PhoneConflict[] => (Array.isArray(v)
    ? (v as Array<Record<string, unknown>>)
        .filter((x) => x && str(x.phone) && str(x.contact))
        .map((x) => ({ phone: x.phone as string, contact: x.contact as string }))
        .slice(0, MAX_CONFLICTS)
    : [])
  const conflicts = conflictsOf(c.conflicts)
  const p = (r.relink_pending ?? null) as Record<string, unknown> | null
  const pendingStarted = p && typeof p === 'object' ? iso(p.started_at) : null
  const pendingConflicts = pendingStarted ? conflictsOf(p?.conflicts) : []
  const contactsStarted = iso(c.started_at)
  const dealsStarted = iso(d.started_at)
  return {
    v: 1,
    source,
    catching_up: r.catching_up === true,
    contacts: {
      started_at: contactsStarted,
      position: contactsStarted ? str(c.position) : null,
      read: contactsStarted ? num(c.read) : 0,
      conflicts: contactsStarted ? conflicts : [],
    },
    deals: {
      started_at: dealsStarted,
      position: dealsStarted ? str(d.position) : null,
      read: dealsStarted ? num(d.read) : 0,
      without_contact: dealsStarted ? num(d.without_contact) : 0,
      other_currency: dealsStarted ? num(d.other_currency) : 0,
    },
    relink_pending: pendingStarted && pendingConflicts.length > 0 ? { started_at: pendingStarted, conflicts: pendingConflicts } : null,
  }
}

/** Conflicts of the pass so far plus new ones, one per contact, at most MAX_CONFLICTS. */
export function addConflicts(known: PhoneConflict[], more: PhoneConflict[]): PhoneConflict[] {
  const byContact = new Map(known.map((c) => [c.contact, c]))
  for (const c of more) if (!byContact.has(c.contact)) byContact.set(c.contact, c)
  return Array.from(byContact.values()).slice(0, MAX_CONFLICTS)
}
