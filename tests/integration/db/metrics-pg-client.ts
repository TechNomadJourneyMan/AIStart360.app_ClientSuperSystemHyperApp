/**
 * A minimal PostgREST-shaped client over one pg connection, for DB tests of
 * the metrics layer (lib/metrics/materialize*.ts, lib/point-a/aggregator.ts).
 *
 * Each query runs as a PostgREST request would: as `authenticated` with the
 * user's JWT claims (real RLS) or as `service_role` (BYPASSRLS), inside the
 * test's rolled-back transaction (tests/helpers/pg-rls.ts). Queries are
 * serialised — the role switch is per query and the connection is shared.
 *
 * Supported: from(t).select(cols) with `alias:col->key`, eq, in, or (eq / is
 * null / and(...)), order, limit, maybeSingle; upsert(rows, { onConflict });
 * delete().eq().in(). Timestamps come back as ISO strings, numerics as numbers
 * (like PostgREST's JSON).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { asUser, type Db } from '../../helpers/pg-rls'

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string; code?: string } | null }

const IDENT = /^[a-z_][a-z0-9_]*$/

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`metrics-pg-client: bad identifier ${name}`)
  return `"${name}"`
}

function selectList(cols: string): string {
  return cols
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const m = /^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)(?:->([a-z_][a-z0-9_]*))?$/.exec(c)
      if (!m) throw new Error(`metrics-pg-client: unsupported select item ${c}`)
      const [, alias, col, key] = m
      const expr = key ? `${ident(col)}->'${key}'` : ident(col)
      return alias || key ? `${expr} AS ${ident(alias ?? key)}` : expr
    })
    .join(', ')
}

function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString()
  return v
}

class Query implements PromiseLike<Result> {
  private op: 'select' | 'upsert' | 'delete' = 'select'
  private cols = '*'
  private where: string[] = []
  private params: unknown[] = []
  private orderBy: string | null = null
  private limitN: number | null = null
  private single = false
  private rows: Row[] = []
  private conflict: string[] = []

  constructor(private readonly table: string, private readonly run: (sql: string, params: unknown[]) => Promise<Row[]>) {}

  private param(v: unknown): string {
    this.params.push(v)
    return `$${this.params.length}`
  }

  select(cols = '*'): this {
    if (this.op === 'select') this.cols = cols
    return this
  }
  eq(col: string, v: unknown): this {
    this.where.push(`${ident(col)} = ${this.param(v)}`)
    return this
  }
  in(col: string, vs: unknown[]): this {
    this.where.push(`${ident(col)}::text = ANY(${this.param(vs.map(String))}::text[])`)
    return this
  }
  or(expr: string): this {
    this.where.push(`(${this.orExpr(expr, 'OR')})`)
    return this
  }
  private orExpr(expr: string, joiner: 'OR' | 'AND'): string {
    return splitTop(expr)
      .map((term) => {
        const nested = /^(and|or)\((.*)\)$/.exec(term)
        if (nested) return `(${this.orExpr(nested[2], nested[1] === 'and' ? 'AND' : 'OR')})`
        const m = /^([a-z_][a-z0-9_]*)\.(eq|is)\.(.*)$/.exec(term)
        if (!m) throw new Error(`metrics-pg-client: unsupported filter ${term}`)
        if (m[2] === 'is') {
          if (m[3] !== 'null') throw new Error(`metrics-pg-client: unsupported is.${m[3]}`)
          return `${ident(m[1])} IS NULL`
        }
        return `${ident(m[1])}::text = ${this.param(m[3])}`
      })
      .join(` ${joiner} `)
  }
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy = `${ident(col)} ${opts.ascending === false ? 'DESC' : 'ASC'}`
    return this
  }
  limit(n: number): this {
    this.limitN = n
    return this
  }
  maybeSingle(): this {
    this.single = true
    return this
  }
  upsert(rows: Row[], opts: { onConflict?: string } = {}): this {
    this.op = 'upsert'
    this.rows = rows
    this.conflict = (opts.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean)
    return this
  }
  delete(): this {
    this.op = 'delete'
    return this
  }

  private sql(): string {
    const where = this.where.length ? ` WHERE ${this.where.join(' AND ')}` : ''
    if (this.op === 'delete') return `DELETE FROM public.${ident(this.table)}${where}`
    if (this.op === 'upsert') {
      const cols = Object.keys(this.rows[0] ?? {})
      const values = this.rows.map((r) => `(${cols.map((c) => {
        const v = r[c]
        return this.param(v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v)
      }).join(', ')})`)
      const update = cols.filter((c) => !this.conflict.includes(c)).map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`)
      return `INSERT INTO public.${ident(this.table)} (${cols.map(ident).join(', ')}) VALUES ${values.join(', ')}` +
        (this.conflict.length ? ` ON CONFLICT (${this.conflict.map(ident).join(', ')}) DO UPDATE SET ${update.join(', ')}` : '')
    }
    return `SELECT ${this.cols === '*' ? '*' : selectList(this.cols)} FROM public.${ident(this.table)}${where}` +
      (this.orderBy ? ` ORDER BY ${this.orderBy}` : '') +
      (this.limitN !== null ? ` LIMIT ${Math.trunc(this.limitN)}` : '')
  }

  private async exec(): Promise<Result> {
    try {
      if (this.op === 'upsert' && this.rows.length === 0) return { data: null, error: null }
      const rows = (await this.run(this.sql(), this.params)).map((r) => {
        const out: Row = {}
        for (const [k, v] of Object.entries(r)) out[k] = normalise(v)
        return out
      })
      if (this.op !== 'select') return { data: null, error: null }
      return { data: this.single ? rows[0] ?? null : rows, error: null }
    } catch (err) {
      const e = err as { message?: string; code?: string }
      return { data: null, error: { message: e.message ?? String(err), code: e.code } }
    }
  }

  then<A = Result, B = never>(onOk?: ((r: Result) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec().then(onOk, onErr)
  }
}

/** Service role for one query; a failed query rolls back to its savepoint (the test transaction stays usable). */
async function asServiceSafe<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT as_service')
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
  await db.query('SET LOCAL ROLE service_role')
  try {
    const out = await fn()
    await db.query('RESET ROLE')
    await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    await db.query('RELEASE SAVEPOINT as_service')
    return out
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT as_service')
    await db.query('RELEASE SAVEPOINT as_service')
    throw err
  }
}

/**
 * Client acting as `userId` (RLS) or, with null, as the service role.
 * pg returns NUMERIC as text; the metric columns read by the code under test
 * are cast where they matter (tests compare with `::float8`).
 */
export function pgSupabase(db: Db, userId: string | null): SupabaseClient {
  let chain: Promise<unknown> = Promise.resolve()
  const run = (sql: string, params: unknown[]): Promise<Row[]> => {
    const exec = async () => {
      const q = () => db.query(sql, params)
      const res = userId ? await asUser(db, userId, q) : await asServiceSafe(db, q)
      return res.rows as Row[]
    }
    const next = chain.then(exec, exec)
    chain = next.catch(() => undefined)
    return next
  }
  return { from: (table: string) => new Query(table, run) } as unknown as SupabaseClient
}
