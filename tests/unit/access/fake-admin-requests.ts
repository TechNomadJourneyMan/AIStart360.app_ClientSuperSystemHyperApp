/**
 * In-memory double of the service-role client for the paid-access request
 * tests (lib/access/upgrade-requests.ts): admin_requests rows with the filters
 * the code uses (eq incl. `payload->>userId`, in, order, limit), insert /
 * update, and an optional emulation of the unique index of migration 144.
 */
type Row = Record<string, unknown>

export interface FakeRequestsDb {
  rows: Row[]
  profiles: Row[]
  companies: Row[]
  /** Emulate admin_requests_open_paywall_per_user (23505 on a second open paywall row). */
  uniqueIndex: boolean
  /** Make the next lookup of open requests return nothing (a race: both callers saw none). */
  hideOpenOnce: number
  failInsert?: boolean
  /** Runs once right before the next UPDATE is applied — a concurrent writer. */
  beforeUpdateOnce?: (rows: Row[]) => void
}

export function newRequestsDb(): FakeRequestsDb {
  return { rows: [], profiles: [], companies: [], uniqueIndex: true, hideOpenOnce: 0 }
}

const OPEN = ['new', 'in_review', 'waiting_for_info', 'escalated']

function field(row: Row, col: string): unknown {
  if (col === 'payload->>userId') return (row.payload as Row | null)?.userId
  return row[col]
}

export function fakeService(db: FakeRequestsDb) {
  return {
    from(table: string) {
      const st = { op: 'select' as 'select' | 'insert' | 'update', payload: null as unknown, eq: [] as Array<[string, unknown]>, in: [] as Array<[string, unknown[]]>, single: false }
      const source = () => (table === 'admin_requests' ? db.rows : table === 'profiles' ? db.profiles : table === 'companies' ? db.companies : [])
      const matches = (r: Row) => st.eq.every(([c, v]) => field(r, c) === v) && st.in.every(([c, vs]) => vs.includes(field(r, c)))
      const exec = async () => {
        if (st.op === 'insert') {
          const row = st.payload as Row
          if (db.failInsert) return { data: null, error: { code: 'XX000', message: 'boom' } }
          if (db.uniqueIndex && row.source === 'paywall' && OPEN.includes(String(row.status))) {
            const uid = (row.payload as Row).userId
            if (db.rows.some((r) => r.source === 'paywall' && OPEN.includes(String(r.status)) && (r.payload as Row).userId === uid)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
            }
          }
          db.rows.push({ ...row })
          return { data: null, error: null }
        }
        if (st.op === 'update') {
          const hook = db.beforeUpdateOnce
          db.beforeUpdateOnce = undefined
          hook?.(source())
          const hit = source().filter(matches)
          for (const r of hit) Object.assign(r, st.payload as Row)
          return { data: hit.map((r) => ({ id: r.id })), error: null }
        }
        let rows = source().filter(matches)
        if (table === 'admin_requests' && st.in.some(([c]) => c === 'status') && db.hideOpenOnce > 0) {
          db.hideOpenOnce -= 1
          rows = []
        }
        rows = [...rows].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
        return { data: st.single ? rows[0] ?? null : rows, error: null }
      }
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b,
        order: () => b,
        limit: () => b,
        eq: (c: string, v: unknown) => { st.eq.push([c, v]); return b },
        in: (c: string, vs: unknown[]) => { st.in.push([c, vs]); return b },
        insert: (p: unknown) => { st.op = 'insert'; st.payload = p; return b },
        update: (p: unknown) => { st.op = 'update'; st.payload = p; return b },
        maybeSingle: () => { st.single = true; return exec() },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
      })
      return b
    },
  }
}
