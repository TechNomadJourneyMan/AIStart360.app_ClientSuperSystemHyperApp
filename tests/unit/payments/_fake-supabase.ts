/**
 * Minimal in-memory stand-in for the service-role Supabase client used by
 * lib/payments/billing.ts: from(table).select/eq/in/order/limit/maybeSingle,
 * insert, update(...).eq(...).select(), and rpc(name, args) dispatched to a
 * handler the test provides. Enough to exercise the billing service end to end
 * without PostgREST; the SQL itself is covered by tests/integration/db.
 */

export type Row = Record<string, unknown>
export interface FakeError { code?: string; message: string }
export type RpcHandler = (name: string, args: Record<string, unknown>, db: FakeDb) => { data?: unknown; error?: FakeError | null }

export interface FakeDb {
  tables: Record<string, Row[]>
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  /** Order of side effects: 'audit:<action>' / 'rpc:<name>'. */
  log: string[]
  /** Make inserts into admin_audit_log fail. */
  auditFails: boolean
  /** Per-table select error (e.g. a missing column). */
  selectError: Record<string, FakeError | undefined>
}

export function fakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  return { tables: { admin_audit_log: [], ...tables }, rpcCalls: [], log: [], auditFails: false, selectError: {} }
}

class Query implements PromiseLike<{ data: unknown; error: FakeError | null }> {
  private filters: Array<(r: Row) => boolean> = []
  private orderBy: { col: string; asc: boolean } | null = null
  private max: number | null = null
  private single = false
  private patch: Row | null = null

  constructor(private db: FakeDb, private table: string) {}

  select(): this { return this }
  eq(col: string, v: unknown): this { this.filters.push((r) => r[col] === v); return this }
  in(col: string, vs: unknown[]): this { this.filters.push((r) => vs.includes(r[col])); return this }
  order(col: string, o?: { ascending?: boolean }): this { this.orderBy = { col, asc: o?.ascending !== false }; return this }
  limit(n: number): this { this.max = n; return this }
  maybeSingle(): this { this.single = true; return this }
  update(patch: Row): this { this.patch = patch; return this }

  insert(row: Row): Promise<{ data: null; error: FakeError | null }> {
    if (this.table === 'admin_audit_log') {
      if (this.db.auditFails) return Promise.resolve({ data: null, error: { message: 'audit down' } })
      this.db.log.push(`audit:${String(row.action)}`)
    }
    ;(this.db.tables[this.table] ??= []).push(row)
    return Promise.resolve({ data: null, error: null })
  }

  private run(): { data: unknown; error: FakeError | null } {
    const err = this.db.selectError[this.table]
    if (err && !this.patch) return { data: null, error: err }
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)))
    if (this.patch) {
      for (const r of rows) Object.assign(r, this.patch)
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      rows = [...rows].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1))
    }
    if (this.max !== null) rows = rows.slice(0, this.max)
    if (this.single) return { data: rows[0] ? { ...rows[0] } : null, error: null }
    return { data: rows.map((r) => ({ ...r })), error: null }
  }

  then<A = { data: unknown; error: FakeError | null }, B = never>(
    ok?: ((v: { data: unknown; error: FakeError | null }) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, fail)
  }
}

export function fakeClient(db: FakeDb, rpc: RpcHandler) {
  return {
    from: (table: string) => new Query(db, table),
    rpc: (name: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ name, args })
      db.log.push(`rpc:${name}`)
      const r = rpc(name, args, db)
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
  }
}

/**
 * A faithful-enough model of billing_set_plan / billing_due_expirations
 * (migration 106) over the fake tables, for service-level tests.
 */
export const sqlModel: RpcHandler = (name, args, db) => {
  const subs = (db.tables.subscriptions ??= [])
  const profiles = db.tables.profiles ?? []
  const nowIso = new Date().toISOString().replace('Z', '')
  const expired = (s: Row, now: string) =>
    (s.status === 'trialing' && s.trialEndsAt != null && String(s.trialEndsAt) <= now) ||
    ((s.status === 'active' || s.status === 'past_due') && s.currentPeriodEnd != null && String(s.currentPeriodEnd) <= now)

  if (name === 'billing_due_expirations') {
    const now = String(args.p_now).replace('Z', '')
    const companies = db.tables.companies ?? []
    return {
      data: subs.filter((s) => expired(s, now)).map((s) => ({
        org_id: s.orgId,
        user_id: (companies.find((c) => c.id === s.orgId)?.user_id as string | undefined) ?? (profiles.find((p) => p.id === s.orgId)?.id ?? null),
        tier: s.tier,
        status: s.status,
        ends_at: s.status === 'trialing' ? s.trialEndsAt : s.currentPeriodEnd,
      })),
    }
  }
  if (name !== 'billing_set_plan') return { error: { code: 'PGRST202', message: `no function ${name}` } }

  const org = String(args.p_org_id)
  const before = subs.find((s) => s.orgId === org)
  if (args.p_only_if_expired && !(before && expired(before, nowIso))) return { data: { applied: false, reason: 'not_expired' } }
  const profile = args.p_user_id ? profiles.find((p) => p.id === args.p_user_id) : undefined
  if (args.p_user_id && !profile) return { error: { code: 'P0002', message: 'profile not found' } }
  const tier = String(args.p_tier)
  const end = args.p_period_end ? String(args.p_period_end).replace('Z', '') : null
  let after: Row | undefined = before
  if (tier === 'free') {
    if (before) Object.assign(before, { status: 'canceled', source: args.p_source, note: args.p_note, assignedBy: args.p_actor, updatedAt: nowIso })
  } else {
    after = before ?? { orgId: org }
    Object.assign(after, {
      tier,
      status: tier === 'pilot' ? 'trialing' : 'active',
      provider: args.p_provider ?? null,
      trialEndsAt: tier === 'pilot' ? end : (after.trialEndsAt ?? null),
      currentPeriodEnd: tier === 'pilot' ? null : end,
      source: args.p_source,
      note: args.p_note ?? null,
      assignedBy: args.p_actor,
      updatedAt: nowIso,
    })
    if (!before) subs.push(after)
  }
  if (profile) profile.tier = tier === 'free' ? 'free' : 'pro'
  return { data: { applied: true, after: after ? { ...after } : null, profile_tier: profile ? profile.tier : null } }
}
