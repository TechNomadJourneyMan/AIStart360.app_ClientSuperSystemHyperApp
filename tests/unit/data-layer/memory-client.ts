import type { SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, unknown>

/** In-memory tables with the subset of the query builder the data layer uses. */
export function memoryClient(tables: Record<string, Row[]> = {}, opts: { missing?: string[] } = {}) {
  let seq = 0
  const db: Record<string, Row[]> = { metric_facts: [], data_discrepancies: [], metric_overrides: [], ...tables }
  const client = {
    // replace_metric_facts (migration 111) is not emulated: the caller falls back to delete + insert.
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    from(table: string) {
      let op: 'select' | 'delete' | 'insert' | 'update' | 'upsert' = 'select'
      let payload: Row | Row[] | null = null
      let conflict: string[] = []
      let single = false
      const filters: Array<(r: Row) => boolean> = []
      const run = () => {
        if (opts.missing?.includes(table)) return { data: null, error: { code: '42P01', message: 'missing' } }
        const rows = (db[table] ??= [])
        const match = (r: Row) => filters.every((f) => f(r))
        let out: unknown = null
        if (op === 'select') out = single ? rows.find(match) ?? null : rows.filter(match)
        if (op === 'delete') db[table] = rows.filter((r) => !match(r))
        if (op === 'insert') for (const p of Array.isArray(payload) ? payload : [payload!]) rows.push({ id: `id${++seq}`, created_at: new Date(2026, 0, seq).toISOString(), ...p })
        if (op === 'update') for (const r of rows) if (match(r)) Object.assign(r, payload)
        if (op === 'upsert') {
          for (const p of Array.isArray(payload) ? payload : [payload!]) {
            const hit = rows.find((r) => conflict.every((c) => r[c] === p[c]))
            if (hit) Object.assign(hit, p)
            else rows.push({ id: `id${++seq}`, ...p })
          }
        }
        return { data: out, error: null }
      }
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        limit: () => b,
        delete: () => { op = 'delete'; return b },
        insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
        upsert: (p: Row | Row[], o?: { onConflict?: string }) => { op = 'upsert'; payload = p; conflict = (o?.onConflict ?? 'id').split(','); return b },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
        maybeSingle: () => { single = true; return Promise.resolve(run()) },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return b
    },
  }
  return { client: client as unknown as SupabaseClient, db }
}
