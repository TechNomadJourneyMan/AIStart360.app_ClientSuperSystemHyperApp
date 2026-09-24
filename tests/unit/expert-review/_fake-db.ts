/**
 * Минимальная in-memory подделка supabase-js для тестов разбора эксперта:
 * select / insert / update / delete с фильтрами eq / in / is / or и
 * maybeSingle / single. Фильтры действительно применяются к строкам, поэтому
 * тесты проверяют, ЧТО маршрут прочитал и изменил, а не только вызовы.
 */

type Row = Record<string, unknown>
type Filter = (r: Row) => boolean

export interface FakeDb {
  tables: Record<string, Row[]>
  log: Array<{ table: string; op: string; filters: string[] }>
  failInsert?: string | null
  from: (table: string) => Builder
}

let seq = 0
const newId = () => {
  seq += 1
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
}

class Builder implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = []
  private labels: string[] = []
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: Row[] | Row | null = null
  private mode: 'many' | 'maybe' | 'single' = 'many'
  private lim: number | null = null

  constructor(private db: FakeDb, private table: string) {}

  select() { return this }
  order() { return this }
  limit(n: number) { this.lim = n; return this }
  insert(rows: Row[] | Row) { this.op = 'insert'; this.payload = rows; return this }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); this.labels.push(`${col}=${String(val)}`); return this }
  is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); this.labels.push(`${col} is ${String(val)}`); return this }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); this.labels.push(`${col} in ${vals.length}`); return this }
  or(expr: string) {
    const parts = expr.split(',').map((p) => p.split('.'))
    this.filters.push((r) => parts.some(([c, , v]) => String(r[c]) === v))
    this.labels.push(`or(${expr})`)
    return this
  }
  maybeSingle() { this.mode = 'maybe'; return this }
  single() { this.mode = 'single'; return this }

  private run(): { data: unknown; error: { message: string } | null } {
    const rows = (this.db.tables[this.table] ??= [])
    this.db.log.push({ table: this.table, op: this.op, filters: this.labels })
    const match = (r: Row) => this.filters.every((f) => f(r))
    let out: Row[]
    if (this.op === 'insert') {
      if (this.db.failInsert === this.table) return { data: null, error: { message: 'insert failed' } }
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      const now = new Date().toISOString()
      out = list.map((r) => ({ id: newId(), created_at: now, updated_at: now, ...r }))
      rows.push(...out)
    } else if (this.op === 'update') {
      out = rows.filter(match)
      for (const r of out) Object.assign(r, this.payload)
    } else if (this.op === 'delete') {
      out = rows.filter(match)
      this.db.tables[this.table] = rows.filter((r) => !match(r))
    } else {
      out = rows.filter(match)
    }
    if (this.lim !== null) out = out.slice(0, this.lim)
    const copy = out.map((r) => ({ ...r }))
    if (this.mode === 'many') return { data: copy, error: null }
    if (this.mode === 'single' && copy.length !== 1) return { data: null, error: { message: 'not single' } }
    return { data: copy[0] ?? null, error: null }
  }

  then<A = { data: unknown; error: { message: string } | null }, B = never>(
    ok?: ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, fail)
  }
}

export function makeFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables,
    log: [],
    failInsert: null,
    from: (table: string) => new Builder(db, table),
  }
  return db
}
