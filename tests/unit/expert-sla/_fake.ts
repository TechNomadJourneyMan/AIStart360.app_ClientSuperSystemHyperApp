/**
 * In-memory double of the service-role Supabase client for lib/expert-sla:
 * the query-builder subset the module uses (select / eq / is / in / not /
 * order / limit / or, update / insert / upsert, maybeSingle, thenable) and an
 * rpc() handler the test supplies (the SQL of migration 145 is exercised on the
 * real database in tests/integration/db/expert-sla.test.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>

export function slaDb(seed: Record<string, Row[]> = {}, rpc: (fn: string, args: Record<string, unknown>) => unknown = () => []) {
  const db: Record<string, Row[]> = { profiles: [], staff_roles: [], user_assignments: [], expert_sla_tasks: [], expert_cases: [], ...seed }
  const writes: Array<{ table: string; op: string; payload: unknown; matched: number }> = []
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  /** Size of every in() list and of every or() filter — the chunking rule (≤ 100 ids per request). */
  const listSizes: number[] = []
  /** Tables whose reads answer with an error (a missing migration, a broken read). */
  const failing = new Set<string>()
  const keyOf: Record<string, string> = { user_assignments: 'user_id', profiles: 'id', staff_roles: 'user_id' }

  const client = {
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      try {
        return { data: await rpc(fn, args), error: null }
      } catch (err) {
        return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
      }
    },
    from(table: string) {
      let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
      let payload: Row | Row[] | null = null
      let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
      let single = false
      let cap: number | null = null
      let sort: { col: string; asc: boolean } | null = null
      const filters: Array<(r: Row) => boolean> = []
      const run = () => {
        if (failing.has(table)) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } }
        const rows = (db[table] ??= [])
        const match = (r: Row) => filters.every((f) => f(r))
        if (op === 'insert' || op === 'upsert') {
          const list = Array.isArray(payload) ? payload : [payload!]
          const key = opts.onConflict ?? keyOf[table] ?? 'id'
          for (const p of list) {
            const hit = rows.find((r) => r[key] === p[key])
            if (hit) {
              if (op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key' } }
              if (!opts.ignoreDuplicates) Object.assign(hit, p)
            } else rows.push({ ...p })
          }
          writes.push({ table, op, payload, matched: list.length })
          return { data: null, error: null }
        }
        if (op === 'update') {
          const hit = rows.filter(match)
          for (const r of hit) Object.assign(r, payload)
          writes.push({ table, op, payload, matched: hit.length })
          return { data: single ? hit[0] ?? null : hit.map((r) => ({ ...r })), error: null }
        }
        let found = rows.filter(match)
        if (sort) {
          const { col, asc } = sort
          found = [...found].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1))
        }
        if (cap !== null) found = found.slice(0, cap)
        found = found.map((r) => ({ ...r }))
        return { data: single ? found[0] ?? null : found, error: null }
      }
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
        upsert: (p: Row | Row[], o: typeof opts = {}) => { op = 'upsert'; payload = p; opts = o; return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b },
        not: (c: string, o: string, v: unknown) => { filters.push((r) => (o === 'is' && v === null ? r[c] != null : r[c] !== v)); return b },
        in: (c: string, vs: unknown[]) => { listSizes.push(vs.length); filters.push((r) => vs.includes(r[c])); return b },
        lt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && (typeof v === 'number' ? Number(r[c]) < v : String(r[c]) < String(v))); return b },
        // PostgREST or(): `col.eq.v,col.is.null,col.in.(a,b)` — any of the parts.
        or: (expr: string) => {
          const parts = expr.match(/[a-z_]+\.(?:in\.\([^)]*\)|[a-z]+\.[^,]*)/g) ?? []
          listSizes.push(parts.reduce((n, p) => n + (p.includes('.in.(') ? p.split(',').length : 1), 0))
          filters.push((r) => parts.some((p) => {
            const [col, op, ...rest] = p.split('.')
            const val = rest.join('.')
            if (op === 'is') return val === 'null' ? r[col] == null : String(r[col]) === val
            if (op === 'eq') return String(r[col]) === val
            if (op === 'in') return val.replace(/[()]/g, '').split(',').includes(String(r[col]))
            return false
          }))
          return b
        },
        order: (col: string, o?: { ascending?: boolean }) => { sort = { col, asc: o?.ascending !== false }; return b },
        limit: (n: number) => { cap = n; return b },
        maybeSingle: () => { single = true; return Promise.resolve(run()) },
        single: () => { single = true; return Promise.resolve(run()) },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return b
    },
  }
  return { sb: client as unknown as SupabaseClient, db, writes, rpcCalls, listSizes, failing }
}

export const iso = (d: Date) => d.toISOString()
export const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000)
