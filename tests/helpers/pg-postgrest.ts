/**
 * A PostgREST-shaped Supabase client over ONE pg connection of the disposable test DB (R3-PB, the end-to-end test of
 * Точка Б on the real schema). The app code under test runs unchanged — its supabase-js calls become SQL with the
 * real constraints, triggers and RLS of the migrations — inside the test's rolled-back transaction
 * (tests/helpers/pg-rls.ts inRollback).
 *
 * Roles: `pgPostgrest(db, null)` acts as the service role (BYPASSRLS, like createServiceClient()); with a user id it
 * acts as that user through `authenticated` + JWT claims (real RLS). Every query runs in its own savepoint, so a
 * refused one (a CHECK, a unique index) leaves the transaction usable — like a PostgREST request. Queries are
 * serialised: the role switch is per query and the connection is shared.
 *
 * Supported subset (what lib/point-b, lib/goals and their helpers use):
 *   from(t).select(cols?, { count?, head? }) · insert(row | rows) · update(patch) · upsert(rows, { onConflict, ignoreDuplicates })
 *   · delete() — then .select(cols) for RETURNING; filters eq / neq / gt / gte / lt / lte / in / is / not(col, 'is', null) /
 *   like / ilike, `col->>key` on the left; order (several, nullsFirst), limit, range, single, maybeSingle.
 * Values: jsonb / json columns get JSON text, arrays stay arrays; NUMERIC and BIGINT come back as numbers, timestamps
 * as ISO strings, DATE as 'YYYY-MM-DD' (as PostgREST's JSON). Errors carry the Postgres code (23505, 23514, 42P01…);
 * single() without exactly one row → PGRST116.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'
import { asUser, type Db } from './pg-rls'

type Row = Record<string, unknown>
type PgError = { message: string; code?: string; details?: string | null; hint?: string | null }
type Result = { data: unknown; error: PgError | null; count?: number | null; status: number }

const TYPES = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
    if (oid === 1082) return (v: string) => v // date
    if (oid === 1700 || oid === 20) return (v: string) => (v === null ? null : Number(v)) // numeric, int8
    return pg.types.getTypeParser(oid, format)
  }) as typeof pg.types.getTypeParser,
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`pg-postgrest: bad identifier ${name}`)
  return `"${name}"`
}

/** A column, or `col->>key` / `col->key`. */
function colExpr(c: string): string {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:(->>|->)([A-Za-z_][A-Za-z0-9_]*))?$/.exec(c.trim())
  if (!m) throw new Error(`pg-postgrest: unsupported column ${c}`)
  return m[2] ? `${ident(m[1])}${m[2]}'${m[3]}'` : ident(m[1])
}

function selectList(cols: string): string {
  const t = cols.trim()
  if (!t || t === '*') return '*'
  return t.split(',').map((c) => c.trim()).filter(Boolean).map((c) => {
    const m = /^(?:([A-Za-z_][A-Za-z0-9_]*):)?(.+)$/.exec(c)!
    if (m[2].includes('(')) throw new Error(`pg-postgrest: embedded selects are not supported (${c})`)
    const expr = colExpr(m[2])
    const json = /->>?([A-Za-z_][A-Za-z0-9_]*)$/.exec(m[2])
    const alias = m[1] ?? (json ? json[1] : null)
    return alias ? `${expr} AS ${ident(alias)}` : expr
  }).join(', ')
}

function normalise(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v
}

type Run = (sql: string, params: unknown[]) => Promise<Row[]>
type ColTypes = (table: string) => Promise<Map<string, string>>

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private cols: string | null = null
  private returning = false
  private where: string[] = []
  private params: unknown[] = []
  private orders: string[] = []
  private limitN: number | null = null
  private offsetN: number | null = null
  private singleMode: 'one' | 'maybe' | null = null
  private rows: Row[] = []
  private patch: Row = {}
  private conflict: string[] = []
  private ignoreDuplicates = false
  private countMode = false
  private headOnly = false

  constructor(private readonly table: string, private readonly run: Run, private readonly types: ColTypes) {}

  private p(v: unknown): string {
    this.params.push(v)
    return `$${this.params.length}`
  }

  select(cols = '*', opts: { count?: string; head?: boolean } = {}): this {
    if (this.op === 'select') {
      this.cols = cols
      this.countMode = !!opts.count
      this.headOnly = !!opts.head
    } else {
      this.cols = cols
      this.returning = true
    }
    return this
  }
  insert(rows: Row | Row[]): this { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this }
  update(patch: Row): this { this.op = 'update'; this.patch = patch; return this }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = 'upsert'
    this.rows = Array.isArray(rows) ? rows : [rows]
    this.conflict = (opts.onConflict ?? 'id').split(',').map((c) => c.trim()).filter(Boolean)
    this.ignoreDuplicates = opts.ignoreDuplicates === true
    return this
  }
  delete(): this { this.op = 'delete'; return this }

  private cmp(col: string, sqlOp: string, v: unknown): this { this.where.push(`${colExpr(col)} ${sqlOp} ${this.p(v)}`); return this }
  eq(col: string, v: unknown): this { return this.cmp(col, '=', v) }
  neq(col: string, v: unknown): this { return this.cmp(col, '<>', v) }
  gt(col: string, v: unknown): this { return this.cmp(col, '>', v) }
  gte(col: string, v: unknown): this { return this.cmp(col, '>=', v) }
  lt(col: string, v: unknown): this { return this.cmp(col, '<', v) }
  lte(col: string, v: unknown): this { return this.cmp(col, '<=', v) }
  like(col: string, v: unknown): this { return this.cmp(col, 'LIKE', v) }
  ilike(col: string, v: unknown): this { return this.cmp(col, 'ILIKE', v) }
  in(col: string, vs: unknown[]): this {
    this.where.push(`${colExpr(col)}::text = ANY(${this.p((vs ?? []).map((v) => String(v)))}::text[])`)
    return this
  }
  is(col: string, v: null | boolean): this {
    this.where.push(`${colExpr(col)} IS ${v === null ? 'NULL' : v ? 'TRUE' : 'FALSE'}`)
    return this
  }
  not(col: string, op: string, v: unknown): this {
    if (op === 'is') this.where.push(`${colExpr(col)} IS NOT ${v === null || v === 'null' ? 'NULL' : v ? 'TRUE' : 'FALSE'}`)
    else if (op === 'eq') this.where.push(`${colExpr(col)} IS DISTINCT FROM ${this.p(v)}`)
    else throw new Error(`pg-postgrest: unsupported not(${op})`)
    return this
  }
  order(col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    const dir = opts.ascending === false ? 'DESC' : 'ASC'
    const nulls = opts.nullsFirst === undefined ? '' : opts.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'
    this.orders.push(`${colExpr(col)} ${dir}${nulls}`)
    return this
  }
  limit(n: number): this { this.limitN = Math.trunc(n); return this }
  range(from: number, to: number): this { this.offsetN = Math.trunc(from); this.limitN = Math.trunc(to - from + 1); return this }
  maybeSingle(): this { this.singleMode = 'maybe'; return this }
  single(): this { this.singleMode = 'one'; return this }

  private async value(col: string, v: unknown): Promise<unknown> {
    if (v === undefined || v === null) return null
    const t = (await this.types(this.table)).get(col)
    if (t === 'jsonb' || t === 'json') return JSON.stringify(v)
    if (v instanceof Date) return v.toISOString()
    return v
  }

  private async sql(): Promise<string> {
    const where = this.where.length ? ` WHERE ${this.where.join(' AND ')}` : ''
    const ret = this.returning ? ` RETURNING ${selectList(this.cols ?? '*')}` : ''
    const T = `public.${ident(this.table)}`
    if (this.op === 'delete') return `DELETE FROM ${T}${where}${ret}`
    if (this.op === 'update') {
      const sets: string[] = []
      for (const [c, v] of Object.entries(this.patch)) sets.push(`${ident(c)} = ${this.p(await this.value(c, v))}`)
      return `UPDATE ${T} SET ${sets.join(', ')}${where}${ret}`
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      const cols = [...new Set(this.rows.flatMap((r) => Object.keys(r)))]
      const values: string[] = []
      for (const r of this.rows) {
        const cells: string[] = []
        for (const c of cols) cells.push(Object.prototype.hasOwnProperty.call(r, c) ? this.p(await this.value(c, r[c])) : 'DEFAULT')
        values.push(`(${cells.join(', ')})`)
      }
      let sql = `INSERT INTO ${T} (${cols.map(ident).join(', ')}) VALUES ${values.join(', ')}`
      if (this.op === 'upsert') {
        const update = cols.filter((c) => !this.conflict.includes(c)).map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`)
        sql += ` ON CONFLICT (${this.conflict.map(ident).join(', ')}) ${this.ignoreDuplicates || !update.length ? 'DO NOTHING' : `DO UPDATE SET ${update.join(', ')}`}`
      }
      return sql + ret
    }
    if (this.countMode && this.headOnly) return `SELECT count(*)::int AS n FROM ${T}${where}`
    return `SELECT ${selectList(this.cols ?? '*')} FROM ${T}${where}` +
      (this.orders.length ? ` ORDER BY ${this.orders.join(', ')}` : '') +
      (this.limitN !== null ? ` LIMIT ${this.limitN}` : '') +
      (this.offsetN !== null ? ` OFFSET ${this.offsetN}` : '')
  }

  private async exec(): Promise<Result> {
    try {
      if ((this.op === 'insert' || this.op === 'upsert') && this.rows.length === 0) return { data: [], error: null, status: 201 }
      const rows = (await this.run(await this.sql(), this.params)).map((r) => {
        const out: Row = {}
        for (const [k, v] of Object.entries(r)) out[k] = normalise(v)
        return out
      })
      if (this.countMode && this.headOnly) return { data: null, error: null, count: Number(rows[0]?.n ?? 0), status: 200 }
      if (this.op !== 'select' && !this.returning) return { data: null, error: null, status: this.op === 'insert' ? 201 : 204 }
      if (this.singleMode) {
        if (rows.length === 1) return { data: rows[0], error: null, status: 200 }
        if (rows.length === 0 && this.singleMode === 'maybe') return { data: null, error: null, status: 200 }
        return { data: null, error: { code: 'PGRST116', message: `JSON object requested, ${rows.length} rows returned` }, status: 406 }
      }
      return { data: rows, error: null, count: this.countMode ? rows.length : null, status: 200 }
    } catch (err) {
      const e = err as PgError
      return { data: null, error: { message: e.message ?? String(err), code: e.code, details: e.details ?? null, hint: e.hint ?? null }, status: 400 }
    }
  }

  then<A = Result, B = never>(onOk?: ((r: Result) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec().then(onOk, onErr)
  }
}

async function asServiceSafe<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT pgrest_service')
  await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
  await db.query('SET LOCAL ROLE service_role')
  try {
    const out = await fn()
    await db.query('RESET ROLE')
    await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    await db.query('RELEASE SAVEPOINT pgrest_service')
    return out
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT pgrest_service')
    await db.query('RELEASE SAVEPOINT pgrest_service')
    await db.query('RESET ROLE').catch(() => undefined)
    throw err
  }
}

export interface PgPostgrest extends SupabaseClient {
  /** Every SQL statement sent, in order (debugging a test). */
  readonly sqlLog: string[]
}

/** A client acting as `userId` (RLS) or, with null, as the service role. */
export function pgPostgrest(db: Db, userId: string | null): PgPostgrest {
  let chain: Promise<unknown> = Promise.resolve()
  const log: string[] = []
  const run: Run = (sql, params) => {
    const exec = async () => {
      log.push(sql)
      const q = () => db.query({ text: sql, values: params, types: TYPES })
      const res = userId ? await asUser(db, userId, q) : await asServiceSafe(db, q)
      return res.rows as Row[]
    }
    const next = chain.then(exec, exec)
    chain = next.catch(() => undefined)
    return next
  }
  const cache = new Map<string, Promise<Map<string, string>>>()
  const types: ColTypes = (table) => {
    let p = cache.get(table)
    if (!p) {
      p = run(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])
        .then((rows) => new Map(rows.map((r) => [String(r.column_name), String(r.data_type)])))
      cache.set(table, p)
    }
    return p
  }
  return {
    from: (table: string) => new Query(table, run, types),
    rpc: () => { throw new Error('pg-postgrest: rpc is not supported') },
    get sqlLog() { return log },
  } as unknown as PgPostgrest
}
