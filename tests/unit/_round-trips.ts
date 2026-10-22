/**
 * Round trips of a loader, counted without a network (W4 speed tests).
 *
 * `roundTrips(sb)` wraps any in-memory Supabase double: a query answers only when the current «wave» is
 * flushed (one macrotask), so every query started before the flush costs one round trip together, and a
 * query that waits for another one lands in the next wave. `waves()` is the number of sequential round
 * trips the loader needed; `reads` counts the queries per table.
 *
 * `memoryDb(tables)` is a tiny double for loaders (select with { count, head } / eq / gt / is / not / in /
 * contains / or / order / limit / maybeSingle / single, and upsert that only records the write in
 * `tables.__writes`): `or` is accepted and ignored.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>
type Failure = { code: string; message: string }

export function roundTrips(sb: SupabaseClient, opts: { fail?: Record<string, Failure> } = {}) {
  let waves = 0
  let pending: Array<() => void> = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const reads: Record<string, number> = {}
  const flush = () => {
    timer = null
    waves++
    const batch = pending
    pending = []
    for (const run of batch) run()
  }
  const later = <T>(run: () => PromiseLike<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pending.push(() => { run().then(resolve, reject) })
      timer ??= setTimeout(flush, 0)
    })
  const client = {
    from(table: string) {
      reads[table] = (reads[table] ?? 0) + 1
      const failure = opts.fail?.[table]
      const target = (sb as unknown as { from: (t: string) => Record<string, unknown> }).from(table)
      const answer = <T>(real: () => PromiseLike<T>) => later(failure ? () => Promise.resolve({ data: null, error: failure } as T) : real)
      const proxy: Record<string, unknown> = new Proxy(target, {
        get(t, prop: string) {
          if (prop === 'then') {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              answer(() => new Promise((ok, ko) => (t.then as (a: unknown, b: unknown) => unknown)(ok, ko))).then(res, rej)
          }
          if (prop === 'maybeSingle' || prop === 'single') return () => answer(() => (t[prop] as () => Promise<unknown>)())
          const v = t[prop]
          return typeof v === 'function' ? (...args: unknown[]) => { const r = (v as (...a: unknown[]) => unknown)(...args); return r === t ? proxy : r } : v
        },
      })
      return proxy
    },
    rpc: (sb as unknown as { rpc?: unknown }).rpc,
  }
  return { sb: client as unknown as SupabaseClient, reads, waves: () => waves }
}

export function memoryDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      const sorts: Array<{ col: string; asc: boolean }> = []
      let cap: number | null = null
      let counted: { head: boolean } | null = null
      let write: Row | null = null
      const run = (single: boolean) => {
        if (write) {
          ;(tables.__writes ??= []).push({ table, ...write })
          return { data: null, error: null }
        }
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        for (const { col, asc } of [...sorts].reverse()) rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (asc ? 1 : -1))
        const count = rows.length
        if (cap !== null) rows = rows.slice(0, cap)
        const copy = rows.map((r) => ({ ...r }))
        if (counted) return { data: counted.head ? null : copy, count, error: null }
        return { data: single ? copy[0] ?? null : copy, error: null }
      }
      const b: Record<string, unknown> = {
        select: (_cols?: string, o?: { count?: string; head?: boolean }) => { if (o?.count) counted = { head: !!o.head }; return b },
        upsert: (row: Row) => { write = row; return b },
        contains: (c: string, v: Record<string, unknown>) => {
          filters.push((r) => Object.entries(v).every(([k, x]) => (r[c] as Record<string, unknown> | null)?.[k] === x))
          return b
        },
        gt: (c: string, v: unknown) => { filters.push((r) => String(r[c] ?? '') > String(v)); return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b },
        not: (c: string, o: string, v: unknown) => { filters.push((r) => (o === 'is' && v === null ? r[c] != null : r[c] !== v)); return b },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
        or: () => b,
        order: (col: string, o?: { ascending?: boolean }) => { sorts.push({ col, asc: o?.ascending !== false }); return b },
        limit: (n: number) => { cap = n; return b },
        maybeSingle: () => Promise.resolve(run(true)),
        single: () => Promise.resolve(run(true)),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
      }
      return b
    },
  } as unknown as SupabaseClient
}
