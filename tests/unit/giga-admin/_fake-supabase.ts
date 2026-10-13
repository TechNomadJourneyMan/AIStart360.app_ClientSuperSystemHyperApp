/**
 * Minimal in-memory double of the service-role Supabase client for route
 * tests: rows per table, eq / is filters, and every write recorded.
 */
export interface FakeDb {
  tables: Record<string, Array<Record<string, unknown>>>
  writes: Array<{ table: string; op: string; payload: unknown; filters: Array<[string, unknown]> }>
  errors: Record<string, { code: string } | undefined>
}

export function newFakeDb(): FakeDb {
  return { tables: {}, writes: [], errors: {} }
}

export function fakeClient(db: FakeDb) {
  return {
    from(table: string) {
      const st = { op: 'select', payload: null as unknown, filters: [] as Array<[string, unknown]>, single: false }
      const exec = () => {
        if (st.op !== 'select') db.writes.push({ table, op: st.op, payload: st.payload, filters: st.filters })
        const err = db.errors[`${table}:${st.op}`]
        if (err) return Promise.resolve({ data: null, error: err })
        const rows = (db.tables[table] ?? []).filter((r) => st.filters.every(([c, v]) => (v === null ? r[c] == null : r[c] === v)))
        if (st.op === 'insert' || st.op === 'upsert') {
          return Promise.resolve({ data: st.single ? { id: 'new-1', ...(st.payload as object) } : null, error: null })
        }
        if (st.op === 'update' || st.op === 'delete') return Promise.resolve({ data: rows, error: null })
        return Promise.resolve({ data: st.single ? rows[0] ?? null : rows, error: null })
      }
      const b: Record<string, unknown> = {}
      const chain = () => b
      Object.assign(b, {
        select: chain, order: chain, limit: chain, not: chain, in: chain,
        eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b },
        is: (c: string, v: unknown) => { st.filters.push([c, v]); return b },
        insert: (p: unknown) => { st.op = 'insert'; st.payload = p; return b },
        update: (p: unknown) => { st.op = 'update'; st.payload = p; return b },
        upsert: (p: unknown) => { st.op = 'upsert'; st.payload = p; return b },
        delete: () => { st.op = 'delete'; return b },
        maybeSingle: () => { st.single = true; return exec() },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
      })
      return b
    },
  }
}
